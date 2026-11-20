import { Activite, Actualite, Inscription } from '@/types';

/**
 * Contenus de l'espace Jeune / Famille.
 *
 * Constat (octobre 2026) : le backend n'expose aucune route publique pour les
 * activités, les actualités ou les demandes d'inscription (toutes exigent une
 * session animateur), et il n'existe aucun compte jeune ou famille. Tant que
 * ces routes n'existent pas, ces contenus sont déclarés indisponibles : l'écran
 * l'indique clairement au lieu d'afficher des données de démonstration comme
 * s'il s'agissait du programme réel.
 *
 * Le jour où une API publique existe, seuls ces hooks sont à brancher.
 */
export type ContenuPublic<T> =
  | { disponible: true; data: T }
  | { disponible: false; data: null };

const INDISPONIBLE: { disponible: false; data: null } = { disponible: false, data: null };

/** Programme des activités visible sans compte. */
export function useActivitesPubliques(): ContenuPublic<Activite[]> {
  return INDISPONIBLE;
}

/** Actualités visibles sans compte. */
export function useActualitesPubliques(): ContenuPublic<Actualite[]> {
  return INDISPONIBLE;
}

/** Inscriptions de l'utilisateur : suppose une identité jeune/famille, qui n'existe pas. */
export function useMesInscriptions(): ContenuPublic<Inscription[]> {
  return INDISPONIBLE;
}

/** Dépôt d'une demande d'inscription en ligne. */
export function useInscriptionEnLigne(): { disponible: boolean } {
  return { disponible: false };
}
