/**
 * Correspondance entre l'espace assigné à un animateur (libellé ou identifiant
 * renvoyé par le serveur) et l'identifiant d'espace utilisé par les données.
 * Module pur.
 */

const LIBELLE_VERS_ID: Record<string, string> = {
  'Collégiens': 'collegiens',
  'Lycéens': 'lyceens',
  'PIJ': 'pij',
  'CLAS': 'clas',
};

export const TOUS_ESPACES = 'all';

/** Identifiant d'espace de l'animateur, ou `all` s'il couvre tous les espaces. */
export function espaceIdAssigne(espaceAssigne: string | null | undefined): string {
  const valeur = (espaceAssigne ?? '').trim();
  if (!valeur || valeur === 'Tous') return TOUS_ESPACES;
  return LIBELLE_VERS_ID[valeur] ?? valeur;
}

export function libelleEspaceAssigne(espaceAssigne: string | null | undefined): string {
  const valeur = (espaceAssigne ?? '').trim();
  return valeur || 'Tous';
}

export function filtrerParEspace<T extends { espaceId: string | null }>(elements: T[], espaceId: string): T[] {
  return espaceId === TOUS_ESPACES ? elements : elements.filter((e) => e.espaceId === espaceId);
}
