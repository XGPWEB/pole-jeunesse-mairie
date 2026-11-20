import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Identité de la session courante (cookie `pj_token`).
 *
 * 200 tant que la session est valide, 401 dès qu'elle est expirée, révoquée
 * ou que le compte est suspendu. Les attributs renvoyés sont ceux de la base au moment
 * de l'appel (un changement de rôle ou d'espace y est donc visible).
 */
export async function GET(request: NextRequest) {
  const session = await requireAuth(request);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  const row = await queryOne<{ totpEnabled: boolean | null }>(
    'SELECT totp_enabled AS "totpEnabled" FROM animateurs WHERE id = $1',
    [session.id],
  );
  if (!row) return NextResponse.json({ error: 'Introuvable' }, { status: 404 });

  return NextResponse.json({
    id: session.id,
    username: session.username,
    nom: session.nom ?? '',
    prenom: session.prenom ?? '',
    role: session.role,
    espaceAssigne: session.espaceAssigne,
    tenantId: session.tenant_id,
    totpEnabled: row.totpEnabled === true,
    expiresAt: session.exp ? new Date(session.exp * 1000).toISOString() : null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
