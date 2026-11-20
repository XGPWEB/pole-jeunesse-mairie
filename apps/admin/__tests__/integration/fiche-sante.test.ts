import { vi, describe, it, expect, beforeEach, afterAll } from 'vitest';

// Les server actions lisent la session dans le cookie via next/headers.
const session = vi.hoisted(() => ({ token: '' }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (session.token ? { value: session.token } : undefined) }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import pool from '@/lib/db';
import { creerJeune, modifierJeune } from '@/app/jeunes/actions';
import { GET as lirePiece } from '@/app/api/jeunes/fiche-agora/route';
import { POST as analyserFiche } from '@/app/api/jeunes/analyse-fiche/route';
import { resetDb, seedAnimateur, cookieFor, jsonRequest } from './helpers';
import { seedEspace } from './integrite-helpers';
import { MINI_FICHE_ENFANT, pdfFictif } from '../fiches-agora-fictives';

/**
 * Renseignements sanitaires d'une fiche jeune et lecture des éditions AGORA —
 * vraies actions, vrais handlers, vrai PostgreSQL.
 */

const uri = (type: string, octets: Buffer | string) => `data:${type};base64,${Buffer.from(octets).toString('base64')}`;
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'latin1');
const SANTE = {
  lieuNaissance: 'Nogent Sur Marne', allergies: 'Arachide', maladies: 'Asthme', regimes: 'Sans porc',
  vaccins: [{ nom: 'DTP', date: '2020-01-02' }, { nom: 'ROR', date: '' }],
  medecinNom: 'BERNARD Paul', medecinTelephone: '01 98 76 54 32',
  assuranceCompagnie: 'Assurance Fictive', assurancePolice: '000000-00X',
  hospitalisation: 'Oui', lieuHospitalisation: 'Hôpital Fictif',
  autorisationSortirSeul: true, autorisationSortirAccompagne: false, autorisationMesuresUrgence: null,
};

let cookie: string;
let espace: string;
const base = (extra: Record<string, unknown> = {}) => ({ nom: 'SANTE', prenom: 'Camille', sexe: 'F', espaceId: espace, ...extra });
const ligne = async (id: string) => (await pool.query('SELECT * FROM jeunes WHERE id = $1', [id])).rows[0];
const piece = (id: string, sante: boolean, c = cookie) =>
  lirePiece(jsonRequest(`/api/jeunes/fiche-agora?id=${encodeURIComponent(id)}${sante ? '&piece=sante' : ''}`, { cookie: c }));
const analyser = (fichier: unknown, c: string | undefined = cookie) =>
  analyserFiche(jsonRequest('/api/jeunes/analyse-fiche', { method: 'POST', body: { fichier }, cookie: c }));

beforeEach(async () => {
  await resetDb();
  cookie = await cookieFor(await seedAnimateur());
  session.token = cookie.slice('pj_token='.length);
  espace = await seedEspace();
});
afterAll(async () => { await pool.end(); });

describe('fiche jeune — renseignements sanitaires', () => {
  it('création : tout est enregistré, autorisation non renseignée conservée en NULL', async () => {
    const id = (await creerJeune(base(SANTE))).id!;
    expect(await ligne(id)).toMatchObject({
      lieu_naissance: 'Nogent Sur Marne', allergies: 'Arachide', maladies: 'Asthme', regimes: 'Sans porc',
      vaccins: SANTE.vaccins, medecin_nom: 'BERNARD Paul', medecin_telephone: '01 98 76 54 32',
      assurance_compagnie: 'Assurance Fictive', assurance_police: '000000-00X',
      hospitalisation: 'Oui', lieu_hospitalisation: 'Hôpital Fictif',
      autorisation_sortir_seul: true, autorisation_sortir_accompagne: false, autorisation_mesures_urgence: null,
      fiche_sante: null,
    });
  });

  it('création sans aucun renseignement : colonnes vides, liste de vaccins vide', async () => {
    const id = (await creerJeune(base())).id!;
    expect(await ligne(id)).toMatchObject({ allergies: null, vaccins: [], autorisation_sortir_seul: null });
  });

  it('modification : remplace les renseignements, vide ce qui est effacé', async () => {
    const id = (await creerJeune(base(SANTE))).id!;
    const res = await modifierJeune(id, base({ ...SANTE, allergies: '', vaccins: [{ nom: 'DTP', date: '2025-05-05' }], autorisationMesuresUrgence: true }));
    expect(res.success).toBe(true);
    expect(await ligne(id)).toMatchObject({
      allergies: null, maladies: 'Asthme', vaccins: [{ nom: 'DTP', date: '2025-05-05' }], autorisation_mesures_urgence: true,
    });
  });
});

