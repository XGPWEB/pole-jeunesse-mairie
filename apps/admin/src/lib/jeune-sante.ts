/**
 * Renseignements sanitaires et compléments d'état civil d'un jeune : types
 * partagés entre le formulaire, les actions serveur, la fiche et l'impression
 * des fiches sanitaires d'une sortie.
 *
 * Module pur (ni base, ni Next) : importable depuis un composant client.
 */

export interface Vaccin {
  nom: string;
  /** Dernier rappel, AAAA-MM-JJ, ou chaîne vide si inconnu. */
  date: string;
}

export interface SanteJeune {
  lieuNaissance: string;
  regimes: string;
  maladies: string;
  allergies: string;
  vaccins: Vaccin[];
  medecinNom: string;
  medecinTelephone: string;
  assuranceCompagnie: string;
  assurancePolice: string;
  hospitalisation: string;
  lieuHospitalisation: string;
  /** `null` = non renseigné : ne jamais l'afficher comme un refus. */
  autorisationSortirSeul: boolean | null;
  autorisationSortirAccompagne: boolean | null;
  autorisationMesuresUrgence: boolean | null;
}

export const SANTE_VIDE: SanteJeune = {
  lieuNaissance: '', regimes: '', maladies: '', allergies: '', vaccins: [],
  medecinNom: '', medecinTelephone: '', assuranceCompagnie: '', assurancePolice: '',
  hospitalisation: '', lieuHospitalisation: '',
  autorisationSortirSeul: null, autorisationSortirAccompagne: null, autorisationMesuresUrgence: null,
};

/** Colonnes à ajouter à un `SELECT … FROM jeunes` (préfixe d'alias facultatif, ex. `j.`). */
export function colonnesSanteSql(alias = ''): string {
  return `
    COALESCE(${alias}lieu_naissance, '') AS "lieuNaissance",
    COALESCE(${alias}regimes, '') AS regimes,
    COALESCE(${alias}maladies, '') AS maladies,
    COALESCE(${alias}allergies, '') AS allergies,
    COALESCE(${alias}vaccins, '[]'::jsonb) AS vaccins,
    COALESCE(${alias}medecin_nom, '') AS "medecinNom",
    COALESCE(${alias}medecin_telephone, '') AS "medecinTelephone",
    COALESCE(${alias}assurance_compagnie, '') AS "assuranceCompagnie",
    COALESCE(${alias}assurance_police, '') AS "assurancePolice",
    COALESCE(${alias}hospitalisation, '') AS hospitalisation,
    COALESCE(${alias}lieu_hospitalisation, '') AS "lieuHospitalisation",
    ${alias}autorisation_sortir_seul AS "autorisationSortirSeul",
    ${alias}autorisation_sortir_accompagne AS "autorisationSortirAccompagne",
    ${alias}autorisation_mesures_urgence AS "autorisationMesuresUrgence"`;
}

const LONGUEUR_COURTE = 200;
const LONGUEUR_LONGUE = 2000;
const VACCINS_MAX = 40;

function texte(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const propre = v.trim().slice(0, max);
  return propre || null;
}

const triEtat = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

function vaccins(v: unknown): Vaccin[] {
  if (!Array.isArray(v)) return [];
  const liste: Vaccin[] = [];
  for (const brut of v.slice(0, VACCINS_MAX)) {
    if (typeof brut !== 'object' || brut === null) continue;
    const { nom, date } = brut as { nom?: unknown; date?: unknown };
    const n = texte(nom, LONGUEUR_COURTE);
    if (!n) continue;
    liste.push({ nom: n, date: typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '' });
  }
  return liste;
}

/**
 * Valeurs prêtes à écrire en base, dans l'ordre de `COLONNES_SANTE_ECRITURE`.
 * Le contrôle du formulaire vit dans le navigateur : tout est re-borné ici.
 */
export function valeursSante(data: Partial<Record<keyof SanteJeune, unknown>>): unknown[] {
  return [
    texte(data.lieuNaissance, LONGUEUR_COURTE),
    texte(data.regimes, LONGUEUR_LONGUE),
    texte(data.maladies, LONGUEUR_LONGUE),
    texte(data.allergies, LONGUEUR_LONGUE),
    JSON.stringify(vaccins(data.vaccins)),
    texte(data.medecinNom, LONGUEUR_COURTE),
    texte(data.medecinTelephone, LONGUEUR_COURTE),
    texte(data.assuranceCompagnie, LONGUEUR_COURTE),
    texte(data.assurancePolice, LONGUEUR_COURTE),
    texte(data.hospitalisation, LONGUEUR_LONGUE),
    texte(data.lieuHospitalisation, LONGUEUR_COURTE),
    triEtat(data.autorisationSortirSeul),
    triEtat(data.autorisationSortirAccompagne),
    triEtat(data.autorisationMesuresUrgence),
  ];
}

export const COLONNES_SANTE_ECRITURE = [
  'lieu_naissance', 'regimes', 'maladies', 'allergies', 'vaccins',
  'medecin_nom', 'medecin_telephone', 'assurance_compagnie', 'assurance_police',
  'hospitalisation', 'lieu_hospitalisation',
  'autorisation_sortir_seul', 'autorisation_sortir_accompagne', 'autorisation_mesures_urgence',
] as const;

/** Vrai si au moins un renseignement médical est saisi (hors autorisations). */
export function aDesRenseignementsMedicaux(s: Partial<SanteJeune>): boolean {
  return !!(s.regimes || s.maladies || s.allergies || s.vaccins?.length || s.medecinNom || s.medecinTelephone
    || s.assuranceCompagnie || s.assurancePolice || s.hospitalisation || s.lieuHospitalisation);
}

export const libelleTriEtat = (v: boolean | null | undefined): string =>
  v === true ? 'Oui' : v === false ? 'Non' : 'Non renseigné';
