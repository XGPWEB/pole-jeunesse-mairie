import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { logAudit } from '@/lib/audit';
import { erreurPolitiqueMotDePasse } from '@/lib/password';
import { consommerJetonEtChangerMotDePasse } from '@/lib/password-reset';
import { FENETRE_15_MIN_MS, consommerTentative, ipClient } from '@/lib/rate-limit';

const MAX_ATTEMPTS = 10;

/**
 * Dernière étape de la réinitialisation — ANONYME par nature (le titulaire a
 * perdu son mot de passe) : la seule preuve est le jeton reçu par courriel.
 *
 * C'est le SEUL endroit du flux de réinitialisation où le hash du mot de passe
 * est modifié, et uniquement après consommation atomique du jeton.
 */
export async function POST(request: NextRequest) {
  try {
    if (!await consommerTentative(`rp:${ipClient(request)}`, MAX_ATTEMPTS, FENETRE_15_MIN_MS)) {
      return NextResponse.json(
        { success: false, error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
        { status: 429 },
      );
    }

    const body: unknown = await request.json().catch(() => null);
    const { token, newPassword } = (body ?? {}) as { token?: unknown; newPassword?: unknown };
    if (typeof token !== 'string' || !token || typeof newPassword !== 'string') {
      return NextResponse.json({ success: false, error: 'Données manquantes.' }, { status: 400 });
    }

    // La politique est vérifiée AVANT de toucher au jeton : un mot de passe
    // trop faible ne doit pas « brûler » le lien à usage unique.
    const erreur = erreurPolitiqueMotDePasse(newPassword);
    if (erreur) {
      return NextResponse.json({ success: false, error: erreur }, { status: 400 });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    const resultat = await consommerJetonEtChangerMotDePasse(token, hash);
    if (!resultat.ok) {
      // Message unique : jeton inconnu, expiré, déjà utilisé ou compte inactif.
      return NextResponse.json(
        { success: false, error: 'Lien invalide ou expiré. Refaites une demande de réinitialisation.' },
        { status: 400 },
      );
    }

    await logAudit({
      action: 'PASSWORD_RESET',
      tableName: 'animateurs',
      recordId: resultat.animateurId,
      animateurId: resultat.animateurId,
      animateurUsername: resultat.username,
      tenant_id: resultat.tenantId,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/auth/reset-password/confirm]', err);
    return NextResponse.json({ success: false, error: 'Erreur serveur' }, { status: 500 });
  }
}
