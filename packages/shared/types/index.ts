// ─── Profils ────────────────────────────────────────────────────────────────
export type UserProfile = 'jeune' | 'animateur';

// ─── Espaces ─────────────────────────────────────────────────────────────────
export type EspaceId = 'collegiens' | 'lyceens' | 'pij' | 'clas';

export interface Espace {
  id: EspaceId;
  nom: string;
  description: string;
  trancheAge: string;
  horaires: string;
  animateurRef: string;
  couleur: string;
  icon: string;
  capacite: number;
}

// ─── Activités ───────────────────────────────────────────────────────────────
export type StatutActivite = 'ouvert' | 'complet' | 'annule';

export interface Activite {
  id: string;
  titre: string;
  description: string;
  espaceId: EspaceId;
  date: string; // ISO 8601
  heureDebut: string;
  heureFin: string;
  lieu: string;
  animateur: string;
  placesTotal: number;
  placesDisponibles: number;
  statut: StatutActivite;
  imageUrl?: string;
  tags: string[];
}

// ─── Jeunes ──────────────────────────────────────────────────────────────────
export type StatutPresence = 'present' | 'absent' | 'excuse' | 'non-pointe';

export interface ContactFamille {
  nom: string;
  lien: string; // père, mère, tuteur…
  telephone: string;
  email?: string;
}

export interface Jeune {
  id: string;
  nom: string;
  prenom: string;
  dateNaissance: string; // ISO 8601
  espaceId: EspaceId;
  etablissement: string;
  classe: string;
  contacts: ContactFamille[];
  observations: string;
  autorisationSortie: boolean;
  autorisationPhoto: boolean;
  autorisationSoinsBenins: boolean;
  adresse: string;
  photo?: string;
}

// ─── Présences ───────────────────────────────────────────────────────────────
export interface PresenceRecord {
  jeuneId: string;
  activiteId: string;
  date: string;
  statut: StatutPresence;
  note?: string;
}

// ─── Inscriptions ────────────────────────────────────────────────────────────
export type StatutInscription = 'confirmee' | 'en-attente' | 'annulee' | 'refusee';

export interface Inscription {
  id: string;
  jeuneId: string;
  jeuneNom: string;       // dénormalisé pour lecture rapide
  jeunePrenom: string;
  activiteId: string;
  activiteTitre: string;  // dénormalisé
  espaceId: string;
  dateInscription: string; // ISO 8601
  statut: StatutInscription;
  note?: string;           // message du jeune ou de l'animateur
}

// ─── Actualités ──────────────────────────────────────────────────────────────
export type CategorieActualite = 'evenement' | 'annonce' | 'sortie' | 'atelier';

export interface Actualite {
  id: string;
  titre: string;
  contenu: string;
  date: string;
  espaceId?: EspaceId;
  categorie: CategorieActualite;
  imageUrl?: string;
  auteur: string;
  epingle: boolean;
}

// ─── Navigation ──────────────────────────────────────────────────────────────
export interface RouteParams {
  activiteId?: string;
  jeuneId?: string;
  espaceId?: EspaceId;
}
