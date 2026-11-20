'use server';

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import { requireActionRubrique } from '@/lib/auth';
import {
  STATUTS_INACTIFS_SQL, verrouillerActivite, compterConfirmes, synchroniserPlaces, estViolationUnicite,
} from '@/lib/inscriptions';

interface ActiviteFormData {
  titre: string;
  description?: string | null;
  espaceId: string;
  date: string;
  heureDebut: string;
  heureFin: string;
  lieu?: string | null;
  animateur?: string | null;
  placesTotal: number;
  statut?: string;
  tags?: string[];
}

const PATHS = ['/admin/activites', '/animateur/activites'];

function revalidateActivite(id: string) {
  PATHS.forEach(p => revalidatePath(p));
  revalidatePath(`/admin/activites/${id}`);
  revalidatePath(`/animateur/activites/${id}`);
}

/**
 * MATRICE D'ACCÈS de ce fichier
 *
 *   Rôle    : tout membre authentifié de la structure (admin ou animateur).
 *             Les fiches activité sont gérées par l'équipe entière — les
 *             écrans /admin/activites et /animateur/activites appellent les
 *             mêmes actions, et une activité n'a pas de propriétaire en base
 *             (`animateur` est un nom libre, pas un identifiant).
 *   Tenant  : TOUJOURS celui de la session, jamais un paramètre. Il est
 *             appliqué à chaque lecture ET à chaque écriture, y compris sur
 *             les tables enfants (inscriptions, pointages).
 *
 * Une Server Action est un point d'entrée HTTP public : la protection de
 * navigation (middleware, pages) ne la couvre pas. Avant ce contrôle, un
 * utilisateur connecté d'une commune B connaissant un identifiant de la
 * commune A pouvait modifier son activité ou la supprimer avec ses
 * inscriptions et pointages.
 */

/** L'espace choisi dans le formulaire doit appartenir à la structure. */
async function espaceDuTenant(client: PoolClient | typeof pool, espaceId: string, tenantId: string): Promise<boolean> {
  const res = await client.query('SELECT 1 FROM espaces WHERE id = $1 AND tenant_id = $2', [espaceId, tenantId]);
  return res.rows.length > 0;
}

/**
 * Le nombre de places vient d'un formulaire : le type TypeScript ne garantit
 * rien à l'exécution. Un nombre négatif ou non entier fausserait tous les
 * calculs de capacité (et la base le refuse par contrainte CHECK).
 */
function placesValides(placesTotal: unknown): placesTotal is number {
  return typeof placesTotal === 'number' && Number.isInteger(placesTotal) && placesTotal >= 0;
}
const ERREUR_PLACES = 'Le nombre de places doit être un entier positif ou nul.';

function messageErreur(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Erreur inconnue';
}

export async function creerActivite(data: ActiviteFormData): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const user = await requireActionRubrique('activites');
    if (!user) return { success: false, error: 'Non authentifié' };
    const tenant_id = user.tenant_id;

    if (!placesValides(data.placesTotal)) return { success: false, error: ERREUR_PLACES };
    if (!await espaceDuTenant(pool, data.espaceId, tenant_id)) {
      return { success: false, error: 'Espace introuvable' };
    }

    const id = `act-${randomUUID()}`;
    await pool.query(`
      INSERT INTO activites (id, titre, description, espace_id, date, heure_debut, heure_fin, lieu, animateur, places_total, places_disponibles, statut, tags, tenant_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    `, [
      id, data.titre, data.description || null, data.espaceId, data.date,
      data.heureDebut, data.heureFin, data.lieu || null, data.animateur || null,
      data.placesTotal, data.placesTotal, data.statut || 'ouvert', data.tags || [], tenant_id,
    ]);

    revalidateActivite(id);
    return { success: true, id };
  } catch (e: unknown) {
    return { success: false, error: messageErreur(e) };
  }
}

export async function modifierActivite(id: string, data: ActiviteFormData): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireActionRubrique('activites');
    if (!user) return { success: false, error: 'Non authentifié' };
    const tenant_id = user.tenant_id;
    if (!placesValides(data.placesTotal)) return { success: false, error: ERREUR_PLACES };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Appartenance vérifiée ET verrou pris : une activité d'une autre
      // structure est « introuvable », exactement comme un identifiant inconnu
      // (on ne révèle pas son existence).
      const activite = await verrouillerActivite(client, id, tenant_id);
      if (!activite) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Activité introuvable' };
      }

      if (!await espaceDuTenant(client, data.espaceId, tenant_id)) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Espace introuvable' };
      }

      // Réduire le nombre de places sous le nombre d'inscrits déjà confirmés
      // créerait un surbooking silencieux (personne n'est rétrogradé). Refus
      // uniquement en cas de RÉDUCTION : une activité déjà en dépassement
      // (données antérieures) reste modifiable.
      const confirmes = await compterConfirmes(client, id, tenant_id);
      const anciennesPlaces = activite.placesTotal ?? 0;
      if (data.placesTotal < anciennesPlaces && data.placesTotal < confirmes) {
        await client.query('ROLLBACK');
        return {
          success: false,
          error: `Impossible de réduire à ${data.placesTotal} places : ${confirmes} inscriptions sont déjà confirmées.`,
        };
      }

      await client.query(`
        UPDATE activites SET
          titre=$2, description=$3, espace_id=$4, date=$5, heure_debut=$6, heure_fin=$7,
          lieu=$8, animateur=$9, places_total=$10,
          places_disponibles = GREATEST(0, $10::int - $13::int),
          statut=$11, tags=$12
        WHERE id=$1 AND tenant_id=$14
      `, [
        id, data.titre, data.description || null, data.espaceId, data.date,
        data.heureDebut, data.heureFin, data.lieu || null, data.animateur || null,
        data.placesTotal, data.statut, data.tags || [],
        confirmes, tenant_id,
      ]);

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    revalidateActivite(id);
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: messageErreur(e) };
  }
}

