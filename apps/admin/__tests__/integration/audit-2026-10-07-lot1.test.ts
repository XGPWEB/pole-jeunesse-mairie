import { vi, describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';

// Les server actions lisent la session dans le cookie via next/headers.
const session = vi.hoisted(() => ({ token: '' }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (session.token ? { value: session.token } : undefined) }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import pool from '@/lib/db';
import { creerJeune, modifierJeune } from '@/app/jeunes/actions';
import { GET as lireFicheAgora } from '@/app/api/jeunes/fiche-agora/route';
import { analyserAppelConsoleError } from '@/lib/monitoring';
import { resetDb, seedAnimateur, cookieFor, jsonRequest } from './helpers';
import { seedEspace, seedJeune } from './integrite-helpers';

/**
 * Audit du 2026-10-07, lot 1 — vraies actions, vrai handler, vrai PostgreSQL.
 *   A1 : pièce AGORA — HTML actif accepté puis servi sur l'origine du site.
 *   A2 : fiche, pièce et contacts d'urgence écrits sans transaction.
 * Les reproductions de l'audit constataient les défauts ; ces tests exigent
 * le comportement corrigé. Appeler l'action directement, c'est précisément
 * contourner les contrôles du formulaire.
 */

const uri = (type: string, octets: Buffer | string) => `data:${type};base64,${Buffer.from(octets).toString('base64')}`;
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'latin1');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const HTML = '<script>document.title="preuve-audit"</script>';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';

const PIECES_HOSTILES: [string, string][] = [
  ['HTML déclaré text/html', uri('text/html', HTML)],
  ['HTML déclaré application/pdf', uri('application/pdf', HTML)],
  ['HTML déclaré image/png', uri('image/png', HTML)],
  ['HTML avec charset', `data:text/html;charset=utf-8;base64,${Buffer.from(HTML).toString('base64')}`],
  ['SVG déclaré image/svg+xml', uri('image/svg+xml', SVG)],
  ['SVG déclaré image/png', uri('image/png', SVG)],
  ['XHTML', uri('application/xhtml+xml', `<html xmlns="http://www.w3.org/1999/xhtml">${HTML}</html>`)],
  ['pas une data URI', 'javascript:alert(1)'],
  ['plus de 5 Mo', uri('application/pdf', Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024, 0x20)]))],
];

let cookie: string;
let espace: string;
const base = (extra: Record<string, unknown> = {}) => ({ nom: 'AUDIT', prenom: 'Camille', sexe: 'F', espaceId: espace, ...extra });
const lire = (id: string) => lireFicheAgora(jsonRequest(`/api/jeunes/fiche-agora?id=${encodeURIComponent(id)}`, { cookie }));
const ligne = async (id: string) => (await pool.query('SELECT nom, fiche_agora, fiche_agora_nom FROM jeunes WHERE id = $1', [id])).rows[0];
const contacts = async (id: string) =>
  (await pool.query('SELECT nom, telephone FROM jeunes_contacts WHERE jeune_id = $1 ORDER BY nom', [id])).rows as { nom: string; telephone: string | null }[];

beforeEach(async () => {
  await resetDb();
  cookie = await cookieFor(await seedAnimateur());
  session.token = cookie.slice('pj_token='.length);
  espace = await seedEspace();
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await pool.end(); });

