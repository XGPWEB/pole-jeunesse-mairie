'use client';

export default function PrintButton({ color = '#1B3870' }: { color?: string }) {
  return (
    <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 100 }} className="no-print">
      <button
        onClick={() => window.print()}
        style={{
          background: color,
          color: 'white',
          border: 'none',
          padding: '10px 20px',
          borderRadius: 8,
          fontWeight: 700,
          cursor: 'pointer',
          fontSize: '13px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        }}
      >
        🖨 Imprimer / Enregistrer en PDF
      </button>
    </div>
  );
}
