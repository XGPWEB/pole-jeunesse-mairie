/**
 * Module PIJ (Point Information Jeunesse) — reprise du tableur « PIJ_Data ».
 *
 * Ce fichier ne dépend ni de la base ni de Next : il est importé par les
 * routes /api/pij/* (validation, droits) ET par l'écran (listes, statistiques).
 *
 *   feuille « Accueil »                          → pij_accueils
 *   feuilles « Permis de conduire », « Chantiers
 *   jeunes », « Bourses », « BAFA »              → pij_dossiers (colonne `type`)
 *   feuille « STATS »                            → `calculerStatsPij`
 */

// ── Droits ───────────────────────────────────────────────────────────────────

const normaliser = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * La saisie PIJ est réservée aux admins et aux informateurs PIJ, c'est-à-dire
 * aux comptes dont l'espace assigné est « PIJ ». Les animateurs des autres
 * espaces (Collégiens, Lycéens, CLAS, Tous) consultent sans pouvoir écrire.
 *
 * À appeler avec la session résolue par `requireAuth` / `getSession` : son
 * rôle et son espace viennent de la base, pas du jeton.
 */
export function peutSaisirPij(session: { role?: string | null; espaceAssigne?: string | null } | null | undefined): boolean {
  if (!session) return false;
  if (session.role === 'admin') return true;
  return normaliser(session.espaceAssigne ?? '') === 'pij';
}

export const ERREUR_SAISIE_PIJ =
  'Saisie réservée aux informateurs PIJ et aux administrateurs.';

// ── Listes du tableur ────────────────────────────────────────────────────────

/** Colonne « Objet de la demande » (multi-sélection). Clés stockées en base. */
export const OBJETS_PIJ = [
  { id: 'bafa',                 label: 'BAFA' },
  { id: 'permis',               label: 'Permis de conduire' },
  { id: 'orientation_scolaire', label: 'Orientation scolaire' },
  { id: 'psc1',                 label: 'PSC1' },
  { id: 'job_stage',            label: 'Recherche job / stage' },
  { id: 'aide_projet',          label: 'Aide à projet' },
  { id: 'chantiers',            label: 'Chantiers jeunes' },
  { id: 'cv_lettre',            label: 'CV / lettre de motivation' },
  { id: 'erasmus',              label: 'Erasmus+' },
  { id: 'logement',             label: 'Logement' },
  { id: 'acces_droits',         label: 'Accès aux droits / démarches administratives' },
  { id: 'projet_personnel',     label: 'Projet personnel' },
  { id: 'autre',                label: 'Autre' },
] as const;
const OBJET_IDS = new Set<string>(OBJETS_PIJ.map(o => o.id));
export const labelObjet = (id: string) => OBJETS_PIJ.find(o => o.id === id)?.label ?? id;

/** Colonne « Quartier (si Nogent) ». */
export const QUARTIERS_PIJ = [
  'Plaisance - Mairie', 'Marne - Beauté', 'Village', 'Les Viselets', 'Le bois Baltard',
] as const;

/** Colonne « État de la demande ». */
export const ETATS_PIJ = [
  { id: 'en_cours',     label: 'En cours de réalisation' },
  { id: 'finalise',     label: 'Finalisé' },
  { id: 'non_finalise', label: 'Non finalisé' },
] as const;
const ETAT_IDS = new Set<string>(ETATS_PIJ.map(e => e.id));
export const labelEtat = (id: string) => ETATS_PIJ.find(e => e.id === id)?.label ?? id;

/** Colonne « Orientation (vers qui ?) » : liste proposée, saisie libre admise. */
export const ORIENTATIONS_PIJ = [
  'Géré en interne', 'Mission locale', 'France travail', 'GRETA', 'IFAC',
  "Maison de l'Europe du 94", 'CAF',
] as const;

/** Communes rencontrées dans le tableur, proposées à la saisie (champ libre). */
export const COMMUNES_PIJ = [
  'Nogent-sur-Marne', 'Le Perreux-sur-Marne', 'Fontenay-sous-Bois', 'Boissy-Saint-Léger',
  'Bry-sur-Marne', 'Neuilly-Plaisance', 'Champigny-sur-Marne',
] as const;

export const SESSIONS_BAFA = ['Formation générale', 'Approfondissement'] as const;
export const ETATS_DOSSIER_PERMIS = ['Complet', 'Incomplet'] as const;

// ── Dossiers : une feuille du tableur = un type ──────────────────────────────

export type TypeDossier = 'permis' | 'chantier' | 'bourse' | 'bafa';

