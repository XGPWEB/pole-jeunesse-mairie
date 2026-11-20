import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { effacerCookieSession } from '@/lib/login';
import { revoquerSessions } from '@/lib/revocation';

export async function POST(request: NextRequest) {
  // Garde complète (cookie de session) : seule une session encore valide peut
  // déclencher une révocation. Un billet 2FA provisoire, un jeton déjà révoqué
  // ou celui d'un compte suspendu ne modifie rien — auparavant un simple JWT
  // signé non typé suffisait, sans contrôle en base.
  const session = await requireAuth(request);

  if (session) {
    // Incrémente la version de session : TOUTES les sessions du compte
    // deviennent définitivement invalides, y compris après une
    // reconnexion — voir lib/revocation.ts.
    await revoquerSessions(session.id);
    await logAudit({
      action: 'LOGOUT',
      animateurId: session.id,
      animateurUsername: session.username,
      tenant_id: session.tenant_id,
    });
  }

  // Réponse identique dans tous les cas, et cookie toujours effacé : le
  // navigateur doit pouvoir se « déconnecter » même avec un jeton périmé.
  const response = NextResponse.json({ success: true });
  effacerCookieSession(response);
  return response;
}

// Pas de handler GET : une déconnexion est un effet de bord (révocation de
// session en base) et ne doit jamais pouvoir être déclenchée par une simple
// navigation ou un lien tiers (CSRF de nuisance via <img>/<a href> malgré
// sameSite=lax, qui autorise les navigations de premier niveau en GET).
// Tous les appels du front (AdminSidebar, AnimateurSidebar) utilisent déjà
// fetch(..., { method: 'POST' }).
