import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';

const CORS = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN ?? 'https://jeunessenogent.cloud',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(request: NextRequest) {
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401, headers: CORS });
  }
  const { tenant_id } = user;
  try {
    const rows = await query(`
      SELECT id, nom, prenom,
             date_naissance::text AS "dateNaissance",
             espace_id AS "espaceId",
             COALESCE(secteur, '') AS secteur
      FROM jeunes
      WHERE tenant_id = $1
      ORDER BY nom, prenom
    `, [tenant_id]);
    return NextResponse.json(rows, { headers: CORS });
  } catch (err) {
    console.error('[api/jeunes]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500, headers: CORS });
  }
}
