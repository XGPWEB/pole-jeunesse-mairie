import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import pool from '@/lib/db';
import * as accueils from '@/app/api/pij/accueils/route';
import * as dossiers from '@/app/api/pij/dossiers/route';
import { resetDb, seedAnimateur, cookieFor, jsonRequest } from './helpers';

/**
 * Module PIJ : la saisie est réservée aux admins et aux informateurs PIJ
 * (espace assigné « PIJ »). Les animateurs des autres espaces lisent sans
 * écrire. Vrais handlers, vrai PostgreSQL.
 */
const URL_ACC = 'http://localhost/api/pij/accueils';
const URL_DOS = 'http://localhost/api/pij/dossiers';

const ACCUEIL = {
  dateVisite: '2026-01-09', nom: 'Durand', prenom: 'Léa', dateNaissance: '2008-03-07', sexe: 'F',
  commune: 'Nogent-sur-Marne', quartier: 'Village', objets: ['bafa', 'erasmus'],
  orientations: ['CAF', 'IFAC'], etat: 'en_cours',
};
const PERMIS = {
  type: 'permis', nom: 'Martin', prenom: 'Noé', dateRef: '2026-02-18', montant: '400',
  heuresARealiser: '20', heuresRealisees: '5', etat: 'Complet',
};

describe('API PIJ', () => {
  let admin: string;
  let informateur: string;
  let animateurCollege: string;
  let animateurLycee: string;

  beforeEach(async () => {
    await resetDb();
    admin = await cookieFor(await seedAnimateur({ role: 'admin', espaceAssigne: 'Tous' }));
    informateur = await cookieFor(await seedAnimateur({ role: 'animateur', espaceAssigne: 'PIJ' }));
    animateurCollege = await cookieFor(await seedAnimateur({ role: 'animateur', espaceAssigne: 'Collégiens' }));
    animateurLycee = await cookieFor(await seedAnimateur({ role: 'animateur', espaceAssigne: 'Lycéens' }));
  });

  afterAll(async () => {
    await pool.end();
  });

  const creerAccueil = async (cookie: string, body: unknown = ACCUEIL) =>
    accueils.POST(jsonRequest(URL_ACC, { method: 'POST', cookie, body }));
  const creerDossier = async (cookie: string, body: unknown = PERMIS) =>
    dossiers.POST(jsonRequest(URL_DOS, { method: 'POST', cookie, body }));

  it('un informateur PIJ et un admin peuvent saisir', async () => {
    for (const cookie of [informateur, admin]) {
      expect((await creerAccueil(cookie)).status).toBe(200);
      expect((await creerDossier(cookie)).status).toBe(200);
    }
    expect((await pool.query('SELECT 1 FROM pij_accueils')).rowCount).toBe(2);
    expect((await pool.query('SELECT 1 FROM pij_dossiers')).rowCount).toBe(2);
  });

  it('un animateur collège ou lycée ne peut ni créer, ni modifier, ni supprimer', async () => {
    const { accueil } = await (await creerAccueil(informateur)).json();
    const { dossier } = await (await creerDossier(informateur)).json();

    for (const cookie of [animateurCollege, animateurLycee]) {
      expect((await creerAccueil(cookie)).status).toBe(403);
      expect((await creerDossier(cookie)).status).toBe(403);
      expect((await accueils.PUT(jsonRequest(URL_ACC, { method: 'PUT', cookie, body: { ...ACCUEIL, id: accueil.id, nom: 'Piraté' } }))).status).toBe(403);
      expect((await dossiers.PUT(jsonRequest(URL_DOS, { method: 'PUT', cookie, body: { ...PERMIS, id: dossier.id, nom: 'Piraté' } }))).status).toBe(403);
      expect((await accueils.DELETE(jsonRequest(`${URL_ACC}?id=${accueil.id}`, { method: 'DELETE', cookie }))).status).toBe(403);
      expect((await dossiers.DELETE(jsonRequest(`${URL_DOS}?id=${dossier.id}`, { method: 'DELETE', cookie }))).status).toBe(403);
    }
    expect((await pool.query(`SELECT nom FROM pij_accueils`)).rows).toEqual([{ nom: 'Durand' }]);
    expect((await pool.query(`SELECT nom FROM pij_dossiers`)).rows).toEqual([{ nom: 'Martin' }]);
  });

  it('un animateur d’un autre espace consulte, sans droit de saisie annoncé', async () => {
    await creerAccueil(informateur);
    const res = await accueils.GET(jsonRequest(URL_ACC, { cookie: animateurCollege }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.peutSaisir).toBe(false);
    expect(data.accueils).toHaveLength(1);

    const pourInformateur = await (await accueils.GET(jsonRequest(URL_ACC, { cookie: informateur }))).json();
    expect(pourInformateur.peutSaisir).toBe(true);
  });

  it('refuse toute requête sans session', async () => {
    expect((await accueils.GET(jsonRequest(URL_ACC))).status).toBe(401);
    expect((await creerAccueil(''))).toHaveProperty('status', 401);
    expect((await dossiers.GET(jsonRequest(URL_DOS))).status).toBe(401);
  });

  it('enregistre un accueil : dates sans décalage, listes, champs vidés à null', async () => {
    const res = await creerAccueil(informateur, { ...ACCUEIL, email: '', prochainRdv: '', dateNaissance: '' });
    expect(res.status).toBe(200);
    const { accueil } = await res.json();
    expect(accueil).toMatchObject({
      dateVisite: '2026-01-09', dateNaissance: null, email: null, prochainRdv: null,
      objets: ['bafa', 'erasmus'], orientations: ['CAF', 'IFAC'], etat: 'en_cours',
    });
  });

  it('modifie un accueil et efface une date de naissance', async () => {
    const { accueil } = await (await creerAccueil(informateur)).json();
    const res = await accueils.PUT(jsonRequest(URL_ACC, {
      method: 'PUT', cookie: informateur,
      body: { ...ACCUEIL, id: accueil.id, dateNaissance: '', etat: 'finalise', suivi: 'BAFA obtenu' },
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).accueil).toMatchObject({ id: accueil.id, dateNaissance: null, etat: 'finalise', suivi: 'BAFA obtenu' });
  });

  it('refuse un accueil invalide sans rien écrire (400)', async () => {
    expect((await creerAccueil(informateur, { ...ACCUEIL, objets: [] })).status).toBe(400);
    expect((await creerAccueil(informateur, { ...ACCUEIL, dateVisite: '' })).status).toBe(400);
    expect((await pool.query('SELECT 1 FROM pij_accueils')).rowCount).toBe(0);
  });

  it('enregistre un dossier permis avec des nombres, et garde son type à la modification', async () => {
    const { dossier } = await (await creerDossier(informateur)).json();
    expect(dossier).toMatchObject({ type: 'permis', dateRef: '2026-02-18', montant: 400, heuresARealiser: 20, heuresRealisees: 5 });

    const res = await dossiers.PUT(jsonRequest(URL_DOS, {
      method: 'PUT', cookie: informateur,
      body: { ...PERMIS, id: dossier.id, type: 'bafa', heuresRealisees: '12,5', dateRef: '' },
    }));
    expect(res.status).toBe(200);
    // Les heures réalisées d'un permis ne se modifient plus par le formulaire :
    // elles viennent du journal des missions (voir pij-missions.test.ts).
    expect((await res.json()).dossier).toMatchObject({ type: 'permis', heuresRealisees: 5, dateRef: null, montant: 400 });
  });

  it('supprime une fiche, et répond 404 pour une fiche inconnue', async () => {
    const { accueil } = await (await creerAccueil(informateur)).json();
    expect((await accueils.DELETE(jsonRequest(`${URL_ACC}?id=${accueil.id}`, { method: 'DELETE', cookie: informateur }))).status).toBe(200);
    expect((await accueils.DELETE(jsonRequest(`${URL_ACC}?id=${accueil.id}`, { method: 'DELETE', cookie: informateur }))).status).toBe(404);
  });

  it('cloisonne les communes : une autre structure ne voit ni ne modifie les fiches', async () => {
    const { accueil } = await (await creerAccueil(informateur)).json();
    const autre = await cookieFor(await seedAnimateur({ role: 'admin', tenantId: 'commune-b' }));

    expect((await (await accueils.GET(jsonRequest(URL_ACC, { cookie: autre }))).json()).accueils).toEqual([]);
    expect((await accueils.PUT(jsonRequest(URL_ACC, { method: 'PUT', cookie: autre, body: { ...ACCUEIL, id: accueil.id } }))).status).toBe(404);
    expect((await accueils.DELETE(jsonRequest(`${URL_ACC}?id=${accueil.id}`, { method: 'DELETE', cookie: autre }))).status).toBe(404);
    expect((await pool.query('SELECT 1 FROM pij_accueils')).rowCount).toBe(1);
  });
});
