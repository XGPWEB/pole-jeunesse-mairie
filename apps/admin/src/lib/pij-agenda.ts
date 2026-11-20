/**
 * Agenda des rendez-vous du PIJ, et son export iCalendar (RFC 5545) pour
 * Outlook et LE HUB.
 *
 * Sans dépendance à la base ni à Next : importé par les routes /api/pij/rdv et
 * /api/pij/agenda/* ET par l'écran.
 *
 * Les heures sont des heures de Paris, sans fuseau (`date` + `heure`) : le
 * calendrier exporté les déclare en `TZID=Europe/Paris`, c'est le logiciel
 * d'agenda qui applique l'heure d'été.
 */

export const STATUTS_RDV = [
  { id: 'prevu',  label: 'Prévu' },
  { id: 'honore', label: 'Honoré' },
  { id: 'absent', label: 'Absent' },
  { id: 'annule', label: 'Annulé' },
] as const;
const STATUT_IDS = new Set<string>(STATUTS_RDV.map(s => s.id));
export const labelStatutRdv = (id: string) => STATUTS_RDV.find(s => s.id === id)?.label ?? id;

export const DUREES_RDV = [15, 30, 45, 60, 90, 120] as const;
export const LIEU_RDV_DEFAUT = 'PIJ';

/** Minutes depuis minuit d'une heure « HH:MM ». */
export const minutesDe = (heure: string) => Number(heure.slice(0, 2)) * 60 + Number(heure.slice(3, 5));

/** Heure de fin « HH:MM » d'un rendez-vous (même jour, bornée à 23:59). */
export function heureFinRdv(heure: string, dureeMinutes: number): string {
  const fin = Math.min(minutesDe(heure) + dureeMinutes, 23 * 60 + 59);
  return `${String(Math.floor(fin / 60)).padStart(2, '0')}:${String(fin % 60).padStart(2, '0')}`;
}

/** « 14:00 – 14:30 » */
export const plageRdv = (r: Pick<RdvPij, 'heure' | 'dureeMinutes'>) => `${r.heure} – ${heureFinRdv(r.heure, r.dureeMinutes)}`;

/**
 * Une seule informatrice reçoit au PIJ : deux rendez-vous non annulés ne
 * peuvent pas se chevaucher (bornes [début, fin) : 14:00–14:30 puis
 * 14:30–15:00 est permis). Message du refus, avec le créneau déjà pris.
 */
export const erreurChevauchement = (autre: Pick<RdvPij, 'heure' | 'dureeMinutes' | 'prenom' | 'nom'>) =>
  `Ce créneau chevauche le rendez-vous de ${autre.prenom} ${autre.nom.trim().charAt(0).toUpperCase()}. (${plageRdv(autre)}) : une seule personne reçoit au PIJ. Choisissez un autre horaire.`;

export interface RdvPij {
  id: string;
  date: string;
  heure: string;
  dureeMinutes: number;
  nom: string;
  prenom: string;
  telephone: string | null;
  objet: string | null;
  lieu: string | null;
  notes: string | null;
  statut: string;
  accueilId: string | null;
  /** Compte qui a posé le rendez-vous (« Prénom Nom »), s'il existe encore. */
  creePar?: string | null;
  /** Dernière modification (ISO 8601) : horodatage de l'événement exporté. */
  modifieLe?: string;
  /**
   * Identifiant du rendez-vous dans LE HUB s'il y a été pris (recopié par la
   * synchro, /api/pij/hub/rdv) : seuls le pointage et les notes se modifient
   * ici, le reste appartient à LE HUB. Absent ou null : saisi ici.
   */
  hubId?: string | null;
}
export type RdvPijSaisie = Omit<RdvPij, 'id' | 'creePar' | 'modifieLe' | 'hubId'>;

/**
 * Fin de journée de l'informatrice (une seule personne reçoit) : un rendez-vous
 * saisi par l'équipe finit au plus tard à cette heure. Même valeur que l'heure
 * de fin des « Créneaux » de LE HUB, qui l'applique de son côté.
 */
export const FIN_JOURNEE_PIJ = '19:00';
export const ERREUR_FIN_JOURNEE =
  `L’informatrice termine sa journée à ${FIN_JOURNEE_PIJ} : le rendez-vous doit finir au plus tard à ${FIN_JOURNEE_PIJ}.`;
export const finitApresJournee = (v: Pick<RdvPij, 'heure' | 'dureeMinutes'>) =>
  minutesDe(v.heure) + v.dureeMinutes > minutesDe(FIN_JOURNEE_PIJ);

