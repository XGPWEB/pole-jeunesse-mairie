import { useCallback } from 'react';
import { api } from '@/lib/client';
import { calculerAge } from '@/lib/dates';
import { PointageServeur } from '@/lib/pointages';
import { chargerFicheJeune, FicheJeune, historiqueJeune, JeuneResume, listerJeunes } from '@/lib/services';
import { Ressource, useRessource } from './useRessource';

const chargerJeunes = () => listerJeunes(api);

/** Jeunes de la structure de l'animateur connecté (GET /api/jeunes). */
export function useJeunes(): Ressource<JeuneResume[]> {
  return useRessource(chargerJeunes);
}

/** Historique de pointage d'un jeune (GET /api/presences?jeuneId=). */
export function useHistoriqueJeune(jeuneId: string): Ressource<PointageServeur[]> {
  const charger = useCallback(() => historiqueJeune(api, jeuneId), [jeuneId]);
  return useRessource(charger);
}

/**
 * Fiche détaillée d'un jeune (GET /api/jeunes/[id]/fiche) : contacts,
 * autorisations, observations. Chargée à chaque ouverture, gardée uniquement
 * dans l'état du composant — jamais dans un stockage persistant.
 */
export function useFicheJeune(jeuneId: string): Ressource<FicheJeune> {
  const charger = useCallback(() => chargerFicheJeune(api, jeuneId), [jeuneId]);
  return useRessource(charger);
}

/** Âge révolu à la date du jour (Europe/Paris) ; 0 si la date est illisible. */
export function getAge(dateNaissance: string): number {
  return calculerAge(dateNaissance) ?? 0;
}
