import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import pool from '@/lib/db';
import * as rdv from '@/app/api/pij/rdv/route';
import * as hub from '@/app/api/pij/hub/rdv/route';
import { resetDb, seedAnimateur, cookieFor, jsonRequest } from './helpers';

/**
 * Une seule informatrice reçoit au PIJ : deux rendez-vous non annulés ne se
 * chevauchent jamais, y compris avec ceux recopiés de LE HUB. Vrais handlers,
 * vrai PostgreSQL.
 */
const URL_RDV = 'http://localhost/api/pij/rdv';
const SECRET = 'secret-de-test-hub-0123456789-abcdefghijkl';
const RDV = { date: '2099-06-15', heure: '14:00', heureFin: '14:30', nom: 'Durand', prenom: 'Léa' };

describe('Agenda PIJ : pas de chevauchement', () => {
  let c: string;

  beforeEach(async () => {
    await resetDb();
    c = await cookieFor(await seedAnimateur({ role: 'animateur', espaceAssigne: 'PIJ', tenantId: 'nogent' }));
  });
  afterAll(async () => {
    delete process.env.HUB_SYNC_SECRET;
    delete process.env.HUB_SYNC_TENANT_ID;
    await pool.end();
  });

  const creer = (body: object) => rdv.POST(jsonRequest(URL_RDV, { method: 'POST', cookie: c, body: { ...RDV, ...body } }));
  const modifier = (body: object) => rdv.PUT(jsonRequest(URL_RDV, { method: 'PUT', cookie: c, body: { ...RDV, ...body } }));

  it('enregistre l’heure de fin comme durée', async () => {
    const res = await creer({ heureFin: '15:15' });
    expect(res.status).toBe(200);
    expect((await res.json()).rdv).toMatchObject({ heure: '14:00', dureeMinutes: 75 });
  });

  it('refuse un créneau qui chevauche, accepte des créneaux dos à dos', async () => {
    expect((await creer({})).status).toBe(200);
    const refus = await creer({ heure: '14:15', heureFin: '14:45', prenom: 'Sam' });
    expect(refus.status).toBe(409);
    expect((await refus.json()).error).toContain('Léa D. (14:00 – 14:30)');
    expect((await creer({ heure: '13:00', heureFin: '15:00' })).status).toBe(409);
    expect((await creer({ heure: '14:30', heureFin: '15:00' })).status).toBe(200);
    expect((await creer({ heure: '13:30', heureFin: '14:00' })).status).toBe(200);
    expect((await creer({ date: '2099-06-16' })).status).toBe(200);
    expect((await pool.query('SELECT 1 FROM pij_rdv')).rowCount).toBe(4);
  });

  it('un rendez-vous annulé libère son créneau ; une annulation n’est jamais refusée', async () => {
    const { rdv: premier } = await (await creer({})).json();
    expect((await modifier({ id: premier.id, statut: 'annule' })).status).toBe(200);
    const { rdv: second } = await (await creer({ prenom: 'Sam' })).json();
    expect(second).toBeTruthy();
    expect((await modifier({ id: premier.id, statut: 'prevu' })).status).toBe(409);
  });

  it('déplacer un rendez-vous sur lui-même est permis, sur un autre non', async () => {
    const { rdv: a } = await (await creer({})).json();
    await creer({ heure: '15:00', heureFin: '15:30', prenom: 'Sam' });
    expect((await modifier({ id: a.id, heure: '14:10', heureFin: '14:40' })).status).toBe(200);
    expect((await modifier({ id: a.id, heure: '14:50', heureFin: '15:10' })).status).toBe(409);
  });

  it('un rendez-vous recopié de LE HUB occupe aussi le créneau', async () => {
    process.env.HUB_SYNC_SECRET = SECRET;
    process.env.HUB_SYNC_TENANT_ID = 'nogent';
    const envoi = await hub.PUT(jsonRequest('http://localhost/api/pij/hub/rdv', {
      method: 'PUT', headers: { 'x-hub-secret': SECRET },
      body: { hubId: 'pij_1', date: '2099-06-15', heure: '16:00', dureeMinutes: 30, nom: 'Martin', prenom: 'Inès' },
    }));
    expect(envoi.status).toBe(200);
    const refus = await creer({ heure: '16:15', heureFin: '16:45' });
    expect(refus.status).toBe(409);
    expect((await refus.json()).error).toContain('Inès M. (16:00 – 16:30)');
  });

  it('l’informatrice termine à 19:00 : un rendez-vous ne finit pas après', async () => {
    const tard = await creer({ heure: '18:30', heureFin: '19:15' });
    expect(tard.status).toBe(400);
    expect((await tard.json()).error).toContain('termine sa journée à 19:00');
    expect((await creer({ heure: '20:00', heureFin: '21:45' })).status).toBe(400);
    const { rdv: ok } = await (await creer({ heure: '18:30', heureFin: '19:00' })).json();
    expect(ok).toBeTruthy();
    expect((await modifier({ id: ok.id, heure: '18:45', heureFin: '19:30' })).status).toBe(400);
  });

  it('deux saisies simultanées sur le même créneau : une seule passe', async () => {
    const res = await Promise.all([creer({}), creer({ prenom: 'Sam' }), creer({ prenom: 'Noa', heure: '14:10', heureFin: '14:20' })]);
    expect(res.map(r => r.status).sort()).toEqual([200, 409, 409]);
    expect((await pool.query('SELECT 1 FROM pij_rdv')).rowCount).toBe(1);
  });
});
