import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import pool from '@/lib/db';
import { POST as LOGIN_MOBILE } from '@/app/api/auth/mobile/login/route';
import { GET as GET_JEUNES } from '@/app/api/jeunes/route';
import { GET as GET_FICHE } from '@/app/api/jeunes/[id]/fiche/route';
import { resetDb } from './helpers';
import { seedCompte, seedEspace, MOT_DE_PASSE } from './securite-helpers';
import { seedJeuneComplet, seedContact, SECRETS } from './revue-r4-helpers';

// Le VRAI client de l'application mobile (modules purs, sans React Native).
import { creerApiClient, resoudreBaseUrl, estApiError, type ApiClient } from '../../../mobile/lib/api';
import { GestionnaireSession, type StockageSession } from '../../../mobile/lib/session';
import { connecter, listerJeunes, chargerFicheJeune } from '../../../mobile/lib/services';
import { MESSAGE_FICHE_INTROUVABLE } from '../../../mobile/lib/ficheJeune';
import { chargerRessource } from '../../../mobile/lib/saisie';

/**
 * Revue R4 — contrat mobile ↔ backend de la fiche détaillée, de bout en bout
 * et sans réseau : le `fetch` du client mobile est aiguillé vers les VRAIS
 * handlers (vraie garde de session, vrai PostgreSQL). Même principe que
 * contrat-mobile.test.ts, que ce fichier ne modifie pas.
 *
 * L'aiguillage résout le segment dynamique comme le ferait Next : il extrait
 * `[id]` du chemin réellement demandé par le client et le passe en `params`.
 */
const MOTIF_FICHE = /^\/api\/jeunes\/([^/]+)\/fiche$/;
const appels: Array<{ methode: string; chemin: string; recherche: string; cookie: string | null; autorisation: string | null }> = [];
let ipCourante = '10.4.0.1';
let compteurIp = 1;

async function fetchVersHandlers(url: string, init: RequestInit): Promise<Response> {
  const u = new URL(url);
  const methode = init.method ?? 'GET';
  const headers = new Headers(init.headers);
  appels.push({ methode, chemin: u.pathname, recherche: u.search, cookie: headers.get('cookie'), autorisation: headers.get('authorization') });
  headers.set('x-real-ip', ipCourante);
  const req = new NextRequest(u, { method: methode, headers, body: init.body as BodyInit | undefined });

  if (methode === 'POST' && u.pathname === '/api/auth/mobile/login') return LOGIN_MOBILE(req);
  if (methode === 'GET' && u.pathname === '/api/jeunes') return GET_JEUNES(req);
  const m = MOTIF_FICHE.exec(u.pathname);
  if (methode === 'GET' && m) {
    return GET_FICHE(req, { params: Promise.resolve({ id: decodeURIComponent(m[1]) }) });
  }
  throw new Error(`Route non câblée dans le test de contrat R4 : ${methode} ${u.pathname}`);
}

function stockageMemoire(): StockageSession & { contenu: string | null; ecritures: string[] } {
  return {
    contenu: null,
    ecritures: [],
    async lire() { return this.contenu; },
    async ecrire(v: string) { this.contenu = v; this.ecritures.push(v); },
    async effacer() { this.contenu = null; },
  };
}

function appareil() {
  const stockage = stockageMemoire();
  const session = new GestionnaireSession(stockage);
  const expirations: string[] = [];
  const api: ApiClient = creerApiClient({
    base: resoudreBaseUrl('https://backend.test', true),
    fetchImpl: fetchVersHandlers,
    getToken: () => session.jetonCourant(),
    onUnauthorized: async () => { expirations.push('401'); await session.fermer('expiree'); },
  });
  return { api, session, stockage, expirations };
}

