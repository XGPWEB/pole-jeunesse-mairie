import type { PoolClient } from 'pg';

/**
 * Règles communes aux chemins d'écriture des inscriptions aux activités
 * (POST/DELETE /api/inscriptions, server actions activités et inscriptions).
 *
 * Elles étaient recopiées dans chaque chemin, avec des variantes : contrôle de
 * doublon avant ou après le verrou, filtre tenant présent ou non, définition
 * différente d'une inscription « active ». Les réunir ici garantit que tous
 * les chemins prennent le MÊME verrou dans le MÊME ordre et appliquent la
 * même définition que l'index unique en base.
 */

/**
 * Statuts qui ne comptent plus comme une inscription en cours. DOIT rester
 * identique au prédicat de l'index unique `uniq_inscriptions_actives`
 * (scripts/migration-integrite-2026-10.sql) : un jeune refusé ou annulé peut
 * être réinscrit, mais il ne peut avoir qu'UNE inscription active par activité.
 */
export const STATUTS_INACTIFS = ['annulee', 'refusee'] as const;

/** Liste SQL littérale (constantes du code, jamais une entrée utilisateur). */
export const STATUTS_INACTIFS_SQL = STATUTS_INACTIFS.map(s => `'${s}'`).join(', ');

export interface ActiviteVerrouillee {
  titre: string;
  espaceId: string | null;
  placesTotal: number | null;
}

/**
 * Verrouille l'activité du tenant pour la durée de la transaction.
 *
 * C'est le verrou COMMUN à toute décision de capacité ou d'unicité :
 * inscription, désistement + promotion, confirmation, changement du nombre de
 * places, suppression. Ordre imposé partout : activité PUIS inscriptions.
 * Renvoie null si l'activité n'existe pas dans ce tenant.
 */
export async function verrouillerActivite(
  client: PoolClient,
  activiteId: string,
  tenantId: string,
): Promise<ActiviteVerrouillee | null> {
  const res = await client.query<ActiviteVerrouillee>(
    `SELECT titre, espace_id AS "espaceId", places_total AS "placesTotal"
     FROM activites
     WHERE id = $1 AND tenant_id = $2
     FOR UPDATE`,
    [activiteId, tenantId],
  );
  return res.rows[0] ?? null;
}

/** Nombre d'inscriptions confirmées (à lire sous le verrou activité). */
export async function compterConfirmes(
  client: PoolClient,
  activiteId: string,
  tenantId: string,
): Promise<number> {
  const res = await client.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM inscriptions
     WHERE activite_id = $1 AND tenant_id = $2 AND statut = 'confirmee'`,
    [activiteId, tenantId],
  );
  return res.rows[0].n;
}

/**
 * Recalcule `places_disponibles` et le statut complet/ouvert à partir du
 * nombre RÉEL de confirmés (jamais par incrément : la valeur ne peut pas
 * dériver, quel que soit le chemin d'écriture).
 */
export async function synchroniserPlaces(
  client: PoolClient,
  activiteId: string,
  tenantId: string,
): Promise<void> {
  await client.query(`
    UPDATE activites
    SET places_disponibles = GREATEST(0, places_total - (
          SELECT COUNT(*) FROM inscriptions WHERE activite_id = $1 AND tenant_id = $2 AND statut = 'confirmee'
        )),
        statut = CASE
          WHEN places_total <= (
            SELECT COUNT(*) FROM inscriptions WHERE activite_id = $1 AND tenant_id = $2 AND statut = 'confirmee'
          ) THEN 'complet'
          WHEN statut = 'complet' THEN 'ouvert'
          ELSE statut
        END
    WHERE id = $1 AND tenant_id = $2
  `, [activiteId, tenantId]);
}

/**
 * Promeut la plus ancienne inscription en attente, SI une place est
 * réellement libre (recomptage dans la même instruction). À appeler sous le
 * verrou activité. L'ordre est celui d'arrivée (date_inscription), départagé
 * par l'id pour rester déterministe en cas d'horodatages identiques.
 */
export async function promouvoirPremierEnAttente(
  client: PoolClient,
  activiteId: string,
  tenantId: string,
): Promise<void> {
  await client.query(`
    UPDATE inscriptions SET statut = 'confirmee'
    WHERE id = (
      SELECT id FROM inscriptions
      WHERE activite_id = $1 AND tenant_id = $2 AND statut IN ('en-attente', 'liste-attente')
      ORDER BY date_inscription ASC, id ASC
      LIMIT 1
    )
    AND (
      SELECT COUNT(*) FROM inscriptions
      WHERE activite_id = $1 AND tenant_id = $2 AND statut = 'confirmee'
    ) < (SELECT COALESCE(places_total, 999) FROM activites WHERE id = $1 AND tenant_id = $2)
  `, [activiteId, tenantId]);
}

/** SQLSTATE 23505 — violation d'un index/contrainte unique. */
export function estViolationUnicite(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
}
