/**
 * Helpers de date locale.
 *
 * ⚠️ NE JAMAIS utiliser `new Date().toISOString().split('T')[0]` pour obtenir
 * « la date d'aujourd'hui ». `toISOString()` renvoie TOUJOURS l'heure UTC :
 * entre minuit et 02h (heure de Paris, UTC+2 l'été), il renvoie la veille.
 * Le serveur tourne avec TZ=Europe/Paris, donc les getters locaux
 * (getFullYear/getMonth/getDate) donnent la bonne date de Paris.
 */

/** Formate un objet Date en 'YYYY-MM-DD' d'après l'heure LOCALE (pas UTC). */
export function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Date d'aujourd'hui au format 'YYYY-MM-DD', en heure locale. */
export function todayLocal(): string {
  return toLocalDateStr(new Date());
}

/**
 * Âge en années révolues à partir d'une date de naissance ('YYYY-MM-DD').
 *
 * Implémentation UNIQUE : le calcul existait auparavant en trois exemplaires
 * (`getAge` et `getAgeFromDate` dans lib/data.ts, plus une copie locale dans
 * JeunesClient). Les tranches d'âge servent aux statistiques transmises à la
 * CAF : elles doivent être calculées de façon identique partout.
 *
 * Retourne NaN si la date est absente ou invalide — aux appelants de décider
 * quoi afficher, plutôt que de renvoyer un 0 trompeur qui fausserait les
 * moyennes et les tranches.
 */
export function getAge(dateNaissance: string | null | undefined): number {
  if (!dateNaissance) return NaN;
  const naissance = new Date(dateNaissance);
  if (Number.isNaN(naissance.getTime())) return NaN;

  const now = new Date();
  let age = now.getFullYear() - naissance.getFullYear();
  const mois = now.getMonth() - naissance.getMonth();
  // L'anniversaire n'est pas encore passé cette année → une année de moins.
  if (mois < 0 || (mois === 0 && now.getDate() < naissance.getDate())) age--;
  return age;
}

/**
 * Vrai si `valeur` est une date civile réelle au format AAAA-MM-JJ.
 *
 * Une simple expression régulière laisse passer `2026-02-31` : PostgreSQL la
 * refuse ensuite, et dans une transaction c'est tout le lot qui tombe (import
 * CSV, audit 2026-10-07 A5). Le contrôle se fait par aller-retour : le jour
 * et le mois relus doivent être ceux qui ont été écrits.
 */
export function estDateCivile(valeur: unknown): valeur is string {
  if (typeof valeur !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeur);
  if (!m) return false;
  const [annee, mois, jour] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (annee < 1900 || annee > 2200) return false;
  const d = new Date(Date.UTC(annee, mois - 1, jour));
  return d.getUTCFullYear() === annee && d.getUTCMonth() === mois - 1 && d.getUTCDate() === jour;
}

/**
 * Heure du jour normalisée en `HH:MM` (24 h), ou `null` si la valeur n'en est
 * pas une. `9:05` devient `09:05` : les heures sont stockées en texte et
 * comparées telles quelles, ce qui n'est juste que si elles ont toutes la même
 * forme.
 */
export function normaliserHeure(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(valeur.trim());
  if (!m) return null;
  const [h, min] = [Number(m[1]), Number(m[2])];
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}
