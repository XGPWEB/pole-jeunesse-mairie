/**
 * Pointages : passage des lignes serveur à l'état local des registres.
 *
 * Module pur. Règles (audit, constats 14, 23, 26) :
 *  - le statut réel (present / absent / excuse) est conservé — une absence ne
 *    devient jamais une présence ;
 *  - chaque registre ne retient que ses propres lignes (accueil libre, ou une
 *    activité précise) ;
 *  - chaque cellule garde l'`id` serveur exact de ses pointages, seul moyen de
 *    supprimer une ligne sans toucher aux autres ;
 *  - les lignes manuelles ont un identifiant stable dérivé du nom, identique
 *    avant et après enregistrement, pour que le rafraîchissement périodique ne
 *    crée ni doublon ni réapparition.
 */
import { ApiError } from './api';
import { versDateCivile } from './dates';

export type StatutPointage = 'present' | 'absent' | 'excuse';

export interface PointageServeur {
  id: string;
  jeuneId: string | null;
  activiteId: string | null;
  espaceId: string | null;
  date: string;
  statut: StatutPointage;
  type: string | null;
  manuel: boolean;
  prenomManuel: string | null;
  nomManuel: string | null;
  heureArrivee: string | null;
}

function texteOuNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

/**
 * Statut d'une ligne serveur.
 * - `absent` / `excuse` / `present` : repris tels quels ;
 * - vide ou NULL : présence (les pointages d'arrivée créés sans statut par le
 *   mobile sont des présences par construction) ;
 * - toute autre valeur : inconnue → null, la ligne est écartée plutôt que
 *   d'être comptée comme présence.
 */
export function lireStatut(brut: unknown): StatutPointage | null {
  if (brut === null || brut === undefined || brut === '') return 'present';
  if (brut === 'present' || brut === 'absent' || brut === 'excuse') return brut;
  return null;
}

/** Valide et normalise la réponse de GET /api/pointages. */
export function normaliserPointages(brut: unknown): PointageServeur[] {
  if (!Array.isArray(brut)) {
    throw new ApiError('invalid_response', 'Liste de pointages inattendue du serveur.');
  }
  const resultat: PointageServeur[] = [];
  for (const ligne of brut) {
    if (typeof ligne !== 'object' || ligne === null) continue;
    const l = ligne as Record<string, unknown>;
    const id = texteOuNull(l.id);
    const dateBrute = texteOuNull(l.date);
    const statut = lireStatut(l.statut);
    if (!id || !dateBrute || !statut) continue;
    let date: string;
    try {
      date = versDateCivile(dateBrute);
    } catch {
      continue;
    }
    resultat.push({
      id,
      date,
      statut,
      jeuneId: texteOuNull(l.jeuneId),
      activiteId: texteOuNull(l.activiteId),
      espaceId: texteOuNull(l.espaceId),
      type: texteOuNull(l.type),
      manuel: l.manuel === true,
      prenomManuel: texteOuNull(l.prenomManuel),
      nomManuel: texteOuNull(l.nomManuel),
      heureArrivee: texteOuNull(l.heureArrivee),
    });
  }
  return resultat;
}

// ─── Registres ───────────────────────────────────────────────────────────────

export type Registre = { type: 'accueil' } | { type: 'activite'; activiteId: string };

export function appartientAuRegistre(p: PointageServeur, registre: Registre): boolean {
  if (registre.type === 'accueil') {
    return p.activiteId === null && p.type !== 'activite';
  }
  return p.activiteId === registre.activiteId;
}

export function filtrerRegistre(pointages: PointageServeur[], registre: Registre): PointageServeur[] {
  return pointages.filter((p) => appartientAuRegistre(p, registre));
}

/** Identifiant de ligne stable pour une personne saisie manuellement. */
export function idLigneManuelle(prenom: string, nom: string): string {
  const net = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr-FR');
  return `manuel:${net(prenom)}|${net(nom)}`;
}

/** Identifiant de ligne d'un pointage : le jeune inscrit, sinon la personne manuelle. */
export function idLigne(p: PointageServeur): string | null {
  if (p.jeuneId) return p.jeuneId;
  if (p.prenomManuel || p.nomManuel) return idLigneManuelle(p.prenomManuel ?? '', p.nomManuel ?? '');
  return null;
}