export async function supprimerActivite(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireActionRubrique('activites');
    if (!user) return { success: false, error: 'Non authentifié' };
    const tenant_id = user.tenant_id;

    // Transaction obligatoire : un échec sur la dernière requête laissait
    // l'activité en base alors que ses pointages et inscriptions étaient
    // déjà supprimés, sans retour arrière possible.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // L'appartenance est vérifiée AVANT toute suppression. Auparavant les
      // enfants étaient effacés sur le seul identifiant d'activité, sans
      // tenant : les inscriptions et pointages d'une autre structure
      // partaient avant même que l'on sache si l'activité était la nôtre.
      const activite = await verrouillerActivite(client, id, tenant_id);
      if (!activite) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Activité introuvable' };
      }

      // Le tenant est répété sur chaque suppression d'enfants : même si une
      // ligne d'une autre structure référençait par erreur cette activité,
      // elle ne serait pas effacée ici.
      await client.query('DELETE FROM pointages WHERE activite_id = $1 AND tenant_id = $2', [id, tenant_id]);
      await client.query('DELETE FROM inscriptions WHERE activite_id = $1 AND tenant_id = $2', [id, tenant_id]);
      const result = await client.query('DELETE FROM activites WHERE id = $1 AND tenant_id = $2', [id, tenant_id]);

      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Activité introuvable' };
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    PATHS.forEach(p => revalidatePath(p));
    return { success: true };
  } catch (e: unknown) {
    console.error('[supprimerActivite]', e);
    return { success: false, error: messageErreur(e) };
  }
}

export async function ajouterInscriptionManuelle(
  activiteId: string,
  activiteTitre: string,
  espaceId: string,
  jeuneId: string | null,
  jeuneNom: string,
  jeunePrenom: string,
): Promise<{ success: boolean; statut?: 'confirmee' | 'liste-attente'; error?: string }> {
  try {
    const user = await requireActionRubrique('activites', 'inscriptions');
    if (!user) return { success: false, error: 'Non authentifié' };
    const tenant_id = user.tenant_id;

    // Transaction + verrou + recalcul depuis le COUNT réel des inscriptions
    // confirmées (au lieu d'un décrément direct de places_disponibles) : même
    // pattern que POST /api/inscriptions, pour éviter tout surbooking en cas
    // d'inscriptions concurrentes. Filtre tenant_id systématique.
    let statut: 'confirmee' | 'liste-attente';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Verrou activité D'ABORD : le contrôle de doublon était fait avant,
      //    deux ajouts simultanés du même jeune passaient tous les deux.
      const activite = await verrouillerActivite(client, activiteId, tenant_id);
      if (!activite) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Activité introuvable' };
      }

      // Espace de l'inscription : celui du jeune s'il est connu, sinon celui de
      // l'activité — lus en base. Les paramètres `espaceId`/`activiteTitre`
      // (contrôlés par le client) ne servent plus que de repli.
      let espaceInscription: string | null = activite.espaceId ?? espaceId;

      if (jeuneId) {
        // Le jeune doit appartenir à la structure : sinon un identifiant
        // extérieur pouvait être rattaché à l'activité.
        const jeune = await client.query<{ espace_id: string | null }>(
          'SELECT espace_id FROM jeunes WHERE id = $1 AND tenant_id = $2', [jeuneId, tenant_id]);
        if (jeune.rows.length === 0) {
          await client.query('ROLLBACK');
          return { success: false, error: 'Jeune introuvable' };
        }
        espaceInscription = jeune.rows[0].espace_id ?? espaceInscription;

        // 2. Doublon, lu sous verrou. Seules les inscriptions ACTIVES
        //    comptent (même définition que l'index unique en base) : un
        //    jeune refusé ou annulé peut être réinscrit.
        const dup = await client.query(
          `SELECT id FROM inscriptions
           WHERE activite_id = $1 AND jeune_id = $2 AND tenant_id = $3
             AND statut NOT IN (${STATUTS_INACTIFS_SQL})`,
          [activiteId, jeuneId, tenant_id],
        );
        if (dup.rows.length > 0) {
          await client.query('ROLLBACK');
          return { success: false, error: 'Ce jeune est déjà inscrit à cette activité.' };
        }
      }

      // 3. Capacité, comptée sous verrou.
      const confirmes = await compterConfirmes(client, activiteId, tenant_id);
      statut = confirmes < (activite.placesTotal ?? 0) ? 'confirmee' : 'liste-attente';

      const id = `ins-${randomUUID()}`;
      await client.query(`
        INSERT INTO inscriptions (id, jeune_id, jeune_nom, jeune_prenom, activite_id, activite_titre, espace_id, date_inscription, statut, manuel, tenant_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8,true,$9)
      `, [
        id, jeuneId, jeuneNom.toUpperCase(), jeunePrenom, activiteId,
        activite.titre || activiteTitre, espaceInscription, statut, tenant_id,
      ]);

      // Resynchroniser les places disponibles depuis le comptage réel
      await synchroniserPlaces(client, activiteId, tenant_id);

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      if (estViolationUnicite(e)) {
        return { success: false, error: 'Ce jeune est déjà inscrit à cette activité.' };
      }
      throw e;
    } finally {
      client.release();
    }

    revalidateActivite(activiteId);
    return { success: true, statut };
  } catch (e: unknown) {
    return { success: false, error: messageErreur(e) };
  }
}