export type ChampDossier =
  | 'dateRef' | 'nom' | 'prenom' | 'dateNaissance' | 'telephone' | 'objet' | 'horaire'
  | 'prochainRdv' | 'remarques' | 'organisme' | 'montant' | 'heuresARealiser'
  | 'heuresRealisees' | 'missions' | 'etat';

export interface ColonneDossier {
  champ: ChampDossier;
  label: string;
  saisie: 'texte' | 'long' | 'date' | 'nombre' | 'liste' | 'suggestions';
  options?: readonly string[];
  /**
   * Colonne du tableur désormais tenue par le journal des missions
   * (pij_missions) : acceptée à l'import, mais ni saisie ni affichée telle quelle.
   */
  journal?: true;
}

const NOM: ColonneDossier = { champ: 'nom', label: 'Nom', saisie: 'texte' };
const PRENOM: ColonneDossier = { champ: 'prenom', label: 'Prénom', saisie: 'texte' };
const NAISSANCE: ColonneDossier = { champ: 'dateNaissance', label: 'Date de naissance', saisie: 'date' };
const TELEPHONE: ColonneDossier = { champ: 'telephone', label: 'Téléphone portable', saisie: 'texte' };
const REMARQUES: ColonneDossier = { champ: 'remarques', label: 'Remarques complémentaires', saisie: 'long' };

/** Colonnes de chaque feuille, dans l'ordre du tableur. */
export const TYPES_DOSSIER: Record<TypeDossier, { label: string; nouveau: string; colonnes: ColonneDossier[] }> = {
  permis: {
    label: 'Permis de conduire',
    nouveau: 'Nouveau dossier permis',
    colonnes: [
      { champ: 'dateRef', label: 'Date de la commission', saisie: 'date' },
      NOM, PRENOM, TELEPHONE,
      { champ: 'montant', label: 'Montant attribué (€)', saisie: 'nombre' },
      { champ: 'heuresARealiser', label: 'Heures à réaliser', saisie: 'nombre' },
      { champ: 'heuresRealisees', label: 'Déjà réalisé', saisie: 'nombre', journal: true },
      { champ: 'missions', label: 'Missions réalisées', saisie: 'long', journal: true },
      { champ: 'etat', label: 'État du dossier', saisie: 'suggestions', options: ETATS_DOSSIER_PERMIS },
      { champ: 'organisme', label: 'Organisme', saisie: 'texte' },
    ],
  },
  chantier: {
    label: 'Chantiers jeunes',
    nouveau: 'Nouveau chantier',
    colonnes: [
      NOM, PRENOM, NAISSANCE, TELEPHONE,
      { champ: 'objet', label: 'Mission et services', saisie: 'long' },
      { champ: 'dateRef', label: 'Date', saisie: 'date' },
      { champ: 'horaire', label: 'Horaire', saisie: 'texte' },
    ],
  },
  bourse: {
    label: 'Bourses',
    nouveau: 'Nouvelle bourse',
    colonnes: [
      { champ: 'dateRef', label: 'Date de la commission', saisie: 'date' },
      NOM, PRENOM, TELEPHONE,
      { champ: 'objet', label: 'Objet de la bourse', saisie: 'long' },
      { champ: 'prochainRdv', label: "Prochain RDV (aide à la rédaction)", saisie: 'texte' },
      REMARQUES,
    ],
  },
  bafa: {
    label: 'BAFA',
    nouveau: 'Nouveau dossier BAFA',
    colonnes: [
      { champ: 'dateRef', label: 'Dépôt du dossier (site BAFA.gouv)', saisie: 'date' },
      NOM, PRENOM, NAISSANCE, TELEPHONE,
      { champ: 'objet', label: 'Session', saisie: 'liste', options: SESSIONS_BAFA },
      { champ: 'prochainRdv', label: 'Prochain RDV', saisie: 'texte' },
      REMARQUES,
      { champ: 'organisme', label: 'Organisme de formation', saisie: 'texte' },
    ],
  },
};
export const TYPE_DOSSIER_IDS = Object.keys(TYPES_DOSSIER) as TypeDossier[];

/**
 * Types proposés à l'écran, rubrique « Dossiers ». Le BAFA en a été retiré à
 * la demande du PIJ (2026-10-10) : il reste un objet de demande du registre
 * d'accueil, et le type reste accepté par l'API (aucune donnée n'est perdue).
 */
export const TYPES_DOSSIER_AFFICHES: TypeDossier[] = TYPE_DOSSIER_IDS.filter(t => t !== 'bafa');

// ── Modèles ──────────────────────────────────────────────────────────────────

