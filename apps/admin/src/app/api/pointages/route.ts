import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import type { PoolClient } from 'pg';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import pool from '@/lib/db';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN ?? 'https://jeunessenogent.cloud',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  // Authorization : l'application mobile s'authentifie par jeton Bearer.
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUTS = new Set(['present', 'absent', 'excuse']);
const TYPES = new Set(['accueil-libre', 'activite']);
/** Garde-fou : une feuille de présence ne compte jamais autant de lignes. */
const MAX_ENTREES = 500;

/** Colonnes renvoyées par GET et par POST — même forme pour les deux verbes. */
const COLONNES = `
  id,
  jeune_id AS "jeuneId",
  espace_id AS "espaceId",
  date::text AS date,
  heure_arrivee AS "heureArrivee",
  heure_sortie AS "heureSortie",
  animateur, type,
  activite_id AS "activiteId",
  manuel, source, statut,
  prenom_manuel AS "prenomManuel",
  nom_manuel AS "nomManuel",
  created_at AS "createdAt"`;

function erreur(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status, headers: CORS_HEADERS });
}

function revalider() {
  revalidatePath('/statistiques');
  revalidatePath('/animateur/statistiques');
  revalidatePath('/presences');
  revalidatePath('/dashboard');
  revalidatePath('/animateur/dashboard');
}

export async function GET(request: NextRequest) {
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401, headers: CORS_HEADERS });
  }
  const { tenant_id } = user;
  try {
    const { searchParams } = new URL(request.url);
    const date       = searchParams.get('date');
    const activiteId = searchParams.get('activiteId');

    // Une date mal formée provoquait une erreur SQL (22007) et un 500 opaque.
    if (date && !DATE_RE.test(date)) return erreur('Paramètre date invalide (AAAA-MM-JJ).', 400);

    const params: string[] = [tenant_id];
    let where = 'WHERE tenant_id = $1';
    if (date)       { params.push(date);       where += ` AND date = $${params.length}`; }
    if (activiteId) { params.push(activiteId); where += ` AND activite_id = $${params.length}`; }

    const rows = await query(`
      SELECT ${COLONNES}
      FROM pointages
      ${where}
      ORDER BY date DESC, created_at DESC
    `, params);

    return NextResponse.json(rows, { headers: CORS_HEADERS });
  } catch (err) {
    console.error('[api/pointages]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500, headers: CORS_HEADERS });
  }
}

/**
 * Supprime UN pointage, désigné par son identifiant, dans le tenant de la
 * session.
 *
 * La forme historique `?jeuneId=&date=` a été retirée : elle effaçait TOUTES
 * les lignes du jeune ce jour-là, sans distinction de type ni d'activité.
 * Retirer une présence à l'accueil libre depuis le mobile supprimait donc
 * aussi ses pointages aux activités du même jour (données des bilans CAF).
 */
export async function DELETE(request: NextRequest) {
  const userDel = await requireAuth(request);
  if (!userDel) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401, headers: CORS_HEADERS });
  }
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return erreur(
        'Paramètre id requis : la suppression se fait par identifiant de pointage (la forme jeuneId+date n’est plus acceptée).',
        400,
      );
    }

    // Filtre tenant_id obligatoire : un id deviné ne doit pas permettre
    // d'effacer les registres de présence d'une autre structure.
    const result = await pool.query<{ id: string }>(
      'DELETE FROM pointages WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [id, userDel.tenant_id],
    );
    if (result.rowCount !== 1) return erreur('Pointage introuvable.', 404);

    revalider();
    return NextResponse.json({ success: true, deleted: 1, id: result.rows[0].id }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error('[api/pointages]', err);
    return erreur('Erreur serveur', 500);
  }
}

// ── POST ─────────────────────────────────────────────────────────────────────

/** Erreur de validation : annule la transaction et produit un 400. */
class EntreeInvalide extends Error {}

function texte(valeur: unknown): string | null {
  if (valeur === undefined || valeur === null) return null;
  if (typeof valeur !== 'string') throw new EntreeInvalide('Champ texte attendu.');
  const v = valeur.trim();
  return v === '' ? null : v;
}

function champ(entree: Record<string, unknown>, nom: string, index: number, max = 200): string | null {
  let v: string | null;
  try {
    v = texte(entree[nom]);
  } catch {
    throw new EntreeInvalide(`Entrée ${index + 1} : champ « ${nom} » invalide.`);
  }
  if (v !== null && v.length > max) {
    throw new EntreeInvalide(`Entrée ${index + 1} : champ « ${nom} » trop long.`);
  }
  return v;
}

