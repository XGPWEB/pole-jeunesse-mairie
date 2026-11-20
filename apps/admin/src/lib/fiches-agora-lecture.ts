/**
 * Lecture des deux éditions AGORA d'un jeune — « FICHE ENFANT » et « FICHE
 * SANTÉ » — pour pré-remplir la fiche jeune.
 *
 * Ces PDF sont produits par AGORA (JasperReports) : du texte positionné, pas
 * une image. On travaille donc sur les fragments de texte et leurs
 * coordonnées, regroupés en « cellules » (fragments voisins d'une même ligne),
 * puis on repère les rubriques par leurs intitulés et non par des coordonnées
 * fixes : un bloc plus long (deux responsables, adresse sur trois lignes)
 * décale tout ce qui suit sans gêner la lecture.
 *
 * Ce qui est lu est une PROPOSITION : le formulaire l'affiche, la personne
 * vérifie et corrige avant d'enregistrer. Une rubrique introuvable est
 * simplement absente du résultat — jamais devinée.
 *
 * Minimisation : numéro de sécurité sociale, numéro et régime d'allocataire,
 * numéro de famille et tarifs figurent sur ces éditions mais ne sont PAS
 * extraits ; ils n'ont pas d'usage dans l'application.
 *
 * Ce module ne dépend ni de la base, ni de Next, ni de la bibliothèque PDF :
 * il est testé unitairement sur des fragments fictifs.
 */

import type { Vaccin } from '@/lib/jeune-sante';

/** Fragment de texte d'une page PDF. `y` croît vers le HAUT de la page (repère PDF). */
export interface ElementTexte {
  x: number;
  y: number;
  largeur: number;
  texte: string;
}

export type TypeFicheAgoraLue = 'enfant' | 'sante';

export interface ContactLu {
  nom: string;
  lien: string;
  telephone: string;
  email: string;
}

/** Champs lus. Une clé absente signifie « non trouvé ou non communiqué » : ne rien écraser. */
export interface ChampsFicheAgora {
  nom?: string;
  prenom?: string;
  /** AAAA-MM-JJ */
  dateNaissance?: string;
  lieuNaissance?: string;
  sexe?: 'M' | 'F';
  adresse?: string;
  etablissement?: string;
  classe?: string;
  contacts?: ContactLu[];
  regimes?: string;
  maladies?: string;
  allergies?: string;
  vaccins?: Vaccin[];
  medecinNom?: string;
  medecinTelephone?: string;
  assuranceCompagnie?: string;
  assurancePolice?: string;
  hospitalisation?: string;
  lieuHospitalisation?: string;
  autorisationPhoto?: boolean;
  autorisationSortirSeul?: boolean;
  autorisationSortirAccompagne?: boolean;
  autorisationMesuresUrgence?: boolean;
}

export type LectureFicheAgora =
  | { ok: true; type: TypeFicheAgoraLue; champs: ChampsFicheAgora }
  | { ok: false; erreur: string };

export const ERREUR_FICHE_NON_RECONNUE =
  'Document non reconnu : seules les éditions AGORA « Fiche enfant » et « Fiche santé » peuvent être lues automatiquement.';

// ─── Cellules ────────────────────────────────────────────────────────────────

interface Cellule { x: number; fin: number; y: number; texte: string }

/** Écart vertical toléré entre deux fragments d'une même ligne (les lignes sont espacées d'environ 11 points). */
const TOLERANCE_LIGNE = 3;
/** Écart horizontal en deçà duquel deux fragments forment une seule cellule (« Classe » + « : 3e »). */
const ECART_CELLULE = 8;

