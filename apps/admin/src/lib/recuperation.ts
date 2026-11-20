import pool from '@/lib/db';
import type { PoolClient } from 'pg';

/**
 * Solde d'heures de récupération d'un animateur.
 *
 * SOURCE DE VÉRITÉ UNIQUE — le solde n'est jamais stocké. Il se calcule à partir
 * des demandes approuvées :
 *   solde = Σ heures approuvées 'credit' − Σ heures approuvées 'debit'
 *
 * Choix délibéré : un solde stocké se désynchronise dès qu'un chemin d'écriture
 * oublie de le mettre à jour (cf. bug places_disponibles). Calculé, il est
 * toujours exact.
 *
 * Accepte un client optionnel pour être appelé À L'INTÉRIEUR d'une transaction
 * (validation d'une pose) et voir les écritures non encore committées.
 */
export async function soldeRecup(
  animateurId: string,
  tenantId: string,
  client?: PoolClient,
): Promise<number> {
  const exec = client ?? pool;
  const res = await exec.query(
    `SELECT COALESCE(SUM(CASE WHEN sens = 'credit' THEN heures ELSE -heures END), 0)::float AS solde
     FROM demandes_recup
     WHERE animateur_id = $1 AND tenant_id = $2 AND statut = 'approved'`,
    [animateurId, tenantId],
  );
  return Number(res.rows[0]?.solde ?? 0);
}

/**
 * Soldes de tous les animateurs d'un tenant, en une seule requête
 * (évite le N+1 sur les vues admin).
 */
export async function soldesParAnimateur(
  tenantId: string,
): Promise<Record<string, number>> {
  const res = await pool.query(
    `SELECT animateur_id AS "animateurId",
            COALESCE(SUM(CASE WHEN sens = 'credit' THEN heures ELSE -heures END), 0)::float AS solde
     FROM demandes_recup
     WHERE tenant_id = $1 AND statut = 'approved'
     GROUP BY animateur_id`,
    [tenantId],
  );
  const map: Record<string, number> = {};
  for (const r of res.rows) map[r.animateurId] = Number(r.solde);
  return map;
}

/**
 * Verrou commun à TOUTES les opérations qui modifient le solde d'un animateur
 * (validation, correction, suppression d'une demande approuvée).
 *
 * Pourquoi il est indispensable : le solde est une SOMME sur plusieurs lignes.
 * Verrouiller la demande traitée (`FOR UPDATE`) ne sérialise que les
 * opérations portant sur cette ligne-là. Deux validations de deux poses
 * DIFFÉRENTES lisaient chacune le même solde (8 h), l'estimaient suffisant
 * pour 6 h, et validaient toutes les deux : −4 h.
 *
 * Pourquoi un verrou consultatif (`pg_advisory_xact_lock`) plutôt qu'un
 * `SELECT ... FOR UPDATE` sur la ligne `animateurs` :
 *   - la ligne animateur est écrite par des chemins sans rapport (connexion :
 *     last_login ; révocation de session ; fiche RH) et référencée par des
 *     clés étrangères (un INSERT dans conges/demandes_recup/sorties prend un
 *     FOR KEY SHARE dessus). La verrouiller FOR UPDATE ferait attendre ces
 *     écritures pendant une validation, et ouvrirait des interblocages avec
 *     toute transaction qui touche l'animateur PUIS ses demandes ;
 *   - le verrou consultatif ne bloque que ceux qui le demandent — exactement
 *     l'ensemble « opérations sur le solde de cet animateur ».
 *
 * La clé est dérivée de (tenant, animateur) par hashtextextended (64 bits).
 * Une collision entre deux animateurs ne ferait que sérialiser inutilement
 * leurs opérations ; elle ne peut pas fausser un solde.
 *
 * Verrou de niveau TRANSACTION : libéré automatiquement au COMMIT/ROLLBACK,
 * donc impossible à oublier. À appeler APRÈS `BEGIN` et AVANT toute lecture
 * du solde ou des demandes — en READ COMMITTED, les requêtes suivantes
 * prennent un nouvel instantané et voient donc ce que la transaction
 * précédente vient de valider.
 */
export async function verrouillerSoldeRecup(
  client: PoolClient,
  tenantId: string,
  animateurId: string,
): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [`recup-solde:${tenantId}:${animateurId}`],
  );
}

/** Compare des heures au centième (NUMERIC(5,2) en base, flottants en JS). */
function centiemes(heures: number): number {
  return Math.round(heures * 100);
}

/**
 * INVARIANT : aucune opération ne fait passer le solde sous zéro, ni ne
 * creuse un solde déjà négatif.
 *
 * `delta` est la variation que l'opération applique au solde (négative pour
 * la validation d'une pose, l'augmentation d'un débit approuvé, la réduction
 * ou la suppression d'un crédit approuvé).
 *
 * Une opération qui AUGMENTE le solde (ou le laisse inchangé) est toujours
 * permise, même si le solde reste négatif après coup : sinon un solde négatif
 * hérité d'avant ce contrôle serait impossible à régulariser.
 *
 * Le code métier ne prévoit aucune « régularisation négative » tracée : on
 * refuse donc, sans exception.
 */
export function soldeApresOperation(
  soldeAvant: number,
  delta: number,
): { autorise: boolean; soldeApres: number } {
  const apres = centiemes(soldeAvant) + centiemes(delta);
  const autorise = centiemes(delta) >= 0 || apres >= 0;
  return { autorise, soldeApres: apres / 100 };
}

/** Variation du solde induite par une demande APPROUVÉE de ce sens/volume. */
export function effetSurSolde(sens: 'credit' | 'debit', heures: number): number {
  return sens === 'credit' ? heures : -heures;
}
