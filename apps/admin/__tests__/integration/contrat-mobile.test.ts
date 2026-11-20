import { vi, describe, it, expect, beforeEach, afterAll } from 'vitest';

// revalidatePath exige le contexte d'une vraie requête Next (absent ici).
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { NextRequest } from 'next/server';
import pool from '@/lib/db';
import { POST as LOGIN_MOBILE } from '@/app/api/auth/mobile/login/route';
import { POST as LOGOUT } from '@/app/api/auth/logout/route';
import { POST as FORGOT } from '@/app/api/auth/forgot-password/route';
import { GET as ME } from '@/app/api/animateurs/me/route';
import { GET as GET_JEUNES } from '@/app/api/jeunes/route';
import { GET as GET_ACTIVITES } from '@/app/api/activites/route';
import { GET as GET_POINTAGES, POST as POST_POINTAGES, DELETE as DELETE_POINTAGES } from '@/app/api/pointages/route';
import { GET as GET_PRESENCES } from '@/app/api/presences/route';
import { resetDb } from './helpers';
import { seedCompte, seedEspace, seedJeune, seedActivite, MOT_DE_PASSE } from './securite-helpers';

// Le VRAI client de l'application mobile (modules purs, sans React Native).
import { creerApiClient, resoudreBaseUrl, estApiError, type ApiClient } from '../../../mobile/lib/api';
import { GestionnaireSession, type StockageSession } from '../../../mobile/lib/session';
import {
  connecter, validerSession, deconnecterServeur, demanderReinitialisation,
  listerJeunes, listerActivites, chargerPointages, historiqueJeune, creerPointages, supprimerPointage,
} from '../../../mobile/lib/services';
import { construireRegistre, pointageASupprimer } from '../../../mobile/lib/pointages';

/**
 * Contrat mobile ↔ backend, vérifié de bout en bout sans réseau : le `fetch`
 * du client mobile est remplacé par un aiguillage vers les VRAIS handlers de
 * route, eux-mêmes branchés sur le vrai PostgreSQL de test.
 *
 * Les deux moitiés ont été écrites séparément (apps/mobile et apps/admin) : ce
 * test échoue dès qu'un nom de champ, un code d'erreur ou une forme de requête
 * diverge entre elles — ce que ni les tests mobiles (fetch simulé) ni les
 * tests backend (requêtes écrites à la main) ne peuvent voir.
 */
type Handler = (req: NextRequest) => Promise<Response>;
const ROUTES: Record<string, Handler> = {
  'POST /api/auth/mobile/login': LOGIN_MOBILE,
  'POST /api/auth/logout': LOGOUT,
  'POST /api/auth/forgot-password': FORGOT,
  'GET /api/animateurs/me': ME,
  'GET /api/jeunes': GET_JEUNES,
  'GET /api/activites': GET_ACTIVITES,
  'GET /api/pointages': GET_POINTAGES,
  'POST /api/pointages': POST_POINTAGES,
  'DELETE /api/pointages': DELETE_POINTAGES,
  'GET /api/presences': GET_PRESENCES,
};

const appels: Array<{ cle: string; url: string; cookie: string | null }> = [];

async function fetchVersHandlers(url: string, init: RequestInit): Promise<Response> {
  const u = new URL(url);
  const cle = `${init.method ?? 'GET'} ${u.pathname}`;
  const handler = ROUTES[cle];
  if (!handler) throw new Error(`Route non câblée dans le test de contrat : ${cle}`);
  const headers = new Headers(init.headers);
  appels.push({ cle, url, cookie: headers.get('cookie') });
  // Adresse IP distincte par test : les compteurs anti-force-brute sont par IP.
  headers.set('x-real-ip', ipCourante);
  return handler(new NextRequest(u, { method: init.method ?? 'GET', headers, body: init.body as BodyInit | undefined }));
}

let ipCourante = '10.0.0.1';
let compteurIp = 1;

