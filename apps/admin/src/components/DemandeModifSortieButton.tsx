'use client';
import { useState } from 'react';

export default function DemandeModifSortieButton({
  sortieId, sortieCreateur,
}: { sortieId: string; sortieCreateur: string }) {
  const [open, setOpen]       = useState(false);
  const [msg, setMsg]         = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState('');

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res  = await fetch('/api/sorties/demande-modif', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sortieId, message: msg }),
      });
      const data = await res.json();
      if (data.success) { setSent(true); setMsg(''); }
      else setError(data.error ?? 'Erreur lors de l\'envoi.');
    } catch {
      setError('Erreur de connexion.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => { setOpen(true); setSent(false); setError(''); setMsg(''); }}
        className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm font-semibold rounded-xl hover:bg-amber-700 transition-colors"
      >
        ✏️ Demander une modification
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-7">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-gray-800 text-base">✏️ Demande de modification</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            {sent ? (
              <div className="text-center py-4">
                <div className="text-4xl mb-3">✅</div>
                <p className="text-green-700 font-semibold text-sm">
                  Demande envoyée à <strong>{sortieCreateur}</strong>
                </p>
                <p className="text-gray-400 text-xs mt-1">Il recevra une notification dans son tableau de bord.</p>
                <button
                  onClick={() => setOpen(false)}
                  className="mt-5 w-full py-2.5 bg-[#1B3870] text-white font-bold rounded-xl text-sm hover:bg-[#162d5e] transition-colors"
                >
                  Fermer
                </button>
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-500 mb-4">
                  Une notification sera envoyée directement à <strong>{sortieCreateur}</strong> dans son tableau de bord.
                </p>

                {error && (
                  <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs">⚠️ {error}</div>
                )}

                <form onSubmit={handleSend} className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      Message <span className="text-gray-400 font-normal">(optionnel)</span>
                    </label>
                    <textarea
                      value={msg}
                      onChange={e => setMsg(e.target.value)}
                      placeholder="Précisez ce que vous souhaitez modifier..."
                      rows={3}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 resize-none"
                    />
                  </div>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setOpen(false)}
                      className="flex-1 py-2.5 border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-50 text-sm transition-colors">
                      Annuler
                    </button>
                    <button type="submit" disabled={loading}
                      className="flex-1 py-2.5 bg-amber-600 text-white font-bold rounded-xl hover:bg-amber-700 transition-colors disabled:opacity-50 text-sm">
                      {loading ? '⟳ Envoi...' : '📩 Envoyer'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
