import { api } from '@/lib/client';
import { ActiviteResume, listerActivites } from '@/lib/services';
import { Ressource, useRessource } from './useRessource';

const chargerActivites = () => listerActivites(api);

/** Activités de la structure de l'animateur connecté (GET /api/activites). */
export function useActivites(): Ressource<ActiviteResume[]> {
  return useRessource(chargerActivites);
}
