'use server';

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import { getTenantId, requireActionRubrique } from '@/lib/auth';
import { verrouillerActivite, promouvoirPremierEnAttente, synchroniserPlaces } from '@/lib/inscriptions';
import { ERREUR_ESPACE_INCONNU, espaceDeLaCommune } from '@/lib/espaces';
import { analyserFicheAgora, nettoyerNomFicheAgora } from '@/lib/fiche-agora';
import { verrouillerSortie, retirerParticipant, type SortieVerrouillee } from '@/lib/sorties';
import { COLONNES_SANTE_ECRITURE, valeursSante, type SanteJeune } from '@/lib/jeune-sante';

interface ContactData {
  nom?: string | null;
  lien?: string | null;
  telephone?: string | null;
  email?: string | null;
}

interface JeuneFormData extends Partial<SanteJeune> {
  nom: string;
  prenom: string;
  dateNaissance?: string | null;
  sexe: string;
  secteur?: string | null;
  espaceId: string;
  etablissement?: string | null;
  classe?: string | null;
  observations?: string | null;
  autorisationSortie?: boolean;
  autorisationPhoto?: boolean;
  autorisationSoinsBenins?: boolean;
  adresse?: string | null;
  contacts?: ContactData[];
  /** Fiche AGORA : data URI base64 (nouveau fichier), null pour retirer, absent = inchangé. */
  ficheAgora?: string | null;
  ficheAgoraNom?: string | null;
  /** Édition « Fiche santé » : mêmes conventions que `ficheAgora`. */
  ficheSante?: string | null;
  ficheSanteNom?: string | null;
}

/** Pièce AGORA à écrire : `undefined` = ne pas y toucher, `null` = retirer. */
type PieceAgora = { dataUri: string; nom: string | null } | null | undefined;

/**
 * Valide la pièce AGORA reçue AVANT toute écriture (audit 2026-10-07, A1) :
 * le contrôle du formulaire vit dans le navigateur et ne protège rien.
 */
function lirePiece(contenu: string | null | undefined, nom: string | null | undefined, libelle: string): { piece: PieceAgora } | { erreur: string } {
  if (contenu === undefined) return { piece: undefined };
  if (contenu === null || contenu === '') return { piece: null };
  const analyse = analyserFicheAgora(contenu);
  if (!analyse.ok) return { erreur: analyse.erreur.replace(/^Fiche AGORA/, libelle) };
  return { piece: { dataUri: analyse.dataUri, nom: nettoyerNomFicheAgora(nom) } };
}

const lirePieceAgora = (data: JeuneFormData) => lirePiece(data.ficheAgora, data.ficheAgoraNom, 'Fiche AGORA');
const lirePieceSante = (data: JeuneFormData) => lirePiece(data.ficheSante, data.ficheSanteNom, 'Fiche santé');

/** `col1 = $n, col2 = $n+1, …` pour les colonnes sanitaires, à partir du paramètre `debut`. */
const affectationsSante = (debut: number) => COLONNES_SANTE_ECRITURE.map((c, i) => `${c} = $${debut + i}`).join(', ');

async function insererContacts(client: PoolClient, jeuneId: string, contacts: ContactData[] | undefined) {
  for (const c of contacts ?? []) {
    if (c.nom?.trim() || c.telephone?.trim()) {
      await client.query(
        'INSERT INTO jeunes_contacts (jeune_id, nom, lien, telephone, email) VALUES ($1,$2,$3,$4,$5)',
        [jeuneId, c.nom || null, c.lien || null, c.telephone || null, c.email || null],
      );
    }
  }
}

const ERREUR_ENREGISTREMENT = 'Enregistrement impossible : aucune modification n\'a été appliquée. Réessayez.';

