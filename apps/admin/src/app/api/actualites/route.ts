import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAuth } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { todayLocal } from '@/lib/dates';
import { sqlEvenementPasse } from '@/lib/actualites';
import { origineAutorisee } from '@/lib/adresse';

const CORS = {
  'Access-Control-Allow-Origin': origineAutorisee(),
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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
    const { searchParams } = new URL(request.url);
    const espaceId = searchParams.get('espaceId');
    const epingle  = searchParams.get('epingle');

    let sql = `
      SELECT id, titre, contenu, date::text AS date, categorie, auteur, epingle,
             espace_id AS "espaceId"
      FROM actualites
      WHERE tenant_id = $1
    `;
    const params: any[] = [tenant_id];

    if (espaceId) {
      params.push(espaceId);
      sql += ` AND (espace_id IS NULL OR espace_id = $${params.length})`;
    }
    if (epingle === '1') {
      sql += ` AND epingle = TRUE`;
    }
    // Les événements passés sont archivés : rendus seulement sur demande (`archives=1`).
    if (searchParams.get('archives') !== '1') {
      params.push(todayLocal());
      sql += ` AND NOT ${sqlEvenementPasse(params.length)}`;
    }

    sql += ` ORDER BY date DESC`;

    const rows = await query(sql, params);
    return NextResponse.json(rows, { headers: CORS });
  } catch (err) {
    console.error('[api/actualites]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500, headers: CORS });
  }
}

export async function POST(request: NextRequest) {
  const user = await requireAuth(request);
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401, headers: CORS });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Accès refusé — rôle admin requis' }, { status: 403, headers: CORS });
  }
  const { tenant_id } = user;
  try {
    const data = await request.json();
    if (!data.titre || !data.contenu) {
      return NextResponse.json({ success: false, error: 'Titre et contenu requis.' }, { status: 400, headers: CORS });
    }

    const id = `actu-${randomUUID()}`;
    const row = await queryOne(`
      INSERT INTO actualites (id, titre, contenu, categorie, espace_id, date, epingle, auteur, tenant_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, titre, contenu, date::text AS date, categorie, auteur, epingle, espace_id AS "espaceId"
    `, [
      id,
      data.titre,
      data.contenu,
      data.categorie ?? 'Info',
      data.espaceId ?? null,
      data.date ?? todayLocal(),
      data.epingle ?? false,
      data.auteur ?? 'Administration',
      tenant_id,
    ]);

    return NextResponse.json({ success: true, actualite: row }, { headers: CORS });
  } catch (err) {
    console.error('[api/actualites]', err);
    return NextResponse.json({ success: false, error: 'Erreur serveur' }, { status: 500, headers: CORS });
  }
}

export async function PUT(request: NextRequest) {
  const user = await requireAuth(request);
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401, headers: CORS });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Accès refusé — rôle admin requis' }, { status: 403, headers: CORS });
  }
  const { tenant_id } = user;
  try {
    const data = await request.json();
    if (!data.id) {
      return NextResponse.json({ success: false, error: 'ID requis.' }, { status: 400, headers: CORS });
    }

    const row = await queryOne(`
      UPDATE actualites
      SET titre     = COALESCE($2, titre),
          contenu   = COALESCE($3, contenu),
          categorie = COALESCE($4, categorie),
          espace_id = $5,
          date      = COALESCE($6, date),
          epingle   = COALESCE($7, epingle),
          auteur    = COALESCE($8, auteur)
      WHERE id = $1 AND tenant_id = $9
      RETURNING id, titre, contenu, date::text AS date, categorie, auteur, epingle, espace_id AS "espaceId"
    `, [
      data.id,
      data.titre ?? null,
      data.contenu ?? null,
      data.categorie ?? null,
      data.espaceId ?? null,
      data.date ?? null,
      data.epingle ?? null,
      data.auteur ?? null,
      tenant_id,
    ]);

    if (!row) {
      return NextResponse.json({ success: false, error: 'Actualité introuvable.' }, { status: 404, headers: CORS });
    }

    return NextResponse.json({ success: true, actualite: row }, { headers: CORS });
  } catch (err) {
    console.error('[api/actualites]', err);
    return NextResponse.json({ success: false, error: 'Erreur serveur' }, { status: 500, headers: CORS });
  }
}

export async function DELETE(request: NextRequest) {
  const user = await requireAuth(request);
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401, headers: CORS });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Accès refusé — rôle admin requis' }, { status: 403, headers: CORS });
  }
  const { tenant_id } = user;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, error: 'ID requis.' }, { status: 400, headers: CORS });
    }

    const result = await queryOne('DELETE FROM actualites WHERE id = $1 AND tenant_id = $2 RETURNING id', [id, tenant_id]);
    if (!result) {
      return NextResponse.json({ success: false, error: 'Actualité introuvable.' }, { status: 404, headers: CORS });
    }

    return NextResponse.json({ success: true }, { headers: CORS });
  } catch (err) {
    console.error('[api/actualites]', err);
    return NextResponse.json({ success: false, error: 'Erreur serveur' }, { status: 500, headers: CORS });
  }
}
