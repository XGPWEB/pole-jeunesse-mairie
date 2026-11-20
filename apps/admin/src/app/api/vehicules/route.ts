import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAuth } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import pool from '@/lib/db';
import { validerReservation } from '@/lib/reservations-vehicules';

function toMin(t: string): number {
  if (!t) return 23 * 60 + 59;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

function horairesChevauchent(dep1: string, ret1: string, dep2: string, ret2: string): boolean {
  const s1 = toMin(dep1), e1 = toMin(ret1 || '23:59');
  const s2 = toMin(dep2), e2 = toMin(ret2 || '23:59');
  return s1 < e2 && e1 > s2;
}

// Compare deux réservations (dates + heures) pour déterminer si elles sont en conflit.
// Si l'une des deux couvre plusieurs jours (date_debut !== date_fin), on ne peut pas se fier
// à une simple comparaison d'heures : tout chevauchement de dates est alors considéré comme
// un conflit. On ne compare les heures que lorsque les deux réservations sont mono-jour ET
// portent sur la même date.
function reservationsEnConflit(
  dateDebut1: string, dateFin1: string, heureDepart1: string, heureRetour1: string,
  dateDebut2: string, dateFin2: string, heureDepart2: string, heureRetour2: string,
): boolean {
  const multiJour1 = dateDebut1 !== dateFin1;
  const multiJour2 = dateDebut2 !== dateFin2;

  if (multiJour1 || multiJour2) {
    // Le chevauchement de dates a déjà été vérifié par la requête SQL
    // (date_debut <= fin AND date_fin >= dateDebut) : c'est suffisant pour un conflit.
    return true;
  }

  // Les deux réservations sont mono-jour : conflit seulement si même date et chevauchement d'heures.
  if (dateDebut1 !== dateDebut2) return false;
  return horairesChevauchent(heureDepart1, heureRetour1, heureDepart2, heureRetour2);
}

const SELECT = `
  SELECT id, vehicule,
         animateur_id AS "animateurId",
         animateur_nom AS "animateurNom",
         espace_id AS "espaceId",
         date_debut::text AS "dateDebut",
         date_fin::text AS "dateFin",
         heure_depart AS "heureDepart",
         heure_retour AS "heureRetour",
         motif, statut,
         created_at AS "createdAt"
  FROM reservations_vehicules
`;

export async function GET(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { tenant_id } = session;
  try {
    const rows = await query(`${SELECT} WHERE tenant_id = $1 AND statut != 'annulee' ORDER BY date_debut DESC, heure_depart`, [tenant_id]);
    return NextResponse.json({ reservations: rows });
  } catch (err) {
    console.error('[api/vehicules]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { tenant_id } = session;

  try {
    const body: unknown = await req.json().catch(() => null);
    // Dates, heures et leur ordre : validés AVANT la transaction (audit 2026-10-07, A3).
    const validation = validerReservation(body);
    if (!validation.ok) return NextResponse.json({ error: validation.erreur }, { status: 400 });
    const { dateDebut, dateFin: fin, heureDepart, heureRetour, motif } = validation.reservation;
    const VEHICULE = 'Renault Trafic';

    const id = `res-${randomUUID()}`;
    const animateurNom = `${session.prenom ?? ''} ${session.nom ?? ''}`.trim();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Verrou avisory par véhicule : sérialise toutes les créations de réservation pour ce
      // véhicule, y compris quand le créneau demandé est encore totalement libre (auquel cas
      // le SELECT ... FOR UPDATE ci-dessous ne verrouille aucune ligne existante).
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [VEHICULE]);

      const activesRes = await client.query(
        `${SELECT} WHERE tenant_id = $1 AND statut != 'annulee' AND date_debut <= $2 AND date_fin >= $3 FOR UPDATE`,
        [tenant_id, fin, dateDebut],
      );

      const conflit = activesRes.rows.find((r: any) => {
        return reservationsEnConflit(
          dateDebut, fin, heureDepart, heureRetour,
          (r as any).dateDebut, (r as any).dateFin, (r as any).heureDepart, (r as any).heureRetour,
        );
      });

      if (conflit) {
        await client.query('ROLLBACK');
        const debut = new Date((conflit as any).dateDebut).toLocaleDateString('fr-FR');
        const retour = (conflit as any).heureRetour ? ` jusqu'à ${(conflit as any).heureRetour}` : '';
        return NextResponse.json({
          error: `Créneau indisponible : le véhicule est déjà réservé le ${debut} de ${(conflit as any).heureDepart}${retour} (${(conflit as any).animateurNom} — ${(conflit as any).motif}).`,
          conflit,
        }, { status: 409 });
      }

      await client.query(`
        INSERT INTO reservations_vehicules
          (id, vehicule, animateur_id, animateur_nom, espace_id,
           date_debut, date_fin, heure_depart, heure_retour, motif, statut, tenant_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'confirmee',$11)
      `, [id, VEHICULE, session.id, animateurNom, session.espaceAssigne, dateDebut, fin, heureDepart, heureRetour, motif, tenant_id]);

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const reservations = await query(`${SELECT} WHERE tenant_id = $1 AND statut != 'annulee' ORDER BY date_debut DESC, heure_depart`, [tenant_id]);
    return NextResponse.json({ success: true, reservations });
  } catch (err) {
    console.error('[POST /api/vehicules]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { tenant_id } = session;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID requis' }, { status: 400 });

    const res = await queryOne('SELECT animateur_id FROM reservations_vehicules WHERE id = $1 AND tenant_id = $2', [id, tenant_id]);
    if (!res || ((res as any).animateur_id !== session.id && session.role !== 'admin')) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
    }

    await queryOne('DELETE FROM reservations_vehicules WHERE id = $1 AND tenant_id = $2', [id, tenant_id]);
    const reservations = await query(`${SELECT} WHERE tenant_id = $1 AND statut != 'annulee' ORDER BY date_debut DESC, heure_depart`, [tenant_id]);
    return NextResponse.json({ success: true, reservations });
  } catch (err) {
    console.error('[api/vehicules]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
