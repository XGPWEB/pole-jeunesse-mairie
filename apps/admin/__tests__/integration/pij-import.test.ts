import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import pool from '@/lib/db';
import { POST } from '@/app/api/pij/import/route';
import { resetDb, seedAnimateur, cookieFor, jsonRequest } from './helpers';

/**
 * Reprise du tableur PIJ : admin uniquement, aperçu sans écriture, import en
 * une transaction, pas de doublon à la relance. Données fictives.
 */
const URL = 'http://localhost/api/pij/import';
const ACCUEIL = [
  'N°\tDate de la première visite\tNom\tPrénom\tSexe\tObjet de la demande\tEtat de la demande',
  '1\t12/01/2026\tDUPONT\tSam\tM\t"BAFA\nERASMUS +"\tFinalisé',
  '2\t13/01/2026\tMARTIN\tZoé\tF\tPERMIS B\t',
  '3\tbientôt\tERREUR\tDate\tF\tBAFA\t',
].join('\n');
const PERMIS = [
  'N°\tDate de la comission\tNom\tPrénom\tMontant attribué\tHeures à réaliser\tDéjà réalisé',
  '1\t19/02/2026\tDUPONT\tSam\t400,00 €\t20\t5',
].join('\n');

describe('POST /api/pij/import', () => {
  let admin: string;

  beforeEach(async () => {
    await resetDb();
    admin = await cookieFor(await seedAnimateur({ role: 'admin' }));
  });
  afterAll(async () => {
    await pool.end();
  });

  const importer = (cookie: string, body: unknown) => POST(jsonRequest(URL, { method: 'POST', cookie, body }));
  const nb = async (table: string) => (await pool.query(`SELECT 1 FROM ${table}`)).rowCount;

  it('réservé aux admins : un informateur PIJ est refusé, comme une requête sans session', async () => {
    const informateur = await cookieFor(await seedAnimateur({ role: 'animateur', espaceAssigne: 'PIJ' }));
    expect((await importer(informateur, { feuille: 'accueil', texte: ACCUEIL, confirmer: true })).status).toBe(403);
    expect((await importer('', { feuille: 'accueil', texte: ACCUEIL, confirmer: true })).status).toBe(401);
    expect(await nb('pij_accueils')).toBe(0);
  });

  it('sans confirmation : décrit l’import sans rien écrire', async () => {
    const res = await importer(admin, { feuille: 'accueil', texte: ACCUEIL });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      importe: false, nouveaux: 2, doublons: [], refus: [{ ligne: 4, motif: 'Date non reconnue : « bientôt ».' }],
    });
    expect(await nb('pij_accueils')).toBe(0);
  });

  it('avec confirmation : insère les lignes valides, puis les ignore à la relance', async () => {
    const res = await importer(admin, { feuille: 'accueil', texte: ACCUEIL, confirmer: true });
    expect(await res.json()).toMatchObject({ importe: true, nouveaux: 2 });
    const { rows } = await pool.query(
      `SELECT nom, date_visite::text AS date, objets, etat, tenant_id FROM pij_accueils ORDER BY date_visite`,
    );
    expect(rows).toEqual([
      { nom: 'DUPONT', date: '2026-01-12', objets: ['bafa', 'erasmus'], etat: 'finalise', tenant_id: 'nogent' },
      { nom: 'MARTIN', date: '2026-01-13', objets: ['permis'], etat: 'en_cours', tenant_id: 'nogent' },
    ]);

    const relance = await importer(admin, { feuille: 'accueil', texte: ACCUEIL, confirmer: true });
    expect(await relance.json()).toMatchObject({ nouveaux: 0, doublons: [2, 3] });
    expect(await nb('pij_accueils')).toBe(2);
  });

  it('importe la feuille Permis comme dossiers de type permis', async () => {
    const res = await importer(admin, { feuille: 'permis', texte: PERMIS, confirmer: true });
    expect(await res.json()).toMatchObject({ importe: true, nouveaux: 1 });
    const { rows } = await pool.query(
      `SELECT type, date_ref::text AS date, montant::float8 AS montant, heures_realisees::float8 AS faites FROM pij_dossiers`,
    );
    expect(rows).toEqual([{ type: 'permis', date: '2026-02-19', montant: 400, faites: 5 }]);
    // Les heures du tableur ouvrent le journal des missions du dossier.
    const journal = await pool.query(`SELECT date::text AS date, libelle, heures::float8 AS heures FROM pij_missions`);
    expect(journal.rows).toEqual([{ date: '2026-02-19', libelle: 'Heures déjà réalisées (reprise)', heures: 5 }]);
  });

  it('les doublons s’apprécient par commune', async () => {
    await importer(admin, { feuille: 'accueil', texte: ACCUEIL, confirmer: true });
    const autre = await cookieFor(await seedAnimateur({ role: 'admin', tenantId: 'commune-b' }));
    expect(await (await importer(autre, { feuille: 'accueil', texte: ACCUEIL, confirmer: true })).json()).toMatchObject({ nouveaux: 2, doublons: [] });
    expect((await pool.query(`SELECT 1 FROM pij_accueils WHERE tenant_id = 'commune-b'`)).rowCount).toBe(2);
  });

  it('refuse une feuille inconnue, un contenu vide ou sans titres (400)', async () => {
    expect((await importer(admin, { feuille: 'bafa', texte: ACCUEIL })).status).toBe(400);
    expect((await importer(admin, { feuille: 'accueil', texte: '  ' })).status).toBe(400);
    expect((await importer(admin, { feuille: 'accueil', texte: '1\tA\tB\n2\tC\tD' })).status).toBe(400);
  });
});
