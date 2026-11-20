import ReinitialisationClient from './ReinitialisationClient';

export const metadata = {
  title: 'Nouveau mot de passe — Pôle Jeunesse',
  // Le lien contient un jeton à usage unique : on demande au navigateur de ne
  // transmettre aucun Referer depuis cette page.
  referrer: 'no-referrer' as const,
};

/**
 * Page PUBLIQUE (déclarée dans PUBLIC_PATHS du middleware) : le titulaire qui
 * a perdu son mot de passe n'a, par définition, pas de session.
 * Elle ne lit aucune donnée : tout se joue dans l'appel à
 * /api/auth/reset-password/confirm, qui valide et consomme le jeton.
 */
export default function ReinitialisationPage() {
  return <ReinitialisationClient />;
}
