/**
 * Version de l'application, figée au moment du build (next.config.js lit le
 * fichier VERSION à la racine du dépôt et le commit Git courant).
 */
export const APP_VERSION: string = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0';
export const APP_COMMIT: string = process.env.NEXT_PUBLIC_APP_COMMIT || '';

/** « 2.1.0 » — ou « 2.1.0 (abc1234) » quand le commit du build est connu. */
export function versionComplete(): string {
  return APP_COMMIT ? `${APP_VERSION} (${APP_COMMIT})` : APP_VERSION;
}
