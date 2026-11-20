/**
 * Layout standalone — aucun sidebar, aucun chrome de navigation.
 * Utilisé pour les pages d'impression (fiches projet, fiches sortie…).
 * Le layout racine (app/layout.tsx) fournit déjà <html><body>.
 */
import type { ReactNode } from 'react';

export default function StandaloneLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
