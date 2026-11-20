import { cache } from 'react';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { getJwtSecretKey } from '@/lib/jwt-secret';
import { memesRubriques, normaliserRubriques, rubriquesExigees, satisfaitExigence } from '@/lib/rubriques';

// Garde de démarrage : secret absent, vide, trop court ou placeholder connu →
// le module refuse de se charger (voir lib/jwt-secret.ts, partagé avec le
// middleware Edge pour que les deux appliquent exactement la même règle).
const JWT_SECRET = getJwtSecretKey();

export type RoleSession = 'admin' | 'animateur' | 'superadmin';

export interface JWTPayload {
  id: string;
  username: string;
  role: RoleSession;
  espaceAssigne: string;
  tenant_id: string;
  nom?: string;
  prenom?: string;
  iat?: number;
  exp?: number;
  /** 'totp-pending' : billet temporaire 2FA — ne donne aucun droit d'accès */
  type?: string;
  /**
   * Version de session (animateurs.session_version au moment de l'émission).
   * Absente des jetons émis avant la migration sécurité 2026-10.
   */
  sv?: number;
  /**
   * Rubriques du menu ouvertes au compte (voir lib/rubriques.ts) ;
   * `null`/absent = accès complet au menu de son rôle. Portées par le jeton
   * pour que le proxy filtre sans base ; la garde vérifie qu'elles sont
   * toujours celles de la base.
   */
  rubriques?: string[] | null;
  /**
   * Compte qui règle les droits des autres (animateurs.gere_droits). Lu en
   * base par la garde à chaque requête, jamais pris dans le jeton.
   */
  gereDroits?: boolean;
}

/** Nom du cookie de session web (httpOnly). */
export const SESSION_COOKIE = 'pj_token';

/**
 * Durée de vie d'une session authentifiée (30 jours).
 * Utilisée à la fois pour l'expiration du JWT et pour le maxAge du cookie
 * `pj_token` — les deux DOIVENT rester synchronisés, sinon le navigateur garde
 * un cookie que le serveur rejette (ou l'inverse).
 * Ne s'applique pas au billet temporaire 2FA, volontairement court (5 min).
 */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export async function signJWT(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  ttlSeconds = SESSION_TTL_SECONDS,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(JWT_SECRET);
}

