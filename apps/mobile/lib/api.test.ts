import { describe, expect, it, vi } from 'vitest';
import { ApiError, creerApiClient, FetchLike, messageErreur, resoudreBaseUrl } from './api';

const BASE = resoudreBaseUrl('https://api.exemple.test', true);

function reponse(status: number, corps?: unknown): Response {
  return new Response(corps === undefined ? null : JSON.stringify(corps), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function client(fetchImpl: FetchLike, jeton: string | null = 'jeton-test') {
  const onUnauthorized = vi.fn();
  const api = creerApiClient({ base: BASE, fetchImpl, getToken: () => jeton, onUnauthorized });
  return { api, onUnauthorized };
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

describe("URL de base de l'API", () => {
  it('aucune URL par défaut : une configuration absente est une erreur explicite', () => {
    expect(resoudreBaseUrl(undefined, true).ok).toBe(false);
    expect(resoudreBaseUrl('   ', false).ok).toBe(false);
  });

  it('https exigé en production, http toléré en développement', () => {
    expect(resoudreBaseUrl('http://192.168.1.20:3000', true).ok).toBe(false);
    expect(resoudreBaseUrl('http://192.168.1.20:3000', false)).toEqual({
      ok: true,
      baseUrl: 'http://192.168.1.20:3000',
    });
    expect(resoudreBaseUrl('https://api.exemple.test/', true)).toEqual({
      ok: true,
      baseUrl: 'https://api.exemple.test',
    });
  });

  it('refuse ce qui n’est pas une URL http(s)', () => {
    expect(resoudreBaseUrl('ftp://exemple.test', false).ok).toBe(false);
    expect(resoudreBaseUrl('exemple.test', false).ok).toBe(false);
    expect(resoudreBaseUrl('https://exemple.test/?x=1', true).ok).toBe(false);
  });

  it('sans URL valide, aucune requête ne part', async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const api = creerApiClient({
      base: resoudreBaseUrl('', true),
      fetchImpl,
      getToken: () => 'jeton-test',
      onUnauthorized: vi.fn(),
    });
    const e = await erreurDe(api.request('/api/jeunes'));
    expect(e.kind).toBe('config');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('client API', () => {
  it('ajoute le Bearer, encode la requête et rend le JSON', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => reponse(200, [{ id: 'pt-1' }]));
    const { api } = client(fetchImpl);

    const corps = await api.request('/api/pointages', { query: { date: '2026-10-06', activiteId: undefined } });

    expect(corps).toEqual([{ id: 'pt-1' }]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.exemple.test/api/pointages?date=2026-10-06');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jeton-test');
  });

  it("n'envoie pas de jeton sur une route publique", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => reponse(200, { success: true }));
    const { api } = client(fetchImpl);

    await api.request('/api/auth/forgot-password', { method: 'POST', body: { username: 'x' }, auth: false });

    const init = fetchImpl.mock.calls[0][1];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(init.body).toBe(JSON.stringify({ username: 'x' }));
  });

  it('401 sur une requête authentifiée : session purgée et erreur typée', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => reponse(401, { error: 'Non autorisé' }));
    const { api, onUnauthorized } = client(fetchImpl);

    const e = await erreurDe(api.request('/api/jeunes'));

    expect(e.kind).toBe('unauthorized');
    expect(e.status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('401 sur la connexion : pas de purge, le code applicatif est transmis', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      reponse(401, { error: 'Code requis', code: 'TOTP_REQUIRED' }),
    );
    const { api, onUnauthorized } = client(fetchImpl, null);

    const e = await erreurDe(api.request('/api/auth/mobile/login', { method: 'POST', body: {}, auth: false }));

    expect(e.kind).toBe('unauthorized');
    expect(e.code).toBe('TOTP_REQUIRED');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('sans jeton, une requête protégée ne part pas et déclenche le retour à la connexion', async () => {
    const fetchImpl = vi.fn<FetchLike>();
    const { api, onUnauthorized } = client(fetchImpl, null);

    const e = await erreurDe(api.request('/api/jeunes'));

    expect(e.kind).toBe('unauthorized');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('échec réseau : erreur typée, pas de valeur de retour', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new TypeError('Network request failed');
    });
    const { api, onUnauthorized } = client(fetchImpl);

    const e = await erreurDe(api.request('/api/jeunes'));

    expect(e.kind).toBe('network');
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(messageErreur(e)).toMatch(/injoignable/i);
  });

  it('délai dépassé : la requête est abandonnée', async () => {
    const fetchImpl = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const { api } = client(fetchImpl);

    const e = await erreurDe(api.request('/api/jeunes', { timeoutMs: 20 }));

    expect(e.kind).toBe('timeout');
  });

  it('classe les erreurs HTTP et reprend le message du serveur', async () => {
    const cas: [number, string][] = [
      [400, 'bad_request'],
      [403, 'forbidden'],
      [404, 'not_found'],
      [429, 'rate_limited'],
      [500, 'server'],
    ];
    for (const [status, kind] of cas) {
      const { api } = client(async () => reponse(status, { error: `erreur ${status}` }));
      const e = await erreurDe(api.request('/api/x'));
      expect(e.kind).toBe(kind);
      expect(e.message).toBe(`erreur ${status}`);
    }
  });

  it('un 200 { success: false } est un échec', async () => {
    const { api } = client(async () => reponse(200, { success: false, error: 'Refusé' }));
    const e = await erreurDe(api.request('/api/pointages', { method: 'POST', body: [] }));
    expect(e.kind).toBe('server');
    expect(e.message).toBe('Refusé');
  });

  it('un corps illisible est une erreur, pas un succès vide', async () => {
    const { api } = client(async () => new Response('<html>502</html>', { status: 200 }));
    const e = await erreurDe(api.request('/api/jeunes'));
    expect(e.kind).toBe('invalid_response');
  });
});
