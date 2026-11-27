// ─── Adresse d'expédition des courriels ──────────────────────────────────────
//
// L'adresse affichée comme expéditeur vient de MAIL_FROM, et non du compte de
// connexion au serveur SMTP : sur une messagerie de collectivité, ce compte
// est souvent un identifiant technique (« DOMAINE\\compte », compte de
// service…) qui n'est pas une adresse valide. SMTP_USER ne sert de repli que
// s'il ressemble à une adresse.
//
// MAIL_FROM accepte une adresse seule (`a@b.fr`) ou la forme
// `"Nom" <a@b.fr>` ; seule l'adresse est retenue, chaque envoi fixant son
// propre nom d'expéditeur.
//
// Fonction pure de l'environnement : se teste sans serveur.

export interface ExpediteurEnv {
  MAIL_FROM?: string;
  SMTP_USER?: string;
}

const ADRESSE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function extraireAdresse(valeur: string | undefined): string | null {
  const brut = valeur?.trim();
  if (!brut) return null;
  const entreChevrons = brut.match(/<([^>]+)>/);
  const adresse = (entreChevrons ? entreChevrons[1] : brut).trim();
  return ADRESSE.test(adresse) ? adresse : null;
}

/** Adresse d'expédition, ou `null` si ni MAIL_FROM ni SMTP_USER n'en donnent une. */
export function adresseExpediteur(env: ExpediteurEnv = { MAIL_FROM: process.env.MAIL_FROM, SMTP_USER: process.env.SMTP_USER }): string | null {
  return extraireAdresse(env.MAIL_FROM) ?? extraireAdresse(env.SMTP_USER);
}

/**
 * Champ `from` d'un envoi nodemailer. Lève une erreur explicite quand aucune
 * adresse n'est configurée, plutôt que d'envoyer avec un expéditeur invalide
 * que le serveur refuserait (ou que les destinataires classeraient en spam).
 */
export function expediteur(nom: string, env: ExpediteurEnv = { MAIL_FROM: process.env.MAIL_FROM, SMTP_USER: process.env.SMTP_USER }): { name: string; address: string } {
  const address = adresseExpediteur(env);
  if (!address) throw new Error("Adresse d'expédition absente : renseigner MAIL_FROM");
  return { name: nom, address };
}
