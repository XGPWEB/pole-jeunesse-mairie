import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import type { Client } from 'pg';

import pool from '@/lib/db';
import { PATCH, PUT, DELETE } from '@/app/api/recuperation/route';
import { PUT as PUT_CONGE, DELETE as DELETE_CONGE } from '@/app/api/conges/route';
import { verrouillerSoldeRecup } from '@/lib/recuperation';
import { resetDb, seedAnimateur, cookieFor, jsonRequest } from './helpers';
import {
  seedRecup, seedConge, soldeEnBase, photographier,
  connexionConcurrente, observer, attendreBlocage, libererActeur,
} from './integrite-helpers';

/**
 * Constats 9, 19, 20 et 22 de l'audit du 2026-10-06 — solde de récupération
 * et cohérence avec le planning des congés, sur un VRAI PostgreSQL.
 *
 * Un mock de `pg` ne peut rien dire de ces défauts : ils tiennent à ce que
 * deux transactions voient ou non l'une de l'autre, et à ce que la base
 * accepte ou refuse.
 */
const URL_RECUP = 'http://localhost/api/recuperation';
const URL_CONGES = 'http://localhost/api/conges';

let admin: string;      // cookie de l'admin
let animateurId: string;
let observateur: Client;

const decider = (id: string, decision: 'approve' | 'reject') =>
  PATCH(jsonRequest(URL_RECUP, { method: 'PATCH', cookie: admin, body: { id, decision } }));
const corriger = (body: Record<string, unknown>) =>
  PUT(jsonRequest(URL_RECUP, { method: 'PUT', cookie: admin, body }));
const supprimer = (id: string) =>
  DELETE(jsonRequest(`${URL_RECUP}?id=${id}`, { method: 'DELETE', cookie: admin }));

async function statut(id: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ statut: string }>('SELECT statut FROM demandes_recup WHERE id = $1', [id]);
  return rows[0]?.statut;
}

beforeEach(async () => {
  await resetDb();
  admin = await cookieFor(await seedAnimateur({ role: 'admin' }));
  animateurId = (await seedAnimateur({ role: 'animateur' })).id;
});

afterAll(async () => {
  await observateur?.end();
  await pool.end();
});

describe('constat 9 — deux validations simultanées sur un même solde', () => {
  it('deux poses de 6 h sur un solde de 8 h : une seule est approuvée, le solde reste ≥ 0', async () => {
    // Répété : sans verrou commun, l'entrelacement fautif est fréquent mais
    // pas systématique. Le test déterministe est juste en dessous.
    for (let tour = 0; tour < 8; tour++) {
      await resetDb();
      admin = await cookieFor(await seedAnimateur({ role: 'admin' }));
      animateurId = (await seedAnimateur({ role: 'animateur' })).id;
      await seedRecup(animateurId, { sens: 'credit', heures: 8 });
      const d1 = await seedRecup(animateurId, { sens: 'debit', heures: 6, statut: 'pending', date: '2026-11-02' });
      const d2 = await seedRecup(animateurId, { sens: 'debit', heures: 6, statut: 'pending', date: '2026-11-03' });

      const reponses = await Promise.all([decider(d1, 'approve'), decider(d2, 'approve')]);

      expect(reponses.map(r => r.status).sort()).toEqual([200, 409]);
      expect([await statut(d1), await statut(d2)].sort()).toEqual(['approved', 'pending']);
      expect(await soldeEnBase(animateurId)).toBe(2);
      // Une seule absence au planning : celle de la pose réellement validée.
      const conges = await pool.query('SELECT id FROM conges WHERE animateur_id = $1', [animateurId]);
      expect(conges.rowCount).toBe(1);
    }
  });

  it('le solde est lu APRÈS le verrou commun : une validation attend la transaction concurrente, puis voit son débit', async () => {
    await seedRecup(animateurId, { sens: 'credit', heures: 8 });
    const d1 = await seedRecup(animateurId, { sens: 'debit', heures: 6, statut: 'pending' });
    const d2 = await seedRecup(animateurId, { sens: 'debit', heures: 6, statut: 'pending' });
    observateur ??= await connexionConcurrente();

    // Acteur A : prend le verrou (tenant, animateur) et valide d1, sans COMMIT.
    const acteur = await pool.connect();
    try {
      await acteur.query('BEGIN');
      await verrouillerSoldeRecup(acteur, 'nogent', animateurId);
      await acteur.query(`UPDATE demandes_recup SET statut = 'approved' WHERE id = $1`, [d1]);

      // Acteur B : le vrai handler valide d2. Il doit ATTENDRE — s'il lisait
      // le solde maintenant il verrait 8 h (d1 non validée) et approuverait.
      const b = observer(decider(d2, 'approve'));
      expect(await attendreBlocage(observateur)).toBe(true);
      expect(b.termine()).toBe(false);

      await acteur.query('COMMIT');
      const reponse = await b.promesse;

      expect(reponse.status).toBe(409);
      expect((await reponse.json()).error).toContain('Solde insuffisant');
    } finally {
      await libererActeur(acteur);
    }
    expect(await statut(d2)).toBe('pending');
    expect(await soldeEnBase(animateurId)).toBe(2);
  });

  it('deux animateurs différents ne se bloquent pas (le verrou est par animateur)', async () => {
    const autre = (await seedAnimateur({ role: 'animateur' })).id;
    await seedRecup(autre, { sens: 'credit', heures: 8 });
    const dAutre = await seedRecup(autre, { sens: 'debit', heures: 6, statut: 'pending' });

    const acteur = await pool.connect();
    try {
      await acteur.query('BEGIN');
      await verrouillerSoldeRecup(acteur, 'nogent', animateurId);
      const reponse = await decider(dAutre, 'approve');
      expect(reponse.status).toBe(200);
      await acteur.query('ROLLBACK');
    } finally {
      await libererActeur(acteur);
    }
  });

  it('valider un crédit reste possible même avec un solde négatif hérité (régularisation)', async () => {
    await seedRecup(animateurId, { sens: 'debit', heures: 4 });           // solde hérité : −4 h
    const credit = await seedRecup(animateurId, { sens: 'credit', heures: 3, statut: 'pending' });

    expect((await decider(credit, 'approve')).status).toBe(200);
    expect(await soldeEnBase(animateurId)).toBe(-1);
  });
});

