/**
 * Adresse publique de l'application (ex. https://polejeunesse.ville-nogentsurmarne.fr).
 *
 * Source unique : APP_BASE_URL, lue sur le serveur dans /opt/pj-secrets.env.
 * Aucune adresse n'est écrite en dur dans le code : elle change avec le
 * serveur (mise en service mairie) sans modifier l'application.
 *
 * Volontairement issue de la configuration et JAMAIS de l'en-tête Host de la
 * requête : un Host forgé ferait partir des liens (réinitialisation de mot de
 * passe…) vers le domaine d'un attaquant.
 */

const ADRESSE_LOCALE = 'http://localhost:3000';

export class AdresseManquanteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdresseManquanteError';
  }
}

/** Normalise et valide une adresse : http(s), sans chemin, sans « / » final. */
export function normaliserAdresse(brute: string): string {
  const valeur = brute.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(valeur);
  } catch {
    throw new AdresseManquanteError(`APP_BASE_URL invalide : « ${brute} »`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AdresseManquanteError(`APP_BASE_URL doit commencer par https:// : « ${brute} »`);
  }
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new AdresseManquanteError(`APP_BASE_URL ne doit contenir que l'adresse du site, sans chemin : « ${brute} »`);
  }
  return url.origin;
}

/**
 * Adresse publique, sans « / » final. En production, l'absence de
 * APP_BASE_URL (et de ALLOWED_ORIGIN) est une erreur (plutôt que d'envoyer des liens vers une
 * mauvaise adresse) ; en développement et en test, repli sur localhost.
 */
export function adresseApplication(env: NodeJS.ProcessEnv = process.env): string {
  // ALLOWED_ORIGIN : repli historique (serveurs configurés avant APP_BASE_URL).
  const brute = env.APP_BASE_URL?.trim() || env.ALLOWED_ORIGIN?.trim();
  if (brute) return normaliserAdresse(brute);
  if (env.NODE_ENV === 'production') {
    throw new AdresseManquanteError('APP_BASE_URL manquant : renseigner l\'adresse du site dans /opt/pj-secrets.env');
  }
  return ADRESSE_LOCALE;
}

/**
 * Valeur de l'en-tête Access-Control-Allow-Origin des routes API.
 * ALLOWED_ORIGIN garde la priorité (réglage existant) ; sinon l'origine de
 * APP_BASE_URL. Ne lève jamais d'erreur : ces en-têtes sont calculés au
 * chargement des routes, y compris pendant le build, où rien n'est configuré.
 * Le repli localhost n'autorise aucun site tiers.
 */
export function origineAutorisee(env: NodeJS.ProcessEnv = process.env): string {
  const permise = env.ALLOWED_ORIGIN?.trim();
  if (permise) return permise;
  try {
    const brute = env.APP_BASE_URL;
    if (brute && brute.trim()) return normaliserAdresse(brute);
  } catch {
    // Adresse invalide : le serveur la refuse au démarrage du déploiement
    // (scripts/check-deploy-secrets.sh) ; ici, repli sans risque.
  }
  return ADRESSE_LOCALE;
}