export interface CelluleServeur {
  statut: StatutPointage;
  /** Ids serveur des pointages de cette cellule, le plus récent en premier. */
  pointageIds: string[];
}

export interface LigneManuelle {
  rowId: string;
  prenom: string;
  nom: string;
}

export interface EtatRegistre {
  /** rowId → date civile → cellule. */
  cellules: Record<string, Record<string, CelluleServeur>>;
  /** Jeunes inscrits ayant au moins une ligne dans le registre. */
  jeuneIds: string[];
  manuels: LigneManuelle[];
}

export const REGISTRE_VIDE: EtatRegistre = { cellules: {}, jeuneIds: [], manuels: [] };

/**
 * Construit l'état d'un registre à partir des pointages serveur.
 * Les pointages hors registre sont ignorés. En cas de doublon dans une cellule,
 * le premier reçu (le plus récent, le serveur trie par création décroissante)
 * fixe le statut ; tous les ids sont conservés.
 */
export function construireRegistre(pointages: PointageServeur[], registre: Registre): EtatRegistre {
  const cellules: Record<string, Record<string, CelluleServeur>> = {};
  const jeuneIds: string[] = [];
  const manuels: LigneManuelle[] = [];

  for (const p of filtrerRegistre(pointages, registre)) {
    const rowId = idLigne(p);
    if (!rowId) continue;
    if (!cellules[rowId]) {
      cellules[rowId] = {};
      if (p.jeuneId) jeuneIds.push(p.jeuneId);
      else manuels.push({ rowId, prenom: p.prenomManuel ?? '', nom: p.nomManuel ?? '' });
    }
    const existante = cellules[rowId][p.date];
    if (existante) existante.pointageIds.push(p.id);
    else cellules[rowId][p.date] = { statut: p.statut, pointageIds: [p.id] };
  }
  return { cellules, jeuneIds, manuels };
}

export function celluleServeur(etat: EtatRegistre, rowId: string, date: string): CelluleServeur | null {
  return etat.cellules[rowId]?.[date] ?? null;
}

/**
 * Id serveur exact à supprimer pour retirer une ligne à une date : un seul
 * pointage, celui du registre affiché. null si rien n'est enregistré.
 */
export function pointageASupprimer(etat: EtatRegistre, rowId: string, date: string): string | null {
  return celluleServeur(etat, rowId, date)?.pointageIds[0] ?? null;
}

// ─── Présences d'une activité : écart brouillon / serveur ────────────────────

/** Saisie locale non enregistrée : rowId → statut voulu (null = effacer). */
export type BrouillonStatuts = Record<string, StatutPointage | null>;

export function statutAffiche(
  etat: EtatRegistre,
  brouillon: BrouillonStatuts,
  rowId: string,
  date: string,
): StatutPointage | null {
  if (rowId in brouillon) return brouillon[rowId];
  return celluleServeur(etat, rowId, date)?.statut ?? null;
}

export interface EcartPresences {
  /** Statuts à créer côté serveur. */
  aEnvoyer: { rowId: string; statut: StatutPointage }[];
  /** Ids serveur à supprimer après création (remplacés ou effacés). */
  aSupprimer: string[];
}

export function calculerEcart(etat: EtatRegistre, brouillon: BrouillonStatuts, date: string): EcartPresences {
  const aEnvoyer: { rowId: string; statut: StatutPointage }[] = [];
  const aSupprimer: string[] = [];
  for (const [rowId, voulu] of Object.entries(brouillon)) {
    const actuelle = celluleServeur(etat, rowId, date);
    if (voulu === (actuelle?.statut ?? null)) continue;
    if (voulu !== null) aEnvoyer.push({ rowId, statut: voulu });
    if (actuelle) aSupprimer.push(...actuelle.pointageIds);
  }
  return { aEnvoyer, aSupprimer };
}

/**
 * Brouillon restant après rechargement serveur : on ne retire que les saisies
 * que le serveur reflète désormais ; le reste (échec partiel) est conservé.
 */
export function brouillonRestant(etat: EtatRegistre, brouillon: BrouillonStatuts, date: string): BrouillonStatuts {
  const reste: BrouillonStatuts = {};
  for (const [rowId, voulu] of Object.entries(brouillon)) {
    if (voulu !== (celluleServeur(etat, rowId, date)?.statut ?? null)) reste[rowId] = voulu;
  }
  return reste;
}
