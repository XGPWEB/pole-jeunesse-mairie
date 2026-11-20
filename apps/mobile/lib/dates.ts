/**
 * Dates civiles de la structure (fuseau Europe/Paris).
 *
 * Module pur (aucune dépendance React Native) : toute date de pointage ou de
 * semaine DOIT être dérivée d'ici. Ne jamais utiliser `toISOString()` (UTC) ni
 * les getters locaux de l'appareil (`getDate()`, `getDay()`…) pour obtenir un
 * jour de pointage : le 6 octobre 2026 à 00:30 à Paris est encore le 5 octobre
 * en UTC, et un téléphone réglé sur un autre fuseau donnerait un autre jour.
 */

export const FUSEAU_STRUCTURE = 'Europe/Paris';

const FORMAT_PARIS = new Intl.DateTimeFormat('en-GB', {
  timeZone: FUSEAU_STRUCTURE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

interface PartiesParis {
  annee: string;
  mois: string;
  jour: string;
  heure: string;
  minute: string;
}

function partiesParis(instant: Date): PartiesParis {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError('Instant invalide');
  }
  const lu: Record<string, string> = {};
  for (const partie of FORMAT_PARIS.formatToParts(instant)) {
    lu[partie.type] = partie.value;
  }
  return {
    annee: lu.year,
    mois: lu.month,
    jour: lu.day,
    // Certains moteurs rendent « 24 » à minuit malgré hourCycle h23.
    heure: lu.hour === '24' ? '00' : lu.hour,
    minute: lu.minute,
  };
}

const MOTIF_DATE_CIVILE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function estDateCivile(valeur: string): boolean {
  const m = MOTIF_DATE_CIVILE.exec(valeur);
  if (!m) return false;
  const utc = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    utc.getUTCFullYear() === Number(m[1]) &&
    utc.getUTCMonth() === Number(m[2]) - 1 &&
    utc.getUTCDate() === Number(m[3])
  );
}

function versUtc(dateCivile: string): Date {
  if (!estDateCivile(dateCivile)) {
    throw new RangeError(`Date civile invalide : ${dateCivile}`);
  }
  const [a, m, j] = dateCivile.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, j));
}

function depuisUtc(utc: Date): string {
  const a = String(utc.getUTCFullYear()).padStart(4, '0');
  const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const j = String(utc.getUTCDate()).padStart(2, '0');
  return `${a}-${m}-${j}`;
}

/** Date civile (YYYY-MM-DD) à Paris pour un instant donné. */
export function dateCivileParis(instant: Date = new Date()): string {
  const p = partiesParis(instant);
  return `${p.annee}-${p.mois}-${p.jour}`;
}

/** Heure murale (HH:MM) à Paris pour un instant donné. */
export function heureParis(instant: Date = new Date()): string {
  const p = partiesParis(instant);
  return `${p.heure}:${p.minute}`;
}

/**
 * Ramène une valeur reçue du serveur à une date civile.
 * - `YYYY-MM-DD` (colonne DATE) : rendue telle quelle, sans passer par un instant ;
 * - horodatage ISO : converti en jour civil de Paris.
 */
export function versDateCivile(valeur: string): string {
  if (estDateCivile(valeur)) return valeur;
  const instant = new Date(valeur);
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError(`Date illisible : ${valeur}`);
  }
  return dateCivileParis(instant);
}

/** Arithmétique calendaire pure : insensible aux changements d'heure. */
export function ajouterJours(dateCivile: string, jours: number): string {
  const utc = versUtc(dateCivile);
  utc.setUTCDate(utc.getUTCDate() + jours);
  return depuisUtc(utc);
}

/** Jour de la semaine ISO : 1 = lundi … 7 = dimanche. */
export function jourSemaineIso(dateCivile: string): number {
  const j = versUtc(dateCivile).getUTCDay();
  return j === 0 ? 7 : j;
}

export function lundiDeLaSemaine(dateCivile: string): string {
  return ajouterJours(dateCivile, 1 - jourSemaineIso(dateCivile));
}

export function jourDuMois(dateCivile: string): number {
  return versUtc(dateCivile).getUTCDate();
}

/** Comparaison lexicographique : valide pour le format YYYY-MM-DD. */
export function comparerDatesCiviles(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface JourSemaine {
  dateStr: string;
  jourDuMois: number;
  label: string;
  shortLabel: string;
  isToday: boolean;
  isFuture: boolean;
}

const JOURS_COURTS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const JOURS_LONGS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

/**
 * Les six jours ouvrés (lundi → samedi) de la semaine contenant « aujourd'hui »
 * à Paris, décalée de `decalage` semaines.
 */
export function joursDeLaSemaine(decalage: number, maintenant: Date = new Date()): JourSemaine[] {
  const aujourdhui = dateCivileParis(maintenant);
  const lundi = ajouterJours(lundiDeLaSemaine(aujourdhui), decalage * 7);
  return JOURS_COURTS.map((shortLabel, i) => {
    const dateStr = ajouterJours(lundi, i);
    return {
      dateStr,
      jourDuMois: jourDuMois(dateStr),
      label: JOURS_LONGS[i],
      shortLabel,
      isToday: dateStr === aujourdhui,
      isFuture: dateStr > aujourdhui,
    };
  });
}

/**
 * Affichage d'une date civile : formatée en UTC à partir de minuit UTC, donc
 * jamais décalée d'un jour par le fuseau de l'appareil.
 */
export function formaterDateCivile(
  dateCivile: string,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' },
): string {
  return new Intl.DateTimeFormat('fr-FR', { ...options, timeZone: 'UTC' }).format(versUtc(dateCivile));
}

/** Âge révolu à la date civile de référence (aujourd'hui à Paris par défaut). */
export function calculerAge(dateNaissance: string, reference: string = dateCivileParis()): number | null {
  let naissance: string;
  try {
    naissance = versDateCivile(dateNaissance);
  } catch {
    return null;
  }
  const [an, mn, jn] = naissance.split('-').map(Number);
  const [ar, mr, jr] = reference.split('-').map(Number);
  let age = ar - an;
  if (mr < mn || (mr === mn && jr < jn)) age -= 1;
  return age;
}
