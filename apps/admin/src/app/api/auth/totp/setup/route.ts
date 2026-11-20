import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { requireAuth, type JWTPayload } from '@/lib/auth';
import pool, { queryOne } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import {
  FENETRE_15_MIN_MS, REAUTH_MAX_TENTATIVES, cleReauth, consommerTentative, reinitialiserTentatives,
} from '@/lib/rate-limit';
import {
  TOTP_PENDING_TTL_MINUTES, construireTotp, consommerCodeTotp, genererSecretTotp, pasDuCode,
} from '@/lib/totp';

/**
 * Gestion du second facteur (TOTP) du compte connecté — admin uniquement.
 *
 * Trois opérations DISTINCTES, là où l'ancienne route n'avait qu'un « enable »
 * qui écrasait le facteur existant avec un secret FOURNI PAR LE CLIENT — une
 * session volée suffisait donc à remplacer le second facteur du titulaire :
 *
 *   start    Prépare une activation (aucun facteur actif) ou une ROTATION
 *            (facteur actif). Exige le mot de passe ; la rotation exige en plus
 *            un code du facteur ACTUEL. Le nouveau secret est généré et
 *            conservé CÔTÉ SERVEUR (totp_pending_secret), avec une expiration.
 *   enable   Confirme avec un code du NOUVEAU secret. Le serveur valide contre
 *            le secret provisoire qu'il a lui-même stocké ; le client ne peut
 *            plus en imposer un.
 *   disable  Exige le mot de passe ET un code du facteur actuel.
 *
 * Le facteur actif n'est jamais modifié avant la confirmation : une
 * activation/rotation abandonnée laisse le compte dans son état initial.
 */


interface EtatTotp {
  password_hash: string | null;
  totp_enabled: boolean | null;
  totp_secret: string | null;
  totp_pending_secret: string | null;
  pending_valide: boolean | null;
}

async function chargerEtat(animateurId: string): Promise<EtatTotp | null> {
  return queryOne<EtatTotp>(
    `SELECT password_hash, totp_enabled, totp_secret, totp_pending_secret,
            (totp_pending_expires_at IS NOT NULL AND totp_pending_expires_at > NOW()) AS pending_valide
       FROM animateurs WHERE id = $1`,
    [animateurId],
  );
}

