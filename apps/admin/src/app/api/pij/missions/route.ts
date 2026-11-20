import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { requireAuth } from '@/lib/auth';
import pool, { query } from '@/lib/db';
import { ERREUR_SAISIE_PIJ, peutSaisirPij, validerMission, type MissionPij } from '@/lib/pij';

/**
 * Journal des missions d'un dossier permis : chaque mission réalisée est une
 * ligne (date, intitulé, heures, auteur). Le total des heures du dossier
 * (`pij_dossiers.heures_realisees`) est recalculé comme la somme du journal,
 * dans la même transaction que l'ajout ou le retrait.
 *
 * Lecture : toute l'équipe. Écriture : admins et informateurs PIJ uniquement.
 */

const SELECT = `
  SELECT m.id,
         m.dossier_id       AS "dossierId",
         m.date::text       AS date,
         m.libelle,
         m.heures::float8   AS heures,
         NULLIF(TRIM(COALESCE(a.prenom, '') || ' ' || COALESCE(a.nom, '')), '') AS "creePar",
         m.created_at       AS "creeLe"
  FROM pij_missions m
  LEFT JOIN animateurs a ON a.id = m.created_by AND a.tenant_id = m.tenant_id
`;
const ORDRE = 'ORDER BY m.date DESC, m.created_at DESC';

/** Recalcule le total du dossier depuis son journal ; rend journal et total. */
async function etatDuDossier(client: PoolClient, dossierId: string, tenantId: string) {
  const total = await client.query<{ heuresRealisees: number }>(`
    UPDATE pij_dossiers d
    SET heures_realisees = (SELECT COALESCE(SUM(m.heures), 0) FROM pij_missions m WHERE m.dossier_id = d.id),
        updated_at = NOW()
    WHERE d.id = $1 AND d.tenant_id = $2
    RETURNING d.heures_realisees::float8 AS "heuresRealisees"
  `, [dossierId, tenantId]);
  const missions = await client.query<MissionPij>(
    `${SELECT} WHERE m.dossier_id = $1 AND m.tenant_id = $2 ${ORDRE}`,
    [dossierId, tenantId],
  );
  return { missions: missions.rows, heuresRealisees: total.rows[0]?.heuresRealisees ?? 0 };
}

export async function GET(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  try {
    const dossierId = new URL(req.url).searchParams.get('dossierId');
    if (!dossierId) return NextResponse.json({ error: 'dossierId requis' }, { status: 400 });
    const missions = await query<MissionPij>(
      `${SELECT} WHERE m.dossier_id = $1 AND m.tenant_id = $2 ${ORDRE}`,
      [dossierId, session.tenant_id],
    );
    return NextResponse.json({ missions });
  } catch (err) {
    console.error('[api/pij/missions GET]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (!peutSaisirPij(session)) return NextResponse.json({ error: ERREUR_SAISIE_PIJ }, { status: 403 });
  const { tenant_id } = session;
  try {
    const validation = validerMission(await req.json());
    if (!validation.ok) return NextResponse.json({ error: validation.erreur }, { status: 400 });
    const { dossierId, date, libelle, heures } = validation.valeurs;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Verrou sur le dossier : deux ajouts simultanés ne faussent pas le total.
      const dossier = await client.query<{ type: string }>(
        'SELECT type FROM pij_dossiers WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
        [dossierId, tenant_id],
      );
      if (dossier.rowCount === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 });
      }
      if (dossier.rows[0].type !== 'permis') {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Seul un dossier permis tient un journal de missions.' }, { status: 400 });
      }
      await client.query(
        `INSERT INTO pij_missions (id, tenant_id, dossier_id, date, libelle, heures, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [`pij-mis-${randomUUID()}`, tenant_id, dossierId, date, libelle, heures, session.id],
      );
      const etat = await etatDuDossier(client, dossierId, tenant_id);
      await client.query('COMMIT');
      return NextResponse.json({ success: true, ...etat });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[api/pij/missions POST]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

/** Retire une ligne saisie par erreur ; ses heures reviennent au reste à faire. */
export async function DELETE(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (!peutSaisirPij(session)) return NextResponse.json({ error: ERREUR_SAISIE_PIJ }, { status: 403 });
  const { tenant_id } = session;
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const mission = await client.query<{ dossierId: string }>(
        `SELECT m.dossier_id AS "dossierId"
         FROM pij_missions m JOIN pij_dossiers d ON d.id = m.dossier_id
         WHERE m.id = $1 AND m.tenant_id = $2
         FOR UPDATE OF d`,
        [id, tenant_id],
      );
      if (mission.rowCount === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 });
      }
      const { dossierId } = mission.rows[0];
      await client.query('DELETE FROM pij_missions WHERE id = $1 AND tenant_id = $2', [id, tenant_id]);
      const etat = await etatDuDossier(client, dossierId, tenant_id);
      await client.query('COMMIT');
      return NextResponse.json({ success: true, ...etat });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[api/pij/missions DELETE]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
