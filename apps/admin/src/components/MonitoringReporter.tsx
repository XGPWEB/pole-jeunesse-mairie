'use client';

import { useEffect } from 'react';
import { SEUIL_CHARGEMENT_LENT_MS, dureeChargementMs, estCoupureReseau, estNavigateurAutomatise } from '@/lib/monitoring-navigateur';

type Genre = 'api_error' | 'js_error' | 'render_error' | 'slow_load';

const MAX_RAPPORTS_PAR_PAGE = 5;
let rapportsEnvoyes = 0;
const dejaSignales = new Set<string>();

/**
 * Envoie un rapport au journal de monitoring. Ne lève jamais, ne bloque
 * jamais l'interface, et se limite à quelques rapports par page : une boucle
 * de rendu en erreur ne doit pas inonder le journal.
 */
export function signalerAuMonitoring(kind: Genre, message: string, detail?: string | null): void {
  try {
    // Robots et navigateurs pilotés : rien n'est signalé (voir lib/monitoring-navigateur.ts).
    if (estNavigateurAutomatise(navigator.userAgent, navigator.webdriver)) return;
    const cle = `${kind}:${message}`;
    if (rapportsEnvoyes >= MAX_RAPPORTS_PAR_PAGE || dejaSignales.has(cle)) return;
    dejaSignales.add(cle);
    rapportsEnvoyes += 1;
    const corps = JSON.stringify({
      kind,
      message: String(message).slice(0, 500),
      detail: detail ? String(detail).slice(0, 3000) : null,
      path: window.location.pathname,
    });
    // keepalive : le rapport part même si la page est en train de se fermer.
    void fetch('/api/monitoring/report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corps, keepalive: true,
    }).catch(() => {});
  } catch { /* le monitoring ne doit jamais casser la page */ }
}

/**
 * Monté une fois dans le layout racine : écoute les erreurs JavaScript non
 * gérées, les réponses 5xx de nos propres API et un chargement anormalement
 * lent.
 *
 * Les échecs RÉSEAU (« Failed to fetch », « Load failed ») ne sont
 * volontairement PAS signalés : sur LE HUB ils provenaient presque tous d'un
 * onglet fermé, d'un ordinateur mis en veille ou d'un rechargement, pas d'une
 * panne du serveur — une vraie panne se voit déjà par les réponses 5xx et par
 * la surveillance /api/health du serveur.
 */
export default function MonitoringReporter() {
  useEffect(() => {
    const surErreur = (e: ErrorEvent) => {
      // Erreurs de scripts tiers sans détail (extensions du navigateur) : bruit.
      if (!e.message || e.message === 'Script error.') return;
      signalerAuMonitoring('js_error', e.message, e.error instanceof Error ? e.error.stack : `${e.filename}:${e.lineno}`);
    };
    const surRejet = (e: PromiseRejectionEvent) => {
      const raison: unknown = e.reason;
      const message = raison instanceof Error ? raison.message : String(raison);
      if (estCoupureReseau(message) || /abort/i.test(message)) return;
      signalerAuMonitoring('js_error', message, raison instanceof Error ? raison.stack : null);
    };
    window.addEventListener('error', surErreur);
    window.addEventListener('unhandledrejection', surRejet);

    // Réponses 5xx de nos API : fetch est observé, jamais modifié (la réponse
    // est rendue telle quelle à l'appelant).
    const fetchOrigine = window.fetch;
    const fetchObserve: typeof window.fetch = async (...args) => {
      const reponse = await fetchOrigine(...args);
      try {
        const url = new URL(reponse.url || String(args[0]), window.location.origin);
        if (reponse.status >= 500 && url.origin === window.location.origin
          && url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/monitoring/')) {
          signalerAuMonitoring('api_error', `${reponse.status} sur ${url.pathname}`);
        }
      } catch { /* observation seulement */ }
      return reponse;
    };
    window.fetch = fetchObserve;

    const surCharge = () => {
      const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
      // Depuis la requête de la page finale : le temps passé dans les
      // redirections en amont n'est pas une lenteur du site.
      const duree = dureeChargementMs(nav);
      // Un onglet resté en arrière-plan charge au ralenti : ce n'est pas une lenteur du site.
      if (duree > SEUIL_CHARGEMENT_LENT_MS && document.visibilityState === 'visible') {
        signalerAuMonitoring('slow_load', `Chargement en ${duree} ms`);
      }
    };
    const minuterie = window.setTimeout(surCharge, 0);
    if (document.readyState !== 'complete') window.addEventListener('load', surCharge, { once: true });

    return () => {
      window.removeEventListener('error', surErreur);
      window.removeEventListener('unhandledrejection', surRejet);
      window.removeEventListener('load', surCharge);
      window.clearTimeout(minuterie);
      if (window.fetch === fetchObserve) window.fetch = fetchOrigine;
    };
  }, []);
  return null;
}