/** Regroupe les fragments en cellules, rangées de haut en bas puis de gauche à droite. */
function enCellules(elements: ElementTexte[]): Cellule[] {
  const utiles = elements
    .filter(e => e.texte.trim() !== '' && Number.isFinite(e.x) && Number.isFinite(e.y))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const lignes: ElementTexte[][] = [];
  for (const e of utiles) {
    const ligne = lignes[lignes.length - 1];
    if (ligne && ligne[0].y - e.y <= TOLERANCE_LIGNE) ligne.push(e);
    else lignes.push([e]);
  }

  const cellules: Cellule[] = [];
  for (const ligne of lignes) {
    ligne.sort((a, b) => a.x - b.x);
    let courante: Cellule | null = null;
    for (const e of ligne) {
      const texte = e.texte.replace(/\s+/g, ' ').trim();
      if (courante && e.x - courante.fin <= ECART_CELLULE) {
        courante.texte = `${courante.texte} ${texte}`;
        courante.fin = Math.max(courante.fin, e.x + e.largeur);
      } else {
        courante = { x: e.x, fin: e.x + e.largeur, y: e.y, texte };
        cellules.push(courante);
      }
    }
  }
  return cellules;
}

const trouver = (cellules: Cellule[], motif: RegExp): Cellule | undefined => cellules.find(c => motif.test(c.texte));

/** Cellules strictement comprises entre deux hauteurs (`haut` exclu, `bas` exclu). */
const entre = (cellules: Cellule[], haut: number, bas: number): Cellule[] =>
  cellules.filter(c => c.y < haut - TOLERANCE_LIGNE && c.y > bas + TOLERANCE_LIGNE);

// ─── Valeurs ─────────────────────────────────────────────────────────────────

/** AGORA écrit « N.C » (non communiqué) ou « null » pour une rubrique vide. */
function valeur(texte: string | undefined): string {
  const v = (texte ?? '').replace(/\s+/g, ' ').trim();
  return /^(n\.?\s?c\.?|null|néant|-)$/i.test(v) ? '' : v;
}

function dateIso(texte: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texte.trim());
  if (!m) return '';
  const [, j, mois, a] = m;
  const d = new Date(Date.UTC(+a, +mois - 1, +j));
  return d.getUTCFullYear() === +a && d.getUTCMonth() === +mois - 1 && d.getUTCDate() === +j ? `${a}-${mois}-${j}` : '';
}

const MOTIF_TELEPHONE = /^(?:\+33\s?[1-9]|0[1-9])(?:[\s.]?\d{2}){4}$/;
const MOTIF_EMAIL = /^Email\s*:\s*(.*)$/i;
const MOTIF_LIBELLE_TELEPHONE = /^(Fixe professionnel|Fixe|Portable|Professionnel)$/i;

/** Texte d'une colonne : les lignes de renvoi sont recollées, les entrées distinctes séparées par une virgule. */
function texteColonne(cellules: Cellule[]): string {
  let texte = '';
  for (const c of cellules) {
    const v = valeur(c.texte);
    if (!v) continue;
    if (!texte) texte = v;
    else texte += (/^[\p{Ll}(.,;)]/u.test(v) ? ' ' : ', ') + v;
  }
  return texte;
}

/** « Oui » / « Non » qui suit un intitulé, dans un texte où les cellules ont été mises bout à bout. */
function ouiNon(texte: string, intitule: RegExp): boolean | undefined {
  const m = new RegExp(`${intitule.source}\\s*:\\s*(Oui|Non)\\b`, 'i').exec(texte);
  return m ? m[1].toLowerCase() === 'oui' : undefined;
}

/**
 * Sépare le nom du prénom. AGORA écrit le NOM en capitales et le prénom en
 * minuscules, dans un ordre qui change d'une édition à l'autre : on se fie à
 * la casse, et à la position seulement si tout est en capitales.
 */
