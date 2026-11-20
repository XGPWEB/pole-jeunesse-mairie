import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import pool from '@/lib/db';
import { verifyJWT, type JWTPayload } from '@/lib/auth';
import { POST as mobileLogin } from '@/app/api/auth/mobile/login/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { POST as forgot } from '@/app/api/auth/forgot-password/route';
import { GET as me } from '@/app/api/animateurs/me/route';
import { GET as pointagesGet, POST as pointagesPost } from '@/app/api/pointages/route';
import { GET as parametresGet } from '@/app/api/parametres/route';
import { resetDb, cookieFor, jsonRequest } from './helpers';
import {
  MOT_DE_PASSE, activerTotp, billetProvisoire, codeTotp, etatCompte, seedCompte, seedEspace, seedJeune,
} from './securite-helpers';

afterAll(async () => { await pool.end(); });

let animateur: JWTPayload;
let compteurIp = 0;
const ip = () => ({ 'x-real-ip': `203.0.113.${++compteurIp}` });

beforeEach(async () => {
  await resetDb();
  animateur = await seedCompte({ role: 'animateur', tenantId: 'vincennes', espaceAssigne: 'Lycéens' });
});

const connecter = (body: unknown, headers = ip()) =>
  mobileLogin(jsonRequest('http://localhost/api/auth/mobile/login', { method: 'POST', headers, body }));
const appelMe = (bearer: string) => me(jsonRequest('http://localhost/api/animateurs/me', { bearer }));

async function jetonMobile(compte: JWTPayload = animateur): Promise<string> {
  const res = await connecter({ username: compte.username, password: MOT_DE_PASSE });
  expect(res.status).toBe(200);
  return (await res.json()).token as string;
}