describe('A1 — pièce AGORA : validation serveur', () => {
  it.each(PIECES_HOSTILES)('création refusée, rien n\'est enregistré : %s', async (_nom, piece) => {
    const res = await creerJeune(base({ ficheAgora: piece, ficheAgoraNom: 'preuve.html' }));
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/^Fiche AGORA : /);
    expect((await pool.query('SELECT 1 FROM jeunes')).rowCount).toBe(0);
  });

  it.each(PIECES_HOSTILES)('modification refusée, fiche et pièce existante intactes : %s', async (_nom, piece) => {
    const id = (await creerJeune(base({ ficheAgora: uri('application/pdf', PDF), ficheAgoraNom: 'origine.pdf', contacts: [{ nom: 'Parent', telephone: '0102030405' }] }))).id!;
    const avant = await ligne(id);

    const res = await modifierJeune(id, base({ nom: 'MODIFIE', ficheAgora: piece, ficheAgoraNom: 'preuve.html', contacts: [] }));

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/^Fiche AGORA : /);
    expect(await ligne(id)).toEqual(avant);
    expect(await contacts(id)).toEqual([{ nom: 'Parent', telephone: '0102030405' }]);
  });

  it.each([
    ['PDF', 'application/pdf', PDF], ['PNG', 'image/png', PNG], ['JPEG', 'image/jpeg', JPEG], ['WEBP', 'image/webp', WEBP],
  ] as const)('%s : accepté à la création et à la modification, resservi à l\'identique pour affichage', async (_nom, type, octets) => {
    const cree = await creerJeune(base({ ficheAgora: uri(type, octets), ficheAgoraNom: 'fiche été.pdf' }));
    expect(cree.success).toBe(true);
    const autre = await seedJeune('nogent', espace);
    expect((await modifierJeune(autre, base({ ficheAgora: uri(type, octets), ficheAgoraNom: 'fiche.bin' }))).success).toBe(true);

    for (const id of [cree.id!, autre]) {
      const res = await lire(id);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe(type);
      expect(res.headers.get('content-disposition')).toMatch(/^inline; /);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      expect(Buffer.from(await res.arrayBuffer()).equals(octets)).toBe(true);
    }
    expect((await lire(cree.id!)).headers.get('content-disposition')).toContain("filename*=UTF-8''fiche%20%C3%A9t%C3%A9.pdf");
  });

  it('type annoncé faux mais contenu inerte : enregistré et servi sous son type réel', async () => {
    const res = await creerJeune(base({ ficheAgora: uri('text/html', JPEG), ficheAgoraNom: 'photo.html' }));
    expect(res.success).toBe(true);
    expect((await ligne(res.id!)).fiche_agora).toBe(uri('image/jpeg', JPEG));
    expect((await lire(res.id!)).headers.get('content-type')).toBe('image/jpeg');
  });

  it('nom de fichier : chemin et caractères de contrôle retirés avant stockage', async () => {
    const res = await creerJeune(base({ ficheAgora: uri('application/pdf', PDF), ficheAgoraNom: '../../a\r\nX-Injecte: 1.pdf' }));
    expect((await ligne(res.id!)).fiche_agora_nom).toBe('aX-Injecte: 1.pdf');
    const disposition = (await lire(res.id!)).headers.get('content-disposition')!;
    expect(disposition).not.toMatch(/[\r\n]/);
  });

  it('modification sans clé ficheAgora : pièce conservée ; null : pièce retirée', async () => {
    const id = (await creerJeune(base({ ficheAgora: uri('image/png', PNG), ficheAgoraNom: 'a.png' }))).id!;
    expect((await modifierJeune(id, base({ nom: 'RENOMME' }))).success).toBe(true);
    expect(await ligne(id)).toEqual({ nom: 'RENOMME', fiche_agora: uri('image/png', PNG), fiche_agora_nom: 'a.png' });
    expect((await modifierJeune(id, base({ ficheAgora: null }))).success).toBe(true);
    expect(await ligne(id)).toMatchObject({ fiche_agora: null, fiche_agora_nom: null });
    expect((await lire(id)).status).toBe(404);
  });
});