export interface AccueilPij {
  id: string;
  dateVisite: string;
  nom: string;
  prenom: string;
  dateNaissance: string | null;
  sexe: 'M' | 'F' | null;
  adresse: string | null;
  codePostal: string | null;
  commune: string | null;
  quartier: string | null;
  email: string | null;
  telephone: string | null;
  objets: string[];
  objetPrecision: string | null;
  prochainRdv: string | null;
  remarques: string | null;
  orientations: string[];
  suivi: string | null;
  etat: string;
}
export type AccueilPijSaisie = Omit<AccueilPij, 'id'>;

export interface DossierPij {
  id: string;
  type: TypeDossier;
  nom: string;
  prenom: string;
  dateNaissance: string | null;
  telephone: string | null;
  dateRef: string | null;
  objet: string | null;
  horaire: string | null;
  prochainRdv: string | null;
  remarques: string | null;
  organisme: string | null;
  montant: number | null;
  heuresARealiser: number | null;
  heuresRealisees: number | null;
  missions: string | null;
  etat: string | null;
  /** Date de création (AAAA-MM-JJ) : range par année un dossier sans date. */
  creeLe?: string;
}
export type DossierPijSaisie = Omit<DossierPij, 'id' | 'creeLe'>;

// ── Validation (corps JSON → valeurs prêtes pour la base) ────────────────────

type Resultat<T> = { ok: true; valeurs: T } | { ok: false; erreur: string };

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Texte nettoyé ; '' / espaces / non-texte → null. */
function texte(v: unknown, max = 300): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t.slice(0, max);
}

/**
 * Date AAAA-MM-JJ réelle. Un champ date vidé arrive en chaîne vide : → null
 * (PostgreSQL refuse '' pour une colonne DATE). `undefined` = valeur invalide.
 */
function date(v: unknown): string | null | undefined {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !DATE_ISO.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? undefined : v;
}

/** Nombre positif ou nul ; champ vidé → null ; `undefined` = valeur invalide. */
function nombre(v: unknown, max: number): number | null | undefined {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : undefined;
}

/** Liste de textes dédoublonnée (sans tenir compte de la casse ni des accents). */
function liste(v: unknown, max = 20): string[] {
  if (!Array.isArray(v)) return [];
  const vus = new Set<string>();
  const res: string[] = [];
  for (const item of v) {
    const t = texte(item, 100);
    if (!t || vus.has(normaliser(t))) continue;
    vus.add(normaliser(t));
    res.push(t);
    if (res.length >= max) break;
  }
  return res;
}

export function validerAccueil(corps: unknown): Resultat<AccueilPijSaisie> {
  const c = (corps ?? {}) as Record<string, unknown>;
  const nom = texte(c.nom, 100);
  const prenom = texte(c.prenom, 100);
  if (!nom || !prenom) return { ok: false, erreur: 'Le nom et le prénom sont obligatoires.' };

  const dateVisite = date(c.dateVisite);
  if (!dateVisite) return { ok: false, erreur: 'La date de la première visite est obligatoire (format AAAA-MM-JJ).' };
  const dateNaissance = date(c.dateNaissance);
  if (dateNaissance === undefined) return { ok: false, erreur: 'Date de naissance invalide.' };
  if (dateNaissance && dateNaissance > dateVisite) {
    return { ok: false, erreur: 'La date de naissance est postérieure à la date de visite.' };
  }

  const sexe = c.sexe === 'M' || c.sexe === 'F' ? c.sexe : null;

  const quartier = texte(c.quartier, 100);
  if (quartier && !(QUARTIERS_PIJ as readonly string[]).includes(quartier)) {
    return { ok: false, erreur: 'Quartier inconnu : choisissez un quartier de la liste.' };
  }

  const objets = liste(c.objets);
  const inconnu = objets.find(o => !OBJET_IDS.has(o));
  if (inconnu) return { ok: false, erreur: `Objet de la demande inconnu : ${inconnu}.` };
  if (objets.length === 0) return { ok: false, erreur: 'Indiquez au moins un objet de la demande.' };

  const etat = typeof c.etat === 'string' && c.etat !== '' ? c.etat : 'en_cours';
  if (!ETAT_IDS.has(etat)) return { ok: false, erreur: 'État de la demande inconnu.' };

  return {
    ok: true,
    valeurs: {
      dateVisite, nom, prenom, dateNaissance, sexe,
      adresse: texte(c.adresse),
      codePostal: texte(c.codePostal, 10),
      commune: texte(c.commune, 100),
      quartier,
      email: texte(c.email, 200),
      telephone: texte(c.telephone, 30),
      objets,
      objetPrecision: texte(c.objetPrecision),
      prochainRdv: texte(c.prochainRdv),
      remarques: texte(c.remarques, 2000),
      orientations: liste(c.orientations),
      suivi: texte(c.suivi, 2000),
      etat,
    },
  };
}

