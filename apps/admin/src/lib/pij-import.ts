/**
 * Reprise du tableur « PIJ_Data » : conversion d'une feuille copiée depuis
 * Excel (ou exportée en CSV) vers les valeurs du module PIJ.
 *
 * Sans dépendance à la base ni à une bibliothèque de lecture de classeur : le
 * texte collé est analysé ici, puis chaque ligne passe par la même validation
 * que la saisie (`validerAccueil`, `validerDossier`).
 *
 * Feuilles reprises : « Accueil » et « Permis de conduire » — les seules à
 * contenir des données dans le classeur 2026.
 */
import {
  ORIENTATIONS_PIJ, QUARTIERS_PIJ, validerAccueil, validerDossier,
  type AccueilPijSaisie, type DossierPijSaisie,
} from '@/lib/pij';

export type FeuilleImport = 'accueil' | 'permis';

export interface RefusImport { ligne: number; motif: string }
export interface ResultatImport<T> {
  valides: { ligne: number; valeurs: T }[];
  refus: RefusImport[];
}

const canon = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s -]+/g, ' ').trim();

// ── Lecture du texte collé ───────────────────────────────────────────────────

/**
 * Découpe un texte tabulé (copier-coller d'Excel) ou CSV (`;` ou `,`) en
 * lignes de cellules. Gère les cellules entre guillemets, qui peuvent contenir
 * des retours à la ligne (objets et orientations multiples) et des guillemets
 * doublés.
 */
export function analyserTableau(texte: string): string[][] {
  const t = texte.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const premiere = t.split('\n', 1)[0] ?? '';
  const sep = premiere.includes('\t') ? '\t'
    : (premiere.match(/;/g)?.length ?? 0) >= (premiere.match(/,/g)?.length ?? 0) ? ';' : ',';

  const lignes: string[][] = [];
  let ligne: string[] = [];
  let cellule = '';
  let entreGuillemets = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (entreGuillemets) {
      if (c === '"' && t[i + 1] === '"') { cellule += '"'; i++; }
      else if (c === '"') entreGuillemets = false;
      else cellule += c;
    } else if (c === '"' && cellule === '') {
      entreGuillemets = true;
    } else if (c === sep) {
      ligne.push(cellule); cellule = '';
    } else if (c === '\n') {
      ligne.push(cellule); cellule = '';
      lignes.push(ligne); ligne = [];
    } else {
      cellule += c;
    }
  }
  if (cellule !== '' || ligne.length > 0) { ligne.push(cellule); lignes.push(ligne); }
  return lignes;
}

// ── Conversions de cellules ──────────────────────────────────────────────────

const iso = (a: number, m: number, j: number) =>
  `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`;

/**
 * Date d'une cellule → AAAA-MM-JJ. Accepte JJ/MM/AAAA (affichage français),
 * AAAA-MM-JJ, et le numéro de série d'Excel (cellule copiée sans son format).
 * '' → '' (champ vide) ; valeur non reconnue → null.
 */
