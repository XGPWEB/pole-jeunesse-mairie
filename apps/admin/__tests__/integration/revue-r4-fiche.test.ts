import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import pool from '@/lib/db';
import { GET as GET_FICHE } from '@/app/api/jeunes/[id]/fiche/route';
import { GET as GET_JEUNES } from '@/app/api/jeunes/route';
import { resetDb, seedAnimateur, cookieFor, tokenFor, jsonRequest } from './helpers';
import { billetProvisoire, seedEspace } from './securite-helpers';
import { seedJeuneComplet, seedContact, nombreAudits, SECRETS } from './revue-r4-helpers';

/**
 * Revue R4 — GET /api/jeunes/[id]/fiche : fiche de terrain d'UN jeune.
 * Vrai handler, vraie garde de session, vrai PostgreSQL.
 */

function appeler(id: string, auth: { cookie?: string; bearer?: string; headers?: Record<string, string> } = {}) {
  return GET_FICHE(
    jsonRequest(`/api/jeunes/${encodeURIComponent(id)}/fiche`, auth),
    { params: Promise.resolve({ id }) },
  );
}

/** Statut, en-têtes utiles et corps brut : sert à prouver que deux réponses sont indiscernables. */
async function empreinte(res: Response) {
  return {
    status: res.status,
    cacheControl: res.headers.get('cache-control'),
    contentType: res.headers.get('content-type'),
    corps: await res.text(),
  };
}

