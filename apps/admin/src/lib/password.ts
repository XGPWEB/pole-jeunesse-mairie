/**
 * Politique de mot de passe — source unique, partagée par le changement de
 * mot de passe du profil et par la réinitialisation par lien. Les deux flux
 * appliquaient jusque-là des règles différentes (le reset n'en avait aucune).
 *
 * Retourne le message d'erreur à afficher, ou `null` si le mot de passe est
 * acceptable.
 */
/**
 * Longueur minimale : 12 caractères (recommandation CNIL, constat de l'audit
 * du 2026-11-20). Ne s'applique qu'aux nouveaux mots de passe : les comptes
 * existants gardent le leur jusqu'au prochain changement.
 */
export const MOT_DE_PASSE_LONGUEUR_MIN = 12;

export function erreurPolitiqueMotDePasse(motDePasse: unknown): string | null {
  if (typeof motDePasse !== 'string' || motDePasse.length < MOT_DE_PASSE_LONGUEUR_MIN) {
    return `Le mot de passe doit faire au moins ${MOT_DE_PASSE_LONGUEUR_MIN} caractères.`;
  }
  // bcrypt ignore silencieusement tout ce qui dépasse 72 octets : au-delà, deux
  // mots de passe différents donneraient le même hash.
  if (new TextEncoder().encode(motDePasse).length > 72) {
    return 'Le mot de passe ne doit pas dépasser 72 caractères.';
  }
  if (!/[A-Z]/.test(motDePasse)) {
    return 'Le mot de passe doit contenir au moins une majuscule.';
  }
  if (!/[!@#$%^&*?_\-+=~|\\/<>,.;:'"]/.test(motDePasse)) {
    return 'Le mot de passe doit contenir au moins un caractère spécial.';
  }
  return null;
}

const MAJUSCULES = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const MINUSCULES = 'abcdefghjkmnpqrstuvwxyz';
const CHIFFRES = '23456789';
// Sous-ensemble de la politique ci-dessus, facile à lire et à dicter.
const SPECIAUX = '!@#$%?*+=';

function tirage(borne: number): number {
  const valeur = new Uint32Array(1);
  globalThis.crypto.getRandomValues(valeur);
  return valeur[0] % borne;
}

/**
 * Mot de passe proposé par les écrans de gestion des comptes (création,
 * « Générer », réinitialisation). Il respecte TOUJOURS la politique : au moins
 * une majuscule, une minuscule, un chiffre et un caractère spécial, 12
 * caractères, tirés par `crypto.getRandomValues` (navigateur et Node).
 * L'ancien tirage au hasard sur un seul alphabet ne contenait de caractère
 * spécial qu'environ 4 fois sur 10 : depuis que les actions administratives
 * appliquent la politique (audit du 19 octobre, S10), la création échouait.
 */
export function genererMotDePasse(longueur = 12): string {
  const tous = MAJUSCULES + MINUSCULES + CHIFFRES + SPECIAUX;
  const caracteres = [MAJUSCULES, MINUSCULES, CHIFFRES, SPECIAUX].map(alphabet => alphabet[tirage(alphabet.length)]);
  while (caracteres.length < longueur) caracteres.push(tous[tirage(tous.length)]);
  for (let i = caracteres.length - 1; i > 0; i--) {
    const j = tirage(i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
  }
  return caracteres.join('');
}