function separerNomPrenom(texte: string, type: TypeFicheAgoraLue): { nom: string; prenom: string } {
  const mots = texte.split(/\s+/).filter(Boolean);
  const enCapitales = (m: string) => /\p{L}{2}/u.test(m) && m === m.toUpperCase();
  const nom = mots.filter(enCapitales);
  const prenom = mots.filter(m => !enCapitales(m));
  if (nom.length > 0 && prenom.length > 0) return { nom: nom.join(' '), prenom: prenom.join(' ') };
  if (mots.length < 2) return { nom: texte.trim(), prenom: '' };
  return type === 'enfant'
    ? { prenom: mots[0], nom: mots.slice(1).join(' ') }
    : { nom: mots.slice(0, -1).join(' '), prenom: mots[mots.length - 1] };
}

function lienDepuisRelation(relation: string): string {
  const r = relation.toLowerCase();
  if (/grand/.test(r)) return 'Grand-parent';
  if (/m[èe]re/.test(r)) return 'Mère';
  if (/p[èe]re/.test(r)) return 'Père';
  if (/tut(eur|rice)/.test(r)) return 'Tuteur légal';
  // Relation propre à AGORA (« concubin /concubine », « oncle »…) : conservée telle quelle.
  const propre = relation.replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim();
  return propre ? propre[0].toUpperCase() + propre.slice(1) : 'Autre';
}

// ─── Personnes (responsables et contacts) ────────────────────────────────────

interface Bloc { tete: Cellule; membres: Cellule[] }

/**
 * Rattache chaque cellule d'une zone à la « tête » (ligne du nom) dont elle
 * dépend : la plus proche au-dessus, dans sa colonne. Tient aussi bien pour
 * des personnes empilées que pour des personnes présentées côte à côte.
 */
function grouper(zone: Cellule[], estTete: (c: Cellule) => boolean): Bloc[] {
  const blocs: Bloc[] = zone.filter(estTete).map(tete => ({ tete, membres: [] }));
  for (const c of zone) {
    if (blocs.some(b => b.tete === c)) continue;
    let choisi: Bloc | null = null;
    for (const b of blocs) {
      if (b.tete.y < c.y - TOLERANCE_LIGNE || b.tete.x > c.x + 20) continue;
      if (!choisi) { choisi = b; continue; }
      const ecart = (b.tete.y - c.y) - (choisi.tete.y - c.y);
      if (ecart < -5 || (Math.abs(ecart) <= 5 && b.tete.x > choisi.tete.x)) choisi = b;
    }
    choisi?.membres.push(c);
  }
  return blocs;
}

/** Numéros d'un bloc, portable en premier : c'est celui qu'on compose en sortie. */
function telephones(membres: Cellule[]): string {
  const libelles = membres.filter(c => MOTIF_LIBELLE_TELEPHONE.test(c.texte));
  const centre = (c: Cellule) => (c.x + c.fin) / 2;
  const numeros = membres.filter(c => MOTIF_TELEPHONE.test(c.texte)).map((n, ordre) => {
    let libelle = '';
    let meilleur = Infinity;
    for (const l of libelles) {
      const dy = l.y - n.y;
      if (dy <= 0 || dy > 20) continue;
      const score = dy + Math.abs(centre(l) - centre(n)) / 2;
      if (score < meilleur) { meilleur = score; libelle = l.texte.toLowerCase(); }
    }
    const rang = libelle === 'portable' ? 0 : libelle === 'fixe' ? 1 : 2;
    return { numero: n.texte.replace(/[\s.]+/g, ' ').trim(), rang, ordre };
  });
  numeros.sort((a, b) => a.rang - b.rang || a.ordre - b.ordre);
  return [...new Set(numeros.map(n => n.numero))].join(' / ');
}

function email(membres: Cellule[]): string {
  for (const c of membres) {
    const m = MOTIF_EMAIL.exec(c.texte);
    if (m) {
      const v = valeur(m[1]);
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return v;
    }
  }
  return '';
}

const MOTIF_CIVILITE = /^(Madame|Monsieur|Mme|Mlle|M\.?)\s+(.+)$/i;