export async function verifyJWT(token: string): Promise<JWTPayload | null> {
  try {
    // Algorithme épinglé : le secret est symétrique, seul HS256 est attendu.
    const { payload } = await jwtVerify(token, JWT_SECRET, { algorithms: ['HS256'] });
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Rôle effectif d'une session à partir du rôle stocké en base.
 * Même normalisation qu'à la connexion (seul 'admin' donne les droits admin)
 * — factorisée pour que le login et la garde ne puissent pas diverger.
 */
export function roleEffectif(roleEnBase: string | null | undefined): 'admin' | 'animateur' {
  return roleEnBase === 'admin' ? 'admin' : 'animateur';
}

/**
 * Extrait le jeton de session d'une requête : uniquement le cookie httpOnly
 * `pj_token`. Il n'y a plus d'application mobile : un en-tête
 * `Authorization: Bearer` est ignoré, il n'ouvre aucune session.
 *
 * Même règle dans le proxy (src/proxy.ts).
 */
export function tokenDepuisRequete(request: NextRequest): string | null {
  return request.cookies.get(SESSION_COOKIE)?.value ?? null;
}

interface LigneSession {
  username: string;
  nom: string | null;
  prenom: string | null;
  role: string | null;
  statut: string | null;
  espace_assigne: string | null;
  tenant_id: string | null;
  session_version: number | string | null;
  session_invalidated_at: string | Date | null;
  rubriques: string[] | null;
  gere_droits: boolean | null;
}

/**
 * LA garde de session — implémentation unique, utilisée par `requireAuth`
 * (routes API, cookie), `getAuthUser` (server components / server
 * actions) et `getSession` (lib/session.ts). Ces trois points d'entrée ne font
 * qu'extraire le jeton ; toute la décision est ici, pour qu'ils appliquent
 * exactement la même règle.
 *
 * Règles :
 *  1. Signature et expiration du JWT valides.
 *  2. Jeton de type « session » uniquement : tout jeton portant un `type`
 *     (billet 2FA `totp-pending`, etc.) est refusé. Auparavant `getSession` et
 *     plusieurs routes sous /api/auth/ (laissées publiques par le middleware)
 *     ne faisaient pas ce contrôle : le seul mot de passe d'un admin suffisait
 *     pour agir avant la validation du second facteur.
 *  3. Compte existant et `actif` en base.
 *  4. Session non révoquée : `sv` égal à la version courante. Pour les anciens
 *     jetons sans `sv`, on conserve le contrôle par horodatage et on les refuse
 *     dès qu'une révocation a eu lieu depuis la migration.
 *  5. Rubriques du jeton identiques à celles de la base : le proxy filtre les
 *     pages et les API sur celles du jeton. Un compte dont on a changé les
 *     rubriques doit se reconnecter (ses sessions sont aussi révoquées par
 *     modifierAnimateur) : un ancien jeton ne rouvre jamais une rubrique retirée.
 *  6. Les attributs renvoyés (rôle, tenant, espace, identité) sont ceux de la
 *     BASE, pas ceux du JWT : un admin rétrogradé, déplacé d'espace ou de
 *     structure n'emporte pas ses anciens droits dans son jeton.
 */
async function resoudreSession(token: string | null | undefined): Promise<JWTPayload | null> {
  if (!token) return null;

  const payload = await verifyJWT(token);
  if (!payload || typeof payload.id !== 'string' || payload.id === '') return null;
  if (payload.type !== undefined && payload.type !== null) return null;

  const row = await queryOne<LigneSession>(
    `SELECT username, nom, prenom, role, statut, espace_assigne, tenant_id,
            session_version, session_invalidated_at, rubriques, gere_droits
     FROM animateurs WHERE id = $1`,
    [payload.id],
  );
  if (!row || row.statut !== 'actif' || !row.tenant_id) return null;

  const versionCourante = Number(row.session_version ?? 0);
  if (typeof payload.sv === 'number') {
    if (payload.sv !== versionCourante) return null;
  } else {
    // Jeton antérieur à la migration (pas de `sv`).
    // Toute révocation postérieure à la migration incrémente la version : on
    // refuse alors l'ancien jeton sans dépendre de la précision à la seconde.
    if (versionCourante > 0) return null;
    if (row.session_invalidated_at) {
      if (typeof payload.iat !== 'number') return null;
      // Arrondi au supérieur : un jeton émis dans la même seconde que la
      // révocation est refusé (le doute profite à la révocation).
      const invalideA = Math.ceil(new Date(row.session_invalidated_at).getTime() / 1000);
      if (payload.iat <= invalideA) return null;
    }
  }

  const role = roleEffectif(row.role);
  const rubriques = normaliserRubriques(role, row.rubriques);
  if (!memesRubriques({ role, rubriques: payload.rubriques ?? null }, { role, rubriques })) return null;

  return {
    id: payload.id,
    username: row.username,
    role,
    espaceAssigne: row.espace_assigne ?? '',
    tenant_id: row.tenant_id,
    nom: row.nom ?? undefined,
    prenom: row.prenom ?? undefined,
    iat: payload.iat,
    exp: payload.exp,
    sv: versionCourante,
    rubriques,
    gereDroits: row.gere_droits === true,
  };
}

/**
 * Garde des routes API (Node runtime) : cookie `pj_token`. Retourne la session avec les attributs ACTUELS du
 * compte, ou `null`.
 *
 * Elle applique aussi les rubriques du chemin demandé (même règle que le
 * proxy, lib/rubriques.ts), à partir des rubriques lues EN BASE : la garde du
 * handler ne dépend plus du seul proxy (matcher modifié, chemin exclu par
 * erreur, appel direct du handler). Le proxy refuse déjà ces requêtes en 403 ;
 * si l'une passait malgré tout, elle est refusée ici (401).
 */
export async function requireAuth(request: NextRequest): Promise<JWTPayload | null> {
  const session = await resoudreSession(tokenDepuisRequete(request));
  if (!session) return null;
  const exigees = rubriquesExigees(request.nextUrl.pathname, request.method);
  if (exigees && !satisfaitExigence(session, exigees)) return null;
  return session;
}

/**
 * Récupère l'utilisateur authentifié depuis le cookie pj_token.
 * À utiliser dans les Server Components et Server Actions.
 *
 * Seul appel à `cookies()` de l'application (lib/session.ts passe par ici).
 *
 * `cache` : pendant le rendu d'UNE page, le layout, la page et `getTenantId`
 * demandent chacun la session ; la base n'est interrogée qu'une fois. La
 * mémoire ne dépasse jamais la requête HTTP en cours : la suivante revérifie
 * le compte (statut, rôle, révocation).
 */
export const getAuthUser = cache(async (): Promise<JWTPayload | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return resoudreSession(token);
});

/**
 * Levée quand une page demande le tenant sans session valide (expirée ou
 * révoquée entre deux rendus). Nommée pour que le monitoring la reconnaisse :
 * le layout redirige vers la connexion, ce n'est pas une panne à signaler.
 */
export class SessionInvalideError extends Error {
  constructor() {
    super('Session invalide ou expirée — tenant indéterminé.');
    this.name = 'SessionInvalideError';
  }
}

/**
 * Retourne le tenant_id de la session courante.
 *
 * Source de vérité UNIQUE pour le cloisonnement des données entre structures.
 * Ne jamais lire le tenant depuis un en-tête HTTP (`x-tenant-id`) : les en-têtes
 * entrants sont contrôlés par le client, ce qui permettrait à un utilisateur
 * authentifié de lire les données d'une autre structure en ajoutant simplement
 * l'en-tête à sa requête.
 *
 * Lève une erreur plutôt que de replier sur une valeur par défaut : un repli
 * silencieux exposerait les données du tenant par défaut à une session invalide
 * ou révoquée.
 */
export async function getTenantId(): Promise<string> {
  const user = await getAuthUser();
  if (!user?.tenant_id) {
    throw new SessionInvalideError();
  }
  return user.tenant_id;
}

/**
 * Garde pour les server actions : utilisateur authentifié requis.
 */
export async function requireActionAuth(): Promise<JWTPayload | null> {
  return getAuthUser();
}

/**
 * Garde pour les server actions réservées à l'admin. Avec `rubrique`, l'admin
 * doit en plus avoir cette rubrique du menu (ex. 'animateurs' pour gérer les
 * comptes).
 */
export async function requireActionAdmin(rubrique?: string): Promise<JWTPayload | null> {
  const user = await getAuthUser();
  if (!user || user.role !== 'admin') return null;
  if (rubrique && !satisfaitExigence(user, [rubrique])) return null;
  return user;
}

/**
 * Garde pour les server actions rattachées à une rubrique du menu : session
 * valide ET l'une des rubriques indiquées ouverte au compte (même règle que le
 * proxy, voir lib/rubriques.ts). Indispensable en plus du proxy : une server
 * action peut être appelée depuis n'importe quelle page.
 */
export async function requireActionRubrique(...rubriques: string[]): Promise<JWTPayload | null> {
  const user = await getAuthUser();
  if (!user || !satisfaitExigence(user, rubriques)) return null;
  return user;
}