export async function creerJeune(data: JeuneFormData): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    if (!await requireActionRubrique('jeunes')) return { success: false, error: 'Non authentifié' };
    const tenant_id = await getTenantId();
    const agora = lirePieceAgora(data);
    if ('erreur' in agora) return { success: false, error: agora.erreur };
    const sante = lirePieceSante(data);
    if ('erreur' in sante) return { success: false, error: sante.erreur };
    const id = `j-${randomUUID()}`;

    // Fiche, pièce AGORA et contacts sur UNE connexion, dans UNE transaction
    // (audit 2026-10-07, A2) : une panne en cours de route ne laisse pas une
    // fiche sans ses contacts d'urgence.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // L'espace doit appartenir à la commune de la session (audit 2026-10-07, A4).
      if (!await espaceDeLaCommune(client, data.espaceId, tenant_id)) {
        await client.query('ROLLBACK');
        return { success: false, error: ERREUR_ESPACE_INCONNU };
      }
      await client.query(`
        INSERT INTO jeunes (id, nom, prenom, date_naissance, sexe, secteur, espace_id, etablissement, classe, observations, autorisation_sortie, autorisation_photo, autorisation_soins_benins, adresse, created_at, tenant_id, fiche_agora, fiche_agora_nom)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),$15,$16,$17)
      `, [
        id, data.nom, data.prenom, data.dateNaissance || null, data.sexe, data.secteur || null,
        data.espaceId, data.etablissement || null, data.classe || null, data.observations || null,
        data.autorisationSortie ?? true, data.autorisationPhoto ?? true, data.autorisationSoinsBenins ?? true,
        data.adresse || null, tenant_id,
        agora.piece?.dataUri ?? null, agora.piece?.nom ?? null,
      ]);
      await client.query(
        `UPDATE jeunes SET ${affectationsSante(3)}, fiche_sante = $${COLONNES_SANTE_ECRITURE.length + 3}, fiche_sante_nom = $${COLONNES_SANTE_ECRITURE.length + 4}
         WHERE id = $1 AND tenant_id = $2`,
        [id, tenant_id, ...valeursSante(data), sante.piece?.dataUri ?? null, sante.piece?.nom ?? null],
      );
      await insererContacts(client, id, data.contacts);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    revalidatePath('/jeunes');
    revalidatePath('/dashboard');
    return { success: true, id };
  } catch (e: unknown) {
    console.error('[creerJeune]', e);
    return { success: false, error: ERREUR_ENREGISTREMENT };
  }
}

export async function modifierJeune(id: string, data: JeuneFormData): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireActionRubrique('jeunes');
    if (!user) return { success: false, error: 'Non authentifié' };
    const agora = lirePieceAgora(data);
    if ('erreur' in agora) return { success: false, error: agora.erreur };
    const sante = lirePieceSante(data);
    if ('erreur' in sante) return { success: false, error: sante.erreur };

    // Une connexion, une transaction (audit 2026-10-07, A2). Auparavant les
    // anciens contacts étaient supprimés puis réinsérés par des requêtes
    // indépendantes : une insertion en échec les effaçait définitivement,
    // alors que l'action annonçait un échec.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Verrou de la fiche : deux modifications simultanées passent l'une
      // après l'autre au lieu de mélanger leurs contacts.
      // Le filtre tenant_id est indispensable : sans lui, un identifiant deviné
      // permettrait de modifier la fiche d'un mineur d'une autre structure.
      const verrou = await client.query(
        'SELECT id FROM jeunes WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
        [id, user.tenant_id],
      );
      if (verrou.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Jeune introuvable' };
      }
      // L'espace doit appartenir à la commune de la session (audit 2026-10-07, A4).
      if (!await espaceDeLaCommune(client, data.espaceId, user.tenant_id)) {
        await client.query('ROLLBACK');
        return { success: false, error: ERREUR_ESPACE_INCONNU };
      }

      await client.query(`
        UPDATE jeunes SET nom=$2, prenom=$3, date_naissance=$4, sexe=$5, secteur=$6, espace_id=$7,
          etablissement=$8, classe=$9, observations=$10, autorisation_sortie=$11, autorisation_photo=$12,
          autorisation_soins_benins=$13, adresse=$14
        WHERE id=$1 AND tenant_id=$15
      `, [
        id, data.nom, data.prenom, data.dateNaissance || null, data.sexe, data.secteur || null,
        data.espaceId, data.etablissement || null, data.classe || null, data.observations || null,
        data.autorisationSortie ?? true, data.autorisationPhoto ?? true, data.autorisationSoinsBenins ?? true,
        data.adresse || null, user.tenant_id,
      ]);
      await client.query(
        `UPDATE jeunes SET ${affectationsSante(3)} WHERE id = $1 AND tenant_id = $2`,
        [id, user.tenant_id, ...valeursSante(data)],
      );

      // Fiche AGORA : mise à jour SEULEMENT si la clé est présente (nouveau fichier
      // ou retrait explicite). Le formulaire ne renvoyant pas le base64 existant,
      // on effacerait sinon le fichier à chaque simple modification du jeune.
      if (agora.piece !== undefined) {
        await client.query(
          'UPDATE jeunes SET fiche_agora = $2, fiche_agora_nom = $3 WHERE id = $1 AND tenant_id = $4',
          [id, agora.piece?.dataUri ?? null, agora.piece?.nom ?? null, user.tenant_id],
        );
      }
      // Fiche santé : même règle.
      if (sante.piece !== undefined) {
        await client.query(
          'UPDATE jeunes SET fiche_sante = $2, fiche_sante_nom = $3 WHERE id = $1 AND tenant_id = $4',
          [id, sante.piece?.dataUri ?? null, sante.piece?.nom ?? null, user.tenant_id],
        );
      }

      if (data.contacts !== undefined) {
        await client.query('DELETE FROM jeunes_contacts WHERE jeune_id=$1', [id]);
        await insererContacts(client, id, data.contacts);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    revalidatePath('/jeunes');
    revalidatePath(`/jeunes/${id}`);
    revalidatePath('/dashboard');
    return { success: true };
  } catch (e: unknown) {
    console.error('[modifierJeune]', e);
    return { success: false, error: ERREUR_ENREGISTREMENT };
  }
}

