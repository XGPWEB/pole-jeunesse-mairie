'use client';

import { useEffect } from 'react';
import { signalerAuMonitoring } from '@/components/MonitoringReporter';
import { estCoupureReseau } from '@/lib/monitoring-navigateur';

const DELAI_NOUVEL_ESSAI_MS = 5_000;

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  // Requête coupée en route (Wi-Fi, sortie de veille, redémarrage du serveur) :
  // ni page 500 ni signalement, la page se recharge seule dès que possible.
  const coupureReseau = estCoupureReseau(error.message);

  useEffect(() => {
    console.error('[error-boundary]', error);
    if (!coupureReseau) {
      // Une page qui ne s'affiche pas est signalée au journal de monitoring.
      signalerAuMonitoring('render_error', error.message || 'Erreur de rendu', error.digest ? `digest ${error.digest}` : error.stack);
      return;
    }
    const reessayer = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) retry();
    };
    const id = window.setInterval(reessayer, DELAI_NOUVEL_ESSAI_MS);
    window.addEventListener('online', reessayer);
    document.addEventListener('visibilitychange', reessayer);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('online', reessayer);
      document.removeEventListener('visibilitychange', reessayer);
    };
  }, [error, coupureReseau, retry]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', backgroundColor: '#f8fafc' }}>
      {coupureReseau ? (
        <>
          <h1 style={{ fontSize: '2rem', fontWeight: 800, color: '#1B3A6B', margin: 0 }}>Connexion interrompue</h1>
          <p style={{ fontSize: '1.25rem', color: '#64748b', marginTop: '1rem' }}>Nouvelle tentative automatique dans quelques secondes…</p>
        </>
      ) : (
        <>
          <h1 style={{ fontSize: '6rem', fontWeight: 800, color: '#dc2626', margin: 0 }}>500</h1>
          <p style={{ fontSize: '1.25rem', color: '#64748b', marginTop: '1rem' }}>Une erreur est survenue</p>
        </>
      )}
      <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
        <button
          onClick={() => retry()}
          style={{ padding: '0.75rem 1.5rem', backgroundColor: '#1B3A6B', color: '#fff', borderRadius: '0.5rem', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '1rem' }}
        >
          Réessayer
        </button>
        <a href="/dashboard" style={{ padding: '0.75rem 1.5rem', backgroundColor: '#f1f5f9', color: '#1B3A6B', borderRadius: '0.5rem', textDecoration: 'none', fontWeight: 600, fontSize: '1rem' }}>
          Tableau de bord
        </a>
      </div>
    </div>
  );
}
