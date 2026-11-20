import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import pool from '@/lib/db';
import * as missions from '@/app/api/pij/missions/route';
import * as dossiers from '@/app/api/pij/dossiers/route';
import { resetDb, seedAnimateur, cookieFor, jsonRequest } from './helpers';

/**
 * Journal des missions d'un dossier permis : chaque mission est tracée, et le
 * total des heures réalisées du dossier est toujours la somme du journal.
 */
const URL_MIS = 'http://localhost/api/pij/missions';
const URL_DOS = 'http://localhost/api/pij/dossiers';

describe('Journal des missions (permis)', () => {
  let informateur: string;
  let college: string;
  let dossierId: string;

  const creerDossier = async (cookie: string, body: Record<string, unknown>) =>
    (await (await dossiers.POST(jsonRequest(URL_DOS, { method: 'POST', cookie, body }))).json()).dossier;
  const ajouter = (cookie: string, body: Record<string, unknown>) =>
    missions.POST(jsonRequest(URL_MIS, { method: 'POST', cookie, body }));
  const heuresDuDossier = async (id: string) =>
    Number((await pool.query('SELECT heures_realisees FROM pij_dossiers WHERE id = $1', [id])).rows[0].heures_realisees);

  beforeEach(async () => {
    await resetDb();
    informateur = await cookieFor(await seedAnimateur({ role: 'animateur', espaceAssigne: 'PIJ' }));
    college = await cookieFor(await seedAnimateur({ role: 'animateur', espaceAssigne: 'Collégiens' }));
    dossierId = (await creerDossier(informateur, { type: 'permis', nom: 'Martin', prenom: 'Noé', heuresARealiser: '20' })).id;
  });
  afterAll(async () => {
    await pool.end();
  });

  it('chaque mission ajoutée est tracée et ses heures se déduisent du dossier', async () => {
    const r1 = await ajouter(informateur, { dossierId, date: '2026-04-05', libelle: 'Chasse aux œufs', heures: 5 });
    expect(r1.status).toBe(200);
    expect(await r1.json()).toMatchObject({ heuresRealisees: 5 });

    const r2 = await (await ajouter(informateur, { dossierId, date: '2026-05-10', libelle: 'Fête de quartier', heures: '2,5' })).json();
    expect(r2.heuresRealisees).toBe(7.5);
    // Plus récente en premier ; auteur de la saisie conservé.
    expect(r2.missions).toMatchObject([
      { date: '2026-05-10', libelle: 'Fête de quartier', heures: 2.5, creePar: 'Utilisateur Test' },
      { date: '2026-04-05', libelle: 'Chasse aux œufs', heures: 5, creePar: 'Utilisateur Test' },
    ]);
    expect(await heuresDuDossier(dossierId)).toBe(7.5);

    const liste = await (await dossiers.GET(jsonRequest(URL_DOS, { cookie: informateur }))).json();
    expect(liste.dossiers[0]).toMatchObject({ heuresARealiser: 20, heuresRealisees: 7.5 });
  });

  it('retirer une mission rend ses heures au reste à faire', async () => {
    await ajouter(informateur, { dossierId, date: '2026-04-05', libelle: 'A', heures: 5 });
    const { missions: liste } = await (await ajouter(informateur, { dossierId, date: '2026-04-06', libelle: 'B', heures: 3 })).json();

    const res = await missions.DELETE(jsonRequest(`${URL_MIS}?id=${liste[0].id}`, { method: 'DELETE', cookie: informateur }));
    expect(await res.json()).toMatchObject({ heuresRealisees: 5, missions: [{ libelle: 'A' }] });
    expect(await heuresDuDossier(dossierId)).toBe(5);
    expect((await missions.DELETE(jsonRequest(`${URL_MIS}?id=${liste[0].id}`, { method: 'DELETE', cookie: informateur }))).status).toBe(404);
  });

  it('un animateur d’un autre espace lit le journal mais ne peut ni ajouter ni retirer', async () => {
    const { missions: liste } = await (await ajouter(informateur, { dossierId, date: '2026-04-05', libelle: 'A', heures: 5 })).json();

    const lecture = await missions.GET(jsonRequest(`${URL_MIS}?dossierId=${dossierId}`, { cookie: college }));
    expect((await lecture.json()).missions).toHaveLength(1);
    expect((await ajouter(college, { dossierId, date: '2026-04-06', libelle: 'B', heures: 3 })).status).toBe(403);
    expect((await missions.DELETE(jsonRequest(`${URL_MIS}?id=${liste[0].id}`, { method: 'DELETE', cookie: college }))).status).toBe(403);
    expect((await ajouter('', { dossierId, date: '2026-04-06', libelle: 'B', heures: 3 })).status).toBe(401);
    expect(await heuresDuDossier(dossierId)).toBe(5);
  });

  it('refuse une mission invalide, un dossier inconnu, d’une autre commune ou qui n’est pas un permis', async () => {
    expect((await ajouter(informateur, { dossierId, date: '2026-04-05', libelle: 'A', heures: 0 })).status).toBe(400);
    expect((await ajouter(informateur, { dossierId, date: '', libelle: 'A', heures: 2 })).status).toBe(400);
    expect((await ajouter(informateur, { dossierId: 'inconnu', date: '2026-04-05', libelle: 'A', heures: 2 })).status).toBe(404);

    const bafa = await creerDossier(informateur, { type: 'bafa', nom: 'A', prenom: 'B' });
    expect((await ajouter(informateur, { dossierId: bafa.id, date: '2026-04-05', libelle: 'A', heures: 2 })).status).toBe(400);

    const autre = await cookieFor(await seedAnimateur({ role: 'admin', tenantId: 'commune-b' }));
    expect((await ajouter(autre, { dossierId, date: '2026-04-05', libelle: 'A', heures: 2 })).status).toBe(404);
    expect((await (await missions.GET(jsonRequest(`${URL_MIS}?dossierId=${dossierId}`, { cookie: autre }))).json()).missions).toEqual([]);
    expect((await pool.query('SELECT 1 FROM pij_missions')).rowCount).toBe(0);
  });

  it('modifier le dossier ne touche pas aux heures tenues par le journal', async () => {
    await ajouter(informateur, { dossierId, date: '2026-04-05', libelle: 'A', heures: 5 });
    const res = await dossiers.PUT(jsonRequest(URL_DOS, {
      method: 'PUT', cookie: informateur,
      body: { id: dossierId, nom: 'Martin', prenom: 'Noé', heuresARealiser: '30', organisme: 'Auto-école X' },
    }));
    expect((await res.json()).dossier).toMatchObject({ heuresARealiser: 30, heuresRealisees: 5, organisme: 'Auto-école X' });
  });

  it('un permis créé avec des heures déjà réalisées ouvre son journal par une ligne de reprise', async () => {
    const d = await creerDossier(informateur, {
      type: 'permis', nom: 'Dupont', prenom: 'Sam', dateRef: '2026-02-19', heuresARealiser: 20, heuresRealisees: 5, missions: 'Chasse aux œufs (5h)',
    });
    const journal = await (await missions.GET(jsonRequest(`${URL_MIS}?dossierId=${d.id}`, { cookie: informateur }))).json();
    expect(journal.missions).toMatchObject([{ date: '2026-02-19', libelle: 'Chasse aux œufs (5h)', heures: 5 }]);
    // Ajouter ensuite une mission s'additionne à la reprise.
    expect((await (await ajouter(informateur, { dossierId: d.id, date: '2026-04-05', libelle: 'B', heures: 3 })).json()).heuresRealisees).toBe(8);
  });

  it('supprimer le dossier supprime son journal', async () => {
    await ajouter(informateur, { dossierId, date: '2026-04-05', libelle: 'A', heures: 5 });
    await dossiers.DELETE(jsonRequest(`${URL_DOS}?id=${dossierId}`, { method: 'DELETE', cookie: informateur }));
    expect((await pool.query('SELECT 1 FROM pij_missions')).rowCount).toBe(0);
  });
});
