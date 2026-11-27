import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';
import { proxy as middleware } from '@/proxy';

/**
 * Le middleware est la première barrière (runtime Edge, sans accès à la base).
 * On vérifie ce qu'il DOIT refuser seul : absence de jeton, signature
 * invalide, et surtout les jetons typés (billet 2FA provisoire), qu'il laissait
 * passer avant la remédiation.
 */
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

async function jeton(claims: Record<string, unknown>, secret = SECRET): Promise<string> {
  return new SignJWT({ id: 'u1', username: 'u', role: 'admin', espaceAssigne: 'x', tenant_id: 'nogent', auth_time: Math.floor(Date.now() / 1000), ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(secret);
}

function requete(chemin: string, opts: { cookie?: string; bearer?: string } = {}): NextRequest {
  const headers = new Headers();
  if (opts.cookie) headers.set('cookie', `pj_token=${opts.cookie}`);
  if (opts.bearer) headers.set('authorization', `Bearer ${opts.bearer}`);
  return new NextRequest(new URL(chemin, 'http://localhost:3000'), { headers });
}

const laissePasser = (res: Response) => res.headers.get('x-middleware-next') === '1';

describe('middleware — API protégée', () => {
  it('refuse les mutations venant d’une autre origine, y compris sous /api/auth/', async () => {
    for (const chemin of ['/api/animateurs/profil', '/api/auth/login']) {
      const req = new NextRequest(new URL(chemin, 'http://localhost:3000'), {
        method: 'POST', headers: { origin: 'https://intrus.example.test' },
      });
      expect((await middleware(req)).status).toBe(403);
    }
  });

  it('accepte l’origine locale de l’application pour la connexion', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST', headers: { origin: 'http://localhost:3000' },
    });
    expect(laissePasser(await middleware(req))).toBe(true);
  });

  it('accepte aussi le Host local réel quand Next normalise nextUrl en localhost', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/login', {
      method: 'POST', headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' },
    });
    expect(laissePasser(await middleware(req))).toBe(true);
  });

  it('401 sans jeton', async () => {
    const res = await middleware(requete('/api/jeunes'));
    expect(res.status).toBe(401);
  });

  it('laisse passer une session par cookie', async () => {
    const res = await middleware(requete('/api/jeunes', { cookie: await jeton({}) }));
    expect(laissePasser(res)).toBe(true);
  });

  it('401 pour un jeton valide présenté en Authorization: Bearer (plus d’application mobile)', async () => {
    const valide = await jeton({});
    for (const chemin of ['/api/pointages', '/api/jeunes', '/api/animateurs/me']) {
      expect((await middleware(requete(chemin, { bearer: valide }))).status, chemin).toBe(401);
    }
    expect((await middleware(requete('/admin/dashboard', { bearer: valide }))).status).toBe(307);
  });

  it('un en-tête Bearer ne gêne pas une session par cookie : seul le cookie compte', async () => {
    const res = await middleware(requete('/api/jeunes', { cookie: await jeton({}), bearer: 'pas.un.jwt' }));
    expect(laissePasser(res)).toBe(true);
  });

  it('401 pour un billet 2FA provisoire', async () => {
    const billet = await jeton({ type: 'totp-pending' });
    expect((await middleware(requete('/api/jeunes', { cookie: billet }))).status).toBe(401);
  });

  it('401 pour un jeton signé avec un autre secret', async () => {
    const faux = await jeton({}, new TextEncoder().encode('un-autre-secret-de-plus-de-32-caracteres!'));
    expect((await middleware(requete('/api/jeunes', { cookie: faux }))).status).toBe(401);
  });
});

describe('middleware — pages', () => {
  it('redirige un billet 2FA provisoire vers /login au lieu d’ouvrir l’administration', async () => {
    const res = await middleware(requete('/admin/dashboard', { cookie: await jeton({ type: 'totp-pending' }) }));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location') ?? '').pathname).toBe('/login');
  });

  it('laisse la page publique de réinitialisation accessible sans session', async () => {
    expect(laissePasser(await middleware(requete('/reinitialisation')))).toBe(true);
  });

  it('ne rend publique aucune API administrative : seuls /api/auth/ et /api/health passent sans jeton', async () => {
    for (const chemin of ['/api/animateurs/me', '/api/pointages', '/api/notifications', '/api/parametres', '/api/jeunes']) {
      expect((await middleware(requete(chemin))).status, chemin).toBe(401);
    }
    expect(laissePasser(await middleware(requete('/api/health')))).toBe(true);
  });

  it('agenda PIJ : seul le flux de calendrier à jeton est public, pas le reste de /api/pij/', async () => {
    expect(laissePasser(await middleware(requete('/api/pij/agenda/flux/un-jeton.ics')))).toBe(true);
    for (const chemin of ['/api/pij/rdv', '/api/pij/agenda/lien', '/api/pij/agenda/flux', '/api/pij/accueils', '/api/pij/import']) {
      expect((await middleware(requete(chemin))).status, chemin).toBe(401);
    }
  });
});

describe('middleware — durées de session', () => {
  const maintenant = () => Math.floor(Date.now() / 1000);

  it('refuse un jeton sans heure de connexion (émis avant les sessions de 24 h)', async () => {
    const res = await middleware(requete('/api/jeunes', { cookie: await jeton({ auth_time: undefined }) }));
    expect(res.status).toBe(401);
  });

  it('refuse une connexion de plus de 24 heures, même si le jeton n’a pas expiré', async () => {
    const res = await middleware(requete('/api/jeunes', { cookie: await jeton({ auth_time: maintenant() - 24 * 3600 - 1 }) }));
    expect(res.status).toBe(401);
  });

  it('page : une session fermée renvoie vers la connexion et efface le cookie', async () => {
    const res = await middleware(requete('/admin/dashboard', { cookie: await jeton({ auth_time: maintenant() - 25 * 3600 }) }));
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
    expect(res.headers.get('set-cookie') ?? '').toMatch(/pj_token=;/);
  });

  it('laisse passer une connexion de moins de 24 heures', async () => {
    const res = await middleware(requete('/api/jeunes', { cookie: await jeton({ auth_time: maintenant() - 23 * 3600 }) }));
    expect(laissePasser(res)).toBe(true);
  });
});
