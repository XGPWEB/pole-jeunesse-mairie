import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import pool from '@/lib/db';
import { signJWT } from '@/lib/auth';
import { GET as me } from '@/app/api/animateurs/me/route';
import { GET as pointages } from '@/app/api/pointages/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { resetDb, cookieFor, jsonRequest } from './helpers';
import { seedCompte } from './securite-helpers';

/**
 * Plus d'application mobile (2.14.0) : la connexion par jeton
 * `Authorization: Bearer` est retirée. Seul le cookie httpOnly `pj_token`
 * ouvre une session, au proxy comme dans la garde des routes (requireAuth).
 * Un jeton parfaitement valide présenté en Bearer ne doit plus rien ouvrir.
 */
beforeEach(async () => { await resetDb(); });
afterAll(async () => { await pool.end(); });

const bearer = (jeton: string) => ({ authorization: `Bearer ${jeton}` });

describe('Authorization: Bearer n’ouvre plus de session', () => {
  it('un jeton valide en Bearer : 401 sur les API protégées ; le même jeton en cookie : 200', async () => {
    const session = await seedCompte({ role: 'animateur' });
    const jeton = await signJWT(session);

    for (const [nom, handler, url] of [
      ['me', me, '/api/animateurs/me'],
      ['pointages', pointages, '/api/pointages'],
    ] as const) {
      const viaBearer = await handler(jsonRequest(url, { headers: bearer(jeton) }));
      expect(viaBearer.status, nom).toBe(401);
      const viaCookie = await handler(jsonRequest(url, { cookie: `pj_token=${jeton}` }));
      expect(viaCookie.status, nom).toBe(200);
    }
  });

  it('un en-tête Bearer invalide ne gêne pas une session par cookie valide', async () => {
    const cookie = await cookieFor(await seedCompte());
    const res = await me(jsonRequest('/api/animateurs/me', { cookie, headers: bearer('pas.un.jwt') }));
    expect(res.status).toBe(200);
  });

  it('logout avec un seul Bearer : aucune révocation (réponse générique inchangée)', async () => {
    const session = await seedCompte();
    const jeton = await signJWT(session);
    const res = await logout(jsonRequest('/api/auth/logout', { method: 'POST', headers: bearer(jeton) }));
    expect(res.status).toBe(200);
    // Le cookie reste valable : rien n'a été révoqué par la requête Bearer.
    expect((await me(jsonRequest('/api/animateurs/me', { cookie: `pj_token=${jeton}` }))).status).toBe(200);
  });
});
