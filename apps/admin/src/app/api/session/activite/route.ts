import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, signJWT, tokenDepuisRequete, verifyJWT, type JWTPayload } from '@/lib/auth';
import { poserCookieSession } from '@/lib/login';

/**
 * Prolonge la session de 10 minutes (lib/auth.ts, SESSION_INACTIVITE_SECONDS).
 *
 * Appelée par le navigateur sur une action réelle de l'utilisateur
 * (components/SurveillanceInactivite.tsx), jamais par les rafraîchissements
 * automatiques. Hors de /api/auth/ : le proxy refuse déjà un jeton expiré, si
 * bien qu'une session fermée pour inactivité ne peut pas être rouverte ici.
 *
 * Le nouveau jeton reprend exactement les claims de l'actuel, `auth_time`
 * compris : la limite de 24 heures après la connexion n'est jamais repoussée.
 */
export async function POST(request: NextRequest) {
  const session = await requireAuth(request);
  const brut = tokenDepuisRequete(request);
  const actuel = session && brut ? await verifyJWT(brut) : null;
  if (!session || !actuel) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const { iat: _iat, exp: _exp, ...claims } = actuel as JWTPayload;
  const token = await signJWT(claims);
  const exp = (await verifyJWT(token))?.exp;

  const response = NextResponse.json({ expiresAt: exp ? new Date(exp * 1000).toISOString() : null });
  poserCookieSession(response, token);
  return response;
}