/** Statuts de pointage : ils constatent ce qui s'est passé au rendez-vous. */
export const STATUTS_POINTAGE = new Set(['honore', 'absent']);

const HORLOGE_PARIS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Vrai si le rendez-vous a commencé (heure de Paris), à `maintenant`. */
export function rdvCommence(r: Pick<RdvPij, 'date' | 'heure'>, maintenant: Date = new Date()): boolean {
  const p = Object.fromEntries(HORLOGE_PARIS.formatToParts(maintenant).map(x => [x.type, x.value]));
  return `${r.date} ${r.heure}` <= `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/**
 * Pointage refusé avant l'heure de début : un rendez-vous marqué « honoré »
 * à l'avance validait la présence du jeune dans LE HUB (et ses XP) dès
 * l'heure venue, même s'il ne venait pas (constaté le 2026-10-25).
 */
export const erreurPointageAvant = (r: Pick<RdvPij, 'date' | 'heure'>) =>
  `Ce rendez-vous commence le ${r.date.slice(8, 10)}/${r.date.slice(5, 7)} à ${r.heure} : il ne peut être marqué honoré ou absent qu’à partir de cette heure.`;

/** Pointage refusé : le rendez-vous a été annulé dans LE HUB, qui en est maître. */
export const ERREUR_RDV_HUB_ANNULE =
  'Ce rendez-vous a été annulé dans LE HUB : il ne peut plus être pointé ici. Rechargez la page pour voir l’agenda à jour.';

/** Message des écritures refusées sur un rendez-vous pris dans LE HUB. */
export const ERREUR_RDV_HUB =
  'Ce rendez-vous a été pris dans LE HUB : sa date, son heure et le jeune se modifient ou s’annulent depuis LE HUB. Ici, seuls le pointage (honoré, absent) et les notes se modifient.';

type Resultat<T> = { ok: true; valeurs: T } | { ok: false; erreur: string };

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

function texte(v: unknown, max = 300): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t.slice(0, max);
}

export function validerRdv(corps: unknown, maintenant: Date = new Date()): Resultat<RdvPijSaisie> {
  const c = (corps ?? {}) as Record<string, unknown>;
  const nom = texte(c.nom, 100);
  const prenom = texte(c.prenom, 100);
  if (!nom || !prenom) return { ok: false, erreur: 'Le nom et le prénom sont obligatoires.' };

  const date = typeof c.date === 'string' ? c.date : '';
  const reelle = DATE_ISO.test(date) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  if (!reelle) return { ok: false, erreur: 'La date du rendez-vous est obligatoire (format AAAA-MM-JJ).' };

  const heure = typeof c.heure === 'string' ? c.heure.slice(0, 5) : '';
  if (!HEURE.test(heure)) return { ok: false, erreur: 'L’heure du rendez-vous est obligatoire (format HH:MM).' };

  // Heure de fin (écran de saisie) ou durée (LE HUB, imports) : l'une ou l'autre.
  let duree: number;
  const heureFin = typeof c.heureFin === 'string' ? c.heureFin.slice(0, 5) : '';
  if (heureFin !== '') {
    if (!HEURE.test(heureFin)) return { ok: false, erreur: 'L’heure de fin est invalide (format HH:MM).' };
    duree = minutesDe(heureFin) - minutesDe(heure);
    if (duree <= 0) return { ok: false, erreur: 'L’heure de fin doit être après l’heure de début.' };
  } else {
    duree = c.dureeMinutes === undefined || c.dureeMinutes === null || c.dureeMinutes === '' ? 30 : Number(c.dureeMinutes);
  }
  if (!Number.isInteger(duree) || duree < 5 || duree > 480) {
    return { ok: false, erreur: 'Durée invalide (de 5 minutes à 8 heures).' };
  }

  const statut = typeof c.statut === 'string' && c.statut !== '' ? c.statut : 'prevu';
  if (!STATUT_IDS.has(statut)) return { ok: false, erreur: 'Statut du rendez-vous inconnu.' };
  if (STATUTS_POINTAGE.has(statut) && !rdvCommence({ date, heure }, maintenant)) {
    return { ok: false, erreur: erreurPointageAvant({ date, heure }) };
  }

  return {
    ok: true,
    valeurs: {
      date, heure, dureeMinutes: duree, nom, prenom,
      telephone: texte(c.telephone, 30),
      objet: texte(c.objet, 200),
      lieu: texte(c.lieu, 200),
      notes: texte(c.notes, 2000),
      statut,
      accueilId: texte(c.accueilId, 100),
    },
  };
}

// ── iCalendar ────────────────────────────────────────────────────────────────

/** Échappement d'une valeur TEXT (RFC 5545 §3.3.11). */
const echapper = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/**
 * Pliage des lignes à 75 octets (RFC 5545 §3.1), sans couper un caractère
 * accentué : la limite se compte en octets UTF-8, pas en caractères.
 */
function plier(ligne: string): string {
  const octets = (s: string) => new TextEncoder().encode(s).length;
  if (octets(ligne) <= 75) return ligne;
  const morceaux: string[] = [];
  let courant = '';
  let limite = 75;
  for (const caractere of ligne) {
    if (octets(courant + caractere) > limite) {
      morceaux.push(courant);
      courant = caractere;
      limite = 74; // les lignes de suite commencent par une espace
    } else {
      courant += caractere;
    }
  }
  morceaux.push(courant);
  return morceaux.join('\r\n ');
}

const deuxChiffres = (n: number) => String(n).padStart(2, '0');

/** Heure locale « naïve » AAAAMMJJTHHMMSS, `minutes` après le début. */
function horaireLocal(date: string, heure: string, minutes = 0): string {
  const [a, m, j] = date.split('-').map(Number);
  const [h, min] = heure.split(':').map(Number);
  // Calcul en UTC sur des composantes locales : simple arithmétique de calendrier.
  const d = new Date(Date.UTC(a, m - 1, j, h, min + minutes));
  return `${d.getUTCFullYear()}${deuxChiffres(d.getUTCMonth() + 1)}${deuxChiffres(d.getUTCDate())}` +
    `T${deuxChiffres(d.getUTCHours())}${deuxChiffres(d.getUTCMinutes())}00`;
}

const horodatageUtc = (iso: string | undefined, repli: Date) => {
  const d = iso ? new Date(iso) : repli;
  return (Number.isNaN(d.getTime()) ? repli : d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
};

const FUSEAU_PARIS = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Paris',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

/**
 * Titre d'un rendez-vous dans un agenda externe : prénom et initiale du nom
 * seulement. Le calendrier quitte l'application (serveurs de messagerie) : ni
 * nom complet, ni téléphone, ni notes n'y sont recopiés.
 */
export const titreRdvExterne = (r: Pick<RdvPij, 'prenom' | 'nom' | 'statut'>) =>
  `${r.statut === 'annule' ? 'Annulé — ' : ''}RDV PIJ — ${r.prenom} ${r.nom.trim().charAt(0).toUpperCase()}.`;

/** Calendrier iCalendar des rendez-vous donnés. `maintenant` : repli d'horodatage. */
export function genererIcs(rdvs: RdvPij[], maintenant: Date = new Date()): string {
  const lignes = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pole Jeunesse//Agenda PIJ//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:RDV PIJ',
    'X-WR-TIMEZONE:Europe/Paris',
    ...FUSEAU_PARIS,
  ];
  for (const r of rdvs) {
    const description = [
      r.objet ? `Objet : ${r.objet}` : null,
      r.statut !== 'prevu' ? `Statut : ${labelStatutRdv(r.statut)}` : null,
      r.hubId ? 'Pris dans LE HUB' : r.creePar ? `Posé par : ${r.creePar}` : null,
    ].filter(Boolean).join('\n');
    const horodatage = horodatageUtc(r.modifieLe, maintenant);
    lignes.push(
      'BEGIN:VEVENT',
      `UID:${r.id}@pole-jeunesse`,
      `DTSTAMP:${horodatage}`,
      `LAST-MODIFIED:${horodatage}`,
      `DTSTART;TZID=Europe/Paris:${horaireLocal(r.date, r.heure)}`,
      `DTEND;TZID=Europe/Paris:${horaireLocal(r.date, r.heure, r.dureeMinutes)}`,
      `SUMMARY:${echapper(titreRdvExterne(r))}`,
      ...(description ? [`DESCRIPTION:${echapper(description)}`] : []),
      ...(r.lieu ? [`LOCATION:${echapper(r.lieu)}`] : []),
      `STATUS:${r.statut === 'annule' ? 'CANCELLED' : 'CONFIRMED'}`,
      'END:VEVENT',
    );
  }
  lignes.push('END:VCALENDAR');
  return lignes.map(plier).join('\r\n') + '\r\n';
}
