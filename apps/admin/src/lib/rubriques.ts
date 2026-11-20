/**
 * Rubriques du menu latéral et droits d'accès compte par compte.
 *
 * Une RUBRIQUE est une entrée du menu latéral (Fiches jeunes, PIJ, Congés…).
 * Chaque compte reçoit la liste des rubriques qu'il peut voir ET ouvrir
 * (`animateurs.rubriques`), choisie parmi celles de son rôle :
 *   - `null` = accès complet au menu de son rôle (tous les comptes existants) ;
 *   - liste  = seulement ces rubriques.
 * Le Tableau de bord (et « Mon profil » chez les animateurs) n'est pas une
 * rubrique réglable : il reste toujours accessible, c'est la page d'arrivée.
 *
 * Module sans dépendance (ni base, ni React) : il est lu par le proxy, par la
 * garde de session, par les server actions et par les menus.
 */

export interface EntreeMenu { id: string; href: string; label: string }
export interface FamilleMenu { titre: string | null; entrees: EntreeMenu[] }

/** Familles du menu admin. « Administration » est repliée : on y va rarement. */
export const FAMILLES_ADMIN: FamilleMenu[] = [
  { titre: null, entrees: [{ id: 'dashboard', href: '/admin/dashboard', label: 'Tableau de bord' }] },
  { titre: 'Jeunes', entrees: [
    { id: 'jeunes', href: '/admin/jeunes', label: 'Fiches jeunes' },
    { id: 'inscriptions', href: '/admin/inscriptions', label: 'Inscriptions' },
    { id: 'presences', href: '/admin/presences', label: 'Présences' },
    { id: 'pij', href: '/admin/pij', label: 'PIJ' },
  ] },
  { titre: 'Programme', entrees: [
    { id: 'activites', href: '/admin/activites', label: 'Activités' },
    { id: 'evenements', href: '/admin/evenements', label: 'Événements' },
    { id: 'sorties', href: '/admin/sorties', label: 'Sorties' },
    { id: 'projets', href: '/admin/projets', label: 'Projets' },
  ] },
  { titre: 'Équipe', entrees: [
    { id: 'animateurs', href: '/admin/animateurs', label: 'Animateurs' },
    { id: 'conges', href: '/admin/conges', label: 'Congés et récup' },
    { id: 'vehicules', href: '/admin/vehicules', label: 'Véhicule' },
  ] },
  { titre: 'Bilans', entrees: [
    { id: 'statistiques', href: '/admin/statistiques', label: 'Statistiques' },
    { id: 'frequentation', href: '/admin/frequentation', label: 'Fréquentation' },
  ] },
  { titre: 'Communication', entrees: [
    { id: 'actualites', href: '/admin/actualites', label: 'Actualités' },
    { id: 'notifications', href: '/admin/notifications', label: 'Notifications' },
  ] },
];
export const ADMINISTRATION: EntreeMenu[] = [
  { id: 'espaces', href: '/admin/espaces', label: 'Espaces' },
  { id: 'apparence', href: '/admin/apparence', label: 'Apparence' },
  { id: 'rgpd', href: '/admin/rgpd', label: 'RGPD' },
  { id: 'parametres', href: '/admin/parametres', label: 'Paramètres' },
  { id: 'monitoring', href: '/admin/monitoring', label: 'Monitoring' },
];

/** Familles du menu animateur. */
export const FAMILLES_ANIMATEUR: FamilleMenu[] = [
  { titre: null, entrees: [{ id: 'dashboard', href: '/animateur/dashboard', label: 'Tableau de bord' }] },
  { titre: 'Jeunes', entrees: [
    { id: 'jeunes', href: '/animateur/jeunes', label: 'Fiches jeunes' },
    { id: 'presences', href: '/animateur/presences', label: 'Présences' },
    { id: 'pij', href: '/animateur/pij', label: 'PIJ' },
  ] },
  { titre: 'Programme', entrees: [
    { id: 'activites', href: '/animateur/activites', label: 'Activités' },
    { id: 'evenements', href: '/animateur/evenements', label: 'Événements' },
    { id: 'sorties', href: '/animateur/sorties', label: 'Sorties' },
    { id: 'projets', href: '/animateur/projets', label: 'Projets' },
  ] },
  { titre: 'Équipe', entrees: [
    { id: 'conges', href: '/animateur/conges', label: 'Congés et récup' },
    { id: 'vehicules', href: '/animateur/vehicules', label: 'Véhicule' },
  ] },
  { titre: 'Bilans', entrees: [
    { id: 'statistiques', href: '/animateur/statistiques', label: 'Statistiques' },
    { id: 'frequentation', href: '/animateur/frequentation', label: 'Fréquentation' },
  ] },
];

/** Jamais réglables : la page d'arrivée et la page où l'animateur règle son menu. */
export const TOUJOURS_ACCESSIBLES: ReadonlySet<string> = new Set(['dashboard', 'profil']);

