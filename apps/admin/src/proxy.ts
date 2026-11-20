import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { getJwtSecretKey } from '@/lib/jwt-secret';
import { rubriquesExigees, satisfaitExigence } from '@/lib/rubriques';

// Même garde de démarrage que lib/auth.ts (module partagé, compatible Edge) :
// secret absent, vide, trop court ou placeholder connu → refus de démarrer.
const JWT_SECRET = getJwtSecretKey();

/**
 * Chemins laissés passer sans jeton. ATTENTION : « public pour le middleware »
 * ne veut pas dire « anonyme » — sous /api/auth/ cohabitent des routes
 * réellement anonymes (login, forgot-password, confirmation de reset) et des
 * routes protégées (logout, totp/setup, reset-password déclenché par un
 * admin). Ces dernières DOIVENT appeler `requireAuth` elles-mêmes.
 */
const PUBLIC_PATHS = [
  '/login', '/reinitialisation', '/api/auth/', '/api/health',
  // Rapports du navigateur (une page en panne peut être l'écran de connexion)
  // et des scripts d'exploitation (secret partagé) : voir ces routes.
  '/api/monitoring/report', '/api/monitoring/internal-report',
  // Abonnement de calendrier (Outlook, LE HUB) : ces clients n'envoient ni
  // cookie ni en-tête. Le jeton du chemin tient lieu d'authentification, il
  // est contrôlé en base par la route. Rien d'autre sous /api/pij/ n'est public,
  // à part la synchro LE HUB ci-dessous.
  '/api/pij/agenda/flux/',
  // Synchro de l'agenda PIJ avec le serveur de LE HUB : secret partagé
  // contrôlé par la route (404 tant qu'il n'est pas configuré).
  '/api/pij/hub/',
  '/_next', '/favicon.ico', '/logo-pj.png', '/icon.png', '/apple-icon.png',
];

/**
 * Pages racine qui sont en réalité les vraies implémentations réutilisées
 * (par ré-export ou import direct) par les pages sous `/admin/*`. Elles sont
 * accessibles directement, hors du groupe `/admin`, et doivent donc porter
 * exactement la même restriction de rôle que leur équivalent `/admin/xxx`
 * — sans quoi un animateur qui connaît l'URL peut contourner le contrôle
 * de rôle simplement en visitant `/rgpd` au lieu de `/admin/rgpd`.
 */
const ADMIN_ONLY_ROOT_PATHS = [
  '/rgpd', '/securite', '/parametres', '/communication', '/animateurs',
];

/**
 * Comparaison de chemin par segment complet : `pathname === base` ou
 * `pathname` commence par `base + '/'`. Un simple `startsWith(base)` ferait
 * correspondre `/animateurs` (page racine admin-only) au préfixe `/animateur`
 * (espace animateur), ce qui casserait la logique de rôle pour les deux.
 */
