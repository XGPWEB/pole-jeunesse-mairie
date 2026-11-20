import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAuth } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import pool from '@/lib/db';
import {
  STATUTS_INACTIFS_SQL, verrouillerActivite, synchroniserPlaces, promouvoirPremierEnAttente,
  estViolationUnicite,
} from '@/lib/inscriptions';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN ?? 'https://jeunessenogent.cloud',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401, headers: CORS_HEADERS });
  }
  const { tenant_id } = user;
  try {
    const { searchParams } = new URL(request.url);
    const activiteId   = searchParams.get('activiteId');
    const statut       = searchParams.get('statut');
    const listeAttente = searchParams.get('listeAttente');

    if (listeAttente === '1') {
      const enAttente = await query(`
        SELECT i.activite_id AS "activiteId", a.titre AS "activiteTitre", COUNT(*) AS count
        FROM inscriptions i
        LEFT JOIN activites a ON a.id = i.activite_id
        WHERE i.statut IN ('liste-attente', 'en-attente')
          AND i.tenant_id = $1
        GROUP BY i.activite_id, a.titre
        HAVING COUNT(*) > 0
      `, [tenant_id]);
      const total = enAttente.reduce((s: number, r: any) => s + Number(r.count), 0);
      const parActivite = enAttente.map((r: any) => ({
        activiteId: r.activiteId,
        activiteTitre: r.activiteTitre,
        count: Number(r.count),
      }));
      return NextResponse.json({ total, parActivite }, { headers: CORS_HEADERS });
    }

    const params: any[] = [tenant_id];
    let where = 'WHERE tenant_id = $1';
    if (activiteId) { params.push(activiteId); where += ` AND activite_id = $${params.length}`; }
    if (statut)     { params.push(statut);     where += ` AND statut = $${params.length}`; }

    const rows = await query(`
      SELECT id,
             jeune_id AS "jeuneId",
             jeune_nom AS "jeuneNom",
             jeune_prenom AS "jeunePrenom",
             activite_id AS "activiteId",
             activite_titre AS "activiteTitre",
             espace_id AS "espaceId",
             statut,
             date_inscription AS "dateInscription",
             manuel
      FROM inscriptions
      ${where}
      ORDER BY date_inscription DESC
    `, params);

    return NextResponse.json(rows, { headers: CORS_HEADERS });
  } catch (err) {
    console.error('[api/inscriptions]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500, headers: CORS_HEADERS });
  }
}

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401, headers: CORS_HEADERS });
  }
  const { tenant_id } = user;
  try {
    const body = await req.json();
    const { jeuneId, activiteId } = body;
    if (!jeuneId || !activiteId) {
      return NextResponse.json({ error: 'jeuneId et activiteId requis' }, { status: 400 });
    }

    const jeune = await queryOne<{ nom: string; prenom: string; espace_id: string | null }>(
      'SELECT id, nom, prenom, espace_id FROM jeunes WHERE id = $1 AND tenant_id = $2', [jeuneId, tenant_id]);
    if (!jeune) return NextResponse.json({ error: 'Jeune introuvable' }, { status: 404 });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Verrou activité D'ABORD. Le contrôle de doublon était fait avant :
      //    deux requêtes pour le même jeune constataient toutes deux l'absence
      //    d'inscription, puis inséraient l'une après l'autre.
      const activite = await verrouillerActivite(client, activiteId, tenant_id);
      if (!activite) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Activité introuvable' }, { status: 404 });
      }

      // 2. Doublon, lu sous verrou.
      const dupRes = await client.query(`
        SELECT id, statut FROM inscriptions
        WHERE jeune_id = $1 AND activite_id = $2 AND tenant_id = $3
          AND statut NOT IN (${STATUTS_INACTIFS_SQL})
      `, [jeuneId, activiteId, tenant_id]);

      if (dupRes.rows[0]) {
        await client.query('ROLLBACK');
        return NextResponse.json({ success: true, inscription: dupRes.rows[0], alreadyExists: true });
      }

      // 3. Capacité, comptée sous verrou.
      const countRes = await client.query(
        `SELECT COUNT(*) FROM inscriptions WHERE activite_id = $1 AND tenant_id = $2 AND statut = 'confirmee'`,
        [activiteId, tenant_id],
      );
      const confirmes = Number(countRes.rows[0].count);
      const placesTotal = activite.placesTotal ?? 999;
      const statutFinal = confirmes < placesTotal ? 'confirmee' : 'en-attente';

      const id = `ins-${randomUUID()}`;
      const res = await client.query(`
        INSERT INTO inscriptions
          (id, jeune_id, jeune_nom, jeune_prenom, activite_id, activite_titre, espace_id, statut, date_inscription, manuel, tenant_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), TRUE, $9)
        RETURNING id, jeune_id AS "jeuneId", jeune_nom AS "jeuneNom",
                  jeune_prenom AS "jeunePrenom", activite_id AS "activiteId",
                  activite_titre AS "activiteTitre", espace_id AS "espaceId",
                  statut, date_inscription AS "dateInscription", manuel
      `, [
        id,
        jeuneId,
        body.jeuneNom || jeune.nom,
        body.jeunePrenom || jeune.prenom,
        activiteId,
        body.activiteTitre || activite.titre,
        body.espaceId || jeune.espace_id || activite.espaceId,
        statutFinal,
        tenant_id,
      ]);

      await synchroniserPlaces(client, activiteId, tenant_id);

      await client.query('COMMIT');
      return NextResponse.json({ success: true, inscription: res.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      // Filet de sécurité : l'index unique des inscriptions actives a refusé
      // l'insertion (chemin d'écriture qui n'aurait pas pris le verrou).
      if (estViolationUnicite(err)) {
        return NextResponse.json(
          { success: false, error: 'Ce jeune est déjà inscrit à cette activité.' },
          { status: 409 },
        );
      }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[api/inscriptions]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const userDel = await requireAuth(req);
  if (!userDel) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401, headers: CORS_HEADERS });
  }
  const tenantIdDel = userDel.tenant_id;
  try {
    const { searchParams } = new URL(req.url);
    const id         = searchParams.get('id');
    const jeuneId    = searchParams.get('jeuneId');
    const activiteId = searchParams.get('activiteId');
    if (!id && !(jeuneId && activiteId)) {
      return NextResponse.json({ error: 'id ou jeuneId+activiteId requis' }, { status: 400 });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Activité concernée : fournie, ou lue (sans verrou) sur l'inscription.
      // Ordre de verrouillage commun à tous les chemins : activité PUIS
      // inscriptions — jamais l'inverse (interblocage sinon).
      let targetActiviteId: string | null = activiteId;
      if (id) {
        const pre = await client.query<{ activite_id: string | null }>(
          'SELECT activite_id FROM inscriptions WHERE id = $1 AND tenant_id = $2',
          [id, tenantIdDel],
        );
        targetActiviteId = pre.rows[0]?.activite_id ?? null;
      }
      const activite = targetActiviteId
        ? await verrouillerActivite(client, targetActiviteId, tenantIdDel)
        : null;

      const r = id
        ? await client.query<{ statut: string }>(
            `DELETE FROM inscriptions WHERE id = $1 AND tenant_id = $2 RETURNING statut`,
            [id, tenantIdDel],
          )
        : await client.query<{ statut: string }>(
            `DELETE FROM inscriptions WHERE jeune_id = $1 AND activite_id = $2 AND tenant_id = $3 RETURNING statut`,
            [jeuneId, activiteId, tenantIdDel],
          );

      // Promotion décidée sur les lignes RÉELLEMENT supprimées (RETURNING) :
      // un second désistement simultané du même jeune ne supprime rien et ne
      // promeut donc personne. La capacité est recomptée sous verrou.
      if (activite && targetActiviteId && r.rows.some(d => d.statut === 'confirmee')) {
        await promouvoirPremierEnAttente(client, targetActiviteId, tenantIdDel);
        await synchroniserPlaces(client, targetActiviteId, tenantIdDel);
      }

      await client.query('COMMIT');
      return NextResponse.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[api/inscriptions]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
