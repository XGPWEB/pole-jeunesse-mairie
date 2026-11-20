import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';

import pool from '@/lib/db';
import { POST } from '@/app/api/projets/route';
import { resetDb, seedAnimateur, cookieFor, jsonRequest } from './helpers';
import { seedProjet, photographier } from './integrite-helpers';

/**
 * Constat 21 de l'audit du 2026-10-06 — projet et budget atomiques.
 *
 * Avant : UPDATE du projet, DELETE de l'ancien budget, puis un INSERT par
 * ligne, chacun validé séparément. Une ligne fautive au milieu laissait un
 * projet modifié et un budget perdu ou tronqué.
 */
const URL = 'http://localhost/api/projets';
const BUDGET_INITIAL = [
  { designation: 'Intervenant danse', cout: '900' },
  { designation: 'Goûter', cout: '150' },
];

let cookie: string;
let auteurId: string;

const envoyer = (body: unknown, c = cookie) => POST(jsonRequest(URL, { method: 'POST', cookie: c, body }));

beforeAll(async () => {
  // Panne simulée EN BASE, au milieu de l'écriture du budget : un déclencheur
  // fait échouer l'insertion d'une ligne précise. Posé pour ce fichier
  // uniquement et retiré en fin de fichier.
  await pool.query(`
    CREATE OR REPLACE FUNCTION test_panne_budget() RETURNS trigger AS $$
    BEGIN
      IF NEW.designation = 'PANNE-EN-BASE' THEN
        RAISE EXCEPTION 'panne simulée pendant l''écriture du budget';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS test_panne_budget ON projets_budget;
    CREATE TRIGGER test_panne_budget BEFORE INSERT ON projets_budget
      FOR EACH ROW EXECUTE FUNCTION test_panne_budget();
  `);
});

beforeEach(async () => {
  await resetDb();
  const auteur = await seedAnimateur({ role: 'animateur' });
  auteurId = auteur.id;
  cookie = await cookieFor(auteur);
});

afterAll(async () => {
  await pool.query(`
    DROP TRIGGER IF EXISTS test_panne_budget ON projets_budget;
    DROP FUNCTION IF EXISTS test_panne_budget();
  `);
  await pool.end();
});