describe('constat 20 — corrections et suppressions sous l’invariant de solde', () => {
  it('augmenter un débit approuvé au-delà du solde est refusé (409) et ne modifie rien', async () => {
    await seedRecup(animateurId, { sens: 'credit', heures: 8 });
    const debit = await seedRecup(animateurId, { sens: 'debit', heures: 6 });
    const avant = await photographier('demandes_recup', 'conges');

    const reponse = await corriger({ id: debit, heures: 12, motif: 'Correction' });

    expect(reponse.status).toBe(409);
    expect((await reponse.json()).error).toContain('négatif');
    expect(await photographier('demandes_recup', 'conges')).toEqual(avant);
    expect(await soldeEnBase(animateurId)).toBe(2);
  });

  it('augmenter un débit approuvé dans la limite du solde est accepté', async () => {
    await seedRecup(animateurId, { sens: 'credit', heures: 8 });
    const debit = await seedRecup(animateurId, { sens: 'debit', heures: 6 });

    expect((await corriger({ id: debit, heures: 8 })).status).toBe(200);
    expect(await soldeEnBase(animateurId)).toBe(0);
  });

  it('réduire un crédit déjà consommé est refusé (409)', async () => {
    const credit = await seedRecup(animateurId, { sens: 'credit', heures: 8 });
    await seedRecup(animateurId, { sens: 'debit', heures: 6 });
    const avant = await photographier('demandes_recup');

    expect((await corriger({ id: credit, heures: 4 })).status).toBe(409);
    expect(await photographier('demandes_recup')).toEqual(avant);
  });

  it('supprimer un crédit déjà consommé est refusé (409), le crédit reste en base', async () => {
    const credit = await seedRecup(animateurId, { sens: 'credit', heures: 8 });
    await seedRecup(animateurId, { sens: 'debit', heures: 6 });

    const reponse = await supprimer(credit);

    expect(reponse.status).toBe(409);
    expect(await statut(credit)).toBe('approved');
    expect(await soldeEnBase(animateurId)).toBe(2);
  });

  it('supprimer un crédit non consommé, ou une demande en attente, reste possible', async () => {
    const c1 = await seedRecup(animateurId, { sens: 'credit', heures: 8 });
    const c2 = await seedRecup(animateurId, { sens: 'credit', heures: 3 });
    await seedRecup(animateurId, { sens: 'debit', heures: 6 });
    const enAttente = await seedRecup(animateurId, { sens: 'debit', heures: 50, statut: 'pending' });

    expect((await supprimer(c2)).status).toBe(200);     // 11 − 3 − 6 = 2 ≥ 0
    expect((await supprimer(enAttente)).status).toBe(200);
    expect((await supprimer(c1)).status).toBe(409);     // 8 − 8 − 6 < 0
    expect(await soldeEnBase(animateurId)).toBe(2);
  });

  it('corriger le volume d’une demande en attente n’est pas soumis au solde (elle ne compte pas encore)', async () => {
    const enAttente = await seedRecup(animateurId, { sens: 'debit', heures: 2, statut: 'pending' });
    expect((await corriger({ id: enAttente, heures: 40 })).status).toBe(200);
    // … mais sa validation, elle, le sera.
    expect((await decider(enAttente, 'approve')).status).toBe(409);
  });

  it('deux augmentations simultanées de deux débits approuvés ne percent pas le solde', async () => {
    await seedRecup(animateurId, { sens: 'credit', heures: 10 });
    const a = await seedRecup(animateurId, { sens: 'debit', heures: 2 });
    const b = await seedRecup(animateurId, { sens: 'debit', heures: 2 });

    // Chacune, seule, tiendrait (2+7 ≤ 10) ; ensemble non (7+7 > 10).
    const reponses = await Promise.all([corriger({ id: a, heures: 7 }), corriger({ id: b, heures: 7 })]);

    expect(reponses.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await soldeEnBase(animateurId)).toBe(1);
  });
});

