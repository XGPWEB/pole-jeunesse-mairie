import { describe, it, expect, beforeEach, afterAll, afterEach } from 'vitest';

import pool from '@/lib/db';
import * as hub from '@/app/api/pij/hub/rdv/route';
import * as rdv from '@/app/api/pij/rdv/route';
import { resetDb, seedAnimateur, seedTenant, cookieFor, jsonRequest } from './helpers';

/**
 * Synchro de l'agenda PIJ avec LE HUB : route à secret partagé, mise à jour
 * par `hubId`, pointage conservé, et rendez-vous LE HUB protégés dans la
 * saisie de l'équipe. Vrais handlers, vrai PostgreSQL.
 */
const URL_HUB = 'http://localhost/api/pij/hub/rdv';
// Date déjà passée mais dans l'historique de 3 mois relu par LE HUB : un
// rendez-vous ne se pointe qu'une fois commencé.
const PASSEE = new Date(Date.now() - 2 * 86400e3).toISOString().slice(0, 10);
const URL_RDV = 'http://localhost/api/pij/rdv';
const SECRET = 'secret-de-test-hub-0123456789-abcdefghijkl';
const RDV_HUB = {
  hubId: 'pij_1761400000000_ab12cd', date: '2099-06-15', heure: '14:00', dureeMinutes: 30,
  nom: 'Martin', prenom: 'Inès', telephone: '06 11 22 33 44', objet: 'Bilan orientation', statut: 'prevu',
};

const envoyer = (body: unknown, secret: string | null = SECRET) =>
  hub.PUT(jsonRequest(URL_HUB, { method: 'PUT', body, headers: secret ? { 'x-hub-secret': secret } : {} }));
const lire = async () =>
  (await (await hub.GET(jsonRequest(URL_HUB, { headers: { 'x-hub-secret': SECRET } }))).json()).rdvs;

