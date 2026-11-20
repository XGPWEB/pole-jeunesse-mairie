import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, type JWTPayload } from '@/lib/auth';
import { query } from '@/lib/db';
import pool from '@/lib/db';
import { tenantExploitant } from '@/lib/monitoring';
import { APP_VERSION, APP_COMMIT } from '@/lib/version';

export const dynamic = 'force-dynamic';

type Refus = { status: 401 | 403; error: string };

/**
 * Le journal est réservé aux ADMINISTRATEURS de la commune exploitante de
 * l'instance (voir tenantExploitant) : ses entrées ne sont pas cloisonnées par
 * commune et peuvent citer des chemins ou des messages de n'importe laquelle.
 */
async function exigerExploitant(request: NextRequest): Promise<JWTPayload | Refus> {
  const session = await requireAuth(request);
  if (!session) return { status: 401, error: 'Non authentifié' };
  if (session.role !== 'admin' || session.tenant_id !== tenantExploitant()) {
    return { status: 403, error: 'Accès réservé à l\'administrateur de l\'instance' };
  }
  return session;
}
const estRefus = (r: JWTPayload | Refus): r is Refus => 'status' in r;

/**
 * GET ?days=7|30|90 — fenêtre de jours plutôt que pagination serveur : le
 * volume attendu est faible (des pannes, pas des actions), et la vue par
 * période est celle qui sert. `byType` alimente la répartition en tête de page.
 */
export async function GET(request: NextRequest) {
  const garde = await exigerExploitant(request);
  if (estRefus(garde)) return NextResponse.json({ error: garde.error }, { status: garde.status });
  try {
    const demande = Number.parseInt(new URL(request.url).searchParams.get('days') ?? '', 10);
    const days = Math.min(365, Math.max(1, Number.isFinite(demande) ? demande : 7));
    const items = await query<{ id: string; at: string; source: string; type: string; message: string; detail: string | null; path: string | null }>(
      `SELECT id, at, source, type, message, detail, path
         FROM monitoring_events
        WHERE at >= NOW() - make_interval(days => $1)
        ORDER BY at DESC
        LIMIT 2000`,
      [days],
    );
    const byType: Record<string, number> = {};
    for (const e of items) byType[e.type] = (byType[e.type] ?? 0) + 1;
    return NextResponse.json(
      { items, byType, days, version: APP_VERSION, commit: APP_COMMIT },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (err) {
    console.error('[api/monitoring/events]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

/** DELETE { ids: string[] } — retire des entrées traitées du journal. */
export async function DELETE(request: NextRequest) {
  const garde = await exigerExploitant(request);
  if (estRefus(garde)) return NextResponse.json({ error: garde.error }, { status: garde.status });
  try {
    const corps: unknown = await request.json().catch(() => null);
    const brut = (corps as { ids?: unknown } | null)?.ids;
    const ids = Array.isArray(brut) ? brut.filter((id): id is string => typeof id === 'string').slice(0, 500) : [];
    if (ids.length === 0) return NextResponse.json({ error: 'Aucune entrée sélectionnée.' }, { status: 400 });
    const res = await pool.query('DELETE FROM monitoring_events WHERE id = ANY($1::text[])', [ids]);
    return NextResponse.json({ ok: true, deleted: res.rowCount ?? 0 });
  } catch (err) {
    console.error('[api/monitoring/events]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