describe('A1 — restitution des pièces enregistrées AVANT le contrôle', () => {
  const semer = async (valeur: string, nom = 'ancien.html') => {
    const id = await seedJeune('nogent', espace);
    await pool.query('UPDATE jeunes SET fiche_agora = $2, fiche_agora_nom = $3 WHERE id = $1', [id, valeur, nom]);
    return id;
  };

  it.each([
    ['HTML', uri('text/html', HTML), HTML],
    ['HTML avec charset', `data:text/html;charset=utf-8;base64,${Buffer.from(HTML).toString('base64')}`, HTML],
    ['SVG', uri('image/svg+xml', SVG), SVG],
  ])('%s historique : jamais affiché, téléchargement opaque sous bac à sable, donnée non supprimée', async (_nom, valeur, contenu) => {
    const id = await semer(valeur);

    const res = await lire(id);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; /);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(await res.text()).toBe(contenu);
    expect((await ligne(id)).fiche_agora).toBe(valeur);
  });

  it('PDF et image historiques : toujours affichés', async () => {
    for (const [type, octets] of [['application/pdf', PDF], ['image/webp', WEBP]] as const) {
      const res = await lire(await semer(uri(type, octets), 'ancien.pdf'));
      expect(res.headers.get('content-type')).toBe(type);
      expect(res.headers.get('content-disposition')).toMatch(/^inline; /);
    }
  });

  it('valeur indécodable : 422 sans contenu, pas de 500', async () => {
    const res = await lire(await semer('data:text/html,<script>alert(1)</script>'));
    expect(res.status).toBe(422);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('cloisonnement inchangé : la pièce d\'une autre commune reste introuvable', async () => {
    await seedAnimateur({ tenantId: 'autre' });
    const espaceAutre = await seedEspace('autre');
    const id = await seedJeune('autre', espaceAutre);
    await pool.query('UPDATE jeunes SET fiche_agora = $2 WHERE id = $1', [id, uri('application/pdf', PDF)]);
    expect((await lire(id)).status).toBe(404);
  });
});

describe('A2 — fiche, pièce AGORA et contacts : une seule transaction', () => {
  /** Panne PostgreSQL à l'insertion d'un contact dont le nom contient « PANNE ». */
  async function avecPanneContact<T>(fn: () => Promise<T>): Promise<T> {
    await pool.query(`CREATE FUNCTION test_contact_panne() RETURNS trigger AS $$
      BEGIN IF NEW.nom LIKE '%PANNE%' THEN RAISE EXCEPTION 'panne simulée à l''insertion du contact'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER test_contact_panne BEFORE INSERT ON jeunes_contacts FOR EACH ROW EXECUTE FUNCTION test_contact_panne()`);
    try { return await fn(); } finally {
      await pool.query('DROP TRIGGER test_contact_panne ON jeunes_contacts');
      await pool.query('DROP FUNCTION test_contact_panne()');
    }
  }

  it('création réussie : fiche, pièce et contacts présents ; contacts vides ignorés', async () => {
    const res = await creerJeune(base({
      ficheAgora: uri('application/pdf', PDF), ficheAgoraNom: 'a.pdf',
      contacts: [{ nom: 'Parent A', telephone: '0102030405' }, { nom: '  ', telephone: '' }, { telephone: '0607080910' }],
    }));
    expect(res.success).toBe(true);
    expect(await contacts(res.id!)).toEqual([{ nom: 'Parent A', telephone: '0102030405' }, { nom: null, telephone: '0607080910' }]);
    expect((await ligne(res.id!)).fiche_agora_nom).toBe('a.pdf');
  });

  it('création : une panne au 2e contact n\'enregistre NI fiche NI contact, et le signale au monitoring', async () => {
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await avecPanneContact(() => creerJeune(base({ contacts: [{ nom: 'Parent A' }, { nom: 'PANNE' }] })));

    expect(res.success).toBe(false);
    expect(res.id).toBeUndefined();
    // Message destiné à l'utilisateur : pas le texte brut de l'erreur PostgreSQL.
    expect(res.error).toContain('aucune modification');
    expect(res.error).not.toContain('panne simulée');
    expect((await pool.query('SELECT 1 FROM jeunes')).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM jeunes_contacts')).rowCount).toBe(0);
    const evenement = analyserAppelConsoleError(journal.mock.calls.find(a => a[0] === '[creerJeune]') ?? []);
    expect(evenement).toMatchObject({ type: 'Erreur serveur — creerJeune' });
  });

  it('modification : une panne d\'insertion restaure nom, pièce ET anciens contacts', async () => {
    const id = (await creerJeune(base({
      nom: 'ORIGINE', ficheAgora: uri('image/png', PNG), ficheAgoraNom: 'origine.png',
      contacts: [{ nom: 'Ancien contact', telephone: '0102030405' }, { nom: 'Second contact', telephone: '0611223344' }],
    }))).id!;
    const avant = await ligne(id);
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await avecPanneContact(() => modifierJeune(id, base({
      nom: 'MODIFIE', ficheAgora: uri('application/pdf', PDF), ficheAgoraNom: 'nouveau.pdf',
      contacts: [{ nom: 'Nouveau contact' }, { nom: 'PANNE' }],
    })));

    expect(res.success).toBe(false);
    expect(await ligne(id)).toEqual(avant);
    expect(await contacts(id)).toEqual([{ nom: 'Ancien contact', telephone: '0102030405' }, { nom: 'Second contact', telephone: '0611223344' }]);
    expect(analyserAppelConsoleError(journal.mock.calls.find(a => a[0] === '[modifierJeune]') ?? [])).toMatchObject({ type: 'Erreur serveur — modifierJeune' });
  });

  it('modification réussie : contacts remplacés ; clé contacts absente : contacts conservés', async () => {
    const id = (await creerJeune(base({ contacts: [{ nom: 'Ancien' }] }))).id!;
    expect((await modifierJeune(id, base({ contacts: [{ nom: 'Nouveau 1' }, { nom: 'Nouveau 2' }] }))).success).toBe(true);
    expect((await contacts(id)).map(c => c.nom)).toEqual(['Nouveau 1', 'Nouveau 2']);
    expect((await modifierJeune(id, base({ nom: 'SANS CONTACTS' }))).success).toBe(true);
    expect((await contacts(id)).map(c => c.nom)).toEqual(['Nouveau 1', 'Nouveau 2']);
    expect((await modifierJeune(id, base({ contacts: [] }))).success).toBe(true);
    expect(await contacts(id)).toEqual([]);
  });

  it('deux modifications simultanées : le résultat est celui de l\'une OU de l\'autre, jamais un mélange', async () => {
    const id = (await creerJeune(base({ contacts: [{ nom: 'Initial' }] }))).id!;
    const jeuA = ['A1', 'A2', 'A3'], jeuB = ['B1', 'B2'];

    for (let tour = 0; tour < 20; tour++) {
      const [a, b] = await Promise.all([
        modifierJeune(id, base({ nom: 'VERSION-A', contacts: jeuA.map(nom => ({ nom })) })),
        modifierJeune(id, base({ nom: 'VERSION-B', contacts: jeuB.map(nom => ({ nom })) })),
      ]);
      expect([a.success, b.success]).toEqual([true, true]);
      const noms = (await contacts(id)).map(c => c.nom);
      const nom = (await ligne(id)).nom;
      // Le dernier à valider l'emporte EN ENTIER : nom et contacts du même auteur.
      expect([{ nom: 'VERSION-A', noms: jeuA }, { nom: 'VERSION-B', noms: jeuB }], `tour ${tour}`).toContainEqual({ nom, noms });
    }
  });

  it('jeune d\'une autre commune : introuvable, aucune écriture', async () => {
    await seedAnimateur({ tenantId: 'autre' });
    const etranger = await seedJeune('autre', await seedEspace('autre'));
    await pool.query(`INSERT INTO jeunes_contacts (jeune_id, nom) VALUES ($1, 'Contact étranger')`, [etranger]);

    const res = await modifierJeune(etranger, base({ nom: 'DETOURNE', contacts: [] }));

    expect(res).toEqual({ success: false, error: 'Jeune introuvable' });
    expect((await ligne(etranger)).nom).toBe('DURAND');
    expect((await contacts(etranger)).map(c => c.nom)).toEqual(['Contact étranger']);
  });

  it('sans session : refus, aucune écriture', async () => {
    session.token = '';
    expect(await creerJeune(base())).toEqual({ success: false, error: 'Non authentifié' });
    expect((await pool.query('SELECT 1 FROM jeunes')).rowCount).toBe(0);
  });

  it('après une panne, aucune connexion ne reste en transaction ouverte', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const id = (await creerJeune(base({ contacts: [{ nom: 'Ancien' }] }))).id!;
    await avecPanneContact(async () => {
      for (let i = 0; i < 15; i++) await modifierJeune(id, base({ contacts: [{ nom: 'PANNE' }] }));
    });
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%'`);
    expect(rows[0].n).toBe(0);
    expect((await modifierJeune(id, base({ contacts: [{ nom: 'Après la panne' }] }))).success).toBe(true);
  });
});