/**
 * Nombre de reprises de la suppression quand les inscriptions du jeune
 * changent pendant qu'on verrouille (voir `tenterSuppressionJeune`). Borne
 * volontairement basse : il faudrait qu'une nouvelle inscription du même jeune
 * arrive à chaque essai pour l'atteindre.
 */
const TENTATIVES_SUPPRESSION = 5;

/** Tri indépendant de la locale : le même ordre dans toutes les transactions. */
const trier = (ids: string[]): string[] => [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

type IssueSuppression = 'supprime' | 'introuvable' | 'recommencer';

/** SQLSTATE 40P01 — PostgreSQL a rompu un interblocage en annulant CETTE transaction. */
function estInterblocage(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '40P01';
}

/**
 * Une tentative de suppression, dans UNE transaction (ouverte ici, validée ici
 * si tout réussit, annulée par l'appelant en cas d'exception).
 *
 * Supprimer un jeune revient à le désister de chacune de ses activités et de
 * chacune de ses sorties : les mêmes règles s'appliquent donc que pour
 * DELETE /api/inscriptions et DELETE /api/sorties/participants (place libérée
 * → promotion du premier en attente → recalcul des places), sous les mêmes
 * verrous. Auparavant les lignes étaient effacées sans rien recalculer : une
 * activité restait affichée « complète » avec une place libre, et le premier
 * de la liste d'attente n'était jamais promu.
 *
 * ORDRE DES VERROUS (ne pas le changer sans relire tous les chemins) :
 *   1. activités concernées, identifiants triés ;
 *   2. sorties concernées, identifiants triés ;
 *   3. la fiche du jeune (FOR UPDATE), EN DERNIER.
 * Les autres chemins ne verrouillent qu'UNE activité ou UNE sortie, puis
 * écrivent une inscription ou un pointage — ce qui pose, par la clé étrangère,
 * un verrou partagé sur la fiche du jeune. Leur ordre est donc « activité →
 * jeune ». L'ancien code faisait l'inverse (jeune d'abord) : dès lors qu'il
 * doit aussi verrouiller les activités, il se serait interbloqué avec une
 * inscription simultanée du même jeune.
 *
 * Comme le jeune n'est verrouillé qu'à la fin, la liste de ses activités et
 * sorties est d'abord lue SANS verrou. Elle peut avoir grossi entre-temps :
 * on le constate sur les suppressions effectives et, plutôt que de verrouiller
 * une ressource supplémentaire hors de l'ordre trié, on annule tout et on
 * recommence ('recommencer').
 */
async function tenterSuppressionJeune(
  client: PoolClient,
  id: string,
  tenantId: string,
): Promise<IssueSuppression> {
  await client.query('BEGIN');

  // Appartenance vérifiée AVANT tout verrou et toute écriture : si l'id est
  // celui d'un jeune d'une autre structure, on s'arrête ici sans rien toucher.
  const cible = await client.query(
    'SELECT id FROM jeunes WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  if (cible.rowCount === 0) {
    await client.query('ROLLBACK');
    return 'introuvable';
  }

  // Ressources communes à verrouiller (lecture indicative, sans verrou).
  const insLues = await client.query<{ activiteId: string }>(
    `SELECT DISTINCT activite_id AS "activiteId" FROM inscriptions
     WHERE jeune_id = $1 AND tenant_id = $2 AND activite_id IS NOT NULL`,
    [id, tenantId],
  );
  // `sorties_participants` n'a pas de colonne tenant : le rattachement à la
  // structure passe par la sortie.
  const sortiesLues = await client.query<{ sortieId: string }>(
    `SELECT sp.sortie_id AS "sortieId" FROM sorties_participants sp
     JOIN sorties s ON s.id = sp.sortie_id
     WHERE sp.jeune_id = $1 AND s.tenant_id = $2`,
    [id, tenantId],
  );
  const activiteIds = trier(insLues.rows.map(r => r.activiteId));
  const sortieIds = trier(sortiesLues.rows.map(r => r.sortieId));

  // 1. Activités, puis 2. sorties — mêmes verrous que les désistements.
  // Une ressource disparue entre-temps (supprimée par un autre utilisateur,
  // avec ses inscriptions) est simplement ignorée : il n'y a plus de place à
  // y recalculer.
  const activitesVerrouillees = new Set<string>();
  for (const activiteId of activiteIds) {
    if (await verrouillerActivite(client, activiteId, tenantId)) activitesVerrouillees.add(activiteId);
  }
  const sortiesVerrouillees = new Map<string, SortieVerrouillee>();
  for (const sortieId of sortieIds) {
    const sortie = await verrouillerSortie(client, sortieId, tenantId);
    if (sortie) sortiesVerrouillees.set(sortieId, sortie);
  }

  // 3. La fiche du jeune. À partir d'ici plus aucune inscription, aucun
  // pointage ni aucune participation à une sortie ne peut lui être rattaché
  // (leur clé étrangère — et le verrou FOR KEY SHARE pris explicitement par
  // l'ajout à une sortie, lib/sorties.ts — attendent ce verrou) :
  // ce que les DELETE ci-dessous renvoient est donc définitif.
  const verrou = await client.query(
    'SELECT id FROM jeunes WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
    [id, tenantId],
  );
  if (verrou.rowCount === 0) {
    // Supprimé par quelqu'un d'autre pendant l'attente des verrous.
    await client.query('ROLLBACK');
    return 'introuvable';
  }

  // Toutes les écritures portent le tenant de la session, enfants compris :
  // la vérification de la fiche suffit à protéger les autres structures
  // (l'identifiant d'un jeune est unique toutes structures confondues), mais
  // une ligne rattachée par erreur à une autre structure ne doit pas partir
  // dans une suppression lancée depuis celle-ci.
  await client.query('DELETE FROM pointages WHERE jeune_id = $1 AND tenant_id = $2', [id, tenantId]);

  // Sorties : retrait + promotion du premier en attente, sortie par sortie.
  for (const [sortieId, sortie] of sortiesVerrouillees) {
    await retirerParticipant(client, sortieId, id, sortie);
  }
  // Une participation ajoutée depuis la lecture initiale concerne une sortie
  // que nous n'avons pas verrouillée : on ne peut ni la laisser (elle
  // pointerait vers un jeune disparu) ni la traiter sans son verrou.
  const participationsRestantes = await client.query(
    `SELECT 1 FROM sorties_participants sp
     JOIN sorties s ON s.id = sp.sortie_id
     WHERE sp.jeune_id = $1 AND s.tenant_id = $2
     LIMIT 1`,
    [id, tenantId],
  );
  if (participationsRestantes.rows.length > 0) {
    await client.query('ROLLBACK');
    return 'recommencer';
  }

  // Activités : les places libérées se décident sur ce qui a RÉELLEMENT été
  // supprimé (RETURNING), jamais sur la lecture initiale.
  const supprimees = await client.query<{ activiteId: string | null; statut: string | null }>(
    `DELETE FROM inscriptions WHERE jeune_id = $1 AND tenant_id = $2
     RETURNING activite_id AS "activiteId", statut`,
    [id, tenantId],
  );
  const lignes = supprimees.rows;
  // Inscription apparue depuis la lecture initiale, sur une activité que nous
  // n'avons donc pas verrouillée : on recommence avec la liste à jour.
  if (lignes.some(l => l.activiteId !== null && !activiteIds.includes(l.activiteId))) {
    await client.query('ROLLBACK');
    return 'recommencer';
  }
  // Même règle que DELETE /api/inscriptions : seule une inscription CONFIRMÉE
  // libère une place ; on promeut alors le premier en attente puis on recalcule
  // `places_disponibles`. Une inscription en attente, refusée ou annulée ne
  // change ni les places ni la file.
  const activitesLiberees = trier([...new Set(
    lignes.flatMap(l =>
      l.statut === 'confirmee' && l.activiteId !== null && activitesVerrouillees.has(l.activiteId)
        ? [l.activiteId]
        : []),
  )]);
  for (const activiteId of activitesLiberees) {
    await promouvoirPremierEnAttente(client, activiteId, tenantId);
    await synchroniserPlaces(client, activiteId, tenantId);
  }

  // Contacts et présences partent en cascade (ON DELETE CASCADE).
  const result = await client.query('DELETE FROM jeunes WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
  if (result.rowCount === 0) {
    await client.query('ROLLBACK');
    return 'introuvable';
  }

  await client.query('COMMIT');
  return 'supprime';
}

export async function supprimerJeune(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireActionRubrique('jeunes');
    if (!user) return { success: false, error: 'Non authentifié' };

    // Transaction obligatoire : ces suppressions en cascade étaient auparavant
    // exécutées sur 4 connexions distinctes du pool. Si la dernière échouait,
    // la fiche du jeune restait en base alors que tout son historique
    // (pointages, inscriptions, sorties) avait déjà été effacé — sans retour
    // arrière possible, et en faussant rétroactivement les statistiques CAF.
    // Les places libérées et les promotions font partie de la même
    // transaction : une erreur à n'importe quelle étape annule TOUT.
    let issue: IssueSuppression = 'recommencer';
    const client = await pool.connect();
    try {
      for (let essai = 0; essai < TENTATIVES_SUPPRESSION && issue === 'recommencer'; essai++) {
        try {
          issue = await tenterSuppressionJeune(client, id, user.tenant_id);
        } catch (e) {
          // Filet de sécurité, pas un chemin normal : l'ordre des verrous
          // ci-dessus exclut l'interblocage avec les inscriptions et les
          // participants, mais une feuille de pointage enregistrée au même
          // instant verrouille des lignes dans un ordre qui lui est propre.
          // PostgreSQL a déjà tout annulé : on peut rejouer sans risque.
          if (!estInterblocage(e)) throw e;
          await client.query('ROLLBACK');
        }
      }
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    if (issue === 'introuvable') return { success: false, error: 'Jeune introuvable' };
    if (issue === 'recommencer') {
      return { success: false, error: 'Les inscriptions de ce jeune sont en cours de modification. Réessayez dans un instant.' };
    }

    revalidatePath('/jeunes');
    revalidatePath('/dashboard');
    // Des places ont pu se libérer et des jeunes être promus.
    revalidatePath('/admin/activites');
    revalidatePath('/animateur/activites');
    revalidatePath('/inscriptions');
    return { success: true };
  } catch (e: unknown) {
    console.error('[supprimerJeune]', e);
    return { success: false, error: e instanceof Error && e.message ? e.message : 'Erreur inconnue' };
  }
}
