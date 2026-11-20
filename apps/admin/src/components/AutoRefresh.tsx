'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * AutoRefresh — appelle router.refresh() à interval régulier.
 * Re-fetche les données des server components sans rechargement complet.
 * Mettre dans un layout pour couvrir toutes les pages enfants.
 *
 * Rien n'est demandé tant que l'onglet est masqué ou le poste hors ligne :
 * personne ne regarde, et un rafraîchissement coupé en route fait tomber la
 * page en erreur. Le rattrapage se fait au retour de l'onglet ou du réseau.
 */
export default function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const rafraichir = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      router.refresh();
    };
    const id = setInterval(rafraichir, intervalMs);
    document.addEventListener('visibilitychange', rafraichir);
    window.addEventListener('online', rafraichir);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', rafraichir);
      window.removeEventListener('online', rafraichir);
    };
  }, [router, intervalMs]);

  return null;
}
