import type { PoolClient } from 'pg';
import pool from '@/lib/db';

/**
 * Révocation durable des sessions d'un compte.
 *
 * `session_version` est un compteur MONOTONE porté par chaque JWT (claim `sv`).
 * Une session n'est valide que si son `sv` est égal à la version courante en
 * base : incrémenter le compteur invalide donc d'un coup tous les jetons déjà
 * émis, et aucune reconnexion ne peut les « réactiver » (le nouveau jeton porte
 * la nouvelle version, les copies de l'ancien gardent l'ancienne).
 *
 * L'implémentation précédente reposait uniquement sur l'horodatage
 * `session_invalidated_at`, remis à NULL à chaque login : la borne de
 * révocation disparaissait et un JWT volé redevenait valable jusqu'à 30 jours.
 * Elle était de plus imprécise à la seconde (iat est en secondes).
 *
 * `session_invalidated_at` reste alimenté — il n'est PLUS JAMAIS remis à NULL —
 * car il sert encore à refuser les anciens jetons émis avant l'ajout de `sv`.
 *
 * Fragment SQL à insérer dans la clause SET d'un UPDATE animateurs quand la
 * révocation doit être atomique avec une autre écriture (changement de mot de
 * passe, de rôle, de statut).
 * clock_timestamp() date l'écriture réelle : NOW() daterait le début d'une
 * transaction ayant attendu un verrou et pourrait précéder un lien de reset
 * émis entre-temps, que cette révocation doit pourtant neutraliser.
 */
export const SQL_REVOQUER_SESSIONS =
  'session_version = session_version + 1, session_invalidated_at = clock_timestamp()';

/**
 * Révoque toutes les sessions (web et mobile) d'un compte.
 * Passer `client` pour l'inclure dans une transaction en cours.
 */
export async function revoquerSessions(animateurId: string, client?: PoolClient): Promise<void> {
  const sql = `UPDATE animateurs SET ${SQL_REVOQUER_SESSIONS} WHERE id = $1`;
  if (client) await client.query(sql, [animateurId]);
  else await pool.query(sql, [animateurId]);
}