function pathMatches(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * Neutralise les en-têtes que le client ne doit jamais pouvoir imposer.
 * Le tenant est déterminé exclusivement à partir de la session (getTenantId) ;
 * ce nettoyage est une seconde barrière, au cas où du code réintroduirait un
 * jour une lecture de `x-tenant-id` dans les en-têtes entrants.
 */
function requestSansEnTetesFalsifiables(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete('x-tenant-id');
  return { request: { headers } };
}

// Next 16 : la convention de fichier `middleware` est dépréciée au profit de
// `proxy` (même rôle, exécuté sur le runtime Node). Le contenu est inchangé.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');

  // Les cookies SameSite ne protègent pas contre une origine sœur compromise.
  // Les clients natifs n'envoient pas Origin ; les navigateurs qui envoient
  // une mutation doivent venir de l'application ou de l'origine configurée.
  if (isApi && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origine = request.headers.get('origin');
    const autorisees = new Set([request.nextUrl.origin]);
    // Next dev normalise 127.0.0.1 en localhost dans nextUrl. Le Host HTTP
    // conserve l'autorité demandée par le navigateur (Nginx le transmet en
    // production) ; ne pas prendre x-forwarded-host, que le client peut fournir.
    const hote = request.headers.get('host');
    if (hote) autorisees.add(`${request.nextUrl.protocol}//${hote}`);
    for (const base of [process.env.APP_BASE_URL, process.env.ALLOWED_ORIGIN]) {
      if (base) autorisees.add(new URL(base).origin);
    }
    if (origine && !autorisees.has(origine)) {
      return NextResponse.json({ error: 'Origine de la requête non autorisée' }, { status: 403 });
    }
  }

  const isPublic = PUBLIC_PATHS.some((p) => p.endsWith('/') ? pathname.startsWith(p) : pathMatches(pathname, p));
  if (isPublic) return NextResponse.next(requestSansEnTetesFalsifiables(request));

  // Même règle que lib/auth.ts (tokenDepuisRequete) : seul le cookie
  // `pj_token` ouvre une session ; un en-tête `Authorization: Bearer` est
  // ignoré (plus d'application mobile). Réimplémenté ici car lib/auth.ts
  // dépend de `pg` et ne peut pas être chargé dans le runtime Edge.
  const token = request.cookies.get('pj_token')?.value ?? null;

  const refuser = (effacerCookie: boolean) => {
    if (isApi) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    const loginUrl = new URL('/login', request.url);
    if (!effacerCookie) loginUrl.searchParams.set('redirect', pathname);
    const response = NextResponse.redirect(loginUrl);
    if (effacerCookie) response.cookies.delete('pj_token');
    return response;
  };

  if (!token) return refuser(false);

  let payload: { role?: string; id?: string; type?: string; rubriques?: string[] | null };
  try {
    const result = await jwtVerify(token, JWT_SECRET, { algorithms: ['HS256'] });
    payload = result.payload as typeof payload;
  } catch {
    return refuser(true);
  }

  // Un billet 2FA provisoire (`type: 'totp-pending'`) — ou tout autre jeton
  // typé — n'est PAS une session : il ne doit ouvrir ni page ni API. Sans ce
  // contrôle, le mot de passe seul d'un admin suffisait à passer le middleware.
  //
  // Le middleware reste une PREMIÈRE barrière (signature, expiration, type) :
  // il ne peut pas interroger PostgreSQL depuis le runtime Edge. Révocation,
  // suspension et attributs actuels (rôle, tenant) sont contrôlés en base par
  // la garde unique de lib/auth.ts, appelée par chaque route, action et layout.
  if (payload.type !== undefined && payload.type !== null) {
    return refuser(true);
  }

  if (pathname === '/') {
    const dest = payload.role === 'admin' ? '/admin/dashboard' : '/animateur/dashboard';
    return NextResponse.redirect(new URL(dest, request.url));
  }

  if (pathMatches(pathname, '/admin') && payload.role !== 'admin') {
    return NextResponse.redirect(new URL('/animateur/dashboard', request.url));
  }

  if (pathMatches(pathname, '/animateur') && payload.role === 'admin') {
    // Pages d'impression partagées avec l'administration (fiche sortie ou
    // projet, fiches sanitaires d'une sortie) : elles n'ont pas de double côté
    // /admin. Elles restent soumises au contrôle des rubriques ci-dessous.
    const impression = pathname.endsWith('/print') || pathname.endsWith('/fiches-sanitaires');
    if (!impression) return NextResponse.redirect(new URL('/admin/dashboard', request.url));
  }

  // Mêmes pages que /admin/*, accessibles aussi directement à la racine
  // (ré-exportées ou importées par les pages du groupe /admin) : même contrôle
  // de rôle, sinon un animateur peut contourner la restriction en visitant
  // directement /rgpd, /securite, /parametres, /communication ou /animateurs.
  if (ADMIN_ONLY_ROOT_PATHS.some((base) => pathMatches(pathname, base)) && payload.role !== 'admin') {
    return NextResponse.redirect(new URL('/animateur/dashboard', request.url));
  }

  // Rubriques du menu accordées au compte (lib/rubriques.ts) : une page ou une
  // API d'une rubrique retirée est refusée, pas seulement masquée du menu.
  // Le jeton porte les rubriques ; la garde de lib/auth.ts refuse tout jeton
  // dont les rubriques ne sont plus celles de la base.
  const exigees = rubriquesExigees(pathname, request.method);
  if (exigees && !satisfaitExigence({ role: payload.role ?? '', rubriques: payload.rubriques ?? null }, exigees)) {
    if (isApi) return NextResponse.json({ error: 'Accès refusé — rubrique non autorisée pour ce compte' }, { status: 403 });
    const accueil = payload.role === 'admin' ? '/admin/dashboard' : '/animateur/dashboard';
    return NextResponse.redirect(new URL(accueil, request.url));
  }

  return NextResponse.next(requestSansEnTetesFalsifiables(request));
}

export const config = {
  matcher: [
    // Les extensions d'image ne sont pas une preuve de fichier public : un
    // identifiant dynamique peut en contenir et doit rester contrôlé.
    '/((?!_next/static|_next/image|favicon.ico$|logo-pj.png$).*)',
  ],
};