export function validerDossier(corps: unknown): Resultat<DossierPijSaisie> {
  const c = (corps ?? {}) as Record<string, unknown>;
  const type = c.type as TypeDossier;
  if (!TYPE_DOSSIER_IDS.includes(type)) return { ok: false, erreur: 'Type de dossier inconnu.' };

  const nom = texte(c.nom, 100);
  const prenom = texte(c.prenom, 100);
  if (!nom || !prenom) return { ok: false, erreur: 'Le nom et le prénom sont obligatoires.' };

  const dateRef = date(c.dateRef);
  const dateNaissance = date(c.dateNaissance);
  if (dateRef === undefined || dateNaissance === undefined) {
    return { ok: false, erreur: 'Date invalide (format AAAA-MM-JJ attendu).' };
  }
  const montant = nombre(c.montant, 999999);
  const heuresARealiser = nombre(c.heuresARealiser, 9999);
  const heuresRealisees = nombre(c.heuresRealisees, 9999);
  if (montant === undefined || heuresARealiser === undefined || heuresRealisees === undefined) {
    return { ok: false, erreur: 'Montant ou nombre d’heures invalide.' };
  }

  // Seules les colonnes de la feuille concernée sont retenues : un champ d'un
  // autre type, envoyé par erreur, n'est pas enregistré.
  const champs = new Set(TYPES_DOSSIER[type].colonnes.map(col => col.champ));
  const si = <T,>(champ: ChampDossier, valeur: T): T | null => (champs.has(champ) ? valeur : null);

  return {
    ok: true,
    valeurs: {
      type, nom, prenom,
      dateNaissance: si('dateNaissance', dateNaissance),
      telephone: si('telephone', texte(c.telephone, 30)),
      dateRef: si('dateRef', dateRef),
      objet: si('objet', texte(c.objet, 1000)),
      horaire: si('horaire', texte(c.horaire, 100)),
      prochainRdv: si('prochainRdv', texte(c.prochainRdv)),
      remarques: si('remarques', texte(c.remarques, 2000)),
      organisme: si('organisme', texte(c.organisme, 200)),
      montant: si('montant', montant),
      heuresARealiser: si('heuresARealiser', heuresARealiser),
      heuresRealisees: si('heuresRealisees', heuresRealisees),
      missions: si('missions', texte(c.missions, 2000)),
      etat: si('etat', texte(c.etat, 100)),
    },
  };
}

// ── Journal des missions d'un dossier permis ────────────────────────────────

/** Une mission réalisée : ses heures se déduisent des heures à réaliser. */
export interface MissionPij {
  id: string;
  dossierId: string;
  date: string;
  libelle: string;
  heures: number;
  /** Compte qui a saisi la ligne (« Prénom Nom »), s'il existe encore. */
  creePar: string | null;
  creeLe: string;
}
export interface MissionPijSaisie { dossierId: string; date: string; libelle: string; heures: number }

export const LIBELLE_REPRISE_HEURES = 'Heures déjà réalisées (reprise)';

export function validerMission(corps: unknown): Resultat<MissionPijSaisie> {
  const c = (corps ?? {}) as Record<string, unknown>;
  const dossierId = texte(c.dossierId, 100);
  if (!dossierId) return { ok: false, erreur: 'Dossier requis.' };
  const libelle = texte(c.libelle, 200);
  if (!libelle) return { ok: false, erreur: 'Indiquez la mission réalisée.' };
  const jour = date(c.date);
  if (!jour) return { ok: false, erreur: 'La date de la mission est obligatoire (format AAAA-MM-JJ).' };
  const heures = nombre(c.heures, 999);
  if (!heures) return { ok: false, erreur: 'Indiquez un nombre d’heures supérieur à zéro.' };
  return { ok: true, valeurs: { dossierId, date: jour, libelle, heures } };
}

// ── Calculs du tableur ───────────────────────────────────────────────────────

/** Âge révolu à la date `aujourdhui` (AAAA-MM-JJ) — colonne « Âge » du tableur. */
export function agePij(dateNaissance: string | null, aujourdhui: string): number | null {
  if (!dateNaissance || !DATE_ISO.test(dateNaissance) || !DATE_ISO.test(aujourdhui)) return null;
  const [an, mn, jn] = dateNaissance.split('-').map(Number);
  const [aa, ma, ja] = aujourdhui.split('-').map(Number);
  const age = aa - an - (ma < mn || (ma === mn && ja < jn) ? 1 : 0);
  return age >= 0 ? age : null;
}

