/**
 * Garde de démarrage du secret JWT — module partagé par `lib/auth.ts` (runtime
 * Node) et `proxy.ts` (ex-middleware). Il ne doit donc dépendre d'AUCUNE
 * API Node (pas de `crypto`, pas de `fs`) : uniquement `process.env` et
 * `TextEncoder`, disponibles dans les deux runtimes.
 *
 * Pourquoi une garde plus stricte que « la variable existe » : le script de
 * déploiement écrivait un placeholder dans la configuration PM2 et se
 * contentait d'un avertissement si le vrai secret manquait. L'application
 * démarrait alors avec une valeur PUBLIQUE (lisible dans le dépôt), ce qui
 * permet à n'importe qui de forger un JWT admin. Un secret connu ou trop court
 * doit empêcher le démarrage, pas produire un simple log.
 */

/** HS256 : la clé doit faire au moins la taille du condensé (256 bits). */
export const JWT_SECRET_MIN_LENGTH = 32;

/**
 * Valeurs de remplacement connues (toutes présentes en clair dans le dépôt ou
 * dans des tutoriels) : refusées quelle que soit leur longueur.
 * Comparaison insensible à la casse et aux espaces de bord.
 */
const PLACEHOLDERS_CONNUS: readonly string[] = [
  // Racine du dépôt : .env.example
  'pj-nogent-secret-changez-moi-en-prod',
  // deploy.sh : jeton de substitution de la configuration PM2
  '__jwt_secret__',
  // Commentaire d'exemple de deploy.sh (« JWT_SECRET=<chaîne aléatoire longue> »)
  '<chaîne aléatoire longue>',
  // Valeurs génériques fréquentes
  'changeme', 'change-me', 'changez-moi', 'secret', 'jwt_secret', 'jwt-secret',
  'your-secret-key', 'your_jwt_secret', 'undefined', 'null',
];

/** Fragments qui trahissent une valeur d'exemple, même rallongée à 32+ caractères. */
const FRAGMENTS_PLACEHOLDER: readonly string[] = [
  'changez-moi', 'change-me', 'changeme', 'placeholder', '__jwt_secret__',
];

/**
 * Retourne la raison du refus, ou `null` si le secret est acceptable.
 * Exportée pour être testée unitairement sans redémarrer le module.
 */
export function raisonRefusSecretJwt(
  secret: string | undefined | null,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string | null {
  if (secret === undefined || secret === null) return 'absent';
  const valeur = secret.trim();
  if (valeur.length === 0) return 'vide';
  if (valeur.length < JWT_SECRET_MIN_LENGTH) {
    return `trop court (${valeur.length} caractères, minimum ${JWT_SECRET_MIN_LENGTH})`;
  }
  const normalise = valeur.toLowerCase();
  if (PLACEHOLDERS_CONNUS.includes(normalise)) return 'valeur de remplacement connue';
  if (FRAGMENTS_PLACEHOLDER.some((f) => normalise.includes(f))) return 'valeur de remplacement connue';
  // Les secrets des suites de tests sont publics (versionnés) : acceptables
  // pour vitest/CI, jamais pour signer des sessions de production.
  if (nodeEnv === 'production' && normalise.includes('not-for-prod')) {
    return 'secret de test utilisé en production';
  }
  return null;
}

/**
 * Clé de signature/vérification HS256.
 *
 * Lève une erreur au chargement du module appelant si le secret est
 * inutilisable. Seule exemption, conservée de l'implémentation précédente : la
 * phase `next build`, pendant laquelle Next importe les modules sans que les
 * secrets d'exécution soient disponibles (aucun jeton n'y est signé ni vérifié).
 */
export function getJwtSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  const raison = raisonRefusSecretJwt(secret);
  if (raison && process.env.NEXT_PHASE !== 'phase-production-build') {
    throw new Error(
      `[SECURITE] JWT_SECRET refusé : ${raison}. Définissez une chaîne aléatoire ` +
      `d'au moins ${JWT_SECRET_MIN_LENGTH} caractères (ex. : openssl rand -base64 48).`,
    );
  }
  return new TextEncoder().encode(secret ?? '');
}
