import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import {
  LOGIN_MAX_TENTATIVES, aUnTenant, chargerCompteActif, emettreSession,
  poserCookieSession, verifierSecondFacteur,
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
    const { pendingToken, code } = (body ?? {}) as { pendingToken?: unknown; code?: unknown };
    if (typeof pendingToken !== 'string' || !pendingToken || !code) {
      return NextResponse.json({ success: false, error: 'Données manquantes.' }, { status: 400, headers: CORS });
    }

    // Vérifier le billet temporaire 2FA
    const pending = await verifyJWT(pendingToken);
    if (!pending || pending.type !== 'totp-pending' || typeof pending.id !== 'string') {
      return NextResponse.json({ success: false, error: 'Billet expiré. Reconnectez-vous.' }, { status: 401, headers: CORS });
    }

    // Le compte est RELU en base : rôle, tenant et statut actuels font foi,
    // pas ceux figés dans le billet au moment de la saisie du mot de passe.
    const compte = await chargerCompteActif(pending.id);
    if (!compte || !compte.totpEnabled || !compte.totpSecret) {
      return NextResponse.json({ success: false, error: 'Configuration 2FA introuvable.' }, { status: 401, headers: CORS });
    }
    // Un billet émis avant une révocation (changement de mot de passe, de
    // rôle, déconnexion) n'est plus recevable.
    if (typeof pending.sv === 'number' && pending.sv !== compte.sessionVersion) {
      return NextResponse.json({ success: false, error: 'Billet expiré. Reconnectez-vous.' }, { status: 401, headers: CORS });
    }
    if (!aUnTenant(compte)) {
      // Pas de repli silencieux, qui ferait basculer un compte d'une autre
      // structure sur 'nogent'.
      return NextResponse.json({ success: false, error: 'Session invalide — reconnectez-vous.' }, { status: 401, headers: CORS });
    }

    // Validation + antirejeu ATOMIQUE (un même pas n'est accepté qu'une fois,
    // même sous concurrence) et limitation par compte — voir lib/totp.ts.
    const resultat = await verifierSecondFacteur(compte, code);
    if (resultat === 'bloque') {
      await logAudit({ action: 'TOTP_FAILED', animateurId: compte.id, animateurUsername: compte.username, tenant_id: compte.tenantId, details: { reason: 'rate-limit', ip } });
      return NextResponse.json(
        { success: false, error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
        { status: 429, headers: CORS },
      );
    }
    if (resultat === 'invalide') {
      await logAudit({ action: 'TOTP_FAILED', animateurId: compte.id, animateurUsername: compte.username, tenant_id: compte.tenantId });
      return NextResponse.json({ success: false, error: 'Code incorrect.' }, { status: 401, headers: CORS });
    }
    if (resultat === 'rejoue') {
      await logAudit({ action: 'TOTP_FAILED', animateurId: compte.id, animateurUsername: compte.username, tenant_id: compte.tenantId, details: { reason: 'replay' } });
      return NextResponse.json({ success: false, error: 'Code déjà utilisé.' }, { status: 401, headers: CORS });
    }

    // Code OK → émettre la vraie session
    const { token } = await emettreSession(compte);
    await logAudit({ action: 'LOGIN', animateurId: compte.id, animateurUsername: compte.username, tenant_id: compte.tenantId, details: { ip, role: compte.role, via: '2FA' } });
    await reinitialiserTentatives(ip);

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
    console.error('[api/auth/verify-totp]', err);
    return NextResponse.json({ success: false, error: 'Erreur serveur' }, { status: 500, headers: CORS });
  }
}
