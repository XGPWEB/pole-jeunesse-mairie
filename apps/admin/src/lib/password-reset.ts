import { createHash, randomBytes, randomUUID } from 'crypto';
import pool from '@/lib/db';
import { SQL_REVOQUER_SESSIONS } from '@/lib/revocation';

/**
 * Réinitialisation de mot de passe par jeton à usage unique.
 *
 * Principe : le hash du mot de passe n'est JAMAIS modifié par une simple
 * demande. Une demande (anonyme si la fiche a une adresse, validée par un
 * admin sinon) ne fait qu'émettre un lien ; seul le titulaire de la boîte mail,
 * en présentant le jeton, peut choisir un nouveau mot de passe.
 *
 * L'ancien flux générait un mot de passe et écrasait le hash immédiatement :
 * n'importe qui connaissant un identifiant admin pouvait verrouiller le compte
 * (et si l'envoi SMTP échouait, plus personne ne connaissait le mot de passe).
 *
 * Le jeton n'est stocké que HACHÉ (SHA-256) : une lecture de la base (dump,
 * sauvegarde, injection en lecture) ne permet pas de réinitialiser un compte.
 * SHA-256 sans sel suffit ici car le jeton est une valeur aléatoire de
 * 256 bits, pas un secret choisi par un humain.
 */

/** Lien demandé par le titulaire lui-même (tout compte ayant une adresse). */
export const RESET_TTL_MINUTES = 30;
/** Lien émis par un admin pour un animateur (le temps qu'il relève ses mails). */
export const RESET_TTL_ADMIN_MINUTES = 60;

export function hacherJeton(jeton: string): string {
  return createHash('sha256').update(jeton, 'utf8').digest('hex');
}

export interface JetonEmis {
  id: string;
  /** Valeur en clair — à transmettre UNIQUEMENT par e-mail, jamais stockée ni journalisée. */
  jeton: string;
  expireLe: Date;
  /**
   * Adresse de la fiche lue SOUS LE VERROU de l'émission. C'est à elle, et non
   * à une adresse lue plus tôt par l'appelant, que le lien doit partir : une
   * adresse changée entre la lecture et l'émission révoque les liens émis
   * avant elle, mais pas celui-ci, daté d'après le changement.
   */
  email: string | null;
}

/**
 * Émet un jeton pour un compte. Les jetons précédents encore valides du même
 * compte sont neutralisés : un seul lien utilisable à la fois.
 */
export async function creerJetonReinitialisation(params: {
  animateurId: string;
  tenantId: string;
  ttlMinutes: number;
  /** id de l'admin à l'origine de l'émission, ou null si demande du titulaire */
  creePar: string | null;
}): Promise<JetonEmis> {
  const jeton = randomBytes(32).toString('base64url');
  const id = `prt-${randomUUID()}`;
  const expireLe = new Date(Date.now() + params.ttlMinutes * 60_000);

  let email: string | null = null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Sérialise les émissions pour un même compte, même quand aucun jeton
    // n'existe encore : verrouiller seulement les anciens jetons ne suffit pas.
    const compte = await client.query<{ email: string | null }>(
      "SELECT id, email FROM animateurs WHERE id = $1 AND tenant_id = $2 AND statut = 'actif' FOR UPDATE",
      [params.animateurId, params.tenantId],
    );
    if (compte.rowCount !== 1) throw new Error('Compte de récupération indisponible');
    await client.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE animateur_id = $1 AND used_at IS NULL',
      [params.animateurId],
    );
    await client.query(
      `INSERT INTO password_reset_tokens (id, animateur_id, tenant_id, token_hash, expires_at, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp())`,
      [id, params.animateurId, params.tenantId, hacherJeton(jeton), expireLe, params.creePar],
    );
    await client.query('COMMIT');
    email = compte.rows[0].email?.trim() || null;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { id, jeton, expireLe, email };
}

/** Retire un jeton qui n'a pas pu être remis (échec d'envoi du courriel). */
export async function supprimerJeton(id: string): Promise<void> {
  await pool.query('DELETE FROM password_reset_tokens WHERE id = $1', [id]);
}