describe('mise à jour d’un projet et de son budget', () => {
  it('ligne intermédiaire invalide → 400, ancien projet et ancien budget intégralement conservés', async () => {
    const id = await seedProjet(auteurId, { titre: 'Titre d’origine', budget: BUDGET_INITIAL });
    const avant = await photographier('projets', 'projets_budget');

    const reponse = await envoyer({
      id, titre: 'Titre modifié', lieu: 'Nouveau lieu',
      budget: [
        { designation: 'Ligne valide 1', cout: '10' },
        { designation: 'Ligne fautive', cout: 'beaucoup' },
        { designation: 'Ligne valide 3', cout: '30' },
      ],
    });

    expect(reponse.status).toBe(400);
    expect((await reponse.json()).error).toContain('n°2');
    expect(await photographier('projets', 'projets_budget')).toEqual(avant);
  });

  it.each([
    ['une ligne qui n’est pas un objet', [{ designation: 'A', cout: '1' }, null, { designation: 'C', cout: '3' }]],
    ['une désignation non textuelle', [{ designation: 'A', cout: '1' }, { designation: { x: 1 }, cout: '2' }]],
    ['un coût objet', [{ designation: 'A', cout: '1' }, { designation: 'B', cout: ['2'] }]],
    ['un budget qui n’est pas une liste', 'pas une liste'],
  ])('%s → 400 sans aucune écriture', async (_nom, budget) => {
    const id = await seedProjet(auteurId, { budget: BUDGET_INITIAL });
    const avant = await photographier('projets', 'projets_budget');

    expect((await envoyer({ id, titre: 'Modifié', budget })).status).toBe(400);
    expect(await photographier('projets', 'projets_budget')).toEqual(avant);
  });

  it('échec EN BASE au milieu de l’écriture → 500, tout est annulé (projet ET budget d’origine intacts)', async () => {
    const id = await seedProjet(auteurId, { titre: 'Titre d’origine', budget: BUDGET_INITIAL });
    const avant = await photographier('projets', 'projets_budget');

    const reponse = await envoyer({
      id, titre: 'Titre modifié',
      budget: [
        { designation: 'Écrite avant la panne', cout: '10' },
        { designation: 'PANNE-EN-BASE', cout: '20' },
        { designation: 'Jamais atteinte', cout: '30' },
      ],
    });

    expect(reponse.status).toBe(500);
    // Ni le nouveau titre, ni la suppression de l'ancien budget, ni la
    // première ligne déjà insérée ne doivent subsister.
    expect(await photographier('projets', 'projets_budget')).toEqual(avant);
  });

  it('remplacement valide : le budget est remplacé en entier, dans l’ordre saisi', async () => {
    const id = await seedProjet(auteurId, { budget: BUDGET_INITIAL });

    const reponse = await envoyer({
      id, titre: 'Modifié',
      budget: [{ designation: 'Kayak', cout: '225,50' }, { designation: 'Carburant', cout: 45 }],
    });

    expect(reponse.status).toBe(200);
    expect((await reponse.json()).projet.budget).toEqual([
      { designation: 'Kayak', cout: '225,50' },
      { designation: 'Carburant', cout: '45' },
    ]);
    expect((await pool.query('SELECT 1 FROM projets_budget WHERE projet_id = $1', [id])).rowCount).toBe(2);
  });

  it('sans budget dans la requête, le budget existant est conservé', async () => {
    const id = await seedProjet(auteurId, { budget: BUDGET_INITIAL });
    const avant = await photographier('projets_budget');

    expect((await envoyer({ id, titre: 'Seul le titre change' })).status).toBe(200);
    expect(await photographier('projets_budget')).toEqual(avant);
  });

  it('accepte le champ `lignesBudget` envoyé par le formulaire et ignore ses lignes vides', async () => {
    const id = await seedProjet(auteurId, { budget: BUDGET_INITIAL });

    const reponse = await envoyer({
      id,
      lignesBudget: [{ designation: 'Affiches', cout: '80' }, { designation: '', cout: '' }, { designation: '  ', cout: '' }],
    });

    expect(reponse.status).toBe(200);
    expect((await reponse.json()).projet.budget).toEqual([{ designation: 'Affiches', cout: '80' }]);
  });

  it('un animateur qui n’est pas l’auteur ne peut ni modifier le projet ni remplacer son budget', async () => {
    const id = await seedProjet(auteurId, { budget: BUDGET_INITIAL });
    const autre = await cookieFor(await seedAnimateur({ role: 'animateur' }));
    const avant = await photographier('projets', 'projets_budget');

    const reponse = await envoyer({ id, titre: 'Détourné', budget: [] }, autre);

    expect(reponse.status).toBe(403);
    expect(await photographier('projets', 'projets_budget')).toEqual(avant);
  });
});

describe('création d’un projet avec budget', () => {
  it('ligne invalide → 400 et AUCUN projet créé', async () => {
    const reponse = await envoyer({
      titre: 'Nouveau', budget: [{ designation: 'OK', cout: '1' }, { designation: 'KO', cout: '1 2 x' }],
    });

    expect(reponse.status).toBe(400);
    expect((await pool.query('SELECT 1 FROM projets')).rowCount).toBe(0);
  });

  it('échec en base sur une ligne → aucun projet orphelin sans son budget', async () => {
    const reponse = await envoyer({
      titre: 'Nouveau',
      budget: [{ designation: 'Écrite avant la panne', cout: '1' }, { designation: 'PANNE-EN-BASE', cout: '2' }],
    });

    expect(reponse.status).toBe(500);
    expect((await pool.query('SELECT 1 FROM projets')).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM projets_budget')).rowCount).toBe(0);
  });

  it('création valide : projet et lignes enregistrés ensemble', async () => {
    const reponse = await envoyer({ titre: 'Séjour', budget: BUDGET_INITIAL });

    expect(reponse.status).toBe(200);
    expect((await reponse.json()).projet.budget).toEqual(BUDGET_INITIAL);
  });
});
