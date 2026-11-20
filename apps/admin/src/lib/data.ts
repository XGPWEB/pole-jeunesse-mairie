// Types et utilitaires partagés. Les données viennent de PostgreSQL :
// plus aucun fichier JSON de démonstration n'est lu ici.

export type StatutInscription = 'confirmee' | 'en-attente' | 'annulee' | 'refusee';

export type EspaceId = 'collegiens' | 'lyceens' | 'pij' | 'clas';

export const ESPACE_LABELS: Record<string, string> = {
  collegiens: 'Collégiens',
  lyceens: 'Lycéens',
  pij: 'PIJ',
  clas: 'CLAS',
};

export const ESPACE_COLORS: Record<string, string> = {
  collegiens: 'purple',
  lyceens: 'navy',
  pij: 'cyan',
  clas: 'green',
};

export { getAge } from './dates';

export function formatDate(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleDateString('fr-FR', opts ?? { day: 'numeric', month: 'short', year: 'numeric' });
}

export type StatutAnimateur = 'actif' | 'inactif' | 'suspendu';
export type TypeContrat = 'CDI' | 'CDD' | 'Vacataire' | 'Bénévole';
export type EspaceAnimateur = 'Collégiens' | 'Lycéens' | 'PIJ' | 'CLAS' | 'Tous';

export interface AnimateurCompte {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  telephone: string;
  dateNaissance: string;
  adresse: string;
  espaceAssigne: EspaceAnimateur;
  dateEmbauche: string;
  typeContrat: TypeContrat;
  username: string;
  password: string;
  statut: StatutAnimateur;
  createdAt: string;
  lastLogin?: string;
  photoUrl: string | null;
  passwordResetRequested: boolean;
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type Sexe = 'M' | 'F' | 'Autre';
export type Secteur = 'Le Bois Baltard' | 'Les Viselets' | 'Village' | 'Marne Beauté' | 'Plaisance Mairie';

export interface Pointage {
  id: string;
  jeuneId: string;
  espaceId: string;
  date: string;
  heureArrivee: string;
  animateur: string;
  type: 'accueil-libre' | 'activite';
  activiteId: string | null;
  manuel: boolean;
}
export interface Participation {
  id: string; jeuneId: string; espaceId: string;
  activiteId: string | null; date: string;
  type: 'activite' | 'pointage'; animateur: string;
}

// ── Utilities ─────────────────────────────────────────────────────────────────
/** @deprecated Alias historique — utiliser getAge depuis @/lib/dates. */
export { getAge as getAgeFromDate } from './dates';