/**
 * Adresse publique de l'application, pour construire le lien du courriel.
 * Volontairement issue de la configuration et JAMAIS de l'en-tête Host de la
 * requête : un Host forgé ferait partir un lien pointant vers le domaine de
 * l'attaquant, qui récupérerait le jeton au clic.
 */
function baseUrlPublique(): string {
  const base = process.env.APP_BASE_URL ?? process.env.ALLOWED_ORIGIN ?? 'https://jeunessenogent.cloud';
  return base.replace(/\/+$/, '');
}

/**
 * Le jeton voyage dans le FRAGMENT de l'URL (#token=…) : le navigateur ne
 * l'envoie ni au serveur (journaux d'accès Nginx) ni dans l'en-tête Referer.
 */
export function lienReinitialisation(jeton: string): string {
  return `${baseUrlPublique()}/reinitialisation#token=${encodeURIComponent(jeton)}`;
}

export type ResultatConsommation =
  | { ok: true; animateurId: string; username: string; tenantId: string }
  | { ok: false };

/**
 * Consomme le jeton et applique le nouveau hash, dans UNE transaction.
 *
 * Consommation atomique : `UPDATE … WHERE used_at IS NULL AND expires_at >
 * NOW() RETURNING`. Deux requêtes simultanées avec le même jeton se disputent
 * le verrou de ligne ; la seconde réévalue la condition après le commit de la
 * première, voit `used_at` renseigné et n'obtient aucune ligne.
 *
 * Le changement de mot de passe révoque toutes les sessions du compte (dans le
 * même UPDATE) : c'est le moyen pour un titulaire d'expulser un intrus.
 */
export async function consommerJetonEtChangerMotDePasse(
  jeton: string,
  nouveauHash: string,
): Promise<ResultatConsommation> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Même ordre de verrouillage que l'émission : compte, puis jeton.
    // Un changement de secret/adresse ou une nouvelle émission concurrente
    // ne peut pas être franchi avec un lien de l'ancien état du compte.
    await client.query(
      `SELECT a.id FROM animateurs a JOIN password_reset_tokens t ON t.animateur_id = a.id
        WHERE t.token_hash = $1 FOR UPDATE OF a`,
      [hacherJeton(jeton)],
    );
    const consomme = await client.query<{ animateur_id: string }>(
      `UPDATE password_reset_tokens t
          SET used_at = NOW()
         FROM animateurs a
        WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > clock_timestamp()
          AND a.id = t.animateur_id AND a.tenant_id = t.tenant_id AND a.statut = 'actif'
          AND (a.session_invalidated_at IS NULL OR t.created_at >= a.session_invalidated_at)
        RETURNING t.animateur_id`,
      [hacherJeton(jeton)],
    );
    if (consomme.rowCount !== 1) {
      await client.query('ROLLBACK');
      return { ok: false };
    }
    const animateurId = consomme.rows[0].animateur_id;

    // Compte suspendu ou supprimé entre l'émission et l'usage : on annule tout
    // (le jeton n'est pas consommé, mais il ne sert à rien tant que le compte
    // n'est pas réactivé, et il expire de lui-même).
    const compte = await client.query<{ username: string; tenant_id: string }>(
      `UPDATE animateurs
          SET password_hash = $2, password_reset_requested = FALSE, ${SQL_REVOQUER_SESSIONS}
        WHERE id = $1 AND statut = 'actif'
        RETURNING username, tenant_id`,
      [animateurId, nouveauHash],
    );
    if (compte.rowCount !== 1) {
      await client.query('ROLLBACK');
      return { ok: false };
    }

    // Tout autre lien encore en circulation pour ce compte devient inutilisable.
    await client.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE animateur_id = $1 AND used_at IS NULL',
      [animateurId],
    );
    // La demande est satisfaite : la notification « reset-request » des admins
    // n'a plus lieu d'être (filtrée par tenant ET par compte concerné).
    await client.query(
      `DELETE FROM notifications
        WHERE type = 'reset-request' AND from_animateur_id = $1 AND tenant_id = $2`,
      [animateurId, compte.rows[0].tenant_id],
    );

    await client.query('COMMIT');
    return {
      ok: true,
      animateurId,
      username: compte.rows[0].username,
      tenantId: compte.rows[0].tenant_id,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
