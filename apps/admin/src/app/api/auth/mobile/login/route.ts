import { NextRequest, NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import {
  LOGIN_MAX_TENTATIVES, aUnTenant, emettreSession, normaliserUsername,
  verifierIdentifiants, verifierSecondFacteur,
} from '@/lib/login';
import { FENETRE_15_MIN_MS, consommerTentative, ipClient, reinitialiserTentatives } from '@/lib/rate-limit';

/**
 * Connexion de l'application mobile.
 *
 * Même cœur que le login web (lib/login.ts) : limitation de débit, temps de
 * réponse constant, audit, antirejeu TOTP atomique. Deux différences de
 * transport seulement :
 *  - le jeton est renvoyé dans le corps et présenté ensuite en
 *    `Authorization: Bearer` (un cookie httpOnly n'a pas de sens dans une
 *    application native) — AUCUN cookie n'est posé ;
 *  - le second facteur est fourni dans la même requête (`totpCode`), il n'y a
 *    donc pas de billet provisoire à faire transiter par le téléphone.
 *
 * Le jeton obtenu est une session ordinaire : mêmes gardes, même révocation
 * (logout, changement de mot de passe, de rôle ou de statut).
 */

type CodeErreur = 'INVALID_CREDENTIALS' | 'TOTP_REQUIRED' | 'TOTP_INVALID';

function refus(error: string, code: CodeErreur) {
  return NextResponse.json({ error, code }, { status: 401 });
}

function tropDeTentatives() {
  return NextResponse.json(
    { error: 'Trop de tentatives. Réessayez dans 15 minutes.', code: 'RATE_LIMITED' },
    { status: 429 },
  );
}

export async function POST(request: NextRequest) {
  try {
    const ip = ipClient(request);
    // Même clé que le login web : les deux portes partagent le même compteur,
    // sinon l'une servirait à contourner la limite de l'autre.
    if (!await consommerTentative(ip, LOGIN_MAX_TENTATIVES, FENETRE_15_MIN_MS)) {
      return tropDeTentatives();
    }

    const body: unknown = await request.json().catch(() => null);
    const { username, password, totpCode } = (body ?? {}) as {
      username?: unknown; password?: unknown; totpCode?: unknown;
    };
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      return NextResponse.json({ error: 'Identifiants manquants.', code: 'MISSING_FIELDS' }, { status: 400 });
    }

    const compte = await verifierIdentifiants(username, password);
    if (!compte) {
      await logAudit({
        action: 'LOGIN_FAILED',
        details: { username: normaliserUsername(username), ip, via: 'mobile' },
      });
      return refus('Identifiants incorrects.', 'INVALID_CREDENTIALS');
    }
    if (!aUnTenant(compte)) {
      console.error('[api/auth/mobile/login] tenant_id absent pour', compte.username);
      return NextResponse.json({ error: 'Compte mal configuré — contactez l’administrateur.' }, { status: 500 });
    }

    if (compte.totpEnabled) {
      const fourni = totpCode !== undefined && totpCode !== null && String(totpCode).trim() !== '';
      if (!fourni) {
        return refus('Code de double authentification requis.', 'TOTP_REQUIRED');
      }
      const resultat = await verifierSecondFacteur(compte, totpCode);
      if (resultat === 'bloque') {
        await logAudit({ action: 'TOTP_FAILED', animateurId: compte.id, animateurUsername: compte.username, tenant_id: compte.tenantId, details: { reason: 'rate-limit', ip, via: 'mobile' } });
        return tropDeTentatives();
      }
      if (resultat !== 'ok') {
        await logAudit({
          action: 'TOTP_FAILED',
          animateurId: compte.id,
          animateurUsername: compte.username,
          tenant_id: compte.tenantId,
          details: { via: 'mobile', ...(resultat === 'rejoue' ? { reason: 'replay' } : {}) },
        });
        return refus(
          resultat === 'rejoue' ? 'Code déjà utilisé. Attendez le code suivant.' : 'Code incorrect.',
          'TOTP_INVALID',
        );
      }
    }

    await reinitialiserTentatives(ip);
    const { token, expiresAt } = await emettreSession(compte);

    await logAudit({
      action: 'LOGIN',
      animateurId: compte.id,
      animateurUsername: compte.username,
      tenant_id: compte.tenantId,
      details: { ip, role: compte.role, via: compte.totpEnabled ? 'mobile+2FA' : 'mobile' },
    });

    return NextResponse.json({
      token,
      expiresAt: expiresAt.toISOString(),
      user: {
        id: compte.id,
        username: compte.username,
        nom: compte.nom,
        prenom: compte.prenom,
        role: compte.role,
        espaceAssigne: compte.espaceAssigne,
        tenantId: compte.tenantId,
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[api/auth/mobile/login]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
