import { vi, describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';

const session = vi.hoisted(() => ({ token: '' }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (session.token ? { value: session.token } : undefined) }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { NextRequest } from 'next/server';
import pool from '@/lib/db';
import { creerJeune, modifierJeune } from '@/app/jeunes/actions';
import { POST as reserver } from '@/app/api/vehicules/route';
import { POST as importer } from '@/app/api/jeunes/import/route';
import { resetDb, seedAnimateur, cookieFor, jsonRequest } from './helpers';
import { seedEspace, seedJeune } from './integrite-helpers';

/**
 * Audit du 2026-10-07, lot 2 — vrais handlers, vraies actions, vrai PostgreSQL.
 *   A3 : réservations de véhicules à dates ou heures inversées.
 *   A4 : jeune rattaché à l'espace d'une autre commune.
 *   A5 : import CSV limité à quatre espaces figés.
 * Les reproductions de l'audit constataient les défauts ; ces tests exigent
 * le comportement corrigé, en application ET en base.
 */

let cookie: string;
let espace: string;

beforeEach(async () => {
  await resetDb();
  cookie = await cookieFor(await seedAnimateur());
  session.token = cookie.slice('pj_token='.length);
  espace = await seedEspace();
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await pool.end(); });

describe('A3 — réservations de véhicules', () => {
  const demander = (body: Record<string, unknown>) => reserver(jsonRequest('/api/vehicules', { method: 'POST', cookie, body }));
  const lignes = async () => (await pool.query(
    `SELECT date_debut::text AS debut, date_fin::text AS fin, heure_depart AS depart, heure_retour AS retour FROM reservations_vehicules ORDER BY date_debut, heure_depart`,
  )).rows;

  it.each([
    ['retour la veille du départ', { dateDebut: '2026-11-10', dateFin: '2026-11-09', heureDepart: '10:00', heureRetour: '12:00' }],
    ['un seul jour, retour avant le départ', { dateDebut: '2026-11-15', dateFin: '2026-11-15', heureDepart: '18:00', heureRetour: '09:00' }],
    ['un seul jour, retour égal au départ', { dateDebut: '2026-11-15', heureDepart: '18:00', heureRetour: '18:00' }],
    ['date de départ impossible', { dateDebut: '2026-02-31', heureDepart: '10:00' }],
    ['date de retour impossible', { dateDebut: '2026-11-10', dateFin: '2026-11-31', heureDepart: '10:00' }],
    ['heure de départ hors plage', { dateDebut: '2026-11-10', heureDepart: '25:00' }],
    ['heure de retour illisible', { dateDebut: '2026-11-10', heureDepart: '10:00', heureRetour: 'midi' }],
    ['date sous un autre format', { dateDebut: '10/11/2026', heureDepart: '10:00' }],
  ])('refusée (400), rien d\'enregistré : %s', async (_nom, corps) => {
    const res = await demander({ motif: 'Audit', ...corps });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
    expect(await lignes()).toEqual([]);
  });

  it('corps illisible ou champs manquants : 400, pas 500', async () => {
    const brut = await reserver(new NextRequest('http://localhost/api/vehicules', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{pas du json' }));
    expect(brut.status).toBe(400);
    expect((await demander({ dateDebut: '2026-11-10', heureDepart: '10:00' })).status).toBe(400);
  });

  it('usages légitimes préservés : plusieurs jours, retour facultatif, heure normalisée', async () => {
    // Séjour de trois jours : le retour à 9 h est AVANT le départ à 18 h, et c'est correct.
    expect((await demander({ dateDebut: '2026-11-10', dateFin: '2026-11-12', heureDepart: '18:00', heureRetour: '09:00', motif: 'Séjour' })).status).toBe(200);
    expect((await demander({ dateDebut: '2026-11-20', heureDepart: '9:30', motif: 'Sans retour' })).status).toBe(200);
    expect((await demander({ dateDebut: '2026-11-21', dateFin: '2026-11-21', heureDepart: '08:00', heureRetour: '08:01', motif: 'Court' })).status).toBe(200);

    expect(await lignes()).toEqual([
      { debut: '2026-11-10', fin: '2026-11-12', depart: '18:00', retour: '09:00' },
      { debut: '2026-11-20', fin: '2026-11-20', depart: '09:30', retour: '' },
      { debut: '2026-11-21', fin: '2026-11-21', depart: '08:00', retour: '08:01' },
    ]);
  });

  it('conflits aux bornes : créneaux contigus acceptés, chevauchement d\'une minute refusé', async () => {
    const jour = { dateDebut: '2026-11-25', dateFin: '2026-11-25', motif: 'Créneau' };
    expect((await demander({ ...jour, heureDepart: '10:00', heureRetour: '12:00' })).status).toBe(200);
    expect((await demander({ ...jour, heureDepart: '12:00', heureRetour: '13:00' })).status).toBe(200);
    expect((await demander({ ...jour, heureDepart: '08:00', heureRetour: '10:00' })).status).toBe(200);
    expect((await demander({ ...jour, heureDepart: '11:59', heureRetour: '12:30' })).status).toBe(409);
    expect((await demander({ ...jour, heureDepart: '9:59', heureRetour: '10:01' })).status).toBe(409);
    // Une réservation de plusieurs jours bloque les jours qu'elle couvre.
    expect((await demander({ dateDebut: '2026-11-24', dateFin: '2026-11-26', heureDepart: '07:00', motif: 'Séjour' })).status).toBe(409);
    expect((await lignes()).length).toBe(3);
  });

  it('la base refuse elle aussi ces lignes, quel que soit le chemin d\'écriture', async () => {
    const inserer = (debut: string, fin: string, depart: string | null, retour: string | null) => pool.query(
      `INSERT INTO reservations_vehicules (id, date_debut, date_fin, heure_depart, heure_retour, motif, tenant_id) VALUES (gen_random_uuid()::text, $1, $2, $3, $4, 'direct', 'nogent')`,
      [debut, fin, depart, retour],
    );
    await expect(inserer('2026-11-10', '2026-11-09', '10:00', '12:00')).rejects.toThrow(/reservations_dates_coherentes/);
    await expect(inserer('2026-11-10', '2026-11-10', '18:00', '09:00')).rejects.toThrow(/reservations_heures_ordonnees/);
    await expect(inserer('2026-11-10', '2026-11-10', '9h', '')).rejects.toThrow(/reservations_heure_depart_valide/);
    await expect(inserer('2026-11-10', '2026-11-10', '09:00', '25:00')).rejects.toThrow(/reservations_heure_retour_valide/);
    // Conformes : retour vide, retour NULL (anciennes lignes), plusieurs jours.
    await inserer('2026-11-10', '2026-11-10', '09:00', '');
    await inserer('2026-11-11', '2026-11-11', '09:00', null);
    await inserer('2026-11-12', '2026-11-14', '18:00', '09:00');
    expect((await lignes()).length).toBe(3);
  });
});

describe('A4 — l\'espace d\'un jeune appartient à sa commune', () => {
  const base = (extra: Record<string, unknown> = {}) => ({ nom: 'AUDIT', prenom: 'Camille', sexe: 'F', espaceId: espace, ...extra });
  let espaceAutre: string;

  beforeEach(async () => {
    await seedAnimateur({ tenantId: 'autre' });
    espaceAutre = await seedEspace('autre');
  });

  it('création avec l\'espace d\'une autre commune : refusée, aucune fiche créée', async () => {
    const res = await creerJeune(base({ espaceId: espaceAutre }));
    expect(res).toEqual({ success: false, error: expect.stringContaining('Espace inconnu') });
    expect((await pool.query('SELECT 1 FROM jeunes')).rowCount).toBe(0);
  });

  it('modification vers l\'espace d\'une autre commune : refusée, fiche et contacts inchangés', async () => {
    const id = (await creerJeune(base({ contacts: [{ nom: 'Parent' }] }))).id!;

    const res = await modifierJeune(id, base({ nom: 'DEPLACE', espaceId: espaceAutre, contacts: [] }));

    expect(res).toEqual({ success: false, error: expect.stringContaining('Espace inconnu') });
    expect((await pool.query('SELECT nom, espace_id FROM jeunes WHERE id = $1', [id])).rows[0]).toEqual({ nom: 'AUDIT', espace_id: espace });
    expect((await pool.query('SELECT 1 FROM jeunes_contacts WHERE jeune_id = $1', [id])).rowCount).toBe(1);
  });

  it.each([['inexistant', 'espace-qui-n-existe-pas'], ['vide', ''], ['absent', undefined], ['mal typé', 42]])(
    'espace %s : refus lisible, pas d\'erreur PostgreSQL brute',
    async (_nom, espaceId) => {
      const journal = vi.spyOn(console, 'error').mockImplementation(() => {});
      const res = await creerJeune(base({ espaceId }) as never);
      expect(res).toEqual({ success: false, error: expect.stringContaining('Espace inconnu') });
      expect(journal).not.toHaveBeenCalled();
    },
  );

  it('espace de sa propre commune : création et changement d\'espace acceptés', async () => {
    const second = await seedEspace();
    const id = (await creerJeune(base())).id!;
    expect((await modifierJeune(id, base({ espaceId: second }))).success).toBe(true);
    expect((await pool.query('SELECT espace_id, tenant_id FROM jeunes WHERE id = $1', [id])).rows[0]).toEqual({ espace_id: second, tenant_id: 'nogent' });
  });

  it('la base refuse elle aussi la référence croisée ; un jeune sans espace reste permis', async () => {
    const inserer = (id: string, espaceId: string | null) =>
      pool.query(`INSERT INTO jeunes (id, nom, prenom, espace_id, tenant_id) VALUES ($1, 'DIRECT', 'Sql', $2, 'nogent')`, [id, espaceId]);
    await expect(inserer('j-croise', espaceAutre)).rejects.toThrow(/fk_jeunes_espace_commune/);
    await inserer('j-sans-espace', null);
    await inserer('j-conforme', espace);
    await expect(pool.query(`UPDATE jeunes SET espace_id = $1 WHERE id = 'j-conforme'`, [espaceAutre])).rejects.toThrow(/fk_jeunes_espace_commune/);
  });

  it('fiche historique déjà rattachée à une autre commune : lisible, non réaffectée, à corriger en choisissant un espace', async () => {
    // État d'une base où la migration a trouvé de l'existant fautif : contrainte NOT VALID.
    await pool.query('ALTER TABLE jeunes DROP CONSTRAINT fk_jeunes_espace_commune');
    try {
      const id = await seedJeune('nogent', espaceAutre);
      await pool.query('ALTER TABLE jeunes ADD CONSTRAINT fk_jeunes_espace_commune FOREIGN KEY (tenant_id, espace_id) REFERENCES espaces(tenant_id, id) NOT VALID');

      // Enregistrer la fiche en gardant l'espace étranger : refusé, rien ne bouge.
      expect(await modifierJeune(id, base({ nom: 'RENOMME', espaceId: espaceAutre }))).toEqual({ success: false, error: expect.stringContaining('Espace inconnu') });
      expect((await pool.query('SELECT nom, espace_id FROM jeunes WHERE id = $1', [id])).rows[0]).toEqual({ nom: 'DURAND', espace_id: espaceAutre });

      // En choisissant un espace de la commune : accepté.
      expect((await modifierJeune(id, base({ nom: 'RENOMME' }))).success).toBe(true);
      expect((await pool.query('SELECT nom, espace_id FROM jeunes WHERE id = $1', [id])).rows[0]).toEqual({ nom: 'RENOMME', espace_id: espace });
      await pool.query('ALTER TABLE jeunes VALIDATE CONSTRAINT fk_jeunes_espace_commune');
    } finally {
      // Quoi qu'il arrive, la base de test retrouve sa contrainte validée.
      await pool.query(`DELETE FROM jeunes j WHERE j.espace_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM espaces e WHERE e.id = j.espace_id AND e.tenant_id = j.tenant_id)`);
      await pool.query('ALTER TABLE jeunes DROP CONSTRAINT IF EXISTS fk_jeunes_espace_commune');
      await pool.query('ALTER TABLE jeunes ADD CONSTRAINT fk_jeunes_espace_commune FOREIGN KEY (tenant_id, espace_id) REFERENCES espaces(tenant_id, id)');
    }
  });
});

describe('A5 — import CSV : espaces réels de la commune, dates réelles', () => {
  async function importerCsv(contenu: string) {
    const form = new FormData();
    form.set('file', new File([contenu], 'jeunes.csv', { type: 'text/csv' }));
    const res = await importer(new NextRequest('http://localhost/api/jeunes/import', { method: 'POST', headers: { cookie }, body: form }));
    return { status: res.status, data: await res.json() as { imported: number; errors: { line: number; message: string }[]; doublons: unknown[] } };
  }
  const jeunes = async () => (await pool.query(`SELECT nom, espace_id, date_naissance::text AS naissance, tenant_id FROM jeunes ORDER BY nom`)).rows;

  it('espace créé depuis l\'interface : reconnu par son identifiant comme par son nom', async () => {
    const perso = await seedEspace('nogent', 'studio-musique-1f0c2a');
    await pool.query(`UPDATE espaces SET nom = 'Studio Musique' WHERE id = $1`, [perso]);

    const { data } = await importerCsv(`nom;prenom;espace\nALPHA;Camille;${perso}\nBETA;Sacha;studio musique\nGAMMA;Noa;STUDIO-MUSIQUE-1F0C2A`);

    expect(data.errors).toEqual([]);
    expect(data.imported).toBe(3);
    expect((await jeunes()).map(j => j.espace_id)).toEqual([perso, perso, perso]);
  });

  it('import existant valide préservé : en-tête espaceId, anciens identifiants, virgules, sans espace', async () => {
    await seedEspace('nogent', 'collegiens');
    await seedEspace('nogent', 'lyceens');

    const { data } = await importerCsv('nom,prenom,dateNaissance,sexe,espaceId,etablissement,classe\nDupont,Jean,2011-03-15,M,collegiens,Collège Victor Hugo,5A\nMartin,Sophie,2012-07-22,F,LYCEENS,Lycée Hector Berlioz,2nde\nSeul,Sans,,,,,');

    expect(data.errors).toEqual([]);
    expect(data.imported).toBe(3);
    expect(await jeunes()).toEqual([
      { nom: 'Dupont', espace_id: 'collegiens', naissance: '2011-03-15', tenant_id: 'nogent' },
      { nom: 'Martin', espace_id: 'lyceens', naissance: '2012-07-22', tenant_id: 'nogent' },
      { nom: 'Seul', espace_id: null, naissance: null, tenant_id: 'nogent' },
    ]);
  });

  it('espace d\'une autre commune ou inconnu : ligne refusée avec la liste des espaces valides, les autres lignes importées', async () => {
    await seedAnimateur({ tenantId: 'autre' });
    const etranger = await seedEspace('autre', 'espace-de-l-autre-commune');
    await pool.query(`UPDATE espaces SET nom = 'Maison des jeunes' WHERE id = $1`, [espace]);

    const { data } = await importerCsv(`nom;prenom;espace\nINTRUS;Un;${etranger}\nINTRUS;Deux;Espace ${etranger}\nINCONNU;Trois;collegiens\nVALIDE;Quatre;${espace}`);

    expect(data.imported).toBe(1);
    expect(data.errors.map(e => e.line)).toEqual([2, 3, 4]);
    for (const e of data.errors) {
      expect(e.message).toContain('Espace inconnu');
      expect(e.message).toContain(`Maison des jeunes (${espace})`);
      // La réponse ne révèle pas à qui appartient l'espace demandé.
      expect(e.message).not.toContain('autre commune');
    }
    expect(await jeunes()).toEqual([{ nom: 'VALIDE', espace_id: espace, naissance: null, tenant_id: 'nogent' }]);
  });

  it('nom d\'espace ambigu : refusé en demandant l\'identifiant', async () => {
    const a = await seedEspace('nogent', 'annexe-a'), b = await seedEspace('nogent', 'annexe-b');
    await pool.query(`UPDATE espaces SET nom = 'Annexe' WHERE id IN ($1, $2)`, [a, b]);

    const { data } = await importerCsv('nom;prenom;espace\nDOUTE;Un;Annexe\nCLAIR;Deux;annexe-b');

    expect(data.imported).toBe(1);
    expect(data.errors).toEqual([expect.objectContaining({ line: 2, message: expect.stringContaining('annexe-a, annexe-b') })]);
  });

  it('date impossible ou future : erreur sur SA ligne, le reste de l\'import n\'est plus annulé', async () => {
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { status, data } = await importerCsv('nom;prenom;dateNaissance\nFEVRIER;Trente,2026-02-31\nAVRIL;Trente-et-un;2011-04-31\nFUTUR;Bebe;2199-01-01\nFORMAT;Autre;15/03/2011\nBISSEXTILE;Ok;2012-02-29\nNORMAL;Ok;2011-03-15');

    expect(status).toBe(200);
    expect(journal).not.toHaveBeenCalled();
    expect(data.imported).toBe(2);
    expect(data.errors.map(e => [e.line, e.message.split(' "')[0]])).toEqual([
      [2, 'Date de naissance impossible'],
      [3, 'Date de naissance impossible'],
      [4, 'Date de naissance dans le futur'],
      [5, 'Date de naissance invalide'],
    ]);
    expect((await jeunes()).map(j => [j.nom, j.naissance])).toEqual([['BISSEXTILE', '2012-02-29'], ['NORMAL', '2011-03-15']]);
  });
});
