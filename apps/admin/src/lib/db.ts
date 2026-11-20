import { Pool } from 'pg';

if (!process.env.DATABASE_URL && process.env.NODE_ENV === 'production') {
  console.warn('[DB] DATABASE_URL non défini en production !');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://pj_admin@localhost:5432/pole_jeunesse',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  keepAlive: true,
});

// Une connexion inactive du pool peut être coupée silencieusement par le
// réseau (firewall/NAT) après un moment d'inactivité. node-postgres détecte
// ça plus tard et émet 'error' sur le pool — sans listener, ça fait planter
// tout le process Node (PM2 le relance, mais la requête en cours tombe en
// 500 le temps du redémarrage). D'où le "ça marche au 2e essai".
pool.on('error', (err) => {
  console.error('[DB] Erreur inattendue sur une connexion inactive du pool :', err);
});

export default pool;

/**
 * Une connexion tirée du pool peut s'avérer déjà morte côté réseau (voir le
 * commentaire sur `pool.on('error', ...)` ci-dessus) : la requête échoue alors
 * immédiatement avec une erreur de connexion, pas une erreur SQL. Dans ce cas
 * précis on retente une fois avec une connexion fraîche plutôt que de laisser
 * planter toute la page (c'est ce qui produisait le 500 sur /admin/dashboard,
 * résolu jusqu'ici uniquement en cliquant sur « Réessayer »).
 */
export function isTransientConnectionError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const message = (err as { message?: string })?.message ?? '';
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EPIPE' ||
    message.includes('Connection terminated') ||
    message.includes('terminated unexpectedly')
  );
}

/**
 * POLITIQUE DE RELANCE — qui a le droit d'être rejoué ?
 *
 * Une erreur de connexion ne dit PAS si PostgreSQL a exécuté la requête : la
 * coupure peut survenir avant l'envoi (connexion déjà morte) comme APRÈS le
 * COMMIT implicite, quand seule la réponse est perdue. Rejouer à l'aveugle un
 * INSERT à identifiant automatique crée alors un doublon (lignes de budget),
 * et un `DELETE ... RETURNING` déjà appliqué revient vide au second essai —
 * la route conclut « introuvable » alors que la suppression a eu lieu.
 *
 *   'auto'       (défaut) : relance UNE fois, et seulement si le texte SQL est
 *                établi en lecture seule par `isReadOnlyStatement`. Toute
 *                écriture est exécutée une seule fois ; son erreur remonte.
 *   'never'      : jamais de relance, même pour une lecture.
 *   'idempotent' : opt-in explicite de l'appelant, réservé aux écritures dont
 *                le rejeu est PROUVÉ sans effet (ex. `UPDATE ... SET x = $1
 *                WHERE id = $2` sans RETURNING exploité, ou INSERT sur clé
 *                fournie avec ON CONFLICT DO NOTHING). À justifier en
 *                commentaire à chaque usage.
 *
 * Les transactions explicites (`pool.connect()` + BEGIN) ne passent pas par
 * ces helpers et ne sont donc jamais rejouées : une connexion perdue en cours
 * de transaction l'annule côté serveur, c'est à l'utilisateur de recommencer.
 */
export type RetryPolicy = 'auto' | 'never' | 'idempotent';

export interface QueryOptions {
  retry?: RetryPolicy;
}

/**
 * Mots dont la seule présence disqualifie une requête de la relance
 * automatique. La liste est volontairement LARGE : un faux positif (une
 * lecture non rejouée) coûte au pire un « Réessayer », un faux négatif (une
 * écriture rejouée) corrompt des données. Sont notamment couverts les pièges
 * d'un simple test « commence par SELECT » :
 *   - CTE modifiantes        : WITH x AS (INSERT/UPDATE/DELETE ... RETURNING)
 *   - verrous de lignes      : SELECT ... FOR UPDATE / FOR NO KEY UPDATE /
 *                              FOR SHARE / FOR KEY SHARE
 *   - SELECT ... INTO        : crée une table
 *   - fonctions à effet de bord : nextval/setval, verrous consultatifs,
 *                              pg_notify, set_config, large objects, dblink
 *   - instructions multiples : tout « ; » en dehors d'un point-virgule final
 *
 * Limite connue et assumée : une fonction SQL définie par l'utilisateur et
 * ayant un effet de bord ne peut pas être reconnue ici. Le schéma n'en définit
 * aucune (scripts/init-db.sql) ; si l'on en ajoute une, l'appeler avec
 * `{ retry: 'never' }`.
 */
const MOTS_INTERDITS_RELANCE = new RegExp(
  '\\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|CALL|DO|COPY|LOCK|INTO|SHARE|SET|' +
  'REFRESH|VACUUM|NOTIFY|LISTEN|EXECUTE|PREPARE|NEXTVAL|SETVAL|SET_CONFIG|PG_NOTIFY)\\b' +
  '|PG_ADVISORY|PG_TRY_ADVISORY|\\bLO_|DBLINK|;',
  'i',
);

/**
 * Vrai seulement si la requête est ÉTABLIE en lecture seule : elle commence
 * par SELECT ou WITH et ne contient aucun des mots ci-dessus. Dans le doute
 * (commentaire en tête, mot-clé dans une chaîne littérale…), répond faux.
 */
export function isReadOnlyStatement(text: string): boolean {
  const sql = text.trim().replace(/;\s*$/, '');
  if (!/^(?:SELECT|WITH)\b/i.test(sql)) return false;
  return !MOTS_INTERDITS_RELANCE.test(sql);
}

function relanceAutorisee(text: string, policy: RetryPolicy): boolean {
  if (policy === 'never') return false;
  if (policy === 'idempotent') return true;
  return isReadOnlyStatement(text);
}

async function queryWithRetry(text: string, params?: any[], options?: QueryOptions) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    if (!isTransientConnectionError(err)) throw err;
    if (!relanceAutorisee(text, options?.retry ?? 'auto')) {
      // Écriture (ou requête non reconnue comme lecture) : on ne sait pas si
      // elle a été appliquée. On ne la rejoue pas ; l'erreur remonte.
      console.warn('[DB] Connexion perdue pendant une écriture — pas de relance automatique :', (err as Error).message);
      throw err;
    }
    console.warn('[DB] Connexion transitoire perdue, nouvelle tentative :', (err as Error).message);
    return pool.query(text, params);
  }
}

export async function query<T = any>(text: string, params?: any[], options?: QueryOptions): Promise<T[]> {
  const result = await queryWithRetry(text, params, options);
  return result.rows;
}

export async function queryOne<T = any>(text: string, params?: any[], options?: QueryOptions): Promise<T | null> {
  const result = await queryWithRetry(text, params, options);
  return result.rows[0] ?? null;
}

/**
 * Normalise une valeur de formulaire destinée à une colonne DATE ou numérique.
 *
 * ⚠️ Un `<input type="date">` ou `type="number"` vidé envoie la chaîne VIDE,
 * pas `null` — et `body.champ ?? null` ne l'intercepte donc PAS. PostgreSQL
 * rejette `''` pour ces types (« invalid input syntax for type date: "" »,
 * SQLSTATE 22007 / 22P02) et la route renvoie un 500 opaque à l'utilisateur.
 *
 * Ce piège a déjà cassé les véhicules (juin) puis les projets (juillet) :
 * utiliser ce helper au lieu de `?? null` pour TOUTE colonne DATE, INTEGER ou
 * NUMERIC alimentée par un formulaire.
 */
export function emptyToNull<T>(value: T): T | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (typeof value === 'number' && Number.isNaN(value)) return null;
  return value;
}