describe('édition « Fiche santé » jointe', () => {
  it('enregistrée à la création, servie avec piece=sante, sans toucher à la fiche enfant', async () => {
    const id = (await creerJeune(base({ ficheSante: uri('application/pdf', PDF), ficheSanteNom: 'fiche_sante.pdf' }))).id!;
    const res = await piece(id, true);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toContain('fiche_sante.pdf');
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
    expect((await piece(id, false)).status).toBe(404);
  });

  it('une simple modification la conserve ; null la retire', async () => {
    const id = (await creerJeune(base({ ficheSante: uri('application/pdf', PDF), ficheSanteNom: 'fiche_sante.pdf' }))).id!;
    await modifierJeune(id, base({ prenom: 'Camille-Rose' }));
    expect((await ligne(id)).fiche_sante_nom).toBe('fiche_sante.pdf');
    await modifierJeune(id, base({ ficheSante: null }));
    expect(await ligne(id)).toMatchObject({ fiche_sante: null, fiche_sante_nom: null });
  });

  it('contenu actif refusé à la création comme à la modification', async () => {
    const html = uri('application/pdf', '<script>document.title="x"</script>');
    const creation = await creerJeune(base({ ficheSante: html, ficheSanteNom: 'x.pdf' }));
    expect(creation).toMatchObject({ success: false });
    expect(creation.error).toMatch(/^Fiche santé : /);
    expect((await pool.query('SELECT 1 FROM jeunes')).rowCount).toBe(0);

    const id = (await creerJeune(base({ ficheSante: uri('application/pdf', PDF) }))).id!;
    expect((await modifierJeune(id, base({ nom: 'MODIFIE', ficheSante: html }))).success).toBe(false);
    expect(await ligne(id)).toMatchObject({ nom: 'SANTE', fiche_sante: uri('application/pdf', PDF) });
  });

  it('une autre commune ne peut pas la lire', async () => {
    const id = (await creerJeune(base({ ficheSante: uri('application/pdf', PDF) }))).id!;
    const autre = await cookieFor(await seedAnimateur({ tenantId: 'autre-commune' }));
    expect((await piece(id, true, autre)).status).toBe(404);
  });
});

describe('POST /api/jeunes/analyse-fiche', () => {
  it('sans session : 401', async () => {
    expect((await analyser(uri('application/pdf', pdfFictif(MINI_FICHE_ENFANT)), '')).status).toBe(401);
  });

  it('PDF AGORA : rend le type et les champs, sans rien enregistrer', async () => {
    const res = await analyser(uri('application/pdf', pdfFictif(MINI_FICHE_ENFANT)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      type: 'enfant',
      champs: {
        nom: 'DURAND-LEROY', prenom: 'Sacha', sexe: 'M', dateNaissance: '2012-04-03',
        lieuNaissance: 'Nogent Sur Marne', adresse: '12 Rue des Lilas',
      },
    });
    expect((await pool.query('SELECT 1 FROM jeunes')).rowCount).toBe(0);
  });

  it.each([
    ['PDF qui n\'est pas une édition AGORA', uri('application/pdf', pdfFictif([{ x: 30, y: 800, texte: 'FACTURE' }]))],
    ['PDF illisible', uri('application/pdf', PDF)],
    ['image', uri('image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]))],
    ['HTML déclaré PDF', uri('application/pdf', '<script>1</script>')],
    ['pas une data URI', 'bonjour'],
    ['absent', undefined],
  ])('%s : 422 avec un message', async (_cas, fichier) => {
    const res = await analyser(fichier);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBeTruthy();
  });
});
