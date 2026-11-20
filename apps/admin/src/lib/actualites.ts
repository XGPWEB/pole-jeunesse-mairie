/**
 * Archivage des actualités de catégorie « événement ».
 *
 * Une annonce d'événement n'a plus d'intérêt une fois l'événement passé : dès
 * le lendemain de sa date, elle quitte les listes courantes (page Actualités,
 * tableaux de bord, API) et rejoint les archives. Rien n'est supprimé, et il
 * n'y a pas d'état à tenir en base : l'archivage se déduit de la catégorie et
 * de la date. Les autres catégories (info, annonce, urgence…) ne s'archivent
 * pas d'elles-mêmes.
 *
 * Module pur, importable depuis un composant client.
 */

/** La catégorie a été saisie sous plusieurs formes au fil du temps : « Evenement », « evenement », « Événement ». */
export function estCategorieEvenement(categorie: string | null | undefined): boolean {
  return (categorie ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase() === 'evenement';
}

/** Vrai si l'actualité est un événement dont la date est passée. `aujourdhui` et `date` : AAAA-MM-JJ. */
export function estEvenementPasse(
  actualite: { categorie?: string | null; date?: string | null },
  aujourdhui: string,
): boolean {
  return estCategorieEvenement(actualite.categorie) && !!actualite.date && actualite.date.slice(0, 10) < aujourdhui;
}

/**
 * Même règle en SQL, pour une table `actualites` (alias facultatif) ;
 * `parametre` est le numéro du paramètre portant la date du jour.
 */
export function sqlEvenementPasse(parametre: number, alias = ''): string {
  return `(lower(btrim(COALESCE(${alias}categorie, ''))) IN ('evenement', 'événement') AND ${alias}date < $${parametre}::date)`;
}
