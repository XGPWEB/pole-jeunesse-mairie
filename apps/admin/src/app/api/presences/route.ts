import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
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

export async function GET(request: NextRequest) {
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401, headers: CORS });
  }
  const { tenant_id } = user;
  try {
    const { searchParams } = new URL(request.url);
    const jeuneId    = searchParams.get('jeuneId');
    const espaceId   = searchParams.get('espaceId');
    const date       = searchParams.get('date');
    const activiteId = searchParams.get('activiteId');

    const params: any[] = [tenant_id];
    let where = 'WHERE tenant_id = $1';
    if (jeuneId)    { params.push(jeuneId);    where += ` AND jeune_id = $${params.length}`; }
    if (espaceId)   { params.push(espaceId);   where += ` AND espace_id = $${params.length}`; }
    if (date)       { params.push(date);       where += ` AND date = $${params.length}`; }
    if (activiteId) { params.push(activiteId); where += ` AND activite_id = $${params.length}`; }

    const rows = await query(`
      SELECT id,
             jeune_id AS "jeuneId",
             espace_id AS "espaceId",
             date::text AS date,
             heure_arrivee AS "heureArrivee",
             heure_sortie AS "heureSortie",
             animateur, type,
             activite_id AS "activiteId",
             manuel, source, statut,
             prenom_manuel AS "prenomManuel",
             nom_manuel AS "nomManuel",
             created_at AS "createdAt"
      FROM pointages
      ${where}
      ORDER BY date DESC, heure_arrivee
    `, params);

    return NextResponse.json(rows, { headers: CORS });
  } catch (err) {
    console.error('[api/presences]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500, headers: CORS });
  }
}

/** Entrée refusée pour une raison imputable au client → 400, lot annulé. */
class EntreeInvalide extends Error {}

export async function POST(request: NextRequest) {
  const userPost = await requireAuth(request);
  if (!userPost) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401, headers: CORS });
  }
  const { tenant_id: postTenantId } = userPost;
  try {
    const body = await request.json();
    const entries: any[] = Array.isArray(body) ? body : body.entries ?? [body];

    if (entries.length === 0) {
      return NextResponse.json({ success: false, error: 'Aucune entrée.' }, { status: 400, headers: CORS });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (let i = 0; i < entries.length; i++) {
        const d = entries[i];

        // Références validées contre le tenant de la SESSION avant toute
        // écriture (même règle que /api/pointages) : sinon un identifiant connu
        // d'une autre commune créait un pointage croisé.
        const refs: Array<[string, unknown, string, boolean]> = [
          ['espaces', d.espaceId, 'espaceId', true],
          ['jeunes', d.jeuneId, 'jeuneId', false],
          ['activites', d.activiteId, 'activiteId', false],
        ];
        for (const [table, refId, champ, requis] of refs) {
          if (refId === undefined || refId === null || refId === '') {
            if (!requis) continue;
            throw new EntreeInvalide(`Entrée ${i + 1} : ${champ} requis.`);
          }
          if (typeof refId !== 'string') throw new EntreeInvalide(`Entrée ${i + 1} : ${champ} invalide.`);
          const r = await client.query(`SELECT 1 FROM ${table} WHERE id = $1 AND tenant_id = $2`, [refId, postTenantId]);
          if (r.rowCount === 0) throw new EntreeInvalide(`Entrée ${i + 1} : ${champ} introuvable.`);
        }
        if (typeof d.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
          throw new EntreeInvalide(`Entrée ${i + 1} : date invalide (AAAA-MM-JJ attendu).`);
        }
        const type = d.type ?? 'accueil-libre';
        if (type !== 'accueil-libre' && type !== 'activite') {
          throw new EntreeInvalide(`Entrée ${i + 1} : type invalide.`);
        }
        if (d.statut != null && !['present', 'absent', 'excuse'].includes(d.statut)) {
          throw new EntreeInvalide(`Entrée ${i + 1} : statut invalide.`);
        }

        const id = `pt-${randomUUID()}`;
        await client.query(`
          INSERT INTO pointages
            (id, jeune_id, espace_id, date, heure_arrivee, heure_sortie,
             animateur, type, activite_id, manuel, source, statut, prenom_manuel, nom_manuel, tenant_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        `, [
          id,
          d.jeuneId ?? null,
          d.espaceId,
          d.date,
          d.heureArrivee,
          d.heureSortie ?? null,
          d.animateur ?? 'animateur',
          type,
          d.activiteId ?? null,
          d.manuel ?? false,
          d.source === 'web' ? 'web' : 'mobile',
          d.statut ?? null,
          d.prenomManuel ?? null,
          d.nomManuel ?? null,
          postTenantId,
        ]);
      }

      await client.query('COMMIT');
      return NextResponse.json({ success: true, count: entries.length }, { headers: CORS });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof EntreeInvalide) {
        return NextResponse.json({ success: false, error: err.message }, { status: 400, headers: CORS });
      }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[api/presences]', err);
    return NextResponse.json({ success: false, error: 'Erreur serveur' }, { status: 500, headers: CORS });
  }
}