/**
 * Vérifie qu'un identifiant référencé appartient au tenant de la session.
 *
 * C'est le cœur du cloisonnement : `pointages.jeune_id` est une clé étrangère
 * vers `jeunes(id)` SANS notion de structure, et `activite_id` / `espace_id`
 * n'ont aucune contrainte. Sans ce contrôle, un utilisateur de la commune B
 * pouvait créer un pointage référençant un jeune ou une activité de la
 * commune A (référence croisée qui fausse les bilans des deux).
 */
async function exigerDansTenant(
  client: PoolClient,
  table: 'jeunes' | 'activites' | 'espaces',
  id: string,
  tenantId: string,
  libelle: string,
  index: number,
): Promise<void> {
  const r = await client.query(`SELECT 1 FROM ${table} WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  if (r.rowCount !== 1) {
    // Message identique que l'objet n'existe pas ou appartienne à une autre
    // structure : on ne confirme pas l'existence d'un identifiant étranger.
    throw new EntreeInvalide(`Entrée ${index + 1} : ${libelle} introuvable.`);
  }
}

export async function POST(request: NextRequest) {
  const userPost = await requireAuth(request);
  if (!userPost) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401, headers: CORS_HEADERS });
  }
  const { tenant_id: tenantId } = userPost;
  try {
    const body: unknown = await request.json().catch(() => null);
    const entries: unknown[] = Array.isArray(body) ? body : [body];

    if (entries.length === 0) return erreur('Aucune entrée reçue.', 400);
    if (entries.length > MAX_ENTREES) return erreur(`Trop d’entrées (maximum ${MAX_ENTREES}).`, 400);

    const idsCrees: string[] = [];

    // Une seule transaction pour tout le lot : soit toute la feuille est
    // enregistrée, soit rien (y compris les remplacements de pointages web).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Caches par requête : une feuille de 30 jeunes sur la même activité ne
      // revérifie pas 30 fois la même activité ni le même espace.
      const vus = new Set<string>();
      const verifier = async (table: 'jeunes' | 'activites' | 'espaces', id: string, libelle: string, i: number) => {
        const cle = `${table}:${id}`;
        if (vus.has(cle)) return;
        await exigerDansTenant(client, table, id, tenantId, libelle, i);
        vus.add(cle);
      };

      // Sérialisation des REMPLACEMENTS (feuille de pointage : DELETE puis
      // INSERT). La transaction garantit le tout-ou-rien d'un lot, pas
      // l'exclusion entre deux lots : deux premières écritures simultanées
      // pour le même jeune/activité/jour supprimaient chacune zéro ligne puis
      // inséraient toutes deux → deux pointages, éventuellement contradictoires.
      // Un verrou consultatif par clé métier, tenu jusqu'au COMMIT, force la
      // seconde écriture à attendre la première ; son DELETE voit alors la
      // ligne validée et la remplace.
      // Les verrous sont pris AVANT toute écriture et dans un ordre trié :
      // deux lots contenant les mêmes clés dans un ordre différent ne peuvent
      // pas s'interbloquer.
      // Pas d'index unique à la place : les entrées de registre (arrivées,
      // passages) sont légitimement multiples dans cette même table.
      const clesRemplacement = new Set<string>();
      for (const brut of entries) {
        if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) continue;
        const e = brut as Record<string, unknown>;
        if (e.statut === undefined || e.type !== undefined) continue;
        if (typeof e.jeuneId === 'string' && typeof e.activiteId === 'string' && typeof e.date === 'string') {
          clesRemplacement.add(JSON.stringify([tenantId, e.jeuneId.trim(), e.activiteId.trim(), e.date.trim()]));
        }
      }
      for (const cle of [...clesRemplacement].sort()) {
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`pointage-remplacement:${cle}`]);
      }

      for (let i = 0; i < entries.length; i++) {
        const brut = entries[i];
        if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) {
          throw new EntreeInvalide(`Entrée ${i + 1} : objet attendu.`);
        }
        const d = brut as Record<string, unknown>;

        const jeuneId    = champ(d, 'jeuneId', i);
        const activiteId = champ(d, 'activiteId', i);
        let   espaceId   = champ(d, 'espaceId', i);
        const date       = champ(d, 'date', i);
        const statut     = champ(d, 'statut', i);

        if (!date || !DATE_RE.test(date)) {
          throw new EntreeInvalide(`Entrée ${i + 1} : date invalide (AAAA-MM-JJ).`);
        }
        if (statut !== null && !STATUTS.has(statut)) {
          throw new EntreeInvalide(`Entrée ${i + 1} : statut invalide (present, absent ou excuse).`);
        }

        // Références validées contre le tenant de la SESSION avant toute écriture.
        if (jeuneId)    await verifier('jeunes', jeuneId, 'jeune', i);
        if (activiteId) await verifier('activites', activiteId, 'activité', i);
        if (espaceId)   await verifier('espaces', espaceId, 'espace', i);

        // Deux formes d'entrée :
        //  - feuille de pointage web : { jeuneId, activiteId, date, statut },
        //    sans `type` — REMPLACE le pointage du jeune pour cette activité ;
        //  - registre (mobile) : `type` explicite, heure d'arrivée, saisie
        //    manuelle éventuelle, `statut` facultatif — AJOUTE une ligne.
        // Le `type` explicite prime : auparavant la seule présence d'un
        // `statut` faisait basculer une entrée du registre dans la branche
        // « activité », qui l'enregistrait avec le mauvais type.
        const isWebPointage = d.statut !== undefined && d.type === undefined;
        const id = `pt-${randomUUID()}`;

        if (isWebPointage) {
          if (!jeuneId || !activiteId || !statut) {
            throw new EntreeInvalide(`Entrée ${i + 1} : jeuneId, activiteId et statut requis.`);
          }

          // Remplace l'ancien pointage de ce jeune pour cette activité et ce
          // jour (évite les doublons) — DANS LE TENANT de la session. Sans le
          // filtre tenant, cette suppression effaçait le pointage d'une autre
          // commune dès lors qu'on connaissait ses identifiants.
          await client.query(
            `DELETE FROM pointages
              WHERE jeune_id = $1 AND activite_id = $2 AND date = $3 AND tenant_id = $4`,
            [jeuneId, activiteId, date, tenantId],
          );

          // L'espace vient de l'activité si le client ne le précise pas —
          // lecture elle aussi bornée au tenant.
          if (!espaceId) {
            const act = await client.query<{ espace_id: string | null }>(
              'SELECT espace_id FROM activites WHERE id = $1 AND tenant_id = $2',
              [activiteId, tenantId],
            );
            espaceId = act.rows[0]?.espace_id ?? null;
          }

          await client.query(`
            INSERT INTO pointages (id, jeune_id, activite_id, espace_id, type, date, statut, source, tenant_id)
            VALUES ($1, $2, $3, $4, 'activite', $5, $6, 'web', $7)
          `, [id, jeuneId, activiteId, espaceId, date, statut, tenantId]);
        } else {
          const type = champ(d, 'type', i);
          if (!type || !TYPES.has(type)) {
            throw new EntreeInvalide(`Entrée ${i + 1} : type invalide (accueil-libre ou activite).`);
          }
          if (!espaceId) {
            throw new EntreeInvalide(`Entrée ${i + 1} : espaceId requis.`);
          }
          const prenomManuel = champ(d, 'prenomManuel', i);
          const nomManuel    = champ(d, 'nomManuel', i);
          if (!jeuneId && !prenomManuel && !nomManuel) {
            throw new EntreeInvalide(`Entrée ${i + 1} : jeuneId ou nom/prénom manuel requis.`);
          }

          await client.query(`
            INSERT INTO pointages
              (id, jeune_id, espace_id, date, heure_arrivee, heure_sortie,
               animateur, type, activite_id, manuel, source, statut, prenom_manuel, nom_manuel, tenant_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'mobile',$11,$12,$13,$14)
          `, [
            id,
            jeuneId,
            espaceId,
            date,
            champ(d, 'heureArrivee', i, 20),
            champ(d, 'heureSortie', i, 20),
            champ(d, 'animateur', i) ?? userPost.username,
            type,
            activiteId,
            d.manuel === true,
            statut,
            prenomManuel,
            nomManuel,
            tenantId,
          ]);
        }
        idsCrees.push(id);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof EntreeInvalide) return erreur(err.message, 400);
      throw err;
    } finally {
      client.release();
    }

    revalider();

    // Les pointages créés sont renvoyés avec leur `id`, dans l'ordre des
    // entrées reçues : le client (mobile) doit conserver cet identifiant pour
    // pouvoir supprimer ensuite EXACTEMENT ce pointage.
    const crees = await query<{ id: string }>(
      `SELECT ${COLONNES} FROM pointages WHERE tenant_id = $1 AND id = ANY($2::text[])`,
      [tenantId, idsCrees],
    );
    const parId = new Map(crees.map((p) => [p.id, p]));
    const pointages = idsCrees.map((id) => parId.get(id)).filter((p) => p !== undefined);

    return NextResponse.json(
      { success: true, count: pointages.length, pointages },
      { headers: CORS_HEADERS },
    );
  } catch (err) {
    console.error('[API /api/pointages]', err);
    return erreur('Erreur serveur', 500);
  }
}
