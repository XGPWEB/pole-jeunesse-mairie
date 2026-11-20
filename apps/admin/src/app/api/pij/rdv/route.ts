import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAuth } from '@/lib/auth';
import type { PoolClient } from 'pg';
import pool, { query, queryOne } from '@/lib/db';
import { ERREUR_SAISIE_PIJ, peutSaisirPij } from '@/lib/pij';
import { ERREUR_FIN_JOURNEE, ERREUR_RDV_HUB, ERREUR_RDV_HUB_ANNULE, STATUTS_POINTAGE, finitApresJournee, erreurChevauchement, erreurPointageAvant, rdvCommence, validerRdv, type RdvPij, type RdvPijSaisie } from '@/lib/pij-agenda';
import { SELECT_RDV, rdvEnChevauchement, verrouillerAgendaPij } from '@/lib/pij-db';

/**
 * Agenda des rendez-vous du PIJ.
 *
 * Lecture : toute l'équipe. Écriture : admins et informateurs PIJ uniquement.
 *
 * Un rendez-vous pris dans LE HUB (`hub_id` renseigné, voir /api/pij/hub/rdv)
 * appartient à LE HUB : ici, seuls son pointage (prévu, honoré, absent) et ses
 * notes se modifient ; il ne s'annule ni ne se supprime.
 *
 * Une seule informatrice reçoit : deux rendez-vous non annulés ne se
 * chevauchent jamais (refus 409, voir ecrireSansChevauchement).
 */

const parametres = (v: RdvPijSaisie) => [
  v.date, v.heure, v.dureeMinutes, v.nom, v.prenom, v.telephone, v.objet, v.lieu, v.notes,
  v.statut, v.accueilId,
];

/** La fiche d'accueil liée doit être celle de la commune. */
async function accueilInconnu(accueilId: string | null, tenantId: string): Promise<boolean> {
  if (!accueilId) return false;
  return !(await queryOne('SELECT 1 FROM pij_accueils WHERE id = $1 AND tenant_id = $2', [accueilId, tenantId]));
}
const ERREUR_ACCUEIL = 'Fiche d’accueil introuvable : choisissez un jeune du registre ou laissez ce champ vide.';

/**
 * Écriture d'un rendez-vous, refusée s'il chevauche un autre rendez-vous non
 * annulé (une seule personne reçoit). Contrôle et écriture dans la même
 * transaction, sous le verrou de l'agenda de la commune. Un rendez-vous
 * annulé n'occupe aucun créneau : il n'est pas contrôlé.
 * Rend le message de refus, ou null si `ecrire` a été appliquée.
 */
