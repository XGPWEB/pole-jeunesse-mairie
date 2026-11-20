import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import pool from '@/lib/db';

const CORS = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN ?? 'https://jeunessenogent.cloud',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

async function getUserPrefs(animateurId: string) {
  const rows = await query<{ actualite_id: string; dismissed: boolean; favorite: boolean }>(
    'SELECT actualite_id, dismissed, favorite FROM actualites_prefs WHERE animateur_id = $1',
    [animateurId],
  );
  return {
    dismissed: rows.filter((r) => r.dismissed).map((r) => r.actualite_id),
    favorites: rows.filter((r) => r.favorite).map((r) => r.actualite_id),
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    if (!session) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401, headers: CORS });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    if (!userId) {
      return NextResponse.json({ error: 'userId requis' }, { status: 400, headers: CORS });
    }
    if (userId !== session.id) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403, headers: CORS });
    }

    const prefs = await getUserPrefs(userId);
    return NextResponse.json(prefs, { headers: CORS });
  } catch (err) {
    console.error('[api/actualites/prefs]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500, headers: CORS });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    if (!session) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401, headers: CORS });
    }

    const body = await request.json();
    const { userId, action, actualiteId } = body;
    if (!userId || !action || !actualiteId) {
      return NextResponse.json({ error: 'userId, action et actualiteId requis' }, { status: 400, headers: CORS });
    }
    if (userId !== session.id) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403, headers: CORS });
    }

    let sql: string;
    switch (action) {
      case 'dismiss':
        sql = `INSERT INTO actualites_prefs (animateur_id, actualite_id, dismissed)
               VALUES ($1, $2, TRUE)
               ON CONFLICT (animateur_id, actualite_id) DO UPDATE SET dismissed = TRUE`;
        break;
      case 'undismiss':
        sql = `INSERT INTO actualites_prefs (animateur_id, actualite_id, dismissed)
               VALUES ($1, $2, FALSE)
               ON CONFLICT (animateur_id, actualite_id) DO UPDATE SET dismissed = FALSE`;
        break;
      case 'favorite':
        sql = `INSERT INTO actualites_prefs (animateur_id, actualite_id, favorite)
               VALUES ($1, $2, TRUE)
               ON CONFLICT (animateur_id, actualite_id) DO UPDATE SET favorite = TRUE`;
        break;
      case 'unfavorite':
        sql = `INSERT INTO actualites_prefs (animateur_id, actualite_id, favorite)
               VALUES ($1, $2, FALSE)
               ON CONFLICT (animateur_id, actualite_id) DO UPDATE SET favorite = FALSE`;
        break;
      default:
        return NextResponse.json({ error: 'Action invalide' }, { status: 400, headers: CORS });
    }

    await pool.query(sql, [userId, actualiteId]);
    const prefs = await getUserPrefs(userId);
    return NextResponse.json({ success: true, prefs }, { headers: CORS });
  } catch (err) {
    console.error('[api/actualites/prefs]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500, headers: CORS });
  }
}
