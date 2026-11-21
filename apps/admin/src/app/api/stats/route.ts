import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { toLocalDateStr } from '@/lib/dates';
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
  if (!user) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401, headers: CORS });
  }
  const { tenant_id } = user;
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = toLocalDateStr(cutoff);

    // Jeunes par espace
    const espaceRows = await query(`
      SELECT espace_id AS "espaceId", COUNT(*) AS count
      FROM jeunes
      WHERE tenant_id = $1 AND espace_id IN ('collegiens','lyceens','pij','clas')
      GROUP BY espace_id
    `, [tenant_id]);
    const totalJeunes = await queryOne<{ count: string }>('SELECT COUNT(*) AS count FROM jeunes WHERE tenant_id = $1', [tenant_id]);
    const parEspace = ['collegiens', 'lyceens', 'pij', 'clas'].map((id) => ({
      espaceId: id,
      count: Number(espaceRows.find((r: any) => r.espaceId === id)?.count ?? 0),
    }));

    const [ptRes, insRes, totalActivites, parJourRows] = await Promise.all([
      queryOne<{ total: string; libre: string; activite: string; manuel: string }>(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE type = 'accueil-libre') AS libre,
          COUNT(*) FILTER (WHERE type = 'activite') AS activite,
          COUNT(*) FILTER (WHERE manuel = TRUE) AS manuel
        FROM pointages WHERE tenant_id = $1
      `, [tenant_id]),
      queryOne<{ total: string; confirmees: string; attente: string; annulees: string }>(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE statut = 'confirmee') AS confirmees,
          COUNT(*) FILTER (WHERE statut IN ('liste-attente','en-attente')) AS attente,
          COUNT(*) FILTER (WHERE statut IN ('annulee','refusee')) AS annulees
        FROM inscriptions WHERE tenant_id = $1
      `, [tenant_id]),
      queryOne<{ count: string }>('SELECT COUNT(*) AS count FROM activites WHERE tenant_id = $1', [tenant_id]),
      query<{ date: string; count: string }>(`
        SELECT date::text, COUNT(*) AS count
        FROM pointages
        WHERE tenant_id = $1 AND date >= $2
        GROUP BY date
        ORDER BY date
      `, [tenant_id, cutoffStr]),
    ]);

    const parJour: Record<string, number> = {};
    for (const r of parJourRows) parJour[r.date] = Number(r.count);

    return NextResponse.json({
      jeunes: {
        total: Number(totalJeunes?.count ?? 0),
        parEspace,
      },
      activites: { total: Number(totalActivites?.count ?? 0) },
      pointages: {
        total:         Number(ptRes?.total ?? 0),
        libreCount:    Number(ptRes?.libre ?? 0),
        activiteCount: Number(ptRes?.activite ?? 0),
        manuelCount:   Number(ptRes?.manuel ?? 0),
        parJour,
      },
      inscriptions: {
        total:      Number(insRes?.total ?? 0),
        confirmees: Number(insRes?.confirmees ?? 0),
        enAttente:  Number(insRes?.attente ?? 0),
        annulees:   Number(insRes?.annulees ?? 0),
      },
    }, { headers: CORS });
  } catch (err) {
    console.error('[api/stats]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500, headers: CORS });
  }
}
