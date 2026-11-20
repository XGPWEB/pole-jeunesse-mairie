/**
 * Client HTTP unique de l'application mobile.
 *
 * Module pur (aucune dépendance React Native) : `fetch`, le jeton et la
 * réaction au 401 sont injectés, ce qui le rend testable hors appareil.
 * L'instance réelle est construite dans `lib/client.ts`.
 *
 * Garanties :
 *  - le jeton n'est envoyé qu'à l'URL de base configurée ;
 *  - un 401 sur une requête authentifiée purge la session (`onUnauthorized`)
 *    puis lève une ApiError — jamais de données de repli ;
 *  - toute erreur (réseau, délai, HTTP, JSON) est levée sous forme d'ApiError
 *    typée ; aucun échec n'est avalé.
 */

export type ApiErrorKind =
  | 'config'
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limited'
  | 'bad_request'
  | 'server'
  | 'invalid_response';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  /** Code applicatif renvoyé par le serveur (ex. TOTP_REQUIRED). */
  readonly code: string | null;

  constructor(kind: ApiErrorKind, message: string, status: number | null = null, code: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

export function estApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

// ─── Configuration de l'URL de base ──────────────────────────────────────────

export type BaseUrlResolue =
  | { ok: true; baseUrl: string }
  | { ok: false; erreur: string };

const MOTIF_URL = /^(https?):\/\/[^\s/?#]+(?:\/[^\s?#]*)?$/i;

/**
 * Valide l'URL du serveur fournie par la configuration de build
 * (`EXPO_PUBLIC_API_URL` ou `extra.apiUrl`). Aucune valeur par défaut :
 * une application sans URL configurée signale l'erreur au lieu de viser
 * silencieusement un serveur. En production, seul https est accepté.
 */
export function resoudreBaseUrl(brut: string | null | undefined, production: boolean): BaseUrlResolue {
  const valeur = (brut ?? '').trim().replace(/\/+$/, '');
  if (!valeur) {
    return { ok: false, erreur: "URL du serveur non configurée (EXPO_PUBLIC_API_URL)." };
  }
  const m = MOTIF_URL.exec(valeur);
  if (!m) {
    return { ok: false, erreur: "URL du serveur invalide (EXPO_PUBLIC_API_URL)." };
  }
  if (production && m[1].toLowerCase() !== 'https') {
    return { ok: false, erreur: "L'URL du serveur doit utiliser https en production." };
  }
  return { ok: true, baseUrl: valeur };
}

// ─── Client ──────────────────────────────────────────────────────────────────

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  base: BaseUrlResolue;
  fetchImpl: FetchLike;
  /** Jeton de session courant, ou null. */
  getToken: () => string | null;
  /** Appelé quand le serveur refuse la session (401 sur requête authentifiée). */
  onUnauthorized: () => void | Promise<void>;
  timeoutMs?: number;
}

export type ValeurQuery = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, ValeurQuery>;
  body?: unknown;
  /** false pour les routes publiques (login, mot de passe oublié). Défaut : true. */
  auth?: boolean;
  timeoutMs?: number;
}

export interface ApiClient {
  request(path: string, options?: RequestOptions): Promise<unknown>;
}

export const DELAI_PAR_DEFAUT_MS = 10_000;

function construireUrl(baseUrl: string, path: string, query?: Record<string, ValeurQuery>): string {
  const chemin = path.startsWith('/') ? path : `/${path}`;
  const paires: string[] = [];
  if (query) {
    for (const [cle, valeur] of Object.entries(query)) {
      if (valeur === null || valeur === undefined) continue;
      paires.push(`${encodeURIComponent(cle)}=${encodeURIComponent(String(valeur))}`);
    }
  }
  return `${baseUrl}${chemin}${paires.length > 0 ? `?${paires.join('&')}` : ''}`;
}

function champTexte(corps: unknown, cle: string): string | null {
  if (typeof corps !== 'object' || corps === null) return null;
  const valeur = (corps as Record<string, unknown>)[cle];
  return typeof valeur === 'string' && valeur.trim() ? valeur : null;
}

