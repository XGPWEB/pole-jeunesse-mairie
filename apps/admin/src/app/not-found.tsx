export default function NotFound() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', backgroundColor: '#f8fafc' }}>
      <h1 style={{ fontSize: '6rem', fontWeight: 800, color: '#1B3A6B', margin: 0 }}>404</h1>
      <p style={{ fontSize: '1.25rem', color: '#64748b', marginTop: '1rem' }}>Page introuvable</p>
      <a href="/dashboard" style={{ marginTop: '2rem', padding: '0.75rem 1.5rem', backgroundColor: '#1B3A6B', color: '#fff', borderRadius: '0.5rem', textDecoration: 'none', fontWeight: 600 }}>
        Retour au tableau de bord
      </a>
    </div>
  );
}
