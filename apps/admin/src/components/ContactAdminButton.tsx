'use client';
import { useState } from 'react';

export default function ContactAdminButton() {
  const [open, setOpen]       = useState(false);
  const [objet, setObjet]     = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState('');

  function handleOpen() { setOpen(true); setSent(false); setError(''); setObjet(''); setMessage(''); }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res  = await fetch('/api/messages-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objet, message }),
      });
      const data = await res.json();
      if (data.success) setSent(true);
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
        onClick={handleOpen}
        className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:border-[#6B1A6E] hover:text-[#6B1A6E] transition-colors shadow-sm"
      >
        💬 Contacter l&apos;administrateur
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-7">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-gray-800 text-base">💬 Envoyer un message</h3>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            {sent ? (
              <div className="text-center py-4">
                <div className="text-4xl mb-3">✅</div>
                <p className="text-green-700 font-semibold text-sm">Message envoyé à l&apos;administrateur</p>
                <p className="text-gray-400 text-xs mt-1">Vous recevrez une réponse par notification.</p>
                <button onClick={() => setOpen(false)}
                  className="mt-5 w-full py-2.5 bg-[#6B1A6E] text-white font-bold rounded-xl text-sm hover:bg-[#551558] transition-colors">
                  Fermer
                </button>
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-500 mb-4">
                  Votre message sera visible dans le tableau de bord de l&apos;administrateur.
                </p>
                {error && (
                  <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs">⚠️ {error}</div>
                )}
                <form onSubmit={handleSend} className="space-y-3">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      Objet <span className="text-gray-400 font-normal">(optionnel)</span>
                    </label>
                    <input
                      type="text"
                      value={objet}
                      onChange={e => setObjet(e.target.value)}
                      placeholder="Ex : Demande de matériel, Question planning…"
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30 focus:border-[#6B1A6E]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Message *</label>
                    <textarea
                      value={message}
                      onChange={e => setMessage(e.target.value)}
                      placeholder="Écrivez votre message ici…"
                      rows={4}
                      required
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30 focus:border-[#6B1A6E] resize-none"
                    />
                  </div>
                  <div className="flex gap-3 pt-1">
                    <button type="button" onClick={() => setOpen(false)}
                      className="flex-1 py-2.5 border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-50 text-sm transition-colors">
                      Annuler
                    </button>
                    <button type="submit" disabled={loading || !message.trim()}
                      className="flex-1 py-2.5 bg-[#6B1A6E] text-white font-bold rounded-xl hover:bg-[#551558] transition-colors disabled:opacity-50 text-sm">
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