function lireResponsables(zone: Cellule[]): ContactLu[] {
  return grouper(zone, c => MOTIF_CIVILITE.test(c.texte)).map(({ tete, membres }) => {
    const [, civilite, reste] = MOTIF_CIVILITE.exec(tete.texte)!;
    return {
      // « MARTIN Claire ( DURAND ) » : la parenthèse est le nom de naissance.
      nom: reste.replace(/\s*\([^()]*\)\s*$/, '').trim(),
      // Proposition la plus fréquente pour un responsable légal ; à corriger si c'est un tuteur.
      lien: /^(monsieur|m\.?)$/i.test(civilite) ? 'Père' : 'Mère',
      telephone: telephones(membres),
      email: email(membres),
    };
  });
}

function lireContacts(zone: Cellule[]): ContactLu[] {
  const estTete = (c: Cellule) =>
    !MOTIF_TELEPHONE.test(c.texte) && !MOTIF_EMAIL.test(c.texte) && !MOTIF_LIBELLE_TELEPHONE.test(c.texte);
  return grouper(zone, estTete).map(({ tete, membres }) => {
    const m = /^(.+?)\s*\(([^()]*)\)\s*$/.exec(tete.texte);
    return {
      nom: (m ? m[1] : tete.texte).trim(),
      lien: m ? lienDepuisRelation(m[2]) : 'Autre',
      telephone: telephones(membres),
      email: email(membres),
    };
  }).filter(c => valeur(c.nom) !== '');
}

/** Un même adulte peut figurer comme responsable et comme contact : on ne le garde qu'une fois. */
function sansDoublons(contacts: ContactLu[]): ContactLu[] {
  const vus = new Set<string>();
  return contacts.filter(c => {
    const cle = cleNom(c.nom);
    if (vus.has(cle)) return false;
    vus.add(cle);
    return true;
  });
}

/** Forme de comparaison d'un nom : sans accents, sans casse, sans ponctuation. */
export function cleNom(nom: string): string {
  return nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
}

// ─── Lecture ─────────────────────────────────────────────────────────────────

const EN_TETE_CONNU = /^(Santé|Autorisation\(s\)|Maladie\(s\)|R[ée]gime\(s\)( alimentaires?(\(s\))?)?|Allergie\(s\)|Renseignements médicaux|Assurance\b.*Hospitalisation|Autre\(s\) information\(s\)|Inscription\(s\).*)$/i;

/**
 * Titre de rubrique. AGORA n'imprime certaines rubriques que si elles sont
 * renseignées (« Régime(s) alimentaire(s) » n'existe pas sur la fiche d'un
 * jeune sans régime) : on ne peut donc pas s'en tenir à une liste. Un titre
 * est centré dans la page, alors que les contenus partent de la marge, et
 * porte presque toujours le pluriel entre parenthèses « (s) ».
 */
function estEnTete(c: Cellule): boolean {
  if (EN_TETE_CONNU.test(c.texte)) return true;
  return c.x > 150 && /\(s\)/i.test(c.texte) && !/:/.test(c.texte);
}

function poser<K extends keyof ChampsFicheAgora>(champs: ChampsFicheAgora, cle: K, v: ChampsFicheAgora[K] | '' | undefined) {
  if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return;
  champs[cle] = v as ChampsFicheAgora[K];
}

