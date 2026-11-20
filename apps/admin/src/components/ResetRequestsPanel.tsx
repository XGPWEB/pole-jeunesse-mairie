'use client';
import { useState, useEffect } from 'react';

interface ResetRequest {
  id: string;
  titre: string;
  envoyeAt: string;
  fromAnimateurId: string;
  fromAnimateurUsername: string;
  fromAnimateurPrenom: string;
  fromAnimateurNom: string;
  fromAnimateurEmail: string;
}

export default function ResetRequestsPanel() {
  const [requests, setRequests]     = useState<ResetRequest[]>([]);
  const [resetting, setResetting]   = useState<string | null>(null);
  const [done, setDone]             = useState<Record<string, string>>({});
  const [erreur, setErreur]         = useState('');

  useEffect(() => {
    fetch('/api/notifications')
      .then(r => r.json())
      .then(d => {
        const resets = (d.notifications ?? []).filter((n: any) => n.type === 'reset-request');
        setRequests(resets);
      });
  }, []);

  async function handleReset(req: ResetRequest) {
    setResetting(req.id);
    setErreur('');
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ animateurId: req.fromAnimateurId, notifId: req.id }),
      });
      const data = await res.json();
      if (data.success) {
        // Le serveur n'a PAS changé le mot de passe : il a envoyé un lien à
        // usage unique. On n'affiche donc plus de mot de passe ici.
        setDone(prev => ({ ...prev, [req.id]: `${req.fromAnimateurPrenom} ${req.fromAnimateurNom}` }));
        setRequests(prev => prev.filter(r => r.id !== req.id));
      } else {
        setErreur(data.error ?? 'La réinitialisation a échoué.');
      }
    } catch {
      setErreur('Erreur de connexion au serveur.');
    } finally {
      setResetting(null);
    }
  }

  // Rien à afficher si aucune demande ni résultat en attente
  if (requests.length === 0 && Object.keys(done).length === 0) return null;

  return (
    <div className="bg-white border-2 border-amber-300 rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-amber-50 px-5 py-3 border-b border-amber-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔑</span>
          <h2 className="font-bold text-amber-800">Demandes de réinitialisation de mot de passe</h2>
          {requests.length > 0 && (
            <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white text-xs font-bold">
              {requests.length}
            </span>
          )}
        </div>
      </div>

      {erreur && (
        <div className="px-5 py-3 bg-red-50 border-b border-red-100 text-sm text-red-700">⚠️ {erreur}</div>
      )}

      {/* Résultats de réinitialisations effectuées */}
      {Object.entries(done).map(([id, pwd]) => (
        <div key={id} className="px-5 py-3 bg-green-50 border-b border-green-100 flex items-center gap-3">
          <span className="text-green-600 text-lg">✅</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-green-800">Lien de réinitialisation envoyé par e-mail à {pwd}</p>
            <p className="text-xs text-green-600 mt-0.5">Le mot de passe actuel reste valable tant que le lien n&apos;a pas été utilisé.</p>
          </div>
          <button onClick={() => setDone(prev => { const n = { ...prev }; delete n[id]; return n; })}
            className="text-green-400 hover:text-green-600 text-sm">✕</button>
        </div>
      ))}

      {/* Liste des demandes */}
      {requests.length > 0 ? (
        <div className="divide-y divide-amber-100">
          {requests.map(req => (
            <div key={req.id} className="px-5 py-4 flex items-center gap-4">
              {/* Avatar */}
              <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 font-bold text-sm shrink-0">
                {req.fromAnimateurPrenom?.[0]}{req.fromAnimateurNom?.[0]}
              </div>

              {/* Infos */}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-800 text-sm">
                  {req.fromAnimateurPrenom} {req.fromAnimateurNom}
                </p>
                <p className="text-xs text-gray-500">
                  @{req.fromAnimateurUsername}
                  {req.fromAnimateurEmail && <> · {req.fromAnimateurEmail}</>}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Demandé le {new Date(req.envoyeAt).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>

              {/* Action */}
              <button
                onClick={() => handleReset(req)}
                disabled={resetting === req.id}
                className="shrink-0 flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
              >
                {resetting === req.id ? '⟳ Envoi...' : '🔑 Envoyer un lien de réinitialisation'}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-5 py-3 text-sm text-gray-500 italic">Toutes les demandes ont été traitées.</div>
      )}
    </div>
  );
}
