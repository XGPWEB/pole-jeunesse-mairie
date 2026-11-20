import { describe, expect, it, vi } from 'vitest';
import { ApiError, creerApiClient, FetchLike, resoudreBaseUrl } from './api';
import {
  chargerFicheJeune,
  lienTelephone,
  MESSAGE_FICHE_INTROUVABLE,
  normaliserFicheJeune,
} from './ficheJeune';
import { chargerRessource } from './saisie';
import { chargerFicheJeune as chargerFicheJeuneViaServices } from './services';
import { GestionnaireSession, Session, StockageSession } from './session';

const BASE = resoudreBaseUrl('https://api.exemple.test', true);

// Données fabriquées : aucune personne réelle.
const REPONSE = {
  id: 'j-1',
  nom: 'TESTELLE',
  prenom: 'Alix',
  dateNaissance: '2012-03-04',
  espaceId: 'collegiens',
  secteur: 'Centre',
  contacts: [
    { nom: 'Parent Fictif', lien: 'Mère', telephone: '01 00 00 00 01' },
    { nom: 'Tuteur Fictif', lien: 'Tuteur', telephone: '' },
  ],
  autorisations: { sortie: true, photo: false, soinsBenins: true },
  observations: 'Allergie fictive aux arachides.',
};

function reponse(status: number, corps?: unknown): Response {
  return new Response(corps === undefined ? null : JSON.stringify(corps), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stockageMemoire(): StockageSession & { contenu: string | null } {
  return {
    contenu: null,
    async lire() { return this.contenu; },
    async ecrire(v: string) { this.contenu = v; },
    async effacer() { this.contenu = null; },
  };
}

const SESSION: Session = {
  token: 'jeton-test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  user: { id: 'a1', username: 'anim.test', nom: 'Test', prenom: 'Anim', role: 'animateur', espaceAssigne: '', tenantId: 'commune-a' },
};

/** Client branché sur un vrai GestionnaireSession, comme lib/client.ts. */
async function appareil(fetchImpl: FetchLike) {
  const stockage = stockageMemoire();
  const session = new GestionnaireSession(stockage);
  await session.ouvrir(SESSION);
  const api = creerApiClient({
    base: BASE,
    fetchImpl,
    getToken: () => session.jetonCourant(),
    onUnauthorized: () => session.fermer('expiree'),
  });
  return { api, session, stockage };
}

async function erreurDe(promesse: Promise<unknown>): Promise<ApiError> {
  try {
    await promesse;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('La requête aurait dû échouer');
}

describe('normalisation de la fiche détaillée', () => {
  it('reprend exactement les champs attendus', () => {
    expect(normaliserFicheJeune(REPONSE, 'j-1')).toEqual(REPONSE);
  });

  it('ignore tout champ non prévu (adresse, e-mail, fiche Agora…)', () => {
    const fiche = normaliserFicheJeune(
      {
        ...REPONSE,
        adresse: '1 rue Fictive',
        ficheAgora: 'data:application/pdf;base64,AAAA',
        tenantId: 'commune-a',
        contacts: [{ nom: 'Parent Fictif', lien: 'Mère', telephone: '0100000001', email: 'parent@exemple.test', id: 7 }],
      },
      'j-1',
    );
    expect(Object.keys(fiche).sort()).toEqual(
      ['autorisations', 'contacts', 'dateNaissance', 'espaceId', 'id', 'nom', 'observations', 'prenom', 'secteur'],
    );
    expect(fiche.contacts).toEqual([{ nom: 'Parent Fictif', lien: 'Mère', telephone: '0100000001' }]);
  });

  it('champs facultatifs absents ou nuls : chaînes vides, jamais de valeur inventée', () => {
    const fiche = normaliserFicheJeune(
      { id: 'j-1', nom: 'TESTELLE', prenom: 'Alix', dateNaissance: null, espaceId: null, contacts: [], autorisations: { sortie: false, photo: false, soinsBenins: false } },
      'j-1',
    );
    expect(fiche).toMatchObject({ dateNaissance: '', espaceId: '', secteur: '', observations: '', contacts: [] });
  });

  it('écarte une ligne de contact entièrement vide, garde les autres dans l’ordre', () => {
    const fiche = normaliserFicheJeune(
      { ...REPONSE, contacts: [{ nom: '', lien: '', telephone: ' ' }, { nom: 'B', lien: '', telephone: '' }, { nom: 'A', lien: 'Père', telephone: '0100000002' }] },
      'j-1',
    );
    expect(fiche.contacts.map((c) => c.nom)).toEqual(['B', 'A']);
  });

  it('refuse une fiche qui n’est pas celle du jeune demandé', () => {
    expect(() => normaliserFicheJeune(REPONSE, 'j-2')).toThrowError(ApiError);
    expect(() => normaliserFicheJeune({ ...REPONSE, id: undefined }, 'j-1')).toThrowError(ApiError);
  });

  it('refuse une autorisation qui n’est pas un booléen explicite (pas de valeur par défaut)', () => {
    for (const autorisations of [
      undefined,
      null,
      {},
      { sortie: 'true', photo: false, soinsBenins: false },
      { sortie: true, photo: 1, soinsBenins: false },
      { sortie: true, photo: false },
    ]) {
      expect(() => normaliserFicheJeune({ ...REPONSE, autorisations }, 'j-1')).toThrowError(ApiError);
    }
  });

  it('refuse une réponse mal formée (tableau, liste de contacts absente ou invalide)', () => {
    for (const brut of [null, 'x', [REPONSE], { ...REPONSE, contacts: undefined }, { ...REPONSE, contacts: ['x'] }]) {
      const e = (() => {
        try {
          normaliserFicheJeune(brut, 'j-1');
        } catch (err) {
          return err;
        }
        return null;
      })();
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).kind).toBe('invalid_response');
    }
  });
});

describe('chargement de la fiche détaillée', () => {
  it('interroge /api/jeunes/<id>/fiche avec le Bearer, id encodé, sans paramètre de requête', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => reponse(200, { ...REPONSE, id: 'j 1/é' }));
    const { api } = await appareil(fetchImpl);
    const fiche = await chargerFicheJeune(api, 'j 1/é');
    expect(fiche.id).toBe('j 1/é');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.exemple.test/api/jeunes/j%201%2F%C3%A9/fiche');
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer jeton-test');
  });

  it('est exposé par le module de services partagé', () => {
    expect(chargerFicheJeuneViaServices).toBe(chargerFicheJeune);
  });

  it('404 : erreur typée avec un message clair, session conservée', async () => {
    const { api, session } = await appareil(async () => reponse(404, { error: 'Fiche introuvable.' }));
    const e = await erreurDe(chargerFicheJeune(api, 'j-1'));
    expect(e.kind).toBe('not_found');
    expect(e.status).toBe(404);
    expect(e.message).toBe(MESSAGE_FICHE_INTROUVABLE);
    expect(session.jetonCourant()).toBe('jeton-test');

    const etat = await chargerRessource(() => chargerFicheJeune(api, 'j-1'));
    expect(etat).toEqual({ ok: false, data: null, erreur: MESSAGE_FICHE_INTROUVABLE });
  });

  it('401 : la session est purgée (mémoire et stockage) et aucune donnée n’est rendue', async () => {
    // Le corps d'un 401 n'est jamais interprété comme une fiche, même s'il en a la forme.
    const { api, session, stockage } = await appareil(async () => reponse(401, REPONSE));
    expect(stockage.contenu).not.toBeNull();
    const etat = await chargerRessource(() => chargerFicheJeune(api, 'j-1'));
    expect(etat.ok).toBe(false);
    expect(etat.data).toBeNull();
    expect(session.jetonCourant()).toBeNull();
    expect(session.sessionCourante()).toBeNull();
    expect(stockage.contenu).toBeNull();
  });

  it('erreur réseau : état d’erreur explicite, aucune donnée, session conservée', async () => {
    const { api, session } = await appareil(async () => {
      throw new TypeError('Network request failed');
    });
    const e = await erreurDe(chargerFicheJeune(api, 'j-1'));
    expect(e.kind).toBe('network');
    const etat = await chargerRessource(() => chargerFicheJeune(api, 'j-1'));
    expect(etat.ok).toBe(false);
    expect(etat.data).toBeNull();
    expect(etat.ok === false && etat.erreur.length > 0).toBe(true);
    expect(session.jetonCourant()).toBe('jeton-test');
  });

  it('erreur serveur ou réponse 200 mal formée : aucune fiche partielle', async () => {
    const a = await appareil(async () => reponse(500, { error: 'Erreur serveur' }));
    expect((await erreurDe(chargerFicheJeune(a.api, 'j-1'))).kind).toBe('server');
    const b = await appareil(async () => reponse(200, { ...REPONSE, autorisations: null }));
    expect((await erreurDe(chargerFicheJeune(b.api, 'j-1'))).kind).toBe('invalid_response');
    // La fiche d'un autre jeune que celui demandé est rejetée.
    const c = await appareil(async () => reponse(200, { ...REPONSE, id: 'j-autre' }));
    expect((await erreurDe(chargerFicheJeune(c.api, 'j-1'))).kind).toBe('invalid_response');
  });

  it('ne persiste rien : le stockage ne contient que la session, jamais la fiche', async () => {
    const { api, stockage } = await appareil(async () => reponse(200, REPONSE));
    const avant = stockage.contenu;
    await chargerFicheJeune(api, 'j-1');
    expect(stockage.contenu).toBe(avant);
    expect(stockage.contenu).not.toContain('Parent Fictif');
    expect(stockage.contenu).not.toContain('arachides');
  });

  it('identifiant vide : aucune requête', async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const { api } = await appareil(fetchImpl);
    expect((await erreurDe(chargerFicheJeune(api, ''))).kind).toBe('not_found');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('lien téléphonique', () => {
  it('compose un lien tel: à partir d’un numéro lisible', () => {
    expect(lienTelephone('01 00 00 00 01')).toBe('tel:0100000001');
    expect(lienTelephone('+33 1 00 00 00 01')).toBe('tel:+33100000001');
    expect(lienTelephone('01.00.00.00.01')).toBe('tel:0100000001');
  });

  it('ne fabrique pas de lien à partir d’un texte libre ou d’une valeur douteuse', () => {
    expect(lienTelephone('')).toBeNull();
    expect(lienTelephone('voir la mère')).toBeNull();
    expect(lienTelephone('0100000001 (soir)')).toBeNull();
    expect(lienTelephone('01')).toBeNull();
    expect(lienTelephone('0100000001?x=1')).toBeNull();
  });
});
