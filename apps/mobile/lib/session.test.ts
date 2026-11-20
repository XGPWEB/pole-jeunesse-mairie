import { describe, expect, it, vi } from 'vitest';
import { ApiError, creerApiClient, FetchLike, resoudreBaseUrl } from './api';
import { chargerRessource, executerEnvoi, saisieInitiale } from './saisie';
import { connecter, creerPointages, EntreeArrivee, listerJeunes, supprimerPointage } from './services';
import { analyserReponseLogin, GestionnaireSession, Session, StockageSession } from './session';

const BASE = resoudreBaseUrl('https://api.exemple.test', true);

function stockageMemoire(initial: string | null = null) {
  let valeur = initial;
  const stockage: StockageSession = {
    lire: async () => valeur,
    ecrire: async (v) => {
      valeur = v;
    },
    effacer: async () => {
      valeur = null;
    },
  };
  return { stockage, contenu: () => valeur };
}

function sessionValide(expiresAt = '2026-11-05T10:00:00.000Z'): Session {
  return {
    token: 'jeton-test',
    expiresAt,
    user: {
      id: 'anim-1',
      username: 'animateur.test',
      nom: 'TEST',
      prenom: 'Anim',
      role: 'animateur',
      espaceAssigne: 'Collégiens',
      tenantId: 'tenant-test',
    },
  };
}

function reponse(status: number, corps?: unknown): Response {
  return new Response(corps === undefined ? null : JSON.stringify(corps), { status });
}

/** Client branché sur un gestionnaire de session, comme dans lib/client.ts. */
function monter(fetchImpl: FetchLike, session: GestionnaireSession) {
  return creerApiClient({
    base: BASE,
    fetchImpl,
    getToken: () => session.jetonCourant(),
    onUnauthorized: () => session.fermer('expiree'),
  });
}

const MAINTENANT = new Date('2026-10-06T08:00:00Z');

describe('session', () => {
  it('401 → session purgée (mémoire et stockage), aucune donnée de repli', async () => {
    const { stockage, contenu } = stockageMemoire();
    const session = new GestionnaireSession(stockage);
    await session.ouvrir(sessionValide());
    const ecouteur = vi.fn();
    session.abonner(ecouteur);
    const api = monter(async () => reponse(401, { error: 'Non autorisé' }), session);

    const resultat = await chargerRessource(() => listerJeunes(api));

    // Aucune liste, pas même vide : l'écran n'a rien à présenter comme réel.
    expect(resultat.ok).toBe(false);
    expect(resultat.data).toBeNull();
    expect(resultat.ok ? '' : resultat.erreur).toMatch(/session a expiré/i);
    expect(session.jetonCourant()).toBeNull();
    expect(contenu()).toBeNull();
    expect(ecouteur).toHaveBeenCalledWith(null, 'expiree');
  });

  it('après la purge, les requêtes suivantes ne partent plus', async () => {
    const { stockage } = stockageMemoire();
    const session = new GestionnaireSession(stockage);
    await session.ouvrir(sessionValide());
    const fetchImpl = vi.fn<FetchLike>(async () => reponse(401));
    const api = monter(fetchImpl, session);

    await chargerRessource(() => listerJeunes(api));
    await chargerRessource(() => listerJeunes(api));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('erreur réseau : pas de données de repli non plus, mais la session est conservée', async () => {
    const { stockage, contenu } = stockageMemoire();
    const session = new GestionnaireSession(stockage);
    await session.ouvrir(sessionValide());
    const api = monter(async () => {
      throw new TypeError('Network request failed');
    }, session);

    const resultat = await chargerRessource(() => listerJeunes(api));

    expect(resultat.data).toBeNull();
    expect(session.jetonCourant()).toBe('jeton-test');
    expect(contenu()).not.toBeNull();
  });

  it('restauration : une session valide est relue, une session expirée ou illisible est purgée', async () => {
    const valide = stockageMemoire(JSON.stringify(sessionValide()));
    const s1 = new GestionnaireSession(valide.stockage);
    expect((await s1.restaurer(MAINTENANT))?.user.username).toBe('animateur.test');
    expect(s1.jetonCourant()).toBe('jeton-test');

    const expiree = stockageMemoire(JSON.stringify(sessionValide('2026-10-06T07:59:59.000Z')));
    const s2 = new GestionnaireSession(expiree.stockage);
    expect(await s2.restaurer(MAINTENANT)).toBeNull();
    expect(s2.jetonCourant()).toBeNull();
    expect(expiree.contenu()).toBeNull();

    const corrompue = stockageMemoire('{"token":');
    const s3 = new GestionnaireSession(corrompue.stockage);
    expect(await s3.restaurer(MAINTENANT)).toBeNull();
    expect(corrompue.contenu()).toBeNull();

    // Ancien format local sans jeton serveur : refusé.
    const ancienne = stockageMemoire(JSON.stringify({ username: 'x', nom: 'Y', prenom: 'Z', espace: 'Tous' }));
    const s4 = new GestionnaireSession(ancienne.stockage);
    expect(await s4.restaurer(MAINTENANT)).toBeNull();
    expect(ancienne.contenu()).toBeNull();
  });

  it('déconnexion : purge locale même si le stockage échoue', async () => {
    const session = new GestionnaireSession({
      lire: async () => null,
      ecrire: async () => undefined,
      effacer: async () => {
        throw new Error('stockage indisponible');
      },
    });
    await session.ouvrir(sessionValide());
    await session.fermer('deconnexion');
    expect(session.jetonCourant()).toBeNull();
  });

  it('une réponse de connexion incomplète est refusée', () => {
    expect(() => analyserReponseLogin({ token: 'x' })).toThrow(ApiError);
    expect(() => analyserReponseLogin({ ...sessionValide(), expiresAt: 'demain' })).toThrow(ApiError);
    expect(analyserReponseLogin(sessionValide()).user.tenantId).toBe('tenant-test');
  });
});

describe('appels backend', () => {
  it('connexion : POST /api/auth/mobile/login sans jeton, code TOTP transmis si fourni', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => reponse(200, sessionValide()));
    const api = monter(fetchImpl, new GestionnaireSession(stockageMemoire().stockage));

    const ouverte = await connecter(api, { username: ' animateur.test ', password: 'secret-de-test', totpCode: '123456' });

    expect(ouverte.token).toBe('jeton-test');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.exemple.test/api/auth/mobile/login');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(String(init.body))).toEqual({
      username: 'animateur.test',
      password: 'secret-de-test',
      totpCode: '123456',
    });
  });

  it('suppression : DELETE /api/pointages?id=<id> et rien d’autre', async () => {
    const { stockage } = stockageMemoire();
    const session = new GestionnaireSession(stockage);
    await session.ouvrir(sessionValide());
    const fetchImpl = vi.fn<FetchLike>(async () => reponse(200, { success: true, deleted: 1 }));
    const api = monter(fetchImpl, session);

    expect(await supprimerPointage(api, 'pt-accueil')).toBe(true);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.exemple.test/api/pointages?id=pt-accueil');
    expect(url).not.toMatch(/jeuneId|date/);
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });

  it('suppression : 404 = déjà absent (false) ; toute autre erreur est levée', async () => {
    const { stockage } = stockageMemoire();
    const session = new GestionnaireSession(stockage);
    await session.ouvrir(sessionValide());

    expect(await supprimerPointage(monter(async () => reponse(404, { error: 'Introuvable' }), session), 'pt-x')).toBe(false);
    await expect(
      supprimerPointage(monter(async () => reponse(500, { error: 'Erreur serveur' }), session), 'pt-x'),
    ).rejects.toMatchObject({ kind: 'server' });
  });
});

