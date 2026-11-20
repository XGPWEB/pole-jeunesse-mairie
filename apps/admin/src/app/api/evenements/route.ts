import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAuth } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

const SELECT = `
  SELECT id, titre, description, date::text AS date,
         heure_debut AS "heureDebut", heure_fin AS "heureFin",
         lieu, espaces, created_by AS "createdBy",
         created_at AS "createdAt", updated_at AS "updatedAt"
  FROM evenements
`;

export async function GET(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { tenant_id } = session;
  try {
    const rows = await query(`${SELECT} WHERE tenant_id = $1 ORDER BY date DESC`, [tenant_id]);
    return NextResponse.json({ evenements: rows });
  } catch (err) {
    console.error('[api/evenements]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  const { tenant_id } = session;

  try {
    const body = await req.json();
    const { titre, date, heureDebut, lieu } = body;
    if (!titre || !date || !heureDebut || !lieu) {
      return NextResponse.json({ error: 'Champs obligatoires manquants (titre, date, heureDebut, lieu)' }, { status: 400 });
    }

    if (body.id) {
      const row = await queryOne(`
        UPDATE evenements
        SET titre       = COALESCE($2, titre),
            description = $3,
            date        = COALESCE($4, date),
            heure_debut = COALESCE($5, heure_debut),
            heure_fin   = $6,
            lieu        = COALESCE($7, lieu),
            espaces     = COALESCE($8, espaces),
            updated_at  = NOW()
        WHERE id = $1 AND tenant_id = $9
        RETURNING id, titre, description, date::text AS date,
                  heure_debut AS "heureDebut", heure_fin AS "heureFin",
                  lieu, espaces, created_by AS "createdBy",
                  created_at AS "createdAt", updated_at AS "updatedAt"
      `, [body.id, titre, body.description ?? null, date, heureDebut, body.heureFin ?? null, lieu, body.espaces ?? null, tenant_id]);

      if (!row) return NextResponse.json({ error: 'Événement introuvable' }, { status: 404 });
      const all = await query(`${SELECT} WHERE tenant_id = $1 ORDER BY date DESC`, [tenant_id]);
      return NextResponse.json({ success: true, evenement: row, evenements: all });
    }

    const id = `evt-${randomUUID()}`;
    const row = await queryOne(`
      INSERT INTO evenements (id, titre, description, date, heure_debut, heure_fin, lieu, espaces, created_by, tenant_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, titre, description, date::text AS date,
                heure_debut AS "heureDebut", heure_fin AS "heureFin",
                lieu, espaces, created_by AS "createdBy",
                created_at AS "createdAt", updated_at AS "updatedAt"
    `, [id, titre, body.description ?? '', date, heureDebut, body.heureFin ?? '', lieu, body.espaces ?? ['Tous'], session.id, tenant_id]);

    const all = await query(`${SELECT} WHERE tenant_id = $1 ORDER BY date DESC`, [tenant_id]);
    return NextResponse.json({ success: true, evenement: row, evenements: all });
  } catch (err) {
    console.error('[api/evenements]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  const { tenant_id } = session;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID requis' }, { status: 400 });

    const deleted = await queryOne('DELETE FROM evenements WHERE id = $1 AND tenant_id = $2 RETURNING id', [id, tenant_id]);
    if (!deleted) return NextResponse.json({ error: 'Événement introuvable' }, { status: 404 });

    const all = await query(`${SELECT} WHERE tenant_id = $1 ORDER BY date DESC`, [tenant_id]);
    return NextResponse.json({ success: true, evenements: all });
  } catch (err) {
    console.error('[api/evenements]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
