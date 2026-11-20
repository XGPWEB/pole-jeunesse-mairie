'use client';
import { useState, useEffect } from 'react';

const ESPACES = ['Tous', 'Collégiens', 'Lycéens', 'PIJ', 'CLAS'];

interface Notification {
  id: string;
  titre: string;
  message: string;
  cible: string;
  urgent: boolean;
  envoyePar: string;
  envoyeAt: string;
  luPar: string[];
  type?: string;
  fromAnimateurId?: string;
  fromAnimateurUsername?: string;
  fromAnimateurPrenom?: string;
  fromAnimateurNom?: string;
  fromAnimateurEmail?: string;
}

export default function NotificationsAdminClient() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [titre, setTitre] = useState('');
  const [message, setMessage] = useState('');
  const [cible, setCible] = useState('Tous');
  const [urgent, setUrgent] = useState(false);
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/notifications').then(r => r.json()).then(d => setNotifications(d.notifications ?? []));
  }, []);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setSuccess('');
    setError('');
    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titre, message, cible, urgent }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess('Notification envoyée avec succès !');
        setTitre('');
        setMessage('');
        setCible('Tous');
        setUrgent(false);
        setNotifications(data.notifications ?? []);
      } else {
        setError(data.error ?? 'Erreur lors de l\'envoi.');
      }
    } catch {
      setError('Erreur de connexion.');
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Supprimer cette notification ?')) return;
    const res = await fetch(`/api/notifications?id=${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) setNotifications(data.notifications ?? []);
  }

  async function handleResetPassword(notif: Notification) {
    if (!notif.fromAnimateurId) return;
    if (!confirm(`Envoyer un lien de réinitialisation de mot de passe par e-mail à ${notif.fromAnimateurPrenom} ${notif.fromAnimateurNom} ?`)) return;
    setResettingId(notif.id);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ animateurId: notif.fromAnimateurId, notifId: notif.id }),
      });
      const data = await res.json();
      if (data.success) {
        setResetResult(prev => ({ ...prev, [notif.id]: `✅ ${data.message ?? 'Lien de réinitialisation envoyé par e-mail.'}` }));
        setNotifications(prev => prev.filter(n => n.id !== notif.id));
      } else {
        setResetResult(prev => ({ ...prev, [notif.id]: `⚠️ Erreur : ${data.error}` }));
      }
    } catch {
      setResetResult(prev => ({ ...prev, [notif.id]: '⚠️ Erreur de connexion.' }));
    } finally {
      setResettingId(null);
    }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
      {/* Formulaire d'envoi */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-lg font-bold text-gray-800 mb-5 flex items-center gap-2">
          <span>🔔</span> Envoyer une notification
        </h2>

        {success && (
          <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-sm">
            ✅ {success}
          </div>
        )}
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleSend} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Titre</label>
            <input
              type="text"
              value={titre}
              onChange={e => setTitre(e.target.value)}
              placeholder="Titre de la notification"
              required
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30 focus:border-[#6B1A6E]"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Message</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Contenu du message..."
              required
              rows={4}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30 focus:border-[#6B1A6E] resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Destinataires</label>
              <select
                value={cible}
                onChange={e => setCible(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30"
              >
                {ESPACES.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  onClick={() => setUrgent(!urgent)}
                  className={`w-12 h-6 rounded-full transition-colors ${urgent ? 'bg-red-500' : 'bg-gray-200'} relative`}
                >
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${urgent ? 'translate-x-7' : 'translate-x-1'}`} />
                </div>
                <span className="text-sm font-medium text-gray-700">
                  {urgent ? '🚨 Urgent' : 'Normal'}
                </span>
              </label>
            </div>
          </div>

          <button
            type="submit"
            disabled={sending}
            className="w-full py-3 bg-[#6B1A6E] text-white font-bold rounded-xl hover:bg-[#5a1460] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {sending ? '⟳ Envoi...' : '🔔 Envoyer la notification'}
          </button>
        </form>
      </div>

      {/* Historique */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800">
            Historique <span className="text-sm font-normal text-gray-400">({notifications.length})</span>
          </h2>
        </div>

        {notifications.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-400">
            <div className="text-4xl mb-3">🔔</div>
            <p>Aucune notification envoyée</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 max-h-[600px] overflow-y-auto">
            {[...notifications].reverse().map(n => (
              <div key={n.id} className={`px-6 py-4 flex gap-4 ${n.type === 'reset-request' ? 'bg-amber-50' : ''}`}>
                <div className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0 ${
                  n.type === 'reset-request' ? 'bg-amber-100' : n.urgent ? 'bg-red-100' : 'bg-purple-100'
                }`}>
                  {n.type === 'reset-request' ? '🔑' : n.urgent ? '🚨' : '🔔'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-gray-800 text-sm">{n.titre}</p>
                    <button onClick={() => handleDelete(n.id)} className="text-gray-300 hover:text-red-400 transition-colors text-xs shrink-0">✕</button>
                  </div>
                  <p className="text-gray-500 text-xs mt-0.5 line-clamp-2">{n.message}</p>
                  <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      n.type === 'reset-request' ? 'bg-amber-100 text-amber-700' : 'bg-purple-50 text-[#6B1A6E]'
                    }`}>→ {n.cible}</span>
                    <span className="text-xs text-gray-400">{new Date(n.envoyeAt).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    {n.type !== 'reset-request' && <span className="text-xs text-gray-400">Lu par {n.luPar.length}</span>}
                  </div>
                  {/* Bouton réinitialisation mot de passe */}
                  {n.type === 'reset-request' && (
                    <div className="mt-3">
                      {resetResult[n.id] ? (
                        <p className="text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-2 rounded-lg">{resetResult[n.id]}</p>
                      ) : (
                        <button
                          onClick={() => handleResetPassword(n)}
                          disabled={resettingId === n.id}
                          className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white text-xs font-bold rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50"
                        >
                          {resettingId === n.id ? '⟳ Envoi...' : '🔑 Envoyer un lien de réinitialisation'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