describe('Synchro LE HUB de l’agenda PIJ', () => {
  let cInformateur: string;

  beforeEach(async () => {
    await resetDb();
    await seedTenant('nogent');
    cInformateur = await cookieFor(await seedAnimateur({ role: 'animateur', espaceAssigne: 'PIJ' }));
    process.env.HUB_SYNC_SECRET = SECRET;
    process.env.HUB_SYNC_TENANT_ID = 'nogent';
  });
  afterEach(() => {
    delete process.env.HUB_SYNC_SECRET;
    delete process.env.HUB_SYNC_TENANT_ID;
  });
  afterAll(async () => {
    await pool.end();
  });

  it('404 tant que la synchro n’est pas configurée, 403 sans le bon secret', async () => {
    delete process.env.HUB_SYNC_SECRET;
    expect((await envoyer(RDV_HUB)).status).toBe(404);
    process.env.HUB_SYNC_SECRET = 'trop-court';
    expect((await envoyer(RDV_HUB)).status).toBe(404);
    process.env.HUB_SYNC_SECRET = SECRET;
    expect((await envoyer(RDV_HUB, null)).status).toBe(403);
    expect((await envoyer(RDV_HUB, `${SECRET}x`)).status).toBe(403);
    expect((await pool.query('SELECT 1 FROM pij_rdv')).rowCount).toBe(0);
  });

  it('crée puis met à jour la même ligne (clé hubId)', async () => {
    expect((await envoyer(RDV_HUB)).status).toBe(200);
    expect((await envoyer({ ...RDV_HUB, heure: '15:30' })).status).toBe(200);
    const { rows } = await pool.query('SELECT hub_id, heure, nom, telephone, lieu, tenant_id FROM pij_rdv');
    expect(rows).toEqual([{ hub_id: RDV_HUB.hubId, heure: '15:30', nom: 'Martin', telephone: '06 11 22 33 44', lieu: 'PIJ', tenant_id: 'nogent' }]);
  });

  it('refuse un hubId ou un rendez-vous invalide (400)', async () => {
    expect((await envoyer({ ...RDV_HUB, hubId: 'a b' })).status).toBe(400);
    expect((await envoyer({ ...RDV_HUB, heure: '14h00' })).status).toBe(400);
  });

  it('GET : agenda sans nom complet, téléphone ni notes', async () => {
    await envoyer(RDV_HUB);
    await rdv.POST(jsonRequest(URL_RDV, {
      method: 'POST', cookie: cInformateur,
      body: { date: '2099-06-16', heure: '10:00', nom: 'Durand', prenom: 'Léa', telephone: '07 00', notes: 'Privé' },
    }));
    const rdvs = await lire();
    expect(rdvs).toHaveLength(2);
    expect(rdvs[0]).toMatchObject({ hubId: RDV_HUB.hubId, date: '2099-06-15', heure: '14:00', dureeMinutes: 30, titre: 'Inès M.', statut: 'prevu' });
    expect(rdvs[1]).toMatchObject({ hubId: null, titre: 'Léa D.' });
    expect(JSON.stringify(rdvs)).not.toMatch(/Durand|07 00|Privé|06 11/);
  });

  it('un pointage fait au Pôle Jeunesse n’est pas écrasé par un « prévu » de LE HUB, une annulation l’est', async () => {
    const PASSE = { ...RDV_HUB, date: PASSEE };
    await envoyer(PASSE);
    const [{ id }] = (await pool.query('SELECT id FROM pij_rdv')).rows;
    const pointage = await rdv.PUT(jsonRequest(URL_RDV, { method: 'PUT', cookie: cInformateur, body: { ...PASSE, id, statut: 'honore' } }));
    expect(pointage.status).toBe(200);

    await envoyer(PASSE);
    expect((await lire())[0].statut).toBe('honore');
    await envoyer({ ...PASSE, statut: 'annule' });
    expect((await lire())[0].statut).toBe('annule');
  });

  it('dans la saisie de l’équipe, un rendez-vous LE HUB ne change que de pointage et de notes', async () => {
    await envoyer({ ...RDV_HUB, date: PASSEE });
    const [{ id }] = (await pool.query('SELECT id FROM pij_rdv')).rows;
    const maj = await rdv.PUT(jsonRequest(URL_RDV, {
      method: 'PUT', cookie: cInformateur,
      body: { ...RDV_HUB, id, date: PASSEE, heure: '13:00', nom: 'Autre', statut: 'absent', notes: 'Prévenu par SMS' },
    }));
    expect(maj.status).toBe(200);
    expect((await maj.json()).rdv).toMatchObject({ heure: '14:00', nom: 'Martin', statut: 'absent', notes: 'Prévenu par SMS', hubId: RDV_HUB.hubId });

    const annulation = await rdv.PUT(jsonRequest(URL_RDV, { method: 'PUT', cookie: cInformateur, body: { ...RDV_HUB, id, statut: 'annule' } }));
    expect(annulation.status).toBe(409);
    const suppression = await rdv.DELETE(jsonRequest(`${URL_RDV}?id=${id}`, { method: 'DELETE', cookie: cInformateur }));
    expect(suppression.status).toBe(409);
    expect((await pool.query('SELECT 1 FROM pij_rdv')).rowCount).toBe(1);
  });

  it('un rendez-vous annulé dans LE HUB ne peut plus être pointé ici', async () => {
    const PASSE = { ...RDV_HUB, date: PASSEE };
    await envoyer(PASSE);
    const [{ id }] = (await pool.query('SELECT id FROM pij_rdv')).rows;
    await envoyer({ ...PASSE, statut: 'annule' });
    const pointage = await rdv.PUT(jsonRequest(URL_RDV, { method: 'PUT', cookie: cInformateur, body: { ...PASSE, id, statut: 'honore' } }));
    expect(pointage.status).toBe(409);
    expect((await pointage.json()).error).toContain('annulé dans LE HUB');
    expect((await lire())[0].statut).toBe('annule');
  });

  it('pas de pointage honoré/absent avant l’heure de début, même si la page envoie une date passée', async () => {
    await envoyer(RDV_HUB);
    const [{ id }] = (await pool.query('SELECT id FROM pij_rdv')).rows;
    for (const statut of ['honore', 'absent']) {
      const res = await rdv.PUT(jsonRequest(URL_RDV, { method: 'PUT', cookie: cInformateur, body: { ...RDV_HUB, id, statut } }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('à partir de cette heure');
    }
    // Date passée envoyée par la page : c'est la date en base (2099) qui compte.
    const ruse = await rdv.PUT(jsonRequest(URL_RDV, { method: 'PUT', cookie: cInformateur, body: { ...RDV_HUB, id, date: PASSEE, statut: 'honore' } }));
    expect(ruse.status).toBe(400);
    // « Prévu » reste permis (remettre un pointage anticipé à zéro).
    expect((await rdv.PUT(jsonRequest(URL_RDV, { method: 'PUT', cookie: cInformateur, body: { ...RDV_HUB, id, statut: 'prevu', notes: 'ok' } }))).status).toBe(200);
    expect((await lire())[0].statut).toBe('prevu');
  });

  it('les rendez-vous d’une autre commune ne sont ni lus ni modifiés', async () => {
    await envoyer(RDV_HUB);
    process.env.HUB_SYNC_TENANT_ID = 'commune-b';
    await seedTenant('commune-b');
    expect(await lire()).toEqual([]);
    await envoyer({ ...RDV_HUB, heure: '16:00' });
    const { rows } = await pool.query('SELECT tenant_id, heure FROM pij_rdv ORDER BY tenant_id');
    expect(rows).toEqual([{ tenant_id: 'commune-b', heure: '16:00' }, { tenant_id: 'nogent', heure: '14:00' }]);
  });
});
