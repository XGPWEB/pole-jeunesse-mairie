import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { origineAutorisee } from '@/lib/adresse';

const CORS = {
  'Access-Control-Allow-Origin': origineAutorisee(),
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(request: NextRequest) {
  const user = await requireAuth(request);
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401, headers: CORS });
  const { tenant_id } = user;
  try {
    const rows = await query(`
      SELECT id, titre,
             espace_id AS "espaceId",
             date::text AS date,
             heure_debut AS "heureDebut",
             heure_fin AS "heureFin"
      FROM activites
      WHERE tenant_id = $1
      ORDER BY date DESC, heure_debut
    `, [tenant_id]);
    return NextResponse.json(rows, { headers: CORS });
  } catch (err) {
    console.error('[api/activites]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500, headers: CORS });
  }
}
