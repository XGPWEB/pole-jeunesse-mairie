import { NextRequest } from 'next/server';
import pool from '@/lib/db';

/**
 * Limitation de débit persistée en base (table `login_attempts`), partagée par
 * toutes les routes d'authentification. Factorisée ici : la même requête était
 * copiée dans login, verify-totp et forgot-password, et le login REMETTAIT À
 * ZÉRO le compteur partagé avec verify-totp — il suffisait d'alterner les deux
 * appels pour essayer des codes TOTP sans aucune limite.
 *
 * La colonne s'appelle `ip` pour des raisons historiques, mais c'est une clé
 * libre : on la préfixe selon l'usage (`fp:<ip>`, `totp:<id>`, …).
 *
 * L'incrément est atomique (INSERT … ON CONFLICT DO UPDATE) : deux requêtes
 * simultanées ne peuvent pas lire le même compteur.
 */
export async function consommerTentative(
  cle: string,
  maxTentatives: number,
  fenetreMs: number,
): Promise<boolean> {
  const resetAt = new Date(Date.now() + fenetreMs);
  const result = await pool.query<{ count: number }>(`
    INSERT INTO login_attempts (ip, count, reset_at)
    VALUES ($1, 1, $2)
    ON CONFLICT (ip) DO UPDATE SET
      count    = CASE WHEN login_attempts.reset_at < NOW() THEN 1 ELSE login_attempts.count + 1 END,
      reset_at = CASE WHEN login_attempts.reset_at < NOW() THEN $2 ELSE login_attempts.reset_at END
    RETURNING count
  `, [cle, resetAt]);
  const compte = Number(result.rows[0].count);
  // Signalé au monitoring au moment précis où le quota est franchi, et non à
  // chaque tentative suivante : un client qui insiste ne doit pas remplir le
  // journal d'entrées identiques. La clé (adresse IP ou identifiant de compte)
  // n'est pas recopiée : seul son préfixe d'usage l'est.
  if (compte === maxTentatives + 1) {
    // Les clés sans préfixe connu sont celles de la connexion (adresse IP nue,
    // qui peut elle-même contenir des « : » en IPv6).
    const usage = /^([a-z]+):/.exec(cle)?.[1] ?? '';
    void import('@/lib/monitoring')
      .then(({ logMonitoringEvent }) => logMonitoringEvent({
        source: 'securite',
        type: `Quota de tentatives épuisé — ${LIBELLES_USAGE[usage] ?? 'connexion'}`,
        message: `Plus de ${maxTentatives} tentatives en ${Math.round(fenetreMs / 60000)} minutes depuis une même origine.`,
      }))
      .catch(() => {});
  }
  return compte <= maxTentatives;
}

const LIBELLES_USAGE: Record<string, string> = {
  login: 'connexion',
  fp: 'mot de passe oublié',
  rp: 'confirmation de réinitialisation',
  totp: 'code de double authentification',
  reauth: 'confirmation du mot de passe',
  mon: 'rapports du navigateur',
};

export async function reinitialiserTentatives(cle: string): Promise<void> {
  await pool.query('DELETE FROM login_attempts WHERE ip = $1', [cle]);
}

/**
 * Preuve du mot de passe ACTUEL d'un compte (« reauth ») : une seule clé par
 * compte, quel que soit le point d'entrée (Mon profil, double authentification,
 * sa propre fiche, envoi d'identifiants). Alterner les écrans ne donne donc pas
 * de nouveaux essais.
 */
export const REAUTH_MAX_TENTATIVES = 5;
export const cleReauth = (compteId: string) => `reauth:${compteId}`;

/**
 * Rend la tentative qu'une vérification RÉUSSIE vient de consommer, sans
 * effacer les échecs précédents. Pour les vérifications faites par un tiers
 * (l'envoi d'identifiants contrôle le mot de passe du compte destinataire) :
 * une réussite n'y prouve pas que l'auteur est le titulaire, elle ne doit donc
 * pas remettre le compteur à zéro comme le fait le titulaire qui se
 * réauthentifie.
 */
export async function rembourserTentative(cle: string): Promise<void> {
  await pool.query(
    'UPDATE login_attempts SET count = GREATEST(count - 1, 0) WHERE ip = $1 AND reset_at >= NOW()',
    [cle],
  );
}

/**
 * Adresse du client pour la limitation de débit.
 * X-Real-IP est posé par Nginx ($remote_addr) — non falsifiable, contrairement
 * à X-Forwarded-For, qui n'est qu'un repli pour le développement local.
 */
export function ipClient(request: NextRequest): string {
  return request.headers.get('x-real-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'unknown';
}

export const FENETRE_15_MIN_MS = 15 * 60 * 1000;