export type RoleRubriques = 'admin' | 'animateur';

/** Familles réglables d'un rôle, pour les cases à cocher (sans le Tableau de bord). */
export function famillesReglables(role: RoleRubriques): FamilleMenu[] {
  const familles = role === 'admin'
    ? [...FAMILLES_ADMIN, { titre: 'Administration', entrees: ADMINISTRATION }]
    : FAMILLES_ANIMATEUR;
  return familles
    .map(f => ({ ...f, entrees: f.entrees.filter(e => !TOUJOURS_ACCESSIBLES.has(e.id)) }))
    .filter(f => f.entrees.length > 0);
}

const RUBRIQUES_PAR_ROLE: Record<RoleRubriques, readonly string[]> = {
  admin: famillesReglables('admin').flatMap(f => f.entrees.map(e => e.id)),
  animateur: famillesReglables('animateur').flatMap(f => f.entrees.map(e => e.id)),
};

/** Rubriques réglables d'un rôle, dans l'ordre du menu. */
export function rubriquesDuRole(role: RoleRubriques): readonly string[] {
  return RUBRIQUES_PAR_ROLE[role];
}

/** Ce que la garde sait d'un compte pour décider d'un accès. */
export interface TitulaireRubriques {
  role: string;
  /** `null`/absent = accès complet au menu du rôle. */
  rubriques?: readonly string[] | null;
}

const roleDe = (t: TitulaireRubriques): RoleRubriques => (t.role === 'admin' ? 'admin' : 'animateur');

/** Rubriques effectivement ouvertes à un compte (liste stockée ∩ rubriques du rôle). */
export function rubriquesEffectives(t: TitulaireRubriques): Set<string> {
  const duRole = rubriquesDuRole(roleDe(t));
  if (t.rubriques == null) return new Set(duRole);
  const accordees = new Set(t.rubriques);
  return new Set(duRole.filter(id => accordees.has(id)));
}

/** Le compte a-t-il toutes les rubriques de son rôle ? */
export function aAccesComplet(t: TitulaireRubriques): boolean {
  return rubriquesEffectives(t).size === rubriquesDuRole(roleDe(t)).length;
}

/** Le compte peut-il ouvrir cette rubrique ? */
export function aRubrique(t: TitulaireRubriques, id: string): boolean {
  return TOUJOURS_ACCESSIBLES.has(id) || rubriquesEffectives(t).has(id);
}

/**
 * Décision commune au proxy et aux server actions pour une exigence « l'une
 * de ces rubriques ». Seules comptent les rubriques qui existent dans le menu
 * du rôle : une rubrique propre au menu admin (Inscriptions, Actualités…)
 * ne restreint pas un animateur — ce sont alors les contrôles de rôle des
 * routes qui décident, comme avant.
 */
export function satisfaitExigence(t: TitulaireRubriques, exigees: readonly string[]): boolean {
  const duRole = new Set(rubriquesDuRole(roleDe(t)));
  const pertinentes = exigees.filter(id => duRole.has(id));
  if (pertinentes.length === 0) return true;
  const ouvertes = rubriquesEffectives(t);
  return pertinentes.some(id => ouvertes.has(id));
}

/**
 * Forme canonique d'une liste stockée : identifiants valides du rôle, sans
 * doublon, dans l'ordre du menu. Sert aussi à comparer la liste portée par le
 * jeton de session à celle de la base.
 */
export function normaliserRubriques(role: string, liste: readonly unknown[] | null | undefined): string[] | null {
  if (liste == null) return null;
  const voulues = new Set(liste.filter((x): x is string => typeof x === 'string'));
  return rubriquesDuRole(role === 'admin' ? 'admin' : 'animateur').filter(id => voulues.has(id));
}

/** Même accès ? (`null` et la liste complète sont équivalents.) */
export function memesRubriques(a: TitulaireRubriques, b: TitulaireRubriques): boolean {
  const ea = rubriquesEffectives(a);
  const eb = rubriquesEffectives(b);
  return ea.size === eb.size && [...ea].every(id => eb.has(id));
}

// ── Chemins → rubriques ──────────────────────────────────────────────────────

/** Pages racine (implémentations réutilisées par /admin/*) et leur rubrique. */
const PAGES_RACINE: Record<string, string> = {
  '/animateurs': 'animateurs', '/jeunes': 'jeunes', '/activites': 'activites',
  '/presences': 'presences', '/inscriptions': 'inscriptions', '/statistiques': 'statistiques',
  '/apparence': 'apparence', '/rgpd': 'rgpd', '/parametres': 'parametres',
  '/communication': 'notifications',
};