function kindPourStatut(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'bad_request';
}

const MESSAGES_PAR_DEFAUT: Record<ApiErrorKind, string> = {
  config: "L'application n'est pas configurée pour joindre le serveur.",
  network: 'Serveur injoignable. Vérifiez votre connexion et réessayez.',
  timeout: 'Le serveur ne répond pas (délai dépassé). Réessayez.',
  unauthorized: 'Votre session a expiré. Veuillez vous reconnecter.',
  forbidden: "Vous n'avez pas les droits pour cette action.",
  not_found: 'Élément introuvable sur le serveur.',
  rate_limited: 'Trop de tentatives. Réessayez dans quelques minutes.',
  bad_request: 'Demande refusée par le serveur.',
  server: 'Erreur du serveur. Réessayez plus tard.',
  invalid_response: 'Réponse inattendue du serveur.',
};

/** Message affichable pour n'importe quelle erreur. */
export function messageErreur(e: unknown): string {
  if (estApiError(e)) return e.message || MESSAGES_PAR_DEFAUT[e.kind];
  return 'Une erreur inattendue est survenue.';
}

export function creerApiClient(options: ApiClientOptions): ApiClient {
  const { base, fetchImpl, getToken, onUnauthorized } = options;
  const delaiDefaut = options.timeoutMs ?? DELAI_PAR_DEFAUT_MS;

  async function request(path: string, req: RequestOptions = {}): Promise<unknown> {
    if (!base.ok) {
      throw new ApiError('config', base.erreur);
    }
    const avecAuth = req.auth !== false;
    const headers: Record<string, string> = { Accept: 'application/json' };

    if (avecAuth) {
      const jeton = getToken();
      if (!jeton) {
        // Pas de session : inutile d'interroger le serveur, et l'écran doit
        // revenir à la connexion comme pour un 401.
        await onUnauthorized();
        throw new ApiError('unauthorized', MESSAGES_PAR_DEFAUT.unauthorized, 401);
      }
      headers.Authorization = `Bearer ${jeton}`;
    }

    let corps: string | undefined;
    if (req.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      corps = JSON.stringify(req.body);
    }

    const controleur = new AbortController();
    let delaiDepasse = false;
    const minuteur = setTimeout(() => {
      delaiDepasse = true;
      controleur.abort();
    }, req.timeoutMs ?? delaiDefaut);

    let reponse: Response;
    let texte: string;
    try {
      reponse = await fetchImpl(construireUrl(base.baseUrl, path, req.query), {
        method: req.method ?? 'GET',
        headers,
        body: corps,
        signal: controleur.signal,
      });
      texte = await reponse.text();
    } catch {
      if (delaiDepasse) throw new ApiError('timeout', MESSAGES_PAR_DEFAUT.timeout);
      throw new ApiError('network', MESSAGES_PAR_DEFAUT.network);
    } finally {
      clearTimeout(minuteur);
    }

    let json: unknown = undefined;
    let jsonValide = true;
    if (texte.trim()) {
      try {
        json = JSON.parse(texte);
      } catch {
        jsonValide = false;
      }
    }

    if (!reponse.ok) {
      const kind = kindPourStatut(reponse.status);
      if (kind === 'unauthorized' && avecAuth) {
        await onUnauthorized();
        throw new ApiError(kind, MESSAGES_PAR_DEFAUT.unauthorized, 401, champTexte(json, 'code'));
      }
      throw new ApiError(
        kind,
        champTexte(json, 'error') ?? MESSAGES_PAR_DEFAUT[kind],
        reponse.status,
        champTexte(json, 'code'),
      );
    }

    if (!jsonValide) {
      throw new ApiError('invalid_response', MESSAGES_PAR_DEFAUT.invalid_response, reponse.status);
    }
    // Certaines routes répondent 200 avec { success: false, error } : c'est un échec.
    if (typeof json === 'object' && json !== null && (json as Record<string, unknown>).success === false) {
      throw new ApiError('server', champTexte(json, 'error') ?? MESSAGES_PAR_DEFAUT.server, reponse.status);
    }
    return json;
  }

  return { request };
}