describe('enregistrement : la saisie survit aux échecs', () => {
  const entree: EntreeArrivee = {
    jeuneId: 'j-1',
    espaceId: 'collegiens',
    date: '2026-10-06',
    heureArrivee: '14:00',
    type: 'accueil-libre',
    activiteId: null,
    manuel: false,
    animateur: 'animateur.test',
  };

  async function sessionOuverte() {
    const session = new GestionnaireSession(stockageMemoire().stockage);
    await session.ouvrir(sessionValide());
    return session;
  }

  it('échec réseau → brouillon intact, erreur visible, aucune confirmation', async () => {
    const api = monter(async () => {
      throw new TypeError('Network request failed');
    }, await sessionOuverte());
    const depart = saisieInitiale(['j-1', 'manuel:paul|durand']);

    const suivant = await executerEnvoi(depart, async (brouillon) => {
      await creerPointages(api, [entree]);
      return { brouillonRestant: [], confirmation: `${brouillon.length} présences enregistrées` };
    });

    expect(suivant.brouillon).toEqual(['j-1', 'manuel:paul|durand']);
    expect(suivant.erreur).toMatch(/injoignable/i);
    expect(suivant.confirmation).toBeNull();
    expect(suivant.enCours).toBe(false);
  });

  it('erreur serveur 500 → même garantie', async () => {
    const api = monter(async () => reponse(500, { success: false, error: 'Erreur serveur' }), await sessionOuverte());
    const suivant = await executerEnvoi(saisieInitiale(['j-1']), async () => {
      await creerPointages(api, [entree]);
      return { brouillonRestant: [], confirmation: 'ok' };
    });
    expect(suivant.brouillon).toEqual(['j-1']);
    expect(suivant.erreur).toBe('Erreur serveur');
    expect(suivant.confirmation).toBeNull();
  });

  it('succès → confirmation seulement après la réponse du serveur, brouillon soldé', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => reponse(200, { success: true, count: 1 }));
    const api = monter(fetchImpl, await sessionOuverte());

    const suivant = await executerEnvoi(saisieInitiale(['j-1']), async () => {
      await creerPointages(api, [entree]);
      return { brouillonRestant: [], confirmation: '1 présence enregistrée' };
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1].body))).toEqual([entree]);
    expect(suivant).toEqual({ brouillon: [], enCours: false, erreur: null, confirmation: '1 présence enregistrée' });
  });
});
