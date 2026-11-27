import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import pool from '@/lib/db';
import { signJWT, verifyJWT, SESSION_DUREE_MAX_SECONDS, SESSION_INACTIVITE_SECONDS } from '@/lib/auth';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as activite } from '@/app/api/session/activite/route';
import { GET as me } from '@/app/api/animateurs/me/route';
import { PATCH as profil } from '@/app/api/animateurs/profil/route';
import { resetDb, jsonRequest } from './helpers';
import { MOT_DE_PASSE, cookieDeReponse, seedCompte } from './securite-helpers';

/**
 * Durées de session (audit du 2026-11-20) : 10 minutes sans action ferment la
 * session, et une connexion ne dure jamais plus de 24 heures.
 */
afterAll(async () => { await pool.end(); });
beforeEach(async () => { await resetDb(); });
afterEach(() => { vi.useRealTimers(); });

const maintenant = () => Math.floor(Date.now() / 1000);
const jeton = (cookie: string) => cookie.replace('pj_token=', '');
const appelMe = (cookie: string) => me(jsonRequest('http://localhost/api/animateurs/me', { cookie }));
const prolonger = (cookie?: string) => activite(jsonRequest('http://localhost/api/session/activite', { method: 'POST', cookie }));

async function connecter() {
  const compte = await seedCompte();
  const res = await login(jsonRequest('http://localhost/api/auth/login', {
    method: 'POST', body: { username: compte.username, password: MOT_DE_PASSE },
  }));
  expect(res.status).toBe(200);
  const cookie = cookieDeReponse(res);
  expect(cookie).not.toBeNull();
  return { compte, cookie: cookie! };
}

describe('session : 10 minutes d’inactivité, 24 heures au plus', () => {
  it('la connexion émet un jeton de 10 minutes daté de la connexion', async () => {
    const { cookie } = await connecter();
    const p = await verifyJWT(jeton(cookie));
    expect(p!.exp! - p!.iat!).toBe(SESSION_INACTIVITE_SECONDS);
    expect(Math.abs(p!.auth_time! - maintenant())).toBeLessThanOrEqual(2);
  });

  it('une action prolonge la session sans repousser l’heure de connexion', async () => {
    const { cookie } = await connecter();
    const avant = await verifyJWT(jeton(cookie));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 5 * 60 * 1000);

    const res = await prolonger(cookie);
    expect(res.status).toBe(200);
    const nouveau = cookieDeReponse(res)!;
    const apres = await verifyJWT(jeton(nouveau));
    expect(apres!.auth_time).toBe(avant!.auth_time);
    expect(apres!.exp! - avant!.exp!).toBeGreaterThanOrEqual(5 * 60 - 1);
    expect((await appelMe(nouveau)).status).toBe(200);
  });

  it('sans action pendant 10 minutes, la session est fermée et ne peut plus être prolongée', async () => {
    const { cookie } = await connecter();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + (SESSION_INACTIVITE_SECONDS + 5) * 1000);
    expect((await appelMe(cookie)).status).toBe(401);
    expect((await prolonger(cookie)).status).toBe(401);
  });

  it('sans session, rien à prolonger', async () => {
    expect((await prolonger()).status).toBe(401);
  });

  it('la prolongation s’arrête à 24 heures après la connexion', async () => {
    const compte = await seedCompte();
    const authTime = maintenant() - SESSION_DUREE_MAX_SECONDS + 120;
    const cookie = `pj_token=${await signJWT({ ...compte, auth_time: authTime })}`;
    const res = await prolonger(cookie);
    expect(res.status).toBe(200);
    expect((await verifyJWT(jeton(cookieDeReponse(res)!)))!.exp).toBe(authTime + SESSION_DUREE_MAX_SECONDS);
  });

  it('une connexion de plus de 24 heures est refusée, même avec un jeton non expiré', async () => {
    const compte = await seedCompte();
    // Jeton forgé avec la bonne clé mais une connexion trop ancienne.
    const { SignJWT } = await import('jose');
    const vieux = await new SignJWT({ ...compte, auth_time: maintenant() - SESSION_DUREE_MAX_SECONDS - 60 })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m')
      .sign(new TextEncoder().encode(process.env.JWT_SECRET));
    expect((await appelMe(`pj_token=${vieux}`)).status).toBe(401);
    expect((await prolonger(`pj_token=${vieux}`)).status).toBe(401);
  });

  it('un jeton émis avant cette version (sans heure de connexion) impose de se reconnecter', async () => {
    const compte = await seedCompte();
    const { SignJWT } = await import('jose');
    const ancien = await new SignJWT({ ...compte })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30d')
      .sign(new TextEncoder().encode(process.env.JWT_SECRET));
    expect((await appelMe(`pj_token=${ancien}`)).status).toBe(401);
  });
});

describe('mot de passe : 12 caractères au minimum', () => {
  it('refuse un nouveau mot de passe de 11 caractères, accepte 12', async () => {
    const { cookie } = await connecter();
    const changer = (nouveau: string) => profil(jsonRequest('http://localhost/api/animateurs/profil', {
      method: 'PATCH', cookie, body: { currentPassword: MOT_DE_PASSE, newPassword: nouveau },
    }));
    const court = await changer('Abcdefgh!1x');
    expect(court.status).toBe(400);
    expect((await court.json()).error).toMatch(/12 caractères/);
    expect((await changer('Abcdefgh!1xy')).status).toBe(200);
  });
});
