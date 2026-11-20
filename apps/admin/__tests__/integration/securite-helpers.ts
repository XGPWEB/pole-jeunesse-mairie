import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import pool from '@/lib/db';
import { construireTotp, genererSecretTotp, TOTP_PERIOD } from '@/lib/totp';
import { signJWT, type JWTPayload } from '@/lib/auth';
import { seedAnimateur } from './helpers';

/**
 * Jeux de données des tests de sécurité (audit du 2026-10-06). Complète
 * helpers.ts sans en changer les signatures.
 */

/** Mot de passe conforme à la politique (8+, majuscule, caractère spécial). */
export const MOT_DE_PASSE = 'Initial!Pass1';

/** Coût bcrypt minimal : on teste le câblage, pas la résistance du hash. */
export async function hash(motDePasse: string): Promise<string> {
  return bcrypt.hash(motDePasse, 4);
}

/** Compte avec mot de passe connu (pour passer par les vraies routes de login). */
export async function seedCompte(opts: {
  role?: 'admin' | 'animateur' | 'superadmin';
  tenantId?: string;
  statut?: string;
  email?: string;
  espaceAssigne?: string;
} = {}): Promise<JWTPayload> {
  return seedAnimateur({
    ...opts,
    username: `u${randomUUID().slice(0, 12)}`,
    passwordHash: await hash(MOT_DE_PASSE),
  });
}

/** Active un facteur TOTP directement en base et renvoie son secret. */
export async function activerTotp(animateurId: string): Promise<string> {
  const secret = genererSecretTotp();
  await pool.query(
    'UPDATE animateurs SET totp_secret = $2, totp_enabled = TRUE WHERE id = $1',
    [animateurId, secret],
  );
  return secret;
}

/** Code TOTP valide pour un secret, décalé de `decalagePas` pas de 30 s. */
export function codeTotp(username: string, secret: string, decalagePas = 0): string {
  return construireTotp(username, secret).generate({
    timestamp: Date.now() + decalagePas * TOTP_PERIOD * 1000,
  });
}

/** Billet 2FA provisoire, tel que l'émet /api/auth/login. */
export async function billetProvisoire(session: JWTPayload): Promise<string> {
  return signJWT({ ...session, type: 'totp-pending' }, 300);
}

export async function seedEspace(tenantId: string, id = `esp-${randomUUID()}`): Promise<string> {
  await pool.query('INSERT INTO espaces (id, nom, tenant_id) VALUES ($1, $2, $3)', [id, `Espace ${id}`, tenantId]);
  return id;
}

export async function seedJeune(tenantId: string, espaceId: string | null = null): Promise<string> {
  const id = `j-${randomUUID()}`;
  await pool.query(
    `INSERT INTO jeunes (id, nom, prenom, espace_id, tenant_id) VALUES ($1, 'DURAND', 'Camille', $2, $3)`,
    [id, espaceId, tenantId],
  );
  return id;
}

export async function seedActivite(tenantId: string, espaceId: string | null = null): Promise<string> {
  const id = `act-${randomUUID()}`;
  await pool.query(
    `INSERT INTO activites (id, titre, espace_id, date, tenant_id) VALUES ($1, 'Atelier', $2, '2026-10-06', $3)`,
    [id, espaceId, tenantId],
  );
  return id;
}

export async function seedPointage(opts: {
  tenantId: string;
  jeuneId: string;
  date?: string;
  type?: 'accueil-libre' | 'activite';
  activiteId?: string | null;
  espaceId?: string | null;
  statut?: string | null;
}): Promise<string> {
  const id = `pt-${randomUUID()}`;
  await pool.query(
    `INSERT INTO pointages (id, jeune_id, espace_id, date, type, activite_id, statut, source, tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'test', $8)`,
    [id, opts.jeuneId, opts.espaceId ?? null, opts.date ?? '2026-10-06', opts.type ?? 'accueil-libre',
     opts.activiteId ?? null, opts.statut ?? null, opts.tenantId],
  );
  return id;
}

export async function seedNotification(opts: {
  tenantId: string;
  cible?: string;
  type?: string;
  destAnimateurId?: string | null;
  fromAnimateurId?: string | null;
}): Promise<string> {
  const id = `notif-${randomUUID()}`;
  await pool.query(
    `INSERT INTO notifications (id, type, titre, message, cible, dest_animateur_id, from_animateur_id, tenant_id)
     VALUES ($1, $2, 'Titre', 'Message', $3, $4, $5, $6)`,
    [id, opts.type ?? 'notification', opts.cible ?? 'Tous', opts.destAnimateurId ?? null,
     opts.fromAnimateurId ?? null, opts.tenantId],
  );
  return id;
}

/** État de sécurité d'un compte, pour vérifier qu'une requête refusée n'a rien modifié. */
export async function etatCompte(id: string) {
  const { rows } = await pool.query(
    `SELECT role, statut, password_hash, session_version, session_invalidated_at,
            totp_enabled, totp_secret, totp_pending_secret, last_totp_step
       FROM animateurs WHERE id = $1`,
    [id],
  );
  return rows[0];
}

/** Extrait la valeur du cookie pj_token d'une réponse de login. */
export function cookieDeReponse(res: Response): string | null {
  const brut = res.headers.get('set-cookie');
  const m = brut ? /pj_token=([^;]*)/.exec(brut) : null;
  return m && m[1] ? `pj_token=${m[1]}` : null;
}