/**
 * Routes API rattachées à une rubrique : préfixe → rubriques acceptées
 * (l'une suffit). Une route servie à plusieurs écrans accepte chacune des
 * rubriques qui s'en servent (la recherche de jeunes sert aussi aux
 * inscriptions d'une activité). Une route absente de cette liste n'a pas de
 * rubrique : notifications, profil, messages à l'admin, widgets du tableau de
 * bord… Le préfixe le plus long l'emporte.
 * `lecture` : exigence propre aux GET/HEAD, quand elle diffère (null = libre).
 */
const ROUTES_API: { prefixe: string; exige: string[]; lecture?: string[] | null }[] = [
  { prefixe: '/api/jeunes', exige: ['jeunes'], lecture: ['jeunes', 'activites', 'inscriptions', 'presences', 'sorties'] },
  { prefixe: '/api/jeunes/fiche-agora', exige: ['jeunes', 'sorties'] },
  { prefixe: '/api/jeunes/import', exige: ['jeunes'] },
  { prefixe: '/api/jeunes/analyse-fiche', exige: ['jeunes'] },
  { prefixe: '/api/inscriptions', exige: ['inscriptions', 'activites', 'sorties'] },
  { prefixe: '/api/pointages', exige: ['presences', 'activites'] },
  { prefixe: '/api/presences', exige: ['presences', 'activites'] },
  { prefixe: '/api/activites', exige: ['activites'], lecture: ['activites', 'presences', 'inscriptions'] },
  { prefixe: '/api/pij', exige: ['pij'] },
  { prefixe: '/api/evenements', exige: ['evenements'] },
  { prefixe: '/api/sorties', exige: ['sorties'] },
  // Demande de modification : envoyée depuis le tableau de bord (animateur)
  // et traitée depuis le panneau de notifications (admin).
  { prefixe: '/api/sorties/demande-modif', exige: [], lecture: null },
  { prefixe: '/api/idfm-places', exige: ['sorties'] },
  { prefixe: '/api/idfm-trajet', exige: ['sorties'] },
  { prefixe: '/api/projets', exige: ['projets'] },
  // Lecture libre : widgets « congés du jour » et « mon solde » du tableau de bord.
  { prefixe: '/api/conges', exige: ['conges'], lecture: null },
  { prefixe: '/api/recuperation', exige: ['conges'], lecture: null },
  { prefixe: '/api/vehicules', exige: ['vehicules'] },
  { prefixe: '/api/stats', exige: ['statistiques'] },
  { prefixe: '/api/caf', exige: ['statistiques'] },
  { prefixe: '/api/export', exige: ['statistiques'] },
  { prefixe: '/api/frequentation', exige: ['frequentation'] },
  { prefixe: '/api/actualites', exige: ['actualites'] },
  // Préférences d'affichage des actualités du tableau de bord animateur.
  { prefixe: '/api/actualites/prefs', exige: [], lecture: null },
  // Lecture libre : la liste des espaces et le thème servent à tous les écrans.
  { prefixe: '/api/espaces', exige: ['espaces'], lecture: null },
  { prefixe: '/api/theme', exige: ['apparence'], lecture: null },
  { prefixe: '/api/parametres', exige: ['parametres'] },
  { prefixe: '/api/monitoring/events', exige: ['monitoring'] },
];

const correspond = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/**
 * Rubriques dont l'une est exigée pour ouvrir ce chemin, ou `null` si le
 * chemin n'appartient à aucune rubrique.
 */
export function rubriquesExigees(pathname: string, methode = 'GET'): string[] | null {
  const segments = pathname.split('/').filter(Boolean);

  if (segments[0] === 'admin' || segments[0] === 'animateur') {
    const id = segments[1];
    if (!id || TOUJOURS_ACCESSIBLES.has(id)) return null;
    const role: RoleRubriques = segments[0];
    return rubriquesDuRole(role).includes(id) ? [id] : null;
  }

  if (segments[0] === 'api') {
    // La lecture et les accusés de lecture servent au tableau de bord de
    // tous ; envoyer un nouveau message reste réservé à la rubrique dédiée.
    if (pathname === '/api/notifications') return methode === 'POST' ? ['notifications'] : null;
    // L'accès à la recherche résumée depuis une activité n'ouvre pas la fiche
    // individuelle (contacts familiaux, autorisations, observations).
    if (segments[1] === 'jeunes' && segments.length === 4 && segments[3] === 'fiche') return ['jeunes'];
    let retenue: (typeof ROUTES_API)[number] | null = null;
    for (const r of ROUTES_API) {
      if (correspond(pathname, r.prefixe) && (!retenue || r.prefixe.length > retenue.prefixe.length)) retenue = r;
    }
    if (!retenue) return null;
    const lecture = methode === 'GET' || methode === 'HEAD';
    const exige = lecture && retenue.lecture !== undefined ? retenue.lecture : retenue.exige;
    return exige && exige.length > 0 ? exige : null;
  }

  for (const [base, id] of Object.entries(PAGES_RACINE)) {
    if (correspond(pathname, base)) return [id];
  }
  return null;
}