function stockageMemoire(): StockageSession & { contenu: string | null } {
  return {
    contenu: null,
    async lire() { return this.contenu; },
    async ecrire(v: string) { this.contenu = v; },
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

describe('contrat mobile ↔ backend (vrai client mobile, vrais handlers, vrai PostgreSQL)', () => {
  let espace: string, jeune: string, activite: string, username: string;

  beforeEach(async () => {
    await resetDb();
    appels.length = 0;
    ipCourante = `10.0.0.${++compteurIp}`;
    const compte = await seedCompte({ tenantId: 'commune-a', role: 'animateur' });
    username = compte.username;
    espace = await seedEspace('commune-a');
    jeune = await seedJeune('commune-a', espace);
    activite = await seedActivite('commune-a', espace);
  });

  afterAll(async () => { await pool.end(); });

  it('connexion : la réponse du backend est acceptée par le client, sans cookie, puis validée par /me', async () => {
    const { api, session } = appareil();
    const s = await connecter(api, { username, password: MOT_DE_PASSE });
    await session.ouvrir(s);

    expect(s.token.split('.')).toHaveLength(3);
    expect(Number.isNaN(Date.parse(s.expiresAt))).toBe(false);
    expect(s.user).toMatchObject({ username, role: 'animateur', tenantId: 'commune-a' });

    const profil = await validerSession(api);
    expect(profil).toMatchObject({ id: s.user.id, username, role: 'animateur' });
    // Le mobile s'authentifie par Bearer : il n'envoie jamais de cookie.
    expect(appels.every(a => a.cookie === null)).toBe(true);
  });

  it('identifiants erronés : erreur typée, session non ouverte, aucun signal « session expirée »', async () => {
    const { api, session, expirations } = appareil();
    const erreur = await connecter(api, { username, password: 'mauvais-mot-de-passe' }).catch(e => e);
    expect(estApiError(erreur)).toBe(true);
    expect(erreur.code).toBe('INVALID_CREDENTIALS');
    expect(session.jetonCourant()).toBeNull();
    expect(expirations).toEqual([]);
  });

  it('sans session, les lectures protégées échouent en 401 et ne renvoient aucune donnée', async () => {
    const { api } = appareil();
    const erreur = await listerJeunes(api).catch(e => e);
    expect(estApiError(erreur)).toBe(true);
    expect(erreur.kind).toBe('unauthorized');
  });

  it('présence d\'accueil : enregistrée, relue avec son id serveur, supprimée par cet id seul', async () => {
    const { api, session } = appareil();
    await session.ouvrir(await connecter(api, { username, password: MOT_DE_PASSE }));

    const jeunes = await listerJeunes(api);
    expect(jeunes.map(j => j.id)).toEqual([jeune]);
    expect((await listerActivites(api)).map(a => a.id)).toEqual([activite]);

    const date = '2026-10-06';
    // Le même jour : une arrivée à l'accueil ET une ABSENCE à une activité.
    await creerPointages(api, [
      { jeuneId: jeune, espaceId: espace, date, heureArrivee: '14:05', type: 'accueil-libre', activiteId: null, manuel: false, animateur: username },
      { jeuneId: jeune, activiteId: activite, espaceId: espace, date, statut: 'absent' },
    ]);

    const relus = await chargerPointages(api, { date });
    expect(relus).toHaveLength(2);
    const accueil = relus.find(p => p.activiteId === null)!;
    const absence = relus.find(p => p.activiteId === activite)!;
    // Constat 23 : l'absence reste une absence après synchronisation.
    expect(absence.statut).toBe('absent');
    expect(accueil.statut).toBe('present');
    expect(accueil.date).toBe(date);

    // Constat 14 : retirer la présence d'accueil ne touche pas le pointage d'activité.
    const registre = construireRegistre(relus, { type: 'accueil' });
    const idASupprimer = pointageASupprimer(registre, jeune, date);
    expect(idASupprimer).toBe(accueil.id);
    expect(await supprimerPointage(api, idASupprimer!)).toBe(true);

    const suppression = appels.filter(a => a.cle === 'DELETE /api/pointages');
    expect(suppression).toHaveLength(1);
    expect(new URL(suppression[0].url).search).toBe(`?id=${encodeURIComponent(accueil.id)}`);

    const apres = await chargerPointages(api, { date });
    expect(apres.map(p => p.id)).toEqual([absence.id]);
    const enBase = await pool.query(`SELECT id, statut FROM pointages WHERE tenant_id = 'commune-a'`);
    expect(enBase.rows).toEqual([{ id: absence.id, statut: 'absent' }]);

    // Seconde suppression du même id : le client la traite comme « déjà absent », sans erreur.
    expect(await supprimerPointage(api, accueil.id)).toBe(false);

    // Historique du jeune (écran des fiches) : même forme, lue par /api/presences.
    const historique = await historiqueJeune(api, jeune);
    expect(historique.map(p => p.id)).toEqual([absence.id]);
  });

  it('entrée manuelle : acceptée par le backend et relue avec nom et prénom', async () => {
    const { api, session } = appareil();
    await session.ouvrir(await connecter(api, { username, password: MOT_DE_PASSE }));
    await creerPointages(api, [{
      jeuneId: null, espaceId: espace, date: '2026-10-06', heureArrivee: '15:00', type: 'accueil-libre',
      activiteId: null, manuel: true, animateur: username, prenomManuel: 'Camille', nomManuel: 'Visiteur',
    }]);
    const relus = await chargerPointages(api, { date: '2026-10-06' });
    expect(relus).toHaveLength(1);
    expect(relus[0]).toMatchObject({ jeuneId: null, manuel: true, prenomManuel: 'Camille', nomManuel: 'Visiteur', statut: 'present' });
  });

  it('un pointage visant un jeune d\'une autre commune est refusé et rien n\'est écrit', async () => {
    const { api, session } = appareil();
    await session.ouvrir(await connecter(api, { username, password: MOT_DE_PASSE }));
    const espaceB = await seedEspace('commune-b');
    const jeuneB = await seedJeune('commune-b', espaceB);

    const erreur = await creerPointages(api, [
      { jeuneId: jeuneB, espaceId: espace, date: '2026-10-06', heureArrivee: '14:00', type: 'accueil-libre', activiteId: null, manuel: false, animateur: username },
    ]).catch(e => e);
    expect(estApiError(erreur)).toBe(true);
    expect((await pool.query('SELECT 1 FROM pointages')).rowCount).toBe(0);
  });

  it('déconnexion : le jeton est révoqué côté serveur ; la requête suivante purge la session locale', async () => {
    const { api, session, stockage, expirations } = appareil();
    await session.ouvrir(await connecter(api, { username, password: MOT_DE_PASSE }));
    expect(stockage.contenu).not.toBeNull();

    // Un second appareil garde une copie du même jeton.
    const copie = appareil();
    await copie.session.ouvrir(session.sessionCourante()!);

    await deconnecterServeur(api);
    await session.fermer('deconnexion');
    expect(stockage.contenu).toBeNull();

    const erreur = await listerJeunes(copie.api).catch(e => e);
    expect(estApiError(erreur) && erreur.kind).toBe('unauthorized');
    expect(copie.expirations).toEqual(['401']);
    expect(copie.session.jetonCourant()).toBeNull();
    expect(copie.stockage.contenu).toBeNull();
    expect(expirations).toEqual([]);
  });

  it('mot de passe oublié : accepté pour un compte connu comme inconnu, mot de passe inchangé', async () => {
    const { api } = appareil();
    await expect(demanderReinitialisation(api, username)).resolves.toBeUndefined();
    await expect(demanderReinitialisation(api, 'compte.inexistant')).resolves.toBeUndefined();
    await expect(connecter(api, { username, password: MOT_DE_PASSE })).resolves.toBeTruthy();
  });
});