function erreur(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function garde(request: NextRequest): Promise<JWTPayload | NextResponse> {
  const session = await requireAuth(request);
  if (!session) return erreur('Non authentifié', 401);
  if (session.role !== 'admin') return erreur('Admin uniquement', 403);
  return session;
}

/**
 * Réauthentification : la possession du cookie ne suffit pas pour toucher au
 * second facteur, il faut prouver à l'instant la connaissance du mot de passe.
 * Limitée par compte, sinon cette route offrirait à une session volée un
 * oracle illimité pour deviner le mot de passe.
 */
async function reauthentifier(
  session: JWTPayload,
  etat: EtatTotp,
  password: unknown,
): Promise<NextResponse | null> {
  if (typeof password !== 'string' || !password) {
    return erreur('Mot de passe requis pour modifier la double authentification.', 400);
  }
  const cle = cleReauth(session.id);
  if (!await consommerTentative(cle, REAUTH_MAX_TENTATIVES, FENETRE_15_MIN_MS)) {
    return erreur('Trop de tentatives. Réessayez dans 15 minutes.', 429);
  }
  const valide = etat.password_hash ? await bcrypt.compare(password, etat.password_hash) : false;
  if (!valide) {
    await logAudit({ action: 'TOTP_REAUTH_FAILED', animateurId: session.id, animateurUsername: session.username, tenant_id: session.tenant_id });
    return erreur('Mot de passe incorrect.', 403);
  }
  await reinitialiserTentatives(cle);
  return null;
}

/** Vérifie et consomme (antirejeu atomique) un code du facteur ACTIF. */
async function exigerFacteurActuel(
  session: JWTPayload,
  etat: EtatTotp,
  code: unknown,
): Promise<NextResponse | null> {
  if (!etat.totp_secret) return erreur('2FA non activée', 400);
  if (code === undefined || code === null || String(code).trim() === '') {
    return erreur('Code de votre application actuelle requis.', 400);
  }
  const cle = `totp:${session.id}`;
  if (!await consommerTentative(cle, REAUTH_MAX_TENTATIVES, FENETRE_15_MIN_MS)) {
    return erreur('Trop de tentatives. Réessayez dans 15 minutes.', 429);
  }
  const resultat = await consommerCodeTotp(session.id, session.username, etat.totp_secret, code);
  if (resultat === 'invalide') return erreur('Code invalide.', 400);
  if (resultat === 'rejoue') return erreur('Code déjà utilisé. Attendez le code suivant.', 400);
  await reinitialiserTentatives(cle);
  return null;
}

/** État du second facteur — lecture seule, ne génère ni ne révèle aucun secret. */
export async function GET(request: NextRequest) {
  const session = await garde(request);
  if (session instanceof NextResponse) return session;

  const etat = await chargerEtat(session.id);
  if (!etat) return erreur('Introuvable', 404);
  return NextResponse.json({
    enabled: etat.totp_enabled === true,
    pending: !!etat.totp_pending_secret && etat.pending_valide === true,
  });
}

export async function POST(request: NextRequest) {
  try {
    const session = await garde(request);
    if (session instanceof NextResponse) return session;

    const body: unknown = await request.json().catch(() => null);
    const { action, password, code, currentCode } = (body ?? {}) as {
      action?: unknown; password?: unknown; code?: unknown; currentCode?: unknown;
    };

    const etat = await chargerEtat(session.id);
    if (!etat) return erreur('Introuvable', 404);
    const actif = etat.totp_enabled === true && !!etat.totp_secret;

    // ── start : activation initiale ou rotation ──────────────────────────────
    if (action === 'start') {
      const refusMdp = await reauthentifier(session, etat, password);
      if (refusMdp) return refusMdp;

      if (actif) {
        // ROTATION : preuve de possession du facteur actuel obligatoire.
        const refusCode = await exigerFacteurActuel(session, etat, currentCode);
        if (refusCode) return refusCode;
      }

      const secret = genererSecretTotp();
      await pool.query(
        `UPDATE animateurs
            SET totp_pending_secret = $2,
                totp_pending_expires_at = NOW() + ($3 || ' minutes')::interval
          WHERE id = $1`,
        [session.id, secret, String(TOTP_PENDING_TTL_MINUTES)],
      );

      const uri = construireTotp(session.username, secret).toString();
      const qrCode = await QRCode.toDataURL(uri, { width: 256, margin: 2 });
      await logAudit({
        action: actif ? 'TOTP_ROTATION_STARTED' : 'TOTP_SETUP_STARTED',
        animateurId: session.id, animateurUsername: session.username, tenant_id: session.tenant_id,
      });
      // Le secret est renvoyé pour être AFFICHÉ (QR code / saisie manuelle) ;
      // il n'est plus jamais relu depuis le client pour la validation.
      return NextResponse.json({
        success: true,
        rotation: actif,
        secret,
        uri,
        qrCode,
        expiresInMinutes: TOTP_PENDING_TTL_MINUTES,
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // ── enable : confirmation avec un code du NOUVEAU secret ─────────────────
    if (action === 'enable') {
      if (!code) return erreur('code requis', 400);
      if (!etat.totp_pending_secret || etat.pending_valide !== true) {
        return erreur('Aucune activation en cours ou délai dépassé. Recommencez.', 400);
      }
      const cle = `totp:${session.id}`;
      if (!await consommerTentative(cle, REAUTH_MAX_TENTATIVES, FENETRE_15_MIN_MS)) {
        return erreur('Trop de tentatives. Réessayez dans 15 minutes.', 429);
      }
      const pas = pasDuCode(session.username, etat.totp_pending_secret, code);
      if (pas === null) return erreur('Code invalide. Réessayez.', 400);

      // Bascule atomique : le secret provisoire devient le facteur actif
      // UNIQUEMENT s'il est toujours celui que l'on vient de valider et qu'il
      // n'a pas expiré. Deux confirmations simultanées : la seconde ne trouve
      // plus de secret provisoire et n'obtient aucune ligne.
      // `last_totp_step` avance au pas utilisé : le code qui vient de servir à
      // l'activation ne pourra pas être rejoué pour une connexion.
      const bascule = await pool.query(
        `UPDATE animateurs
            SET totp_secret = totp_pending_secret,
                totp_enabled = TRUE,
                totp_pending_secret = NULL,
                totp_pending_expires_at = NULL,
                last_totp_step = GREATEST(COALESCE(last_totp_step, 0), $3)
          WHERE id = $1
            AND totp_pending_secret = $2
            AND totp_pending_expires_at > NOW()
          RETURNING id`,
        [session.id, etat.totp_pending_secret, pas],
      );
      if (bascule.rowCount !== 1) {
        return erreur('Aucune activation en cours ou délai dépassé. Recommencez.', 400);
      }
      await reinitialiserTentatives(cle);
      await logAudit({
        action: actif ? 'TOTP_ROTATED' : 'TOTP_ENABLED',
        animateurId: session.id, animateurUsername: session.username, tenant_id: session.tenant_id,
      });
      return NextResponse.json({ success: true, enabled: true });
    }

    // ── disable : mot de passe + facteur actuel ──────────────────────────────
    if (action === 'disable') {
      if (!actif) return erreur('2FA non activée', 400);
      const refusMdp = await reauthentifier(session, etat, password);
      if (refusMdp) return refusMdp;
      const refusCode = await exigerFacteurActuel(session, etat, code);
      if (refusCode) return refusCode;

      // Condition sur le secret : si une rotation concurrente vient d'aboutir,
      // on ne désactive pas le nouveau facteur avec la preuve de l'ancien.
      const desactive = await pool.query(
        `UPDATE animateurs
            SET totp_secret = NULL, totp_enabled = FALSE,
                totp_pending_secret = NULL, totp_pending_expires_at = NULL
          WHERE id = $1 AND totp_secret = $2
          RETURNING id`,
        [session.id, etat.totp_secret],
      );
      if (desactive.rowCount !== 1) return erreur('La configuration 2FA a changé. Rechargez la page.', 409);
      await logAudit({ action: 'TOTP_DISABLED', animateurId: session.id, animateurUsername: session.username, tenant_id: session.tenant_id });
      return NextResponse.json({ success: true, enabled: false });
    }

    // ── cancel : abandon d'une activation/rotation en cours ──────────────────
    if (action === 'cancel') {
      await pool.query(
        'UPDATE animateurs SET totp_pending_secret = NULL, totp_pending_expires_at = NULL WHERE id = $1',
        [session.id],
      );
      return NextResponse.json({ success: true });
    }

    return erreur('action invalide (start|enable|disable|cancel)', 400);
  } catch (err) {
    console.error('[api/auth/totp/setup]', err);
    return erreur('Erreur serveur', 500);
  }
}