describe('R4 — contrat mobile ↔ backend de la fiche détaillée (vrai client, vrai handler, vrai PostgreSQL)', () => {
  let username: string, compteId: string, espace: string, jeune: string, jeuneB: string;

  beforeEach(async () => {
    await resetDb();
    appels.length = 0;
    ipCourante = `10.4.0.${++compteurIp}`;
    const compte = await seedCompte({ tenantId: 'commune-a', role: 'animateur' });
    username = compte.username;
    compteId = compte.id;
    await seedCompte({ tenantId: 'commune-b', role: 'animateur' });
    espace = await seedEspace('commune-a');
    jeune = await seedJeuneComplet({ tenantId: 'commune-a', espaceId: espace });
    await seedContact(jeune, { nom: 'Parent Fictif', lien: 'Mère', telephone: '01 00 00 00 01' });
    await seedContact(jeune, { nom: null, lien: null, telephone: null });
    jeuneB = await seedJeuneComplet({ tenantId: 'commune-b', espaceId: await seedEspace('commune-b'), nom: 'VOISIN' });
    await seedContact(jeuneB, { nom: 'CONTACT-COMMUNE-B', lien: 'Père', telephone: '01 00 00 00 03' });
  });

  afterAll(async () => { await pool.end(); });

  it('après connexion, le client ouvre la fiche d\'un jeune de la liste et obtient contacts, autorisations, observations', async () => {
    const { api, session, stockage } = appareil();
    await session.ouvrir(await connecter(api, { username, password: MOT_DE_PASSE }));

    const liste = await listerJeunes(api);
    expect(liste.map((j) => j.id)).toEqual([jeune]);

    const fiche = await chargerFicheJeune(api, liste[0].id);
    // Égalité stricte sur l'objet normalisé par le client : la forme du backend
    // est exactement celle que le mobile attend, sans champ en trop.
    expect(fiche).toEqual({
      id: jeune,
      nom: 'TESTELLE',
      prenom: 'Alix',
      dateNaissance: '2012-03-04',
      espaceId: espace,
      secteur: 'Centre',
      // La ligne de contact entièrement vide est écartée par le client.
      contacts: [{ nom: 'Parent Fictif', lien: 'Mère', telephone: '01 00 00 00 01' }],
      autorisations: { sortie: true, photo: false, soinsBenins: true },
      observations: 'Allergie fictive aux arachides.',
    });
    // L'identité de la fiche concorde avec le résumé de la liste (même format de date).
    expect(fiche).toMatchObject({ ...liste[0] });

    const appel = appels.find((a) => MOTIF_FICHE.test(a.chemin))!;
    expect(appel).toMatchObject({ methode: 'GET', chemin: `/api/jeunes/${jeune}/fiche`, recherche: '', cookie: null });
    expect(appel.autorisation).toBe(`Bearer ${session.jetonCourant()}`);

    // Rien de la fiche n'a été écrit dans le stockage de l'appareil : seule la session l'est.
    expect(stockage.ecritures).toHaveLength(1);
    for (const sensible of ['Parent Fictif', '01 00 00 00 01', 'arachides', ...Object.values(SECRETS)]) {
      expect(stockage.contenu).not.toContain(sensible);
    }
  });

  it('jeune d\'une autre commune : le client reçoit « introuvable », exactement comme pour un id inexistant, session intacte', async () => {
    const { api, session, expirations } = appareil();
    await session.ouvrir(await connecter(api, { username, password: MOT_DE_PASSE }));

    const autreCommune = await chargerRessource(() => chargerFicheJeune(api, jeuneB));
    const inexistant = await chargerRessource(() => chargerFicheJeune(api, 'j-inexistant'));
    expect(autreCommune).toEqual({ ok: false, data: null, erreur: MESSAGE_FICHE_INTROUVABLE });
    expect(inexistant).toEqual(autreCommune);

    const erreur = await chargerFicheJeune(api, jeuneB).catch((e) => e);
    expect(estApiError(erreur) && erreur.kind).toBe('not_found');
    expect(session.jetonCourant()).not.toBeNull();
    expect(expirations).toEqual([]);
  });

  it('sans session : aucune requête ne part et aucune donnée n\'est rendue', async () => {
    const { api } = appareil();
    const etat = await chargerRessource(() => chargerFicheJeune(api, jeune));
    expect(etat.ok).toBe(false);
    expect(etat.data).toBeNull();
    expect(appels).toEqual([]);
  });

  it('compte suspendu en cours de session : 401 du backend, session locale purgée, aucune fiche', async () => {
    const { api, session, stockage, expirations } = appareil();
    await session.ouvrir(await connecter(api, { username, password: MOT_DE_PASSE }));
    expect((await chargerFicheJeune(api, jeune)).id).toBe(jeune);

    await pool.query(`UPDATE animateurs SET statut = 'suspendu' WHERE id = $1`, [compteId]);
    const etat = await chargerRessource(() => chargerFicheJeune(api, jeune));
    expect(etat.ok).toBe(false);
    expect(etat.data).toBeNull();
    expect(expirations).toEqual(['401']);
    expect(session.jetonCourant()).toBeNull();
    expect(stockage.contenu).toBeNull();
  });

  it('session révoquée (version incrémentée) : même traitement', async () => {
    const { api, session, expirations } = appareil();
    await session.ouvrir(await connecter(api, { username, password: MOT_DE_PASSE }));
    await pool.query(`UPDATE animateurs SET session_version = session_version + 1 WHERE id = $1`, [compteId]);
    const erreur = await chargerFicheJeune(api, jeune).catch((e) => e);
    expect(estApiError(erreur) && erreur.kind).toBe('unauthorized');
    expect(expirations).toEqual(['401']);
    expect(session.jetonCourant()).toBeNull();
  });
});
