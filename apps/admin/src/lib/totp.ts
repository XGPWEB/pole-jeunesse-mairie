import * as OTPAuth from 'otpauth';
import pool from '@/lib/db';

export const TOTP_PERIOD = 30;
const TOTP_ISSUER = 'Pôle Jeunesse Nogent';

/** Durée de validité d'un secret provisoire (activation / rotation en cours). */
export const TOTP_PENDING_TTL_MINUTES = 10;

export function construireTotp(username: string, secretBase32: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label: username,
    algorithm: 'SHA1',
    digits: 6,
    period: TOTP_PERIOD,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

export function genererSecretTotp(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

/**
 * Valide arithmétiquement un code et retourne le pas Unix (floor(t/30)) auquel
 * il correspond, ou `null` s'il est faux. Aucune écriture : l'antirejeu est
 * appliqué séparément, de façon atomique.
 */
export function pasDuCode(username: string, secretBase32: string, code: unknown): number | null {
  const token = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(token)) return null;
  let delta: number | null;
  try {
    delta = construireTotp(username, secretBase32).validate({ token, window: 1 });
  } catch {
    // Secret illisible en base : on traite comme un code faux plutôt qu'un 500.
    return null;
  }
  if (delta === null) return null;
  return Math.floor(Date.now() / 1000 / TOTP_PERIOD) + delta;
}

export type ResultatTotp = 'ok' | 'invalide' | 'rejoue';

/**
 * Vérifie un code du facteur ACTIF d'un compte et le consomme.
 *
 * Antirejeu ATOMIQUE : un seul UPDATE conditionnel… RETURNING. PostgreSQL
 * verrouille la ligne pendant l'UPDATE et réévalue la condition après
 * l'attente du verrou : de deux requêtes simultanées présentant le même pas,
 * une seule voit `last_totp_step < pas` et obtient une ligne en retour.
 * L'ancienne version lisait `last_totp_step` puis l'écrivait dans une seconde
 * requête — les deux requêtes pouvaient lire la même valeur et accepter le
 * même code.
 *
 * Le secret est relu DANS la condition (`totp_secret = $3`) : si le facteur a
 * été remplacé ou désactivé entre la lecture et l'écriture, rien n'est accepté.
 */
export async function consommerCodeTotp(
  animateurId: string,
  username: string,
  secretBase32: string,
  code: unknown,
): Promise<ResultatTotp> {
  const pas = pasDuCode(username, secretBase32, code);
  if (pas === null) return 'invalide';

  const result = await pool.query(
    `UPDATE animateurs
        SET last_totp_step = $2
      WHERE id = $1
        AND totp_enabled = TRUE
        AND totp_secret = $3
        AND (last_totp_step IS NULL OR last_totp_step < $2)
      RETURNING id`,
    [animateurId, pas, secretBase32],
  );
  return result.rowCount === 1 ? 'ok' : 'rejoue';
}
