'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

interface AdminNotif {
  id: string;
  type: string;
  titre: string;
  message: string;
  envoyeAt: string;
  cible?: string;
  // reset-request
  fromAnimateurId?: string;
  fromAnimateurUsername?: string;
  fromAnimateurPrenom?: string;
  fromAnimateurNom?: string;
  fromAnimateurEmail?: string;
  // modif-sortie
  sortieId?: string;
  sortieUrl?: string;
  demandeurId?: string;
  demandeurNom?: string;
  destAnimateurId?: string;
  // message-animateur
  expediteurId?: string;
  expediteurNom?: string;
  expediteurUsername?: string;
  expediteurEspace?: string;
}

export default function AdminNotificationsPanel({ adminId }: { adminId: string }) {
  const [notifs, setNotifs]           = useState<AdminNotif[]>([]);
  const [resetting, setResetting]     = useState<string | null>(null);
  const [dismissing, setDismissing]   = useState<string | null>(null);
  const [resetDone, setResetDone]     = useState<Record<string, string>>({});
  // Accorder modification state
  const [accordant, setAccordant]     = useState<Record<string, boolean>>({});
  // Reply state
  const [replyNotif, setReplyNotif]   = useState<AdminNotif | null>(null);
  const [replyText, setReplyText]     = useState('');
  const [replySending, setReplySending] = useState(false);
  const [replyDone, setReplyDone]     = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/notifications')
      .then(r => r.json())
      .then(d => {
        const all: AdminNotif[] = d.notifications ?? [];
        const adminNotifs = all.filter(n => {
          if (n.type === 'reset-request')     return true;
          if (n.type === 'message-animateur') return true;
          if (n.type === 'modif-sortie')      return n.destAnimateurId === adminId;
          return false;
        });
        adminNotifs.sort((a, b) => new Date(b.envoyeAt).getTime() - new Date(a.envoyeAt).getTime());
        setNotifs(adminNotifs);
      });
  }, [adminId]);

  async function handleReset(notif: AdminNotif) {
    setResetting(notif.id);
    try {
      const res  = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ animateurId: notif.fromAnimateurId, notifId: notif.id }),
      });
      const data = await res.json();
      if (data.success) {
        setResetDone(prev => ({ ...prev, [notif.id]: `${notif.fromAnimateurPrenom} ${notif.fromAnimateurNom}` }));
        setNotifs(prev => prev.filter(n => n.id !== notif.id));
      } else {
        // Un échec (pas d'adresse e-mail, envoi impossible…) était silencieux :
        // l'admin croyait la demande traitée alors que rien n'était parti.
        alert(data.error ?? 'La réinitialisation a échoué.');
      }
    } catch {
      alert('Erreur de connexion au serveur.');
    } finally {
      setResetting(null);
    }
  }

  async function handleDismiss(notifId: string) {
    setDismissing(notifId);
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: notifId, action: 'dismiss' }),
    });
    setNotifs(prev => prev.filter(n => n.id !== notifId));
    setDismissing(null);
  }

  async function handleAccorder(notif: AdminNotif) {
    if (!notif.sortieId || !notif.demandeurId) return;
    setAccordant(prev => ({ ...prev, [notif.id]: true }));
    try {
      await fetch('/api/sorties/demande-modif', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifId: notif.id, sortieId: notif.sortieId, demandeurId: notif.demandeurId }),
      });
      setNotifs(prev => prev.filter(n => n.id !== notif.id));
    } finally {
      setAccordant(prev => { const n = { ...prev }; delete n[notif.id]; return n; });
    }
  }

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyNotif || !replyText.trim()) return;
    setReplySending(true);
    try {
      const destinataire = replyNotif.expediteurId;
      const destinataireNom = replyNotif.expediteurNom ?? replyNotif.expediteurUsername ?? 'Animateur';
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:            'reponse-admin',
          titre:           `📩 Réponse de l'administration`,
          message:         replyText.trim(),
          cible:           destinataire,
          destAnimateurId: destinataire,
          urgent:          false,
        }),
      });
      // Dismiss l'original après réponse
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: replyNotif.id, action: 'dismiss' }),
      });
      setNotifs(prev => prev.filter(n => n.id !== replyNotif.id));
      setReplyDone(destinataireNom);
      setReplyNotif(null);
      setReplyText('');
    } finally {
      setReplySending(false);
    }
  }

  const total = notifs.length;
  if (total === 0 && Object.keys(resetDone).length === 0 && !replyDone) return null;

  const TYPE_CONFIG = {
    'reset-request':     { icon: '🔑', border: 'border-l-amber-400',  bg: 'bg-amber-50',  iconBg: 'bg-amber-100',  iconColor: 'text-amber-700'  },
    'modif-sortie':      { icon: '✏️', border: 'border-l-blue-400',   bg: 'bg-blue-50',   iconBg: 'bg-blue-100',   iconColor: 'text-blue-700'   },
    'message-animateur': { icon: '💬', border: 'border-l-purple-400', bg: 'bg-purple-50', iconBg: 'bg-purple-100', iconColor: 'text-[#6B1A6E]'  },
  } as Record<string, { icon: string; border: string; bg: string; iconBg: string; iconColor: string }>;

  return (
    <>
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-3">
          <span className="text-lg">🔔</span>
          <h2 className="font-bold text-gray-800">Messages des animateurs</h2>
          {total > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#6B1A6E] text-white text-xs font-bold">
              {total}
            </span>
          )}
          <div className="ml-auto flex gap-2 text-xs text-gray-400 font-medium">
            {[
              { type: 'reset-request',     label: '🔑 Réinit.', color: 'text-amber-600' },
              { type: 'modif-sortie',      label: '✏️ Modif.',  color: 'text-blue-600' },
              { type: 'message-animateur', label: '💬 Message', color: 'text-purple-600' },
            ].map(({ type, label, color }) => {
              const count = notifs.filter(n => n.type === type).length;
              return count > 0 ? (
                <span key={type} className={`${color} font-semibold`}>{label} ({count})</span>
              ) : null;
            })}
          </div>
        </div>

        {/* Réinitialisations effectuées */}
        {Object.entries(resetDone).map(([id, nom]) => (
          <div key={id} className="px-5 py-3 bg-green-50 border-b border-green-100 flex items-center gap-3">
            <span className="text-green-600">✅</span>
            <p className="flex-1 text-sm font-semibold text-green-800">
              Lien de réinitialisation envoyé par e-mail à <strong>{nom}</strong>.
            </p>
            <button onClick={() => setResetDone(prev => { const n = { ...prev }; delete n[id]; return n; })}
              className="text-green-400 hover:text-green-600 text-sm">✕</button>
          </div>
        ))}

        {/* Réponse envoyée */}
        {replyDone && (
          <div className="px-5 py-3 bg-green-50 border-b border-green-100 flex items-center gap-3">
            <span className="text-green-600">✅</span>
            <p className="flex-1 text-sm font-semibold text-green-800">
              Réponse envoyée à <strong>{replyDone}</strong>.
            </p>
            <button onClick={() => setReplyDone(null)} className="text-green-400 hover:text-green-600 text-sm">✕</button>
          </div>
        )}

        {/* Liste des notifications */}
        <div className="divide-y divide-gray-50">
          {notifs.map(n => {
            const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG['message-animateur'];
            return (
              <div key={n.id} className={`px-5 py-4 flex items-start gap-3 border-l-4 ${cfg.border} ${cfg.bg}/30 hover:${cfg.bg}/50 transition-colors`}>
                {/* Icône */}
                <div className={`mt-0.5 w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0 ${cfg.iconBg} ${cfg.iconColor}`}>
                  {cfg.icon}
                </div>

                {/* Contenu */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900">{n.titre}</p>
                  <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{n.message}</p>
                  {/* Méta */}
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-xs text-gray-400">
                      {new Date(n.envoyeAt).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {n.expediteurEspace && (
                      <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-medium">{n.expediteurEspace}</span>
                    )}
                  </div>
                  {/* Actions */}
                  <div className="flex gap-2 mt-2.5 flex-wrap">
                    {n.type === 'reset-request' && (
                      <button
                        onClick={() => handleReset(n)}
                        disabled={resetting === n.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                      >
                        {resetting === n.id ? '⟳ Envoi...' : '🔑 Envoyer un lien de réinitialisation'}
                      </button>
                    )}
                    {n.type === 'modif-sortie' && n.sortieId && (
                      <>
                        <Link
                          href={`/admin/sorties/${n.sortieId}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors"
                        >
                          ✏️ Voir & modifier →
                        </Link>
                        {n.demandeurId && (
                          <button
                            onClick={() => handleAccorder(n)}
                            disabled={accordant[n.id]}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
                          >
                            {accordant[n.id] ? '⟳ Accord...' : '✅ Accorder la modification'}
                          </button>
                        )}
                      </>
                    )}
                    {n.type === 'message-animateur' && (
                      <button
                        onClick={() => { setReplyNotif(n); setReplyText(''); }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#6B1A6E] hover:bg-[#551558] text-white text-xs font-bold rounded-lg transition-colors"
                      >
                        📩 Répondre
                      </button>
                    )}
                    <button
                      onClick={() => handleDismiss(n.id)}
                      disabled={dismissing === n.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                    >
                      {dismissing === n.id ? '⟳' : '✓ Traité'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {notifs.length === 0 && (
            <div className="px-5 py-4 text-sm text-gray-400 italic">Tous les messages ont été traités. ✅</div>
          )}
        </div>
      </div>

      {/* Modal de réponse */}
      {replyNotif && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-7">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800 text-base">📩 Répondre à {replyNotif.expediteurNom}</h3>
              <button onClick={() => setReplyNotif(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            {/* Message original */}
            <div className="mb-4 px-3 py-2.5 bg-purple-50 border border-purple-100 rounded-xl">
              <p className="text-[10px] text-purple-500 font-semibold uppercase tracking-wide mb-1">Message reçu</p>
              {replyNotif.titre.includes('—') && (
                <p className="text-xs font-semibold text-gray-700 mb-0.5">{replyNotif.titre.split('—').slice(1).join('—').trim()}</p>
              )}
              <p className="text-xs text-gray-600 leading-relaxed">{replyNotif.message}</p>
            </div>

            <form onSubmit={handleReply} className="space-y-3">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Votre réponse *</label>
                <textarea
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  placeholder="Écrivez votre réponse…"
                  rows={4}
                  required
                  autoFocus
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30 focus:border-[#6B1A6E] resize-none"
                />
              </div>
              <p className="text-xs text-gray-400">La réponse apparaîtra dans les notifications de {replyNotif.expediteurNom?.split(' ')[0]}.</p>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setReplyNotif(null)}
                  className="flex-1 py-2.5 border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-50 text-sm transition-colors">
                  Annuler
                </button>
                <button type="submit" disabled={replySending || !replyText.trim()}
                  className="flex-1 py-2.5 bg-[#6B1A6E] text-white font-bold rounded-xl hover:bg-[#551558] transition-colors disabled:opacity-50 text-sm">
                  {replySending ? '⟳ Envoi...' : '📩 Envoyer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