async function ecrireSansChevauchement(
  tenantId: string, v: RdvPijSaisie, idExclu: string | null, ecrire: (client: PoolClient) => Promise<void>,
): Promise<string | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await verrouillerAgendaPij(client, tenantId);
    const autre = v.statut === 'annule' ? null : await rdvEnChevauchement(client, tenantId, v, idExclu);
    if (autre) {
      await client.query('ROLLBACK');
      return erreurChevauchement(autre);
    }
    await ecrire(client);
    await client.query('COMMIT');
    return null;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function GET(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  try {
    const rdvs = await query<RdvPij>(
      `${SELECT_RDV} WHERE r.tenant_id = $1 ORDER BY r.date, r.heure`,
      [session.tenant_id],
    );
    return NextResponse.json({ rdvs, peutSaisir: peutSaisirPij(session) });
  } catch (err) {
    console.error('[api/pij/rdv GET]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (!peutSaisirPij(session)) return NextResponse.json({ error: ERREUR_SAISIE_PIJ }, { status: 403 });
  try {
    const validation = validerRdv(await req.json());
    if (!validation.ok) return NextResponse.json({ error: validation.erreur }, { status: 400 });
    if (finitApresJournee(validation.valeurs)) return NextResponse.json({ error: ERREUR_FIN_JOURNEE }, { status: 400 });
    if (await accueilInconnu(validation.valeurs.accueilId, session.tenant_id)) {
      return NextResponse.json({ error: ERREUR_ACCUEIL }, { status: 400 });
    }

    const id = `pij-rdv-${randomUUID()}`;
    const refus = await ecrireSansChevauchement(session.tenant_id, validation.valeurs, null, client => client.query(`
      INSERT INTO pij_rdv (
        id, tenant_id, created_by,
        date, heure, duree_minutes, nom, prenom, telephone, objet, lieu, notes, statut, accueil_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `, [id, session.tenant_id, session.id, ...parametres(validation.valeurs)]).then(() => {}));
    if (refus) return NextResponse.json({ error: refus }, { status: 409 });

    const rdv = await queryOne<RdvPij>(`${SELECT_RDV} WHERE r.id = $1 AND r.tenant_id = $2`, [id, session.tenant_id]);
    return NextResponse.json({ success: true, rdv });
  } catch (err) {
    console.error('[api/pij/rdv POST]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (!peutSaisirPij(session)) return NextResponse.json({ error: ERREUR_SAISIE_PIJ }, { status: 403 });
  try {
    const corps = await req.json();
    const id = corps?.id;
    if (typeof id !== 'string' || id === '') return NextResponse.json({ error: 'id requis' }, { status: 400 });
    const validation = validerRdv(corps);
    if (!validation.ok) return NextResponse.json({ error: validation.erreur }, { status: 400 });
    const existant = await queryOne<{ hubId: string | null; statut: string; date: string; heure: string }>(
      'SELECT hub_id AS "hubId", statut, date::text AS date, heure FROM pij_rdv WHERE id = $1 AND tenant_id = $2', [id, session.tenant_id],
    );
    if (!existant) return NextResponse.json({ error: 'Rendez-vous introuvable' }, { status: 404 });
    if (existant.hubId) {
      if (validation.valeurs.statut === 'annule') return NextResponse.json({ error: ERREUR_RDV_HUB }, { status: 409 });
      // Annulé dans LE HUB : plus de pointage possible (une fiche restée
      // ouverte pouvait le remettre « honoré », 2026-10-25). La condition est
      // aussi dans l'UPDATE, au cas où LE HUB l'annulerait entre-temps.
      if (existant.statut === 'annule') return NextResponse.json({ error: ERREUR_RDV_HUB_ANNULE }, { status: 409 });
      // Date et heure de LE HUB (en base), pas celles envoyées par la page.
      if (STATUTS_POINTAGE.has(validation.valeurs.statut) && !rdvCommence(existant)) {
        return NextResponse.json({ error: erreurPointageAvant(existant) }, { status: 400 });
      }
      const pointe = await queryOne(
        `UPDATE pij_rdv SET statut = $3, notes = $4, updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND statut <> 'annule' RETURNING id`,
        [id, session.tenant_id, validation.valeurs.statut, validation.valeurs.notes],
      );
      if (!pointe) return NextResponse.json({ error: ERREUR_RDV_HUB_ANNULE }, { status: 409 });
      const rdv = await queryOne<RdvPij>(`${SELECT_RDV} WHERE r.id = $1 AND r.tenant_id = $2`, [id, session.tenant_id]);
      return NextResponse.json({ success: true, rdv });
    }
    // Les RDV LE HUB (branche ci-dessus) gardent leurs heures : LE HUB les borne.
    if (finitApresJournee(validation.valeurs)) return NextResponse.json({ error: ERREUR_FIN_JOURNEE }, { status: 400 });
    if (await accueilInconnu(validation.valeurs.accueilId, session.tenant_id)) {
      return NextResponse.json({ error: ERREUR_ACCUEIL }, { status: 400 });
    }

    const refus = await ecrireSansChevauchement(session.tenant_id, validation.valeurs, id, client => client.query(`
      UPDATE pij_rdv SET
        date = $3, heure = $4, duree_minutes = $5, nom = $6, prenom = $7, telephone = $8,
        objet = $9, lieu = $10, notes = $11, statut = $12, accueil_id = $13, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
    `, [id, session.tenant_id, ...parametres(validation.valeurs)]).then(() => {}));
    if (refus) return NextResponse.json({ error: refus }, { status: 409 });

    const rdv = await queryOne<RdvPij>(`${SELECT_RDV} WHERE r.id = $1 AND r.tenant_id = $2`, [id, session.tenant_id]);
    return NextResponse.json({ success: true, rdv });
  } catch (err) {
    console.error('[api/pij/rdv PUT]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (!peutSaisirPij(session)) return NextResponse.json({ error: ERREUR_SAISIE_PIJ }, { status: 403 });
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });
    const hub = await queryOne('SELECT 1 FROM pij_rdv WHERE id = $1 AND tenant_id = $2 AND hub_id IS NOT NULL', [id, session.tenant_id]);
    if (hub) return NextResponse.json({ error: ERREUR_RDV_HUB }, { status: 409 });
    const supprime = await queryOne(
      'DELETE FROM pij_rdv WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [id, session.tenant_id],
    );
    if (!supprime) return NextResponse.json({ error: 'Rendez-vous introuvable' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/pij/rdv DELETE]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
