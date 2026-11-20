import { useCallback, useEffect, useRef, useState } from 'react';
import { chargerRessource } from '@/lib/saisie';

export interface Ressource<T> {
  /** null tant que le serveur n'a pas répondu, et après tout échec. */
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Charge une ressource du backend pour la session courante.
 * Aucun repli : en cas d'erreur (401, réseau, serveur), `data` reste null et
 * `error` porte le message à afficher.
 */
export function useRessource<T>(charger: () => Promise<T>): Ressource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const monte = useRef(true);

  const reload = useCallback(() => {
    setLoading(true);
    chargerRessource(charger).then((resultat) => {
      if (!monte.current) return;
      setData(resultat.data);
      setError(resultat.ok ? null : resultat.erreur);
      setLoading(false);
    });
  }, [charger]);

  useEffect(() => {
    monte.current = true;
    reload();
    return () => {
      monte.current = false;
    };
  }, [reload]);

  return { data, loading, error, reload };
}
