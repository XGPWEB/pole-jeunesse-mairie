import { describe, it, expect, vi } from 'vitest';

// Évite toute connexion réelle à PostgreSQL lors de l'import de auth.ts
vi.mock('@/lib/db', () => ({
  default: { query: vi.fn() },
  queryOne: vi.fn(),
}));

import { signJWT, verifyJWT } from '@/lib/auth';

describe('JWT — signJWT + verifyJWT', () => {
  const base = { id: 'u1', username: 'test.user', role: 'admin' as const, espaceAssigne: 'alpha', tenant_id: 'nogent' };

  it('produit un token à 3 segments', async () => {
    const token = await signJWT(base);
    expect(token.split('.')).toHaveLength(3);
  });

  it('vérifie un token valide', async () => {
    const token = await signJWT({ ...base, role: 'animateur' });
    const payload = await verifyJWT(token);
    expect(payload).not.toBeNull();
    expect(payload!.id).toBe('u1');
    expect(payload!.role).toBe('animateur');
    expect(payload!.username).toBe('test.user');
    expect(payload!.tenant_id).toBe('nogent');
  });

  it('porte la version de session (sv) quand elle est fournie', async () => {
    const token = await signJWT({ ...base, sv: 7 });
    const payload = await verifyJWT(token);
    expect(payload?.sv).toBe(7);
  });

  it("rejette un token signé avec un autre algorithme que HS256 (alg: none)", async () => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const forge = `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ ...base, exp: Math.floor(Date.now() / 1000) + 60 })}.`;
    expect(await verifyJWT(forge)).toBeNull();
  });

  it('rejette un token modifié', async () => {
    const token = await signJWT(base);
    const [h, b, s] = token.split('.');
    expect(await verifyJWT(`${h}.${b}X.${s}`)).toBeNull();
  });

  it('rejette un token expiré', async () => {
    const token = await signJWT(base, -1);
    expect(await verifyJWT(token)).toBeNull();
  });

  it('rejette un token vide ou malformé', async () => {
    expect(await verifyJWT('')).toBeNull();
    expect(await verifyJWT('a.b')).toBeNull();
    expect(await verifyJWT('not.a.jwt')).toBeNull();
  });

  it('billet 2FA temporaire inclut type=totp-pending', async () => {
    const token = await signJWT({ ...base, type: 'totp-pending' }, 300);
    const payload = await verifyJWT(token);
    expect(payload?.type).toBe('totp-pending');
  });
});

describe('JWT — durée de vie', () => {
  const base = { id: 'u1', username: 'test.user', role: 'admin' as const, espaceAssigne: 'alpha', tenant_id: 'nogent' };

  it('exp est bien dans 24h pour un token normal', async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await signJWT(base, 86400);
    const payload = await verifyJWT(token);
    const after = Math.floor(Date.now() / 1000);
    expect(payload!.exp).toBeGreaterThanOrEqual(before + 86399);
    expect(payload!.exp).toBeLessThanOrEqual(after + 86401);
  });

  it('billet TOTP expire en 5 minutes max', async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await signJWT({ ...base, type: 'totp-pending' }, 300);
    const payload = await verifyJWT(token);
    expect(payload!.exp! - before).toBeLessThanOrEqual(301);
  });
});

describe('Validation des entrées', () => {
  it('détecte un username vide', () => {
    const isValid = (u: string, p: string) => u.trim().length > 0 && p.length > 0;
    expect(isValid('', 'secret')).toBe(false);
    expect(isValid('xavier', '')).toBe(false);
    expect(isValid('xavier.gerinette', 'motdepasse')).toBe(true);
  });

  it("normalise le @ dans l'username", () => {
    const normalize = (u: string) => u.replace('@', '');
    expect(normalize('@xavier')).toBe('xavier');
    expect(normalize('xavier.gerinette')).toBe('xavier.gerinette');
  });
});