function lireIdentite(cellules: Cellule[], type: TypeFicheAgoraLue, champs: ChampsFicheAgora, yBas: number) {
  const titre = trouver(cellules, /^FICHE (ENFANT|SANT[ÉE])$/i)!;
  const bloc = cellules.filter(c => c.y < titre.y - TOLERANCE_LIGNE && c.y > yBas + TOLERANCE_LIGNE && !/^N°\s*Famille/i.test(c.texte));
  // Le bloc de droite (scolarité ou allocataire) commence à son premier intitulé.
  const droite = trouver(bloc, /^(Scolaire|Allocataire)\b/i);
  const xDroite = droite ? droite.x - 10 : Infinity;
  const gauche = bloc.filter(c => c.x < xDroite);

  if (gauche.length > 0) {
    const { nom, prenom } = separerNomPrenom(gauche[0].texte, type);
    poser(champs, 'nom', nom);
    poser(champs, 'prenom', prenom);
  }
  const sexe = gauche.find(c => /^(Garçon|Fille|Masculin|Féminin)\b/i.test(c.texte));
  if (sexe) champs.sexe = /^(Garçon|Masculin)/i.test(sexe.texte) ? 'M' : 'F';

  const indexNaissance = gauche.findIndex(c => /^Née? le\b/i.test(c.texte));
  if (indexNaissance >= 0) {
    const m = /^Née? le\s+(\d{2}\/\d{2}\/\d{4})(?:\s+à\s+(.+))?$/i.exec(gauche[indexNaissance].texte);
    if (m) {
      poser(champs, 'dateNaissance', dateIso(m[1]));
      poser(champs, 'lieuNaissance', valeur(m[2]));
    }
    const lignesAdresse = gauche.slice(indexNaissance + 1)
      .map(c => valeur(c.texte.replace(/^Adresse\s*:?\s*/i, '')))
      .filter(Boolean);
    poser(champs, 'adresse', lignesAdresse.join(', '));
  }

  if (type === 'enfant' && droite) {
    const scolaire = bloc.filter(c => c.x >= xDroite);
    const etablissement: string[] = [];
    for (const c of scolaire) {
      const classe = /^Classe\s*:\s*(.*)$/i.exec(c.texte);
      const niveau = /^Niveau\s*:\s*(.*)$/i.exec(c.texte);
      if (classe) poser(champs, 'classe', valeur(classe[1]));
      else if (niveau) { if (!champs.classe) poser(champs, 'classe', valeur(niveau[1])); }
      else {
        const v = valeur(c.texte.replace(/^Scolaire\s*:?\s*/i, ''));
        if (v) etablissement.push(v);
      }
    }
    // « Classe » l'emporte sur « Niveau », quel que soit leur ordre sur la page.
    const classe = scolaire.map(c => /^Classe\s*:\s*(.*)$/i.exec(c.texte)).find(Boolean);
    if (classe && valeur(classe[1])) champs.classe = valeur(classe[1]);
    poser(champs, 'etablissement', etablissement.join(' '));
  }
}