describe('POST /api/auth/mobile/login', () => {
  it('200 : { token, expiresAt, user } conforme au contrat, sans cookie', async () => {
    const res = await connecter({ username: animateur.username, password: MOT_DE_PASSE });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();

    const corps = await res.json();
    expect(Object.keys(corps).sort()).toEqual(['expiresAt', 'token', 'user']);
    expect(corps.user).toEqual({
      id: animateur.id,
      username: animateur.username,
      nom: 'Test',
      prenom: 'Utilisateur',
      role: 'animateur',
      espaceAssigne: 'Lycéens',
      tenantId: 'vincennes',
    });

    // expiresAt est une date ISO cohérente avec l'expiration réelle du jeton.
    expect(new Date(corps.expiresAt).toISOString()).toBe(corps.expiresAt);
    const payload = await verifyJWT(corps.token);
    expect(payload?.type).toBeUndefined();
    expect(payload?.sv).toBe(0);
    expect(Math.abs((payload?.exp ?? 0) * 1000 - new Date(corps.expiresAt).getTime())).toBeLessThanOrEqual(2000);
  });

  it('400 si un champ manque', async () => {
    expect((await connecter({ username: animateur.username })).status).toBe(400);
    expect((await connecter({ password: MOT_DE_PASSE })).status).toBe(400);
    expect((await connecter({})).status).toBe(400);
  });

  it('401 INVALID_CREDENTIALS, réponse identique pour un compte inconnu, suspendu ou un mauvais mot de passe', async () => {
    const suspendu = await seedCompte({ statut: 'suspendu' });
    const reponses = await Promise.all([
      connecter({ username: animateur.username, password: 'Mauvais!Pass0' }),
      connecter({ username: 'compte.inexistant', password: MOT_DE_PASSE }),
      connecter({ username: suspendu.username, password: MOT_DE_PASSE }),
    ]);
    const corps = await Promise.all(reponses.map(r => r.json()));
    expect(reponses.map(r => r.status)).toEqual([401, 401, 401]);
    expect(corps[0]).toEqual({ error: 'Identifiants incorrects.', code: 'INVALID_CREDENTIALS' });
    expect(corps[1]).toEqual(corps[0]);
    expect(corps[2]).toEqual(corps[0]);
  });

  it('429 après 5 tentatives depuis la même adresse, même avec le bon mot de passe ensuite', async () => {
    const meme = { 'x-real-ip': '203.0.113.200' };
    for (let i = 0; i < 5; i++) {
      expect((await connecter({ username: animateur.username, password: 'Mauvais!Pass0' }, meme)).status).toBe(401);
    }
    expect((await connecter({ username: animateur.username, password: MOT_DE_PASSE }, meme)).status).toBe(429);
  });

  it('les échecs sont tracés dans le journal d’audit', async () => {
    await connecter({ username: animateur.username, password: 'Mauvais!Pass0' });
    await jetonMobile();
    const { rows } = await pool.query(`SELECT action, details->>'via' AS via FROM audit_log ORDER BY id`);
    expect(rows).toEqual([{ action: 'LOGIN_FAILED', via: 'mobile' }, { action: 'LOGIN', via: 'mobile' }]);
  });

  describe('compte avec TOTP', () => {
    let admin: JWTPayload;
    let secret: string;

    beforeEach(async () => {
      admin = await seedCompte({ role: 'admin' });
      secret = await activerTotp(admin.id);
    });

    it('401 TOTP_REQUIRED sans code, 401 TOTP_INVALID avec un code faux — aucun jeton émis', async () => {
      const sans = await connecter({ username: admin.username, password: MOT_DE_PASSE });
      expect(sans.status).toBe(401);
      expect(await sans.json()).toMatchObject({ code: 'TOTP_REQUIRED' });

      const faux = await connecter({ username: admin.username, password: MOT_DE_PASSE, totpCode: '000000' });
      expect(faux.status).toBe(401);
      const corps = await faux.json();
      expect(corps.code).toBe('TOTP_INVALID');
      expect(corps.token).toBeUndefined();
    });

    it('un mauvais mot de passe ne révèle pas que le TOTP est activé', async () => {
      const res = await connecter({ username: admin.username, password: 'Mauvais!Pass0', totpCode: codeTotp(admin.username, secret) });
      expect(await res.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
      // Et le code n'a pas été consommé.
      expect((await etatCompte(admin.id)).last_totp_step).toBeNull();
    });

    it('200 avec le bon code ; le même code est refusé au second usage (antirejeu)', async () => {
      const totpCode = codeTotp(admin.username, secret);
      const ok = await connecter({ username: admin.username, password: MOT_DE_PASSE, totpCode });
      expect(ok.status).toBe(200);
      expect((await ok.json()).user.role).toBe('admin');

      const rejeu = await connecter({ username: admin.username, password: MOT_DE_PASSE, totpCode });
      expect(rejeu.status).toBe(401);
      expect((await rejeu.json()).code).toBe('TOTP_INVALID');
    });

    it('connexions concurrentes avec le même code : un seul jeton émis', async () => {
      const totpCode = codeTotp(admin.username, secret);
      const reponses = await Promise.all([1, 2, 3, 4].map(() =>
        connecter({ username: admin.username, password: MOT_DE_PASSE, totpCode })));
      expect(reponses.filter(r => r.status === 200)).toHaveLength(1);
      expect(reponses.filter(r => r.status === 401)).toHaveLength(3);
    });
  });
});

describe('Authorization: Bearer — mêmes contrôles que le cookie', () => {
  it('le jeton mobile ouvre les API protégées, avec le tenant du compte', async () => {
    const token = await jetonMobile();
    const espaceId = await seedEspace('vincennes');
    const jeuneId = await seedJeune('vincennes', espaceId);

    const moi = await appelMe(token);
    expect(moi.status).toBe(200);
    expect(await moi.json()).toMatchObject({ id: animateur.id, role: 'animateur', tenantId: 'vincennes', espaceAssigne: 'Lycéens' });

    const creation = await pointagesPost(jsonRequest('http://localhost/api/pointages', {
      method: 'POST', bearer: token,
      body: [{ jeuneId, espaceId, date: '2026-10-06', heureArrivee: '14:00', type: 'accueil-libre' }],
    }));
    expect(creation.status).toBe(200);
    const liste = await pointagesGet(jsonRequest('http://localhost/api/pointages?date=2026-10-06', { bearer: token }));
    expect(await liste.json()).toHaveLength(1);
  });

  it('un jeton d’animateur ne donne accès à aucune API d’administration', async () => {
    const token = await jetonMobile();
    expect((await parametresGet(jsonRequest('http://localhost/api/parametres', { bearer: token }))).status).toBe(403);
  });

  it('refus : sans jeton, jeton altéré, billet 2FA provisoire, compte suspendu, session révoquée', async () => {
    const token = await jetonMobile();
    expect((await me(jsonRequest('http://localhost/api/animateurs/me'))).status).toBe(401);
    expect((await appelMe(`${token.slice(0, -2)}xx`)).status).toBe(401);
    expect((await appelMe(await billetProvisoire(animateur))).status).toBe(401);

    await pool.query(`UPDATE animateurs SET statut = 'suspendu' WHERE id = $1`, [animateur.id]);
    expect((await appelMe(token)).status).toBe(401);
    await pool.query(`UPDATE animateurs SET statut = 'actif', session_version = session_version + 1 WHERE id = $1`, [animateur.id]);
    expect((await appelMe(token)).status).toBe(401);
  });

  it('un Bearer invalide n’est pas rattrapé par un cookie valide (une seule identité par requête)', async () => {
    const cookie = await cookieFor(animateur);
    const res = await me(jsonRequest('http://localhost/api/animateurs/me', { cookie, bearer: 'pas.un.jwt' }));
    expect(res.status).toBe(401);
  });

  it('POST /api/auth/logout avec Bearer révoque la session : le jeton est refusé ensuite, même après reconnexion', async () => {
    const token = await jetonMobile();
    const res = await logout(jsonRequest('http://localhost/api/auth/logout', { method: 'POST', bearer: token }));
    expect(res.status).toBe(200);
    expect((await appelMe(token)).status).toBe(401);

    const nouveau = await jetonMobile();
    expect((await appelMe(nouveau)).status).toBe(200);
    expect((await appelMe(token)).status).toBe(401);
  });

  it('POST /api/auth/forgot-password { username } : toujours 200 générique', async () => {
    const appel = async (username: string) => {
      const res = await forgot(jsonRequest('http://localhost/api/auth/forgot-password', { method: 'POST', headers: ip(), body: { username } }));
      return [res.status, await res.json()];
    };
    const connu = await appel(animateur.username);
    expect(connu[0]).toBe(200);
    expect(await appel('inconnu.total')).toEqual(connu);
  });
});
