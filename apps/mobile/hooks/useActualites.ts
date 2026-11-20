import { api } from '@/lib/client';
import { ActualiteServeur, listerActualites } from '@/lib/services';
import { Ressource, useRessource } from './useRessource';

const chargerActualites = () => listerActualites(api);

/** Actualités de la structure de l'animateur connecté (GET /api/actualites). */
export function useActualites(): Ressource<ActualiteServeur[]> {
  return useRessource(chargerActualites);
}