function lireFicheEnfant(cellules: Cellule[], champs: ChampsFicheAgora, yContactsBas: number) {
  const bas = trouver(cellules, /^Inscription\(s\)/i)?.y ?? -Infinity;

  // Santé : trois colonnes sous leurs intitulés, bornées à droite par les autorisations.
  const enTeteAutorisations = trouver(cellules, /^Autorisation\(s\)$/i);
  const sousRubriques = entre(cellules, yContactsBas, bas);
  const lignesAutorisations = sousRubriques.filter(c => /^(Hospitalisation|Droit\b|Mesure\b)/i.test(c.texte));
  const xAutorisations = lignesAutorisations.length > 0
    ? Math.min(...lignesAutorisations.map(c => c.x)) - 5
    : (enTeteAutorisations ? enTeteAutorisations.x - 60 : Infinity);

  const colonnes = [
    { cle: 'regimes' as const, enTete: trouver(sousRubriques, /^R[ée]gime\(s\)$/i) },
    { cle: 'maladies' as const, enTete: trouver(sousRubriques, /^Maladie\(s\)$/i) },
    { cle: 'allergies' as const, enTete: trouver(sousRubriques, /^Autre\(s\)$/i) },
  ].filter((c): c is { cle: 'regimes' | 'maladies' | 'allergies'; enTete: Cellule } => !!c.enTete)
    .sort((a, b) => a.enTete.x - b.enTete.x);
  colonnes.forEach((col, i) => {
    const xFin = i + 1 < colonnes.length ? colonnes[i + 1].enTete.x - 10 : xAutorisations;
    const contenu = sousRubriques.filter(c =>
      c.y < col.enTete.y - TOLERANCE_LIGNE && c.x >= col.enTete.x - 10 && c.x < xFin);
    poser(champs, col.cle, texteColonne(contenu));
  });

  if (Number.isFinite(xAutorisations)) {
    const texte = sousRubriques.filter(c => c.x >= xAutorisations && c !== enTeteAutorisations)
      .map(c => c.texte).join(' ');
    const hospitalisation = /Hospitalisation\s*:\s*(.*?)(?=\s+(?:Droit|Mesure)\b|$)/i.exec(texte);
    poser(champs, 'hospitalisation', valeur(hospitalisation?.[1]));
    poser(champs, 'autorisationSortirAccompagne', ouiNon(texte, /Droit de sortir avec mineur[^:]*/));
    poser(champs, 'autorisationSortirSeul', ouiNon(texte, /Droit de sortir seul[^:]*/));
    poser(champs, 'autorisationPhoto', ouiNon(texte, /Droit à l['’]image/));
    poser(champs, 'autorisationMesuresUrgence', ouiNon(texte, /Mesures? d['’]urgence/));
  }
}

/** « Sans porc : précision éventuelle » → une entrée par ligne, sans le deux-points final. */
function lignesIntitulees(cellules: Cellule[]): string {
  return cellules.map(c => valeur(c.texte.replace(/\s*:\s*$/, ''))).filter(Boolean).join(', ');
}

/** Ajoute à un champ déjà lu, sans répéter ce qui y figure. */
function ajouter(champs: ChampsFicheAgora, cle: 'regimes' | 'maladies' | 'allergies', texte: string) {
  if (!texte) return;
  const actuel = champs[cle];
  if (!actuel) champs[cle] = texte;
  else if (!actuel.includes(texte)) champs[cle] = `${actuel}, ${texte}`;
}

function lireVaccins(zone: Cellule[]): Vaccin[] {
  // Tableau sur deux demi-largeurs : « vaccin, date, vaccin, date » sur chaque ligne.
  const vaccins: Vaccin[] = [];
  let enAttente: string | null = null;
  for (const c of zone) {
    if (/^(Vaccin|Dates des derniers|rappels)$/i.test(c.texte)) continue;
    const date = dateIso(c.texte);
    if (date && enAttente !== null) { vaccins.push({ nom: enAttente, date }); enAttente = null; }
    else if (!date) {
      if (enAttente !== null) vaccins.push({ nom: enAttente, date: '' });
      enAttente = valeur(c.texte) || null;
    }
  }
  if (enAttente !== null) vaccins.push({ nom: enAttente, date: '' });
  return vaccins;
}

function lireAssurance(zone: Cellule[], champs: ChampsFicheAgora) {
  for (const c of zone) {
    const m = /^([^:]+?)\s*:\s*(.*)$/.exec(c.texte);
    if (!m) continue;
    const [, intitule, brut] = m;
    const v = valeur(brut);
    if (/^Compagnie d['’]assurance$/i.test(intitule)) poser(champs, 'assuranceCompagnie', v);
    else if (/^N°\s*Police$/i.test(intitule)) poser(champs, 'assurancePolice', v);
    else if (/^Hospitalisation$/i.test(intitule)) poser(champs, 'hospitalisation', v);
    else if (/^Lieu d['’]hospitalisation$/i.test(intitule)) poser(champs, 'lieuHospitalisation', v);
    else if (/^Médecin traitant$/i.test(intitule)) {
      const medecin = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(v);
      poser(champs, 'medecinNom', valeur(medecin ? medecin[1] : v));
      poser(champs, 'medecinTelephone', valeur(medecin?.[2]));
    }
  }
}

/**
 * Sous les contacts, la fiche santé est une suite de rubriques titrées. On la
 * découpe titre par titre : une rubrique qui n'existe que sur certaines fiches
 * est ainsi lue pour ce qu'elle est, au lieu de déborder sur sa voisine.
 */
function lireFicheSante(cellules: Cellule[], champs: ChampsFicheAgora, yContacts: number) {
  const yPied = trouver(cellules, /^[ÉE]dit[ée]e? le\b/i)?.y ?? -Infinity;
  const sous = cellules.filter(c => c.y < yContacts - TOLERANCE_LIGNE && c.y > yPied + TOLERANCE_LIGNE);
  const titres = sous.filter(estEnTete);

  titres.forEach((titre, i) => {
    const bas = titres.slice(i + 1).find(t => t.y < titre.y - TOLERANCE_LIGNE)?.y ?? yPied;
    const zone = entre(sous, titre.y, bas).filter(c => !titres.includes(c));
    const t = titre.texte;
    if (/^Maladie\(s\)$/i.test(t)) ajouter(champs, 'maladies', texteColonne(zone));
    else if (/^R[ée]gime/i.test(t)) ajouter(champs, 'regimes', lignesIntitulees(zone));
    else if (/^Allergie/i.test(t)) ajouter(champs, 'allergies', lignesIntitulees(zone));
    else if (/^Renseignements médicaux$/i.test(t)) poser(champs, 'vaccins', lireVaccins(zone));
    else if (/^Assurance\b/i.test(t)) lireAssurance(zone, champs);
    // « Autres allergies (poussière, pollen, ...) : précision éventuelle »
    else if (/^Autre\(s\) information\(s\)$/i.test(t)) ajouter(champs, 'allergies', lignesIntitulees(zone));
    else {
      // Rubrique médicale inconnue : mieux vaut la montrer, titre compris, que la perdre.
      const contenu = lignesIntitulees(zone);
      if (contenu) ajouter(champs, 'maladies', `${t} : ${contenu}`);
    }
  });
}

/** Lit une édition AGORA à partir de ses fragments de texte. */
export function lireFicheAgora(elements: ElementTexte[]): LectureFicheAgora {
  const cellules = enCellules(elements);
  const titre = trouver(cellules, /^FICHE (ENFANT|SANT[ÉE])$/i);
  if (!titre) return { ok: false, erreur: ERREUR_FICHE_NON_RECONNUE };
  const type: TypeFicheAgoraLue = /ENFANT/i.test(titre.texte) ? 'enfant' : 'sante';

  const champs: ChampsFicheAgora = {};
  const yResponsables = trouver(cellules, /^(Foyer|Responsable\(s\))$/i)?.y;
  const yContacts = trouver(cellules, /^Contact\(s\)$/i)?.y;
  // Première rubrique sous les contacts : c'est elle qui ferme leur zone.
  const yApresContacts = yContacts === undefined ? undefined
    : cellules.find(c => c.y < yContacts - TOLERANCE_LIGNE && estEnTete(c))?.y;

  lireIdentite(cellules, type, champs, yResponsables ?? yContacts ?? -Infinity);

  const contacts: ContactLu[] = [];
  if (yResponsables !== undefined) {
    contacts.push(...lireResponsables(entre(cellules, yResponsables, yContacts ?? yApresContacts ?? -Infinity)));
  }
  if (yContacts !== undefined) {
    contacts.push(...lireContacts(entre(cellules, yContacts, yApresContacts ?? -Infinity)));
  }
  poser(champs, 'contacts', sansDoublons(contacts));

  if (type === 'enfant') {
    // La rubrique « Santé » et ses colonnes commencent sous les contacts (ou sous le foyer, faute de contacts).
    const haut = trouver(cellules, /^(Santé|Autorisation\(s\))$/i)?.y ?? yContacts ?? yResponsables;
    if (haut !== undefined) lireFicheEnfant(cellules, champs, haut + 2 * TOLERANCE_LIGNE);
  } else {
    lireFicheSante(cellules, champs, yContacts ?? yResponsables ?? titre.y);
  }

  if (!champs.nom && !champs.prenom) return { ok: false, erreur: ERREUR_FICHE_NON_RECONNUE };
  return { ok: true, type, champs };
}
