import Constants from 'expo-constants';

/**
 * URL du serveur admin Next.js, fournie par la configuration de build :
 *  1. variable `EXPO_PUBLIC_API_URL` (fichier .env en développement, profil EAS
 *     en build — voir eas.json et .env.example) ;
 *  2. à défaut, `expo.extra.apiUrl` (app.json / app.config).
 *
 * Aucune URL n'est codée en dur ici et l'utilisateur ne peut pas la modifier
 * dans l'application : le jeton de session n'est envoyé qu'à cette adresse.
 * La validation (présence, https en production) est faite par
 * `resoudreBaseUrl` dans lib/api.ts.
 */
function lireExtraApiUrl(): string | undefined {
  const extra: unknown = Constants.expoConfig?.extra;
  if (typeof extra !== 'object' || extra === null) return undefined;
  const valeur = (extra as Record<string, unknown>).apiUrl;
  return typeof valeur === 'string' ? valeur : undefined;
}

export const API_URL_CONFIGUREE: string | undefined =
  process.env.EXPO_PUBLIC_API_URL || lireExtraApiUrl();