describe('R4 — fiche détaillée d\'un jeune', () => {
  let espaceA: string, espaceA2: string, espaceB: string;
  let jeuneA: string, autreJeuneA: string, jeuneB: string;

  beforeEach(async () => {
    await resetDb();
    // Les comptes créent les communes (FK) avant les espaces et les jeunes.
    await seedAnimateur({ tenantId: 'commune-a', role: 'admin' });
    await seedAnimateur({ tenantId: 'commune-b', role: 'admin' });
    espaceA = await seedEspace('commune-a');
    espaceA2 = await seedEspace('commune-a');
    espaceB = await seedEspace('commune-b');

    jeuneA = await seedJeuneComplet({ tenantId: 'commune-a', espaceId: espaceA });
    await seedContact(jeuneA, { nom: 'Parent Fictif', lien: 'Mère', telephone: '01 00 00 00 01' });
    await seedContact(jeuneA, { nom: 'Tuteur Fictif', lien: 'Tuteur', telephone: null });

    autreJeuneA = await seedJeuneComplet({
      tenantId: 'commune-a', espaceId: espaceA2, nom: 'AUTRE', prenom: 'Sacha',
      observations: 'OBSERVATION-AUTRE-JEUNE',
    });
    await seedContact(autreJeuneA, { nom: 'CONTACT-AUTRE-JEUNE', lien: 'Père', telephone: '01 00 00 00 02' });

    jeuneB = await seedJeuneComplet({
      tenantId: 'commune-b', espaceId: espaceB, nom: 'VOISIN', prenom: 'Noa',
      observations: 'OBSERVATION-COMMUNE-B',
    });
    await seedContact(jeuneB, { nom: 'CONTACT-COMMUNE-B', lien: 'Mère', telephone: '01 00 00 00 03' });
  });

  afterAll(async () => { await pool.end(); });

  it('anonyme : 401, aucune donnée, pas de mise en cache', async () => {
    const res = await appeler(jeuneA);
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const texte = await res.text();
    expect(JSON.parse(texte)).toEqual({ error: 'Non autorisé' });
    expect(texte).not.toContain('Parent Fictif');
  });

  it('jeton altéré, billet TOTP provisoire (cookie comme Bearer) : 401', async () => {
    const animateur = await seedAnimateur({ tenantId: 'commune-a', role: 'animateur' });
    const jeton = await tokenFor(animateur);
    const billet = await billetProvisoire(animateur);
    for (const auth of [
      { bearer: `${jeton.slice(0, -2)}xx` },
      { bearer: billet },
      { cookie: `pj_token=${billet}` },
      // Un Bearer invalide n'est pas rattrapé par un cookie valide.
      { bearer: 'pas-un-jwt', cookie: await cookieFor(animateur) },
    ]) {
      const res = await appeler(jeuneA, auth);
      expect(res.status).toBe(401);
      expect(await res.text()).not.toContain('Parent Fictif');
    }
  });

  it('compte suspendu puis session révoquée : 401 avec un jeton pourtant bien signé', async () => {
    const animateur = await seedAnimateur({ tenantId: 'commune-a', role: 'animateur' });
    const bearer = await tokenFor(animateur);
    expect((await appeler(jeuneA, { bearer })).status).toBe(200);

    await pool.query(`UPDATE animateurs SET statut = 'suspendu' WHERE id = $1`, [animateur.id]);
    const suspendu = await appeler(jeuneA, { bearer });
    expect(suspendu.status).toBe(401);
    expect(await suspendu.text()).not.toContain('Parent Fictif');

    await pool.query(
      `UPDATE animateurs SET statut = 'actif', session_version = session_version + 1 WHERE id = $1`,
      [animateur.id],
    );
    const revoque = await appeler(jeuneA, { bearer });
    expect(revoque.status).toBe(401);
    expect(await revoque.text()).not.toContain('Parent Fictif');
  });

  it('animateur de la commune A (Bearer) : contenu exact, contacts du seul jeune demandé, no-store', async () => {
    const animateur = await seedAnimateur({ tenantId: 'commune-a', role: 'animateur' });
    const res = await appeler(jeuneA, { bearer: await tokenFor(animateur) });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    // Aucune ouverture CORS sur des données sensibles.
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const texte = await res.text();
    // toEqual sur l'objet entier : tout champ supplémentaire ferait échouer le test.
    expect(JSON.parse(texte)).toEqual({
      id: jeuneA,
      nom: 'TESTELLE',
      prenom: 'Alix',
      dateNaissance: '2012-03-04',
      espaceId: espaceA,
      secteur: 'Centre',
      contacts: [
        { nom: 'Parent Fictif', lien: 'Mère', telephone: '01 00 00 00 01' },
        { nom: 'Tuteur Fictif', lien: 'Tuteur', telephone: '' },
      ],
      autorisations: { sortie: true, photo: false, soinsBenins: true },
      observations: 'Allergie fictive aux arachides.',
    });
    expect(texte).not.toContain('CONTACT-AUTRE-JEUNE');
    expect(texte).not.toContain('CONTACT-COMMUNE-B');
    expect(texte).not.toContain('OBSERVATION-AUTRE-JEUNE');
  });

  it('champs non exposés : aucune valeur ni clé de fiche Agora, adresse, e-mail, établissement, classe, sexe, commune', async () => {
    const animateur = await seedAnimateur({ tenantId: 'commune-a', role: 'animateur' });
    const res = await appeler(jeuneA, { bearer: await tokenFor(animateur) });
    const texte = await res.text();
    for (const secret of Object.values(SECRETS)) expect(texte).not.toContain(secret);
    expect(texte).not.toContain('U0VDUkVU');
    expect(texte.toLowerCase()).not.toMatch(/agora|adresse|email|etablissement|classe|sexe|tenant|created/);
    const corps = JSON.parse(texte) as { contacts: Record<string, unknown>[] };
    for (const c of corps.contacts) expect(Object.keys(c).sort()).toEqual(['lien', 'nom', 'telephone']);
  });

  it('session web par cookie acceptée, et admin de la commune : même fiche', async () => {
    const animateur = await seedAnimateur({ tenantId: 'commune-a', role: 'animateur' });
    const admin = await seedAnimateur({ tenantId: 'commune-a', role: 'admin' });
    const parCookie = await appeler(jeuneA, { cookie: await cookieFor(animateur) });
    const parAdmin = await appeler(jeuneA, { bearer: await tokenFor(admin) });
    expect(parCookie.status).toBe(200);
    expect(parAdmin.status).toBe(200);
    expect(await parAdmin.json()).toEqual(await parCookie.json());
  });

  it('jeune de la commune B : 404 strictement identique à un identifiant inexistant', async () => {
    const animateur = await seedAnimateur({ tenantId: 'commune-a', role: 'animateur' });
    const bearer = await tokenFor(animateur);
    const autreCommune = await empreinte(await appeler(jeuneB, { bearer }));
    const inexistant = await empreinte(await appeler('j-00000000-0000-0000-0000-000000000000', { bearer }));
    expect(autreCommune.status).toBe(404);
    expect(autreCommune).toEqual(inexistant);
    expect(autreCommune.cacheControl).toContain('no-store');
    expect(autreCommune.corps).not.toContain('VOISIN');
    expect(autreCommune.corps).not.toContain('CONTACT-COMMUNE-B');
    expect(autreCommune.corps).not.toContain('OBSERVATION-COMMUNE-B');
    expect(autreCommune.corps).not.toContain(jeuneB);

    // Et l'animateur de B, lui, lit bien son jeune (le 404 vient du cloisonnement, pas d'un jeu de données cassé).
    const animateurB = await seedAnimateur({ tenantId: 'commune-b', role: 'animateur' });
    const chezLui = await appeler(jeuneB, { bearer: await tokenFor(animateurB) });
    expect(chezLui.status).toBe(200);
    expect((await chezLui.json()).contacts).toEqual([{ nom: 'CONTACT-COMMUNE-B', lien: 'Mère', telephone: '01 00 00 00 03' }]);
  });

  it('le tenant vient de la base : en-tête x-tenant-id et commune inscrite dans le jeton sont ignorés', async () => {
    const animateur = await seedAnimateur({ tenantId: 'commune-a', role: 'animateur' });
    const parEnTete = await appeler(jeuneB, { bearer: await tokenFor(animateur), headers: { 'x-tenant-id': 'commune-b' } });
    expect(parEnTete.status).toBe(404);
    // Jeton bien signé qui PRÉTEND appartenir à la commune B.
    const jetonMenteur = await tokenFor({ ...animateur, tenant_id: 'commune-b' });
    const parJeton = await appeler(jeuneB, { bearer: jetonMenteur });
    expect(parJeton.status).toBe(404);
    expect(await parJeton.text()).not.toContain('CONTACT-COMMUNE-B');
  });

  it('périmètre animateur = règle du web : commune entière, sans restriction par espace assigné', async () => {
    // Constat : la fiche web d'un animateur ne filtre que par commune. La route
    // applique la même règle ; ce test la fige pour qu'un changement soit délibéré.
    const animateur = await seedAnimateur({ tenantId: 'commune-a', role: 'animateur', espaceAssigne: espaceA });
    const res = await appeler(autreJeuneA, { bearer: await tokenFor(animateur) });
    expect(res.status).toBe(200);
    const corps = await res.json();
    expect(corps.espaceId).toBe(espaceA2);
    expect(corps.contacts).toEqual([{ nom: 'CONTACT-AUTRE-JEUNE', lien: 'Père', telephone: '01 00 00 00 02' }]);
  });

  it('valeurs absentes en base : autorisations à false, chaînes vides, date nulle, aucun contact', async () => {
    const animateur = await seedAnimateur({ tenantId: 'commune-a', role: 'animateur' });
    const nu = await seedJeuneComplet({
      tenantId: 'commune-a', dateNaissance: null, secteur: null, observations: null,
      autorisationSortie: null, autorisationPhoto: null, autorisationSoinsBenins: null,
    });
    const res = await appeler(nu, { bearer: await tokenFor(animateur) });
    expect(await res.json()).toEqual({
      id: nu, nom: 'TESTELLE', prenom: 'Alix', dateNaissance: null, espaceId: null, secteur: '',
      contacts: [], autorisations: { sortie: false, photo: false, soinsBenins: false }, observations: '',
    });
  });

  it('identifiants hostiles : 404 générique, aucune erreur serveur', async () => {
    const animateur = await seedAnimateur({ tenantId: 'commune-a', role: 'animateur' });
    const bearer = await tokenFor(animateur);
    for (const id of ["' OR '1'='1", '%', '../fiche-agora', 'x'.repeat(500), `${jeuneA} `]) {
      const res = await appeler(id, { bearer });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Fiche introuvable.' });
    }
  });

  it('la liste GET /api/jeunes garde sa forme de résumé : ni contacts, ni autorisations, ni observations', async () => {
    const animateur = await seedAnimateur({ tenantId: 'commune-a', role: 'animateur' });
    const res = await GET_JEUNES(jsonRequest('/api/jeunes', { bearer: await tokenFor(animateur) }));
    const lignes = await res.json() as Record<string, unknown>[];
    expect(lignes).toHaveLength(2);
    for (const l of lignes) {
      expect(Object.keys(l).sort()).toEqual(['dateNaissance', 'espaceId', 'id', 'nom', 'prenom', 'secteur']);
    }
  });

  it('journalisation : aucune donnée personnelle dans les logs, et aucune entrée d\'audit de consultation (le dépôt n\'en écrit pas)', async () => {
    const animateur = await seedAnimateur({ tenantId: 'commune-a', role: 'animateur' });
    const bearer = await tokenFor(animateur);
    const espions = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
    ];
    try {
      const avant = await nombreAudits();
      await appeler(jeuneA, { bearer });
      await appeler(jeuneB, { bearer });
      await appeler(jeuneA);
      const sorties = espions.flatMap((e) => e.mock.calls).map((args) => args.map(String).join(' ')).join('\n');
      for (const interdit of ['Parent Fictif', 'TESTELLE', '01 00 00 00 01', 'arachides', jeuneA, jeuneB]) {
        expect(sorties).not.toContain(interdit);
      }
      expect(await nombreAudits()).toBe(avant);
    } finally {
      for (const e of espions) e.mockRestore();
    }
  });
});
