import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import pool from '@/lib/db';
import { signJWT, type JWTPayload } from '@/lib/auth';

/**
 * Vide toutes les tables entre deux tests (schéma conservé). CASCADE couvre
 * les FK qu'on ne liste pas explicitement dans TRUNCATE tant qu'on liste bien
 * toutes les tables présentes dans le schéma.
 */
export async function resetDb(): Promise<void> {
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  if (rows.length === 0) return;
  const tables = rows.map(r => `"${r.tablename}"`).join(', ');
  await pool.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

export async function seedTenant(id = 'nogent'): Promise<void> {
  await pool.query(
    `INSERT INTO tenants (id, nom) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [id, 'Nogent-sur-Marne'],
  );
}

interface SeedAnimateurOpts {
  id?: string;
  role?: 'admin' | 'animateur' | 'superadmin';
  statut?: string;
  tenantId?: string;
  espaceAssigne?: string;
  /** Optionnels (tests sécurité) : sans eux le compte n'a ni hash ni e-mail. */
  username?: string;
  passwordHash?: string;
  email?: string;
}

export async function seedAnimateur(opts: SeedAnimateurOpts = {}): Promise<JWTPayload> {
  const id = opts.id ?? `anim-${randomUUID()}`;
  const tenantId = opts.tenantId ?? 'nogent';
  const username = opts.username ?? `test.${id}`;
  await seedTenant(tenantId);
  await pool.query(
    `INSERT INTO animateurs (id, nom, prenom, username, statut, role, tenant_id, espace_assigne, password_hash, email)
     VALUES ($1, 'Test', 'Utilisateur', $2, $3, $4, $5, $6, $7, $8)`,
    [id, username, opts.statut ?? 'actif', opts.role ?? 'admin', tenantId, opts.espaceAssigne ?? 'Collégiens',
     opts.passwordHash ?? null, opts.email ?? null],
  );
  return {
    id,
    username,
    role: opts.role ?? 'admin',
    espaceAssigne: opts.espaceAssigne ?? 'Collégiens',
    tenant_id: tenantId,
    // Version de session d'un compte fraîchement créé (DEFAULT 0) : le jeton
    // produit par cookieFor() suit ainsi le même chemin de contrôle qu'un
    // jeton émis par un vrai login (claim `sv`), pas le chemin de
    // compatibilité des anciens jetons.
    sv: 0,
  };
}

export async function cookieFor(session: JWTPayload): Promise<string> {
  const token = await signJWT(session);
  return `pj_token=${token}`;
}

/** Jeton brut, pour un en-tête `Authorization: Bearer` (application mobile). */
export async function tokenFor(session: JWTPayload): Promise<string> {
  return signJWT(session);
}

/**
 * Construit une NextRequest exactement comme Next le fait pour une route API
 * — même parsing du cookie `pj_token` (via req.cookies), même body JSON.
 */
export function jsonRequest(
  url: string,
  opts: { method?: string; cookie?: string; bearer?: string; body?: unknown; headers?: Record<string, string> } = {},
): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json', ...(opts.headers ?? {}) });
  if (opts.cookie) headers.set('cookie', opts.cookie);
  if (opts.bearer) headers.set('authorization', `Bearer ${opts.bearer}`);
  return new NextRequest(new URL(url, 'http://localhost:3000'), {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}