/** Colonne « Heures restantes » de la feuille Permis. */
export function heuresRestantes(d: Pick<DossierPij, 'heuresARealiser' | 'heuresRealisees'>): number | null {
  if (d.heuresARealiser === null) return null;
  return Math.round((d.heuresARealiser - (d.heuresRealisees ?? 0)) * 100) / 100;
}

export interface LigneStat { label: string; effectif: number }

export interface StatsPij {
  nbJeunes: number;
  /** Somme des objets de demande : un jeune venu pour deux objets compte deux dossiers. */
  nbDossiers: number;
  parSexe: LigneStat[];
  parObjet: LigneStat[];
  parAge: LigneStat[];
  parQuartier: LigneStat[];
  parCommune: LigneStat[];
  parEtat: LigneStat[];
  parOrientation: LigneStat[];
}

const NON_RENSEIGNE = 'Non renseigné';

/** Clé de regroupement : « Nogent-sur-Marne », « nogent sur marne » et « Nogent-sur-Marne  » ne font qu'un. */
const canon = (s: string) => normaliser(s).replace(/[\s-]+/g, ' ');

/** Compte par libellé ; `ordre` fixe les premières lignes (même à zéro). */
function compter(valeurs: string[], ordre: readonly string[] = []): LigneStat[] {
  const libelles = new Map<string, string>(ordre.map(l => [canon(l), l]));
  const total = new Map<string, number>(ordre.map(l => [canon(l), 0]));
  for (const v of valeurs) {
    const k = canon(v);
    if (!libelles.has(k)) libelles.set(k, v.trim());
    total.set(k, (total.get(k) ?? 0) + 1);
  }
  const lignes = [...total].map(([k, effectif]) => ({ label: libelles.get(k) as string, effectif }));
  const fixes = lignes.slice(0, ordre.length);
  const libres = lignes.slice(ordre.length).sort((a, b) => b.effectif - a.effectif || a.label.localeCompare(b.label, 'fr'));
  // « Non renseigné » toujours en dernier.
  return [...fixes, ...libres.filter(l => l.label !== NON_RENSEIGNE), ...libres.filter(l => l.label === NON_RENSEIGNE)];
}

/**
 * Feuille « STATS » : mêmes tableaux, recalculés à partir du registre.
 * Les âges sont ceux du jour `aujourdhui`, comme dans le tableur (TODAY()).
 */
export function calculerStatsPij(accueils: AccueilPij[], aujourdhui: string): StatsPij {
  const ages = accueils.map(a => agePij(a.dateNaissance, aujourdhui));
  const tranchesAge = Array.from({ length: 11 }, (_, i) => `${15 + i} ans`);
  const libelleAge = (age: number | null) =>
    age === null ? NON_RENSEIGNE : age < 15 ? 'Moins de 15 ans' : age > 25 ? 'Plus de 25 ans' : `${age} ans`;

  const nogentais = accueils.filter(a => canon(a.commune ?? '') === 'nogent sur marne');
  const sansZero = (lignes: LigneStat[], fixes: number) =>
    lignes.filter((l, i) => i < fixes || l.effectif > 0);

  return {
    nbJeunes: accueils.length,
    nbDossiers: accueils.reduce((n, a) => n + a.objets.length, 0),
    parSexe: compter(accueils.map(a => (a.sexe === 'M' ? 'Garçons' : a.sexe === 'F' ? 'Filles' : NON_RENSEIGNE)), ['Garçons', 'Filles']),
    parObjet: compter(accueils.flatMap(a => a.objets.map(labelObjet)), OBJETS_PIJ.map(o => o.label)),
    parAge: sansZero(compter(ages.map(libelleAge), tranchesAge), tranchesAge.length),
    // Le quartier n'a de sens que pour les Nogentais (« si Nogent » dans le tableur).
    parQuartier: compter(nogentais.map(a => a.quartier ?? NON_RENSEIGNE), QUARTIERS_PIJ),
    parCommune: compter(accueils.map(a => a.commune ?? NON_RENSEIGNE), ['Nogent-sur-Marne']),
    parEtat: compter(accueils.map(a => labelEtat(a.etat)), ETATS_PIJ.map(e => e.label)),
    parOrientation: compter(accueils.flatMap(a => (a.orientations.length ? a.orientations : [NON_RENSEIGNE])), ORIENTATIONS_PIJ),
  };
}
