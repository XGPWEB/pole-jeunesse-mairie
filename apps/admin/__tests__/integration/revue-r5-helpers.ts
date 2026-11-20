import pool from '@/lib/db';

/**
 * Lectures d'état pour les tests de la revue R5 (suppression d'un jeune).
 * Toutes interrogent la base DIRECTEMENT, sans passer par le code testé : un
 * défaut de `synchroniserPlaces` ne peut pas se masquer lui-même.
 */

export interface EtatActivite {
  placesTotal: number;
  placesDisponibles: number;
  statut: string;
  /** Jeunes confirmés, triés par identifiant (l'ordre n'a pas de sens métier). */
  confirmes: string[];
  /** File d'attente dans l'ordre de promotion : date d'inscription puis id. */
  attente: string[];
}

export async function etatActivite(activiteId: string): Promise<EtatActivite> {
  const act = await pool.query<{ places_total: number; places_disponibles: number; statut: string }>(
    'SELECT places_total, places_disponibles, statut FROM activites WHERE id = $1', [activiteId]);
  const ins = await pool.query<{ jeune_id: string; statut: string }>(
    `SELECT jeune_id, statut FROM inscriptions WHERE activite_id = $1 ORDER BY date_inscription ASC, id ASC`,
    [activiteId]);
  return {
    placesTotal: act.rows[0].places_total,
    placesDisponibles: act.rows[0].places_disponibles,
    statut: act.rows[0].statut,
    confirmes: ins.rows.filter(r => r.statut === 'confirmee').map(r => r.jeune_id).sort(),
    attente: ins.rows.filter(r => r.statut === 'en-attente' || r.statut === 'liste-attente').map(r => r.jeune_id),
  };
}

/**
 * Met `places_disponibles` et le statut de l'activité en accord avec les
 * inscriptions semées (les seeds insèrent les inscriptions sans y toucher).
 * Le point de départ d'un test est ainsi un état COHÉRENT, comme en
 * production après une inscription.
 */
export async function recalerPlaces(activiteId: string): Promise<void> {
  await pool.query(
    `UPDATE activites a SET
       places_disponibles = GREATEST(0, a.places_total - c.n),
       statut = CASE WHEN c.n >= a.places_total THEN 'complet' ELSE 'ouvert' END
     FROM (SELECT COUNT(*)::int AS n FROM inscriptions WHERE activite_id = $1 AND statut = 'confirmee') c
     WHERE a.id = $1`,
    [activiteId],
  );
}

/**
 * Invariants de capacité d'une activité, recomptés en base :
 *  - jamais plus de confirmés que de places ;
 *  - `places_disponibles` = places − confirmés ;
 *  - « complet » si et seulement si plus aucune place.
 * Renvoie la liste des écarts (vide = cohérent), pour un message d'échec lisible.
 */
export async function ecartsActivite(activiteId: string): Promise<string[]> {
  const e = await etatActivite(activiteId);
  const ecarts: string[] = [];
  if (e.confirmes.length > e.placesTotal) ecarts.push(`${e.confirmes.length} confirmés pour ${e.placesTotal} places`);
  const attendu = Math.max(0, e.placesTotal - e.confirmes.length);
  if (e.placesDisponibles !== attendu) ecarts.push(`places_disponibles=${e.placesDisponibles}, recomptage=${attendu}`);
  if ((e.statut === 'complet') !== (attendu === 0)) ecarts.push(`statut=${e.statut} avec ${attendu} place(s) libre(s)`);
  if (attendu > 0 && e.attente.length > 0) ecarts.push(`${attendu} place(s) libre(s) alors que ${e.attente.length} jeune(s) attendent`);
  return ecarts;
}

export interface EtatSortie {
  /** Confirmés puis file d'attente, chacun dans l'ordre `ordre` (arrivée). */
  confirmes: string[];
  attente: string[];
}

export async function etatSortie(sortieId: string): Promise<EtatSortie> {
  const { rows } = await pool.query<{ jeune_id: string; en_attente: boolean }>(
    'SELECT jeune_id, en_attente FROM sorties_participants WHERE sortie_id = $1 ORDER BY ordre', [sortieId]);
  return {
    confirmes: rows.filter(r => !r.en_attente).map(r => r.jeune_id),
    attente: rows.filter(r => r.en_attente).map(r => r.jeune_id),
  };
}

/** Nombre de lignes qui référencent encore ce jeune, table par table. */
export async function tracesDuJeune(jeuneId: string): Promise<Record<string, number>> {
  const traces: Record<string, number> = {};
  for (const [table, colonne] of [
    ['jeunes', 'id'], ['inscriptions', 'jeune_id'], ['sorties_participants', 'jeune_id'],
    ['pointages', 'jeune_id'], ['jeunes_contacts', 'jeune_id'],
  ] as const) {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "${table}" WHERE "${colonne}" = $1`, [jeuneId]);
    traces[table] = rows[0].n;
  }
  return traces;
}

export const AUCUNE_TRACE = { jeunes: 0, inscriptions: 0, sorties_participants: 0, pointages: 0, jeunes_contacts: 0 };

/** Tables dont la photographie doit rester identique après une suppression refusée ou annulée. */
export const TABLES_SUPPRESSION = [
  'jeunes', 'jeunes_contacts', 'inscriptions', 'sorties_participants', 'pointages', 'activites', 'sorties',
] as const;