describe('constat 19 — un congé issu d’une récupération ne se modifie pas directement', () => {
  /** Passe par la vraie validation : c'est elle qui crée le congé et le lien. */
  async function poseValidee(): Promise<{ demandeId: string; congeId: string }> {
    await seedRecup(animateurId, { sens: 'credit', heures: 8 });
    const demandeId = await seedRecup(animateurId, { sens: 'debit', heures: 6, statut: 'pending', date: '2026-11-05' });
    expect((await decider(demandeId, 'approve')).status).toBe(200);
    const { rows } = await pool.query<{ conge_id: string }>('SELECT conge_id FROM demandes_recup WHERE id = $1', [demandeId]);
    return { demandeId, congeId: rows[0].conge_id };
  }

  it('DELETE /api/conges sur un congé de récupération : 409, débit et planning intacts', async () => {
    const { congeId } = await poseValidee();
    const avant = await photographier('conges', 'demandes_recup');

    const reponse = await DELETE_CONGE(jsonRequest(`${URL_CONGES}?id=${congeId}`, { method: 'DELETE', cookie: admin }));

    expect(reponse.status).toBe(409);
    expect((await reponse.json()).error).toContain('Récupération');
    expect(await photographier('conges', 'demandes_recup')).toEqual(avant);
  });

  it('PUT /api/conges sur un congé de récupération : 409, dates inchangées', async () => {
    const { congeId } = await poseValidee();
    const avant = await photographier('conges', 'demandes_recup');

    const reponse = await PUT_CONGE(jsonRequest(URL_CONGES, {
      method: 'PUT', cookie: admin,
      body: { id: congeId, dateDebut: '2026-12-01', dateFin: '2026-12-01', motif: 'Déplacé' },
    }));

    expect(reponse.status).toBe(409);
    expect(await photographier('conges', 'demandes_recup')).toEqual(avant);
  });

  it('la voie prévue fonctionne : corriger la DEMANDE déplace le congé, la supprimer le retire', async () => {
    const { demandeId, congeId } = await poseValidee();

    expect((await corriger({ id: demandeId, date: '2026-11-19', heures: 4, motif: 'Reportée' })).status).toBe(200);
    const conge = await pool.query<{ debut: string; fin: string; motif: string }>(
      'SELECT date_debut::text AS debut, date_fin::text AS fin, motif FROM conges WHERE id = $1', [congeId]);
    expect(conge.rows[0]).toEqual({ debut: '2026-11-19', fin: '2026-11-19', motif: 'Récupération 4h — Reportée' });

    expect((await supprimer(demandeId)).status).toBe(200);
    expect((await pool.query('SELECT 1 FROM conges WHERE id = $1', [congeId])).rowCount).toBe(0);
    expect(await soldeEnBase(animateurId)).toBe(8);
  });

  it('un congé « recup » orphelin (sans demande liée) reste nettoyable par un admin', async () => {
    const orphelin = await seedConge(animateurId, { source: 'recup', type: 'recuperation' });
    const reponse = await DELETE_CONGE(jsonRequest(`${URL_CONGES}?id=${orphelin}`, { method: 'DELETE', cookie: admin }));
    expect(reponse.status).toBe(200);
  });
});

describe('constat 22 — dates de congé validées sur le couple final', () => {
  const modifier = (body: Record<string, unknown>) =>
    PUT_CONGE(jsonRequest(URL_CONGES, { method: 'PUT', cookie: admin, body }));

  it('une fin SEULE antérieure au début existant est refusée, le congé est inchangé', async () => {
    const id = await seedConge(animateurId, { dateDebut: '2026-11-10', dateFin: '2026-11-14' });
    const avant = await photographier('conges');

    const reponse = await modifier({ id, dateFin: '2026-11-05', motif: 'Motif initial' });

    expect(reponse.status).toBe(400);
    expect((await reponse.json()).error).toContain('précède');
    expect(await photographier('conges')).toEqual(avant);
  });

  it('un début SEUL postérieur à la fin existante est refusé', async () => {
    const id = await seedConge(animateurId, { dateDebut: '2026-11-10', dateFin: '2026-11-14' });
    expect((await modifier({ id, dateDebut: '2026-11-20' })).status).toBe(400);
  });

  it('une modification partielle cohérente est acceptée et conserve l’autre borne', async () => {
    const id = await seedConge(animateurId, { dateDebut: '2026-11-10', dateFin: '2026-11-14' });

    expect((await modifier({ id, dateFin: '2026-11-12', dateDebut: '' })).status).toBe(200);

    const { rows } = await pool.query<{ debut: string; fin: string }>(
      'SELECT date_debut::text AS debut, date_fin::text AS fin FROM conges WHERE id = $1', [id]);
    expect(rows[0]).toEqual({ debut: '2026-11-10', fin: '2026-11-12' });
  });

  it('une date mal formée est refusée en 400 plutôt que de provoquer un 500', async () => {
    const id = await seedConge(animateurId);
    expect((await modifier({ id, dateFin: '14/11/2026' })).status).toBe(400);
  });
});
