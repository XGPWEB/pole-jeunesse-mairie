import { getAge } from '@/lib/dates';

/**
 * Espace à proposer pour un jeune d'après son âge et la tranche d'âge des
 * espaces de la commune (« 11-14 ans », « 15 à 17 ans »…).
 *
 * Ne propose que si le choix est sans équivoque : un seul espace couvre cet
 * âge, ou un seul parmi les plus resserrés (un espace « 11-25 ans » ouvert à
 * tous ne l'emporte pas sur « 11-14 ans »). Sinon `null` : à la personne de
 * choisir. Module pur, importable depuis un composant client.
 */
export function proposerEspace(
  espaces: { id: string; trancheAge?: string | null }[],
  dateNaissance: string | null | undefined,
): string | null {
  const age = getAge(dateNaissance);
  if (Number.isNaN(age)) return null;
  const couvrants = espaces.flatMap(e => {
    const m = /(\d{1,2})\D+(\d{1,2})/.exec(e.trancheAge ?? '');
    if (!m) return [];
    const [min, max] = [Number(m[1]), Number(m[2])];
    return min <= age && age <= max ? [{ id: e.id, etendue: max - min }] : [];
  });
  if (couvrants.length === 0) return null;
  const plusResserree = Math.min(...couvrants.map(c => c.etendue));
  const retenus = couvrants.filter(c => c.etendue === plusResserree);
  return retenus.length === 1 ? retenus[0].id : null;
}
