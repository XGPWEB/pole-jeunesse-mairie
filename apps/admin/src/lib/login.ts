import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import pool, { queryOne } from '@/lib/db';
import { roleEffectif, signJWT, SESSION_COOKIE, SESSION_TTL_SECONDS } from '@/lib/auth';
import { consommerCodeTotp } from '@/lib/totp';
import { normaliserRubriques } from '@/lib/rubriques';
import { consommerTentative, reinitialiserTentatives, FENETRE_15_MIN_MS } from '@/lib/rate-limit';

/**
 * Cœur de l'authentification du login web (/api/auth/login +
 * /api/auth/verify-totp, cookie). Regroupé ici pour que les deux étapes aient
 * exactement les mêmes protections : temps de réponse constant, antirejeu
 * TOTP atomique, limitation par compte, version de session.
 */

export const LOGIN_MAX_TENTATIVES = 5;
const TOTP_MAX_TENTATIVES = 5;
const BILLET_TOTP_TTL_SECONDS = 5 * 60;

/**
 * Hash bcrypt d'une valeur quelconque, comparé quand le compte n'existe pas :
 * le temps de réponse ne révèle pas l'existence d'un identifiant.
 */
const HASH_FACTICE = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

export interface CompteAuthentifie {
  id: string;
  nom: string;
  prenom: string;
  username: string;
  role: 'admin' | 'animateur';
  espaceAssigne: string;
  poste: string | null;
  tenantId: string | null;
  totpEnabled: boolean;
  totpSecret: string | null;
  sessionVersion: number;
  /** Rubriques du menu ouvertes (null = toutes celles du rôle). */
  rubriques: string[] | null;
}

interface LigneCompte {
  id: string;
  nom: string;
  prenom: string;
  username: string;
  role: string | null;
  espace_assigne: string | null;
  poste: string | null;
  password_hash: string | null;
  tenant_id: string | null;
  totp_enabled: boolean | null;
  totp_secret: string | null;
  session_version: number | string | null;
  rubriques: string[] | null;
}

const COLONNES_COMPTE = `
  id, nom, prenom, username, role, espace_assigne, poste, password_hash,
  tenant_id, totp_enabled, totp_secret, session_version, rubriques`;

function versCompte(row: LigneCompte): CompteAuthentifie {
  return {
    id: row.id,
    nom: row.nom,
    prenom: row.prenom,
    username: row.username,
    role: roleEffectif(row.role),
    espaceAssigne: row.espace_assigne ?? '',
    poste: row.poste,
    tenantId: row.tenant_id,
    totpEnabled: row.totp_enabled === true,
    totpSecret: row.totp_secret,
    sessionVersion: Number(row.session_version ?? 0),
    rubriques: normaliserRubriques(roleEffectif(row.role), row.rubriques),
  };
}

export function normaliserUsername(username: string): string {
  return username.trim().replace('@', '');
}

/**
 * Vérifie identifiant + mot de passe d'un compte ACTIF.
 * Retourne `null` dans tous les cas d'échec, sans distinguer « compte
 * inconnu », « compte suspendu » et « mauvais mot de passe ».
 */
export async function verifierIdentifiants(
  username: string,
  password: string,
): Promise<CompteAuthentifie | null> {
  const row = await queryOne<LigneCompte>(
    `SELECT ${COLONNES_COMPTE} FROM animateurs WHERE username = $1 AND statut = 'actif'`,
    [normaliserUsername(username)],
  );

  let valide = false;
  if (row?.password_hash) {
    valide = await bcrypt.compare(password, row.password_hash);
  } else {
    await bcrypt.compare(password, HASH_FACTICE);
  }
  return row && valide ? versCompte(row) : null;
}

/** Recharge un compte actif par son id (étape 2FA : le billet ne porte que l'id). */
export async function chargerCompteActif(id: string): Promise<CompteAuthentifie | null> {
  const row = await queryOne<LigneCompte>(
    `SELECT ${COLONNES_COMPTE} FROM animateurs WHERE id = $1 AND statut = 'actif'`,
    [id],
  );
  return row ? versCompte(row) : null;
}

export type ResultatSecondFacteur = 'ok' | 'invalide' | 'rejoue' | 'bloque';

/**
 * Vérifie et consomme un code du second facteur pendant une connexion.
 *
 * Limitation PAR COMPTE (et non par IP) : c'est le compte qui est attaqué, et
 * l'attaquant qui connaît le mot de passe peut changer d'adresse. Le compteur
 * n'est remis à zéro que par un code accepté — jamais par la seule réussite de
 * l'étape mot de passe.
 */
export async function verifierSecondFacteur(
  compte: CompteAuthentifie,
  code: unknown,
): Promise<ResultatSecondFacteur> {
  if (!compte.totpEnabled || !compte.totpSecret) return 'invalide';

  const cle = `totp:${compte.id}`;
  if (!await consommerTentative(cle, TOTP_MAX_TENTATIVES, FENETRE_15_MIN_MS)) return 'bloque';

  const resultat = await consommerCodeTotp(compte.id, compte.username, compte.totpSecret, code);
  if (resultat === 'ok') await reinitialiserTentatives(cle);
  return resultat;
}

/**
 * Billet temporaire 2FA (5 min). Ne donne AUCUN droit : la garde de session et
 * le middleware refusent tout jeton portant un `type`. Il porte la version de
 * session courante, pour qu'une révocation (changement de mot de passe…) rende
 * aussi caducs les billets en attente.
 */
export async function emettreBilletTotp(compte: CompteAuthentifie & { tenantId: string }): Promise<string> {
  return signJWT(
    {
      id: compte.id,
      username: compte.username,
      role: compte.role,
      espaceAssigne: compte.espaceAssigne,
      tenant_id: compte.tenantId,
      type: 'totp-pending',
      sv: compte.sessionVersion,
    },
    BILLET_TOTP_TTL_SECONDS,
  );
}

export interface SessionEmise {
  token: string;
  expiresAt: Date;
}

/**
 * Émet une session pour un compte entièrement authentifié.
 *
 * Le jeton porte `sv`, la version de session lue en base. On ne remet PLUS
 * `session_invalidated_at` à NULL ici : c'est ce qui réactivait les jetons
 * révoqués à chaque reconnexion.
 */
export async function emettreSession(compte: CompteAuthentifie & { tenantId: string }): Promise<SessionEmise> {
  const expiresAt = new Date((Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS) * 1000);
  const token = await signJWT({
    id: compte.id,
    username: compte.username,
    role: compte.role,
    espaceAssigne: compte.espaceAssigne,
    tenant_id: compte.tenantId,
    nom: compte.nom,
    prenom: compte.prenom,
    sv: compte.sessionVersion,
    rubriques: compte.rubriques,
  });
  await pool.query('UPDATE animateurs SET last_login = NOW() WHERE id = $1', [compte.id]);
  return { token, expiresAt };
}

/** Garde de type : un compte sans tenant est mal configuré, on ne l'authentifie pas. */
export function aUnTenant(compte: CompteAuthentifie): compte is CompteAuthentifie & { tenantId: string } {
  return typeof compte.tenantId === 'string' && compte.tenantId !== '';
}

export function poserCookieSession(response: NextResponse, token: string): void {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function effacerCookieSession(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
