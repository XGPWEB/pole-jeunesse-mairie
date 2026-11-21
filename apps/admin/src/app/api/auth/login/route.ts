import { NextRequest, NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import {
  LOGIN_MAX_TENTATIVES, aUnTenant, emettreBilletTotp, emettreSession,
  normaliserUsername, poserCookieSession, verifierIdentifiants,
} from '@/lib/login';
import { FENETRE_15_MIN_MS, consommerTentative, ipClient, reinitialiserTentatives } from '@/lib/rate-limit';
import { origineAutorisee } from '@/lib/adresse';

const CORS = {
  'Access-Control-Allow-Origin': origineAutorisee(),
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request: NextRequest) {
  try {
    const ip = ipClient(request);

    if (!await consommerTentative(ip, LOGIN_MAX_TENTATIVES, FENETRE_15_MIN_MS)) {
      return NextResponse.json(
        { success: false, error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
        { status: 429, headers: CORS },
      );
    }

    const body: unknown = await request.json().catch(() => null);
    const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return NextResponse.json({ success: false, error: 'Identifiants manquants.' }, { status: 400, headers: CORS });
    }

    const compte = await verifierIdentifiants(username, password);
    if (!compte) {
      await logAudit({
        action: 'LOGIN_FAILED',
        details: { username: normaliserUsername(username), ip },
      });
      return NextResponse.json({ success: false, error: 'Identifiants incorrects.' }, { status: 401, headers: CORS });
    }

    // Le tenant vient de la fiche animateur, jamais d'une constante : une valeur
    // figée rendrait inopérants tous les filtres `WHERE tenant_id = $1` du reste
    // de l'application (ils compareraient tous à la même valeur).
    if (!aUnTenant(compte)) {
      console.error('[api/auth/login] tenant_id absent pour', compte.username);
      return NextResponse.json({ success: false, error: 'Compte mal configuré — contactez l’administrateur.' }, { status: 500, headers: CORS });
    }

    // ── 2FA : TOTP activé → billet temporaire ────────────────────────────────
    // Le compteur de tentatives n'est PAS remis à zéro ici : la connexion
    // n'est pas terminée. Le remettre à zéro permettait, en alternant login et
    // verify-totp, d'essayer des codes sans limite.
    if (compte.totpEnabled) {
      const pendingToken = await emettreBilletTotp(compte);
      return NextResponse.json({ success: true, requiresTOTP: true, pendingToken }, { headers: CORS });
    }

    // ── Session normale ───────────────────────────────────────────────────────
    await reinitialiserTentatives(ip);
    const { token } = await emettreSession(compte);

    await logAudit({
      action: 'LOGIN',
      animateurId: compte.id,
      animateurUsername: compte.username,
      tenant_id: compte.tenantId,
      details: { ip, role: compte.role },
    });

    const response = NextResponse.json({
      success: true,
      role: compte.role,
      animateur: {
        id: compte.id,
        nom: compte.nom,
        prenom: compte.prenom,
        username: compte.username,
        espaceAssigne: compte.espaceAssigne,
        poste: compte.poste,
        role: compte.role,
      },
    }, { headers: CORS });

    poserCookieSession(response, token);
    return response;
  } catch (err) {
    console.error('[api/auth/login]', err);
    return NextResponse.json({ success: false, error: 'Erreur serveur' }, { status: 500, headers: CORS });
  }
}
