import { redirect } from 'next/navigation';
import { getAuthUser, JWTPayload } from './auth';
import { aRubrique } from './rubriques';

/**
 * Session courante pour les Server Components (layouts, pages).
 *
 * Délègue ENTIÈREMENT à `getAuthUser` : il n'existe qu'une seule
 * implémentation de la garde (lib/auth.ts). La copie qui vivait ici avait
 * divergé — elle acceptait les billets 2FA provisoires (`totp-pending`), si
 * bien qu'un mot de passe admin seul suffisait à afficher les pages
 * d'administration avant la validation du second facteur.
 *
 * Seule différence conservée : ne lève jamais (retourne `null` en cas
 * d'erreur), car les layouts s'en servent pour décider d'une redirection.
 */
export async function getSession(): Promise<JWTPayload | null> {
  try {
    return await getAuthUser();
  } catch {
    return null;
  }
}

export async function requireAdmin(): Promise<JWTPayload> {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    throw new Error('Accès refusé — rôle admin requis');
  }
  return session;
}

/**
 * Garde des pages réservées à l'admin situées HORS du groupe `(admin)` (dont
 * le layout fait déjà ce contrôle) : /animateurs, /rgpd, /parametres,
 * /communication, /securite.
 *
 * Le middleware filtre ces chemins à partir du rôle inscrit dans le JWT, sans
 * accès à la base. Ici le rôle vient de la base (via la garde unique) : une
 * session révoquée, suspendue ou rétrogradée est refusée même si son jeton
 * est encore syntaxiquement valide.
 */
export async function exigerAdminPage(rubrique?: string): Promise<JWTPayload> {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/animateur/dashboard');
  // Rubrique du menu non accordée à ce compte (le proxy le refuse déjà ;
  // contrôle répété ici à partir de la base).
  if (rubrique && !aRubrique(session, rubrique)) redirect('/admin/dashboard');
  return session;
}
