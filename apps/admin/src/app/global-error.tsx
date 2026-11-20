'use client';

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="fr">
      <body style={{ margin: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', backgroundColor: '#f8fafc' }}>
          <h1 style={{ fontSize: '6rem', fontWeight: 800, color: '#dc2626', margin: 0 }}>500</h1>
          <p style={{ fontSize: '1.25rem', color: '#64748b', marginTop: '1rem' }}>Une erreur critique est survenue</p>
          <button
            onClick={reset}
            style={{ marginTop: '2rem', padding: '0.75rem 1.5rem', backgroundColor: '#1B3A6B', color: '#fff', borderRadius: '0.5rem', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '1rem' }}
          >
            Réessayer
          </button>
        </div>
      </body>
    </html>
  );
}
