import { ESPACES } from '@/constants/espaces';
import { Espace, EspaceId } from '@/types';

/** Présentation statique des espaces (contenu institutionnel public). */
export function useEspaces(): Espace[] {
  return ESPACES;
}

export function useEspace(id: EspaceId): Espace | undefined {
  return ESPACES.find((e) => e.id === id);
}