export function dateTableur(valeur: string): string | null {
  const v = valeur.trim();
  if (v === '') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  // Séparateur doublé toléré (« 20/02//2026 », faute de frappe vue dans le tableur).
  const fr = /^(\d{1,2})[/.-]+(\d{1,2})[/.-]+(\d{2}|\d{4})$/.exec(v);
  if (fr) {
    const annee = fr[3].length === 2 ? 2000 + Number(fr[3]) : Number(fr[3]);
    return iso(annee, Number(fr[2]), Number(fr[1]));
  }
  if (/^\d{4,5}$/.test(v)) {
    // Numéro de série Excel : jours écoulés depuis le 30/12/1899.
    const d = new Date(Date.UTC(1899, 11, 30) + Number(v) * 86_400_000);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return null;
}

/** Cellule à choix multiples : un choix par ligne (ou séparés par « ; »). */
const choix = (valeur: string) => valeur.split(/[\n;]+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);

/** Libellés du tableur → clés d'objet. Premier motif reconnu retenu. */
const MOTIFS_OBJET: [RegExp, string][] = [
  [/bafa/, 'bafa'],
  [/permis/, 'permis'],
  [/orientation/, 'orientation_scolaire'],
  [/psc ?1/, 'psc1'],
  [/job|stage/, 'job_stage'],
  [/aide a projet/, 'aide_projet'],
  [/chantier/, 'chantiers'],
  [/\bcv\b|lettre/, 'cv_lettre'],
  [/erasmus/, 'erasmus'],
  [/logement/, 'logement'],
  [/acces aux droits|demarches/, 'acces_droits'],
  [/projet personnel/, 'projet_personnel'],
];

/**
 * « Objet de la demande » : « PERMIS B » → permis, « Autre (ASSR2) » → autre
 * avec la précision « ASSR2 ». Un libellé inconnu n'est pas perdu : il devient
 * « Autre », avec le libellé en précision.
 */
export function objetsTableur(valeur: string): { objets: string[]; precision: string } {
  const objets: string[] = [];
  const precisions: string[] = [];
  for (const libelle of choix(valeur)) {
    const c = canon(libelle);
    let cle = MOTIFS_OBJET.find(([motif]) => motif.test(c))?.[1];
    if (!cle || c.startsWith('autre')) {
      cle = 'autre';
      const entreParentheses = /^autres?\s*\((.*)\)\s*$/i.exec(libelle)?.[1];
      const precision = entreParentheses ?? (c.startsWith('autre') ? libelle.replace(/^autres?\s*:?\s*/i, '') : libelle);
      if (precision.trim()) precisions.push(precision.trim());
    }
    if (!objets.includes(cle)) objets.push(cle);
  }
  return { objets, precision: precisions.join(', ') };
}

function etatTableur(valeur: string): string {
  const c = canon(valeur);
  if (c === '') return 'en_cours';
  if (c.startsWith('non finalise')) return 'non_finalise';
  if (c.startsWith('finalise')) return 'finalise';
  if (c.startsWith('en cours')) return 'en_cours';
  return valeur; // inconnu : refusé par la validation, avec son motif
}

const parLibelle = <T extends string>(liste: readonly T[], valeur: string): T | undefined =>
  liste.find(l => canon(l) === canon(valeur));

// ── Colonnes ─────────────────────────────────────────────────────────────────

/** En-tête (canonisée) → champ. Ordre significatif : premier motif reconnu. */
const COLONNES: Record<FeuilleImport, [RegExp, string][]> = {
  accueil: [
    [/premiere visite/, 'dateVisite'],
    [/date de naissance/, 'dateNaissance'],
    [/^prenom/, 'prenom'],
    [/^nom/, 'nom'],
    [/^sexe/, 'sexe'],
    [/adresse/, 'adresse'],
    [/code/, 'codePostal'],
    [/commune/, 'commune'],
    [/quartier/, 'quartier'],
    [/mail/, 'email'],
    [/telephone/, 'telephone'],
    [/objet/, 'objets'],
    [/prochain rdv/, 'prochainRdv'],
    [/remarque/, 'remarques'],
    [/orientation/, 'orientations'],
    [/^suivi/, 'suivi'],
    [/^etat/, 'etat'],
  ],
  permis: [
    [/date de la com+ission/, 'dateRef'],
    [/^prenom/, 'prenom'],
    [/^nom/, 'nom'],
    [/telephone/, 'telephone'],
    [/montant/, 'montant'],
    [/heures a realiser/, 'heuresARealiser'],
    [/deja realise/, 'heuresRealisees'],
    [/missions/, 'missions'],
    [/^etat/, 'etat'],
    [/organisme/, 'organisme'],
  ],
};

const NOMS_FEUILLE: Record<FeuilleImport, string> = { accueil: 'Accueil', permis: 'Permis de conduire' };

export const LIMITE_LIGNES_IMPORT = 1000;

/**
 * Convertit le texte d'une feuille. La première ligne doit être celle des
 * en-têtes du tableur ; les lignes sans nom ni prénom (lignes numérotées mais
 * vides) sont ignorées. Les numéros de ligne rendus sont ceux du tableur
 * (en-têtes = ligne 1).
 */
export function convertirFeuille(feuille: 'accueil', texte: string): ResultatImport<AccueilPijSaisie> | { erreur: string };
export function convertirFeuille(feuille: 'permis', texte: string): ResultatImport<DossierPijSaisie> | { erreur: string };
export function convertirFeuille(feuille: FeuilleImport, texte: string): ResultatImport<AccueilPijSaisie | DossierPijSaisie> | { erreur: string };
export function convertirFeuille(
  feuille: FeuilleImport, texte: string,
): ResultatImport<AccueilPijSaisie | DossierPijSaisie> | { erreur: string } {
  const lignes = analyserTableau(texte);
  if (lignes.length < 2) return { erreur: 'Collez la ligne d’en-têtes du tableur et au moins une ligne de données.' };
  if (lignes.length - 1 > LIMITE_LIGNES_IMPORT) return { erreur: `Trop de lignes (${LIMITE_LIGNES_IMPORT} au maximum).` };

  const colonne = new Map<string, number>();
  lignes[0].forEach((entete, i) => {
    const champ = COLONNES[feuille].find(([motif]) => motif.test(canon(entete)))?.[1];
    if (champ && !colonne.has(champ)) colonne.set(champ, i);
  });
  const obligatoires = feuille === 'accueil' ? ['nom', 'prenom', 'dateVisite', 'objets'] : ['nom', 'prenom'];
  if (obligatoires.some(c => !colonne.has(c))) {
    return { erreur: `En-têtes de la feuille « ${NOMS_FEUILLE[feuille]} » non reconnus : copiez la feuille avec sa première ligne (titres des colonnes).` };
  }

  const res: ResultatImport<AccueilPijSaisie | DossierPijSaisie> = { valides: [], refus: [] };
  // Une cellule multi-lignes ne compte que pour une ligne du tableur.
  lignes.slice(1).forEach((cellules, index) => {
    const ligne = index + 2;
    const lire = (champ: string) => (cellules[colonne.get(champ) ?? -1] ?? '').trim();
    if (lire('nom') === '' && lire('prenom') === '') return;

    const dates: Record<string, string> = {};
    for (const champ of ['dateVisite', 'dateNaissance', 'dateRef']) {
      const d = dateTableur(lire(champ));
      if (d === null) { res.refus.push({ ligne, motif: `Date non reconnue : « ${lire(champ)} ».` }); return; }
      dates[champ] = d;
    }

    let validation;
    if (feuille === 'accueil') {
      const { objets, precision } = objetsTableur(lire('objets'));
      const sexe = canon(lire('sexe'));
      validation = validerAccueil({
        dateVisite: dates.dateVisite, dateNaissance: dates.dateNaissance,
        nom: lire('nom'), prenom: lire('prenom'),
        sexe: /^(m|h|g)/.test(sexe) ? 'M' : sexe.startsWith('f') ? 'F' : '',
        adresse: lire('adresse'), codePostal: lire('codePostal'),
        commune: lire('commune').replace(/\s+/g, ' '),
        quartier: parLibelle(QUARTIERS_PIJ, lire('quartier')) ?? '',
        email: lire('email'), telephone: lire('telephone'),
        objets, objetPrecision: precision,
        prochainRdv: lire('prochainRdv'), remarques: lire('remarques'),
        orientations: choix(lire('orientations')).map(o => parLibelle(ORIENTATIONS_PIJ, o) ?? o),
        suivi: lire('suivi'), etat: etatTableur(lire('etat')),
      });
    } else {
      validation = validerDossier({
        type: 'permis', dateRef: dates.dateRef,
        nom: lire('nom'), prenom: lire('prenom'), telephone: lire('telephone'),
        montant: lire('montant').replace(/[€\s ]/g, ''),
        heuresARealiser: lire('heuresARealiser'), heuresRealisees: lire('heuresRealisees'),
        missions: lire('missions').replace(/ /g, ' '), etat: lire('etat'), organisme: lire('organisme'),
      });
    }
    if (validation.ok) res.valides.push({ ligne, valeurs: validation.valeurs });
    else res.refus.push({ ligne, motif: validation.erreur });
  });
  return res;
}

/** Clé de doublon : même jeune, même date (visite ou commission). */
export const cleDoublon = (nom: string, prenom: string, date: string | null) =>
  `${canon(nom)}|${canon(prenom)}|${date ?? ''}`;
