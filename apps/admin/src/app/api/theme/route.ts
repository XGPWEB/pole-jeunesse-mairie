import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await requireAuth(request);
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const tenant_id = user?.tenant_id ?? 'nogent';
  try {
    const row = await queryOne<{ data: any }>('SELECT data FROM theme WHERE id = $1', [tenant_id]);
    return NextResponse.json(row?.data ?? {});
  } catch (err) {
    console.error('[api/theme]', err);
    return NextResponse.json({});
  }
}

export async function PUT(request: NextRequest) {
  const user = await requireAuth(request);
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Accès refusé — rôle admin requis' }, { status: 403 });
  }
  const { tenant_id } = user;
  try {
    const body = await request.json();
    await pool.query(`
      INSERT INTO theme (id, data) VALUES ($1, $2)
      ON CONFLICT (id) DO UPDATE SET data = theme.data || $2
    `, [tenant_id, body]);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/theme]', err);
    return NextResponse.json({ success: false, error: 'Erreur serveur' }, { status: 500 });
  }
}
