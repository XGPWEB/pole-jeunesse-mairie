'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import ContactAdminButton from '@/components/ContactAdminButton';
import CongesJourWidget from '@/components/CongesJourWidget';
import MonSoldeRecupWidget from '@/components/MonSoldeRecupWidget';

interface Notification {
  id: string; titre: string; message: string; cible: string;
  urgent: boolean; envoyePar: string; envoyeAt: string; luPar: string[];
  type?: string;
  sortieUrl?: string;
  sortieId?: string;
  demandeurId?: string;
  demandeurNom?: string;
  destAnimateurId?: string;
}
interface ProchaineItem {
  id: string;
  titre: string;
  date: string;
  heureDebut?: string;
  heureDepart?: string;
  espaceId?: string;
  lieuDestination?: string;
  _type: 'activite' | 'sortie';
}
interface Evenement { id: string; titre: string; date: string; heureDebut: string; lieu: string; }

interface ActualiteItem {
  id: string;
  titre: string;
  contenu: string;
  categorie: string;
  date: string;
  auteur: string;
  epingle?: boolean;
  espaceId?: string | null;
}

interface ActualitesPrefs {
  dismissed: string[];
  favorites: string[];
}

interface BirthdayAlert {
  animateurId: string;
  prenom: string;
  nom: string;
  age: number;
}

interface PointsAttention {
  activitesCompletes:      any[];
  activitesPeuDePlaces:    any[];
  sortiesCompletes:        any[];
  sortiesEnAttente:        any[];
  inscriptionsEnAttente:   any[];
  listeAttenteParActivite: { id: string; titre: string; attente: number }[];
  totalListeAttente:       number;
}

interface DashboardConfig {
  messageAccueil?: string;
  afficherNotifications?: boolean;
  afficherProchaines?: boolean;
  afficherEvenements?: boolean;
  liensRapides?: Array<{ label: string; url: string; icon: string }>;
}

const ACTU_CAT_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  Info:       { label: 'Info',       color: 'text-blue-700',   bg: 'bg-blue-100' },
  Evenement:  { label: 'Evenement',  color: 'text-amber-700',  bg: 'bg-amber-100' },
  Urgence:    { label: 'Urgence',    color: 'text-red-700',    bg: 'bg-red-100' },
  Divers:     { label: 'Divers',     color: 'text-gray-600',   bg: 'bg-gray-100' },
  annonce:    { label: 'Annonce',    color: 'text-purple-700', bg: 'bg-purple-100' },
  evenement:  { label: 'Evenement',  color: 'text-amber-700',  bg: 'bg-amber-100' },
  atelier:    { label: 'Atelier',    color: 'text-green-700',  bg: 'bg-green-100' },
  sortie:     { label: 'Sortie',     color: 'text-indigo-700', bg: 'bg-indigo-100' },
};

export default function DashboardAnimateurClient({
  notifications, prochaines, evenements, sessionId, dashboardConfig, birthdays = [],
  actualites: initialActualites = [], actualitesPrefs: initialPrefs, pointsAttention,
  mesJeunesCount = 0, activitesTodayCount = 0,
}: {
  notifications: Notification[];
  prochaines: ProchaineItem[];
  evenements: Evenement[];
  sessionId: string;
  dashboardConfig?: DashboardConfig;
  birthdays?: BirthdayAlert[];
  actualites?: ActualiteItem[];
  actualitesPrefs?: ActualitesPrefs;
  pointsAttention?: PointsAttention;
  mesJeunesCount?: number;
  activitesTodayCount?: number;
}) {
  const showNotifs    = dashboardConfig?.afficherNotifications  !== false;
  const showProchaines = dashboardConfig?.afficherProchaines    !== false;
  const showEvts      = dashboardConfig?.afficherEvenements     !== false;
  const liensRapides  = dashboardConfig?.liensRapides ?? [];
  const [notifs, setNotifs]   = useState(notifications);
  const [accordant, setAccordant] = useState<Record<string, boolean>>({});

  // Sync nouvelles notifications depuis les props (déclenché par AutoRefresh toutes les 10s)
  useEffect(() => {
    setNotifs(prev => {
      const prevIds = new Set(prev.map(n => n.id));
      const newOnes = notifications.filter(n => !prevIds.has(n.id));
      return newOnes.length > 0 ? [...prev, ...newOnes] : prev;
    });
  }, [notifications]);

  // Au chargement : marquer comme lues côté SERVEUR uniquement (badge sidebar)
  // sans toucher le state local → les notifs restent visuellement "non lues" jusqu'au clic
  useEffect(() => {
    const unreadIds = notifications.filter(n => !n.luPar.includes(sessionId)).map(n => n.id);
    if (unreadIds.length > 0) {
      window.dispatchEvent(new CustomEvent('notifications-read'));
      unreadIds.forEach(id => {
        fetch('/api/notifications', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, action: 'read' }),
        }).catch(() => {});
      });
    }

    // Polling toutes les 30s pour afficher les nouvelles notifications
    const poll = async () => {
      try {
        const res  = await fetch('/api/notifications');
        const data = await res.json();
        const fresh: Notification[] = data.notifications ?? [];
        setNotifs(prev => {
          const prevIds = new Set(prev.map(n => n.id));
          const newOnes = fresh.filter(n => !prevIds.has(n.id));
          return newOnes.length > 0 ? [...prev, ...newOnes] : prev;
        });
      } catch {}
    };
    const interval = setInterval(poll, 30_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Actualites state
  const [prefs, setPrefs] = useState<ActualitesPrefs>(initialPrefs ?? { dismissed: [], favorites: [] });
  const [expandedActu, setExpandedActu] = useState<string | null>(null);
  const [actuAnimating, setActuAnimating] = useState<string | null>(null);

  // Sorted actualites: favorites first, then by date, dismissed filtered out
  const visibleActualites = initialActualites
    .filter(a => !prefs.dismissed.includes(a.id))
    .sort((a, b) => {
      const aFav = prefs.favorites.includes(a.id) ? 1 : 0;
      const bFav = prefs.favorites.includes(b.id) ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

  async function toggleFavorite(actualiteId: string) {
    const isFav = prefs.favorites.includes(actualiteId);
    const action = isFav ? 'unfavorite' : 'favorite';
    setPrefs(prev => ({
      ...prev,
      favorites: isFav
        ? prev.favorites.filter(id => id !== actualiteId)
        : [...prev.favorites, actualiteId],
    }));
    await fetch('/api/actualites/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: sessionId, action, actualiteId }),
    });
  }

  async function dismissActualite(actualiteId: string) {
    setActuAnimating(actualiteId);
    setTimeout(() => {
      setPrefs(prev => ({
        ...prev,
        dismissed: [...prev.dismissed, actualiteId],
      }));
      setActuAnimating(null);
    }, 300);
    await fetch('/api/actualites/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: sessionId, action: 'dismiss', actualiteId }),
    });
  }

  async function markAsRead(id: string) {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'read' }),
    });
    setNotifs(prev =>
      prev.map(n => n.id === id && !n.luPar.includes(sessionId)
        ? { ...n, luPar: [...n.luPar, sessionId] } : n)
    );
  }

  async function dismissNotif(id: string) {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'dismiss' }),
    });
    setNotifs(prev => prev.filter(n => n.id !== id));
  }

  async function handleAccorder(notif: Notification) {
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

  const nonLuesCount = notifs.filter(n => !n.luPar.includes(sessionId)).length;

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-5">
        <Link href="/animateur/jeunes"
          className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 block transition-all hover:shadow-md hover:border-gray-200 hover:-translate-y-0.5">
          <div className="text-2xl mb-1">👥</div>
          <div className="text-3xl font-extrabold text-gray-800">{mesJeunesCount}</div>
          <div className="text-sm text-gray-500 mt-1">Jeunes dans mon espace</div>
        </Link>
        <Link href="/animateur/activites"
          className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 block transition-all hover:shadow-md hover:border-gray-200 hover:-translate-y-0.5">
          <div className="text-2xl mb-1">📅</div>
          <div className="text-3xl font-extrabold text-gray-800">{activitesTodayCount}</div>
          <div className="text-sm text-gray-500 mt-1">Activités aujourd&apos;hui</div>
        </Link>
        <Link href="/animateur/activites"
          className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 block transition-all hover:shadow-md hover:border-gray-200 hover:-translate-y-0.5">
          <div className="text-2xl mb-1">📋</div>
          <div className="text-3xl font-extrabold text-gray-800">{prochaines.length}</div>
          <div className="text-sm text-gray-500 mt-1">Activités &amp; sorties à venir</div>
        </Link>
        <div className={`rounded-xl border shadow-sm p-5 ${nonLuesCount > 0 ? 'bg-purple-50 border-purple-200' : 'bg-white border-gray-100'}`}>
          <div className="text-2xl mb-1">🔔</div>
          <div className={`text-3xl font-extrabold ${nonLuesCount > 0 ? 'text-[#6B1A6E]' : 'text-gray-800'}`}>{nonLuesCount}</div>
          <div className="text-sm text-gray-500 mt-1">Notifications non lues</div>
        </div>
      </div>

      {/* Message d'accueil */}
      {dashboardConfig?.messageAccueil && (
        <div className="bg-[#1B3870] text-white px-6 py-4 rounded-2xl font-semibold text-sm shadow-sm">
          {dashboardConfig.messageAccueil}
        </div>
      )}

      {/* Anniversaires du jour */}
      {birthdays.length > 0 && (
        <div className="space-y-3">
          {birthdays.map(b => (
            <div
              key={b.animateurId}
              className="relative overflow-hidden rounded-2xl border-2 border-pink-200 bg-gradient-to-r from-pink-50 via-purple-50 to-yellow-50 p-5 shadow-sm"
            >
              <div className="absolute -top-2 -right-2 text-6xl opacity-20 select-none">🎈</div>
              <div className="absolute -bottom-2 -left-2 text-5xl opacity-20 select-none">🎉</div>
              <div className="relative flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-2xl shadow-lg">
                  🎂
                </div>
                <div>
                  <p className="text-lg font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-pink-600 to-purple-600">
                    🎂 Joyeux anniversaire {b.prenom} ! 🎉
                  </p>
                  <p className="text-sm text-purple-500 font-medium mt-0.5">
                    {b.prenom} {b.nom} fête ses {b.age} ans aujourd&apos;hui 🥳🎈🎁
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Liens rapides */}
      {liensRapides.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {liensRapides.map((lien, i) => (
            <a key={i} href={lien.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:border-[#1B3870] hover:text-[#1B3870] transition-colors shadow-sm">
              <span>{lien.icon}</span>
              <span>{lien.label}</span>
            </a>
          ))}
        </div>
      )}

      {/* Congés du jour + solde de récupération */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <CongesJourWidget href="/animateur/conges" />
        <MonSoldeRecupWidget />
      </div>

      {/* Row 1: Notifications + Prochaines activités & sorties */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Notifications */}
        {showNotifs && <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
            <h2 className="font-bold text-gray-800 flex items-center gap-2">
              🔔 Notifications de l&apos;administrateur
              {notifs.filter(n => !n.luPar.includes(sessionId)).length > 0 && (
                <span className="bg-[#6B1A6E] text-white text-xs font-bold px-2 py-0.5 rounded-full">
                  {notifs.filter(n => !n.luPar.includes(sessionId)).length}
                </span>
              )}
            </h2>
            <ContactAdminButton />
          </div>
          {notifs.length === 0 ? (
            <div className="px-6 py-10 text-center text-gray-400">
              <div className="text-3xl mb-2">🔕</div>
              <p className="text-sm">Aucune notification pour le moment</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {[...notifs].reverse().map(n => {
                const isRead = n.luPar.includes(sessionId);
                return (
                  <div key={n.id}
                    className={`px-6 py-4 transition-colors ${
                      n.type === 'modif-sortie'   ? 'bg-amber-50'   :
                      n.type === 'reponse-admin'  ? 'bg-green-50'   :
                      n.type === 'modif-accordee' ? 'bg-green-50'   :
                      !isRead                     ? 'bg-purple-50'  :
                      'bg-white opacity-60'
                    }`}>
                    <div className="flex gap-3">
                      <div
                        className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0 cursor-pointer ${
                          n.type === 'modif-sortie'   ? 'bg-amber-100' :
                          n.type === 'reponse-admin'  ? 'bg-green-100' :
                          n.type === 'modif-accordee' ? 'bg-green-100' :
                          n.urgent ? 'bg-red-100' : 'bg-purple-100'
                        }`}
                        onClick={() => !isRead && markAsRead(n.id)}
                      >
                        {n.type === 'modif-sortie' ? '✏️' : n.type === 'reponse-admin' ? '📩' : n.type === 'modif-accordee' ? '✅' : n.urgent ? '🚨' : '🔔'}
                      </div>
                      <div className="flex-1 cursor-pointer" onClick={() => !isRead && markAsRead(n.id)}>
                        <div className="flex items-center gap-2">
                          <p className={`text-sm ${isRead ? 'font-medium text-gray-500' : 'font-bold text-gray-900'}`}>{n.titre}</p>
                          {!isRead && <span className="w-2 h-2 bg-[#6B1A6E] rounded-full" />}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">{n.message}</p>
                        <p className="text-xs text-gray-400 mt-1">
                          {new Date(n.envoyeAt).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          {!isRead && <span className="ml-2 text-[#6B1A6E]">· Cliquer pour marquer comme lu</span>}
                        </p>
                        {/* Actions pour les demandes de modification */}
                        {n.type === 'modif-sortie' && (
                          <div className="flex gap-2 mt-2 flex-wrap" onClick={e => e.stopPropagation()}>
                            {n.sortieUrl && (
                              <a
                                href={n.sortieUrl}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white text-xs font-bold rounded-lg hover:bg-amber-700 transition-colors"
                              >
                                ✏️ Voir la sortie →
                              </a>
                            )}
                            {n.sortieId && n.demandeurId && (
                              <button
                                onClick={() => handleAccorder(n)}
                                disabled={accordant[n.id]}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                              >
                                {accordant[n.id] ? '⟳ Accord...' : '✅ Accorder la modification'}
                              </button>
                            )}
                          </div>
                        )}
                        {/* Accès accordé : lien pour aller modifier la sortie */}
                        {n.type === 'modif-accordee' && n.sortieUrl && (
                          <a
                            href={n.sortieUrl}
                            onClick={e => e.stopPropagation()}
                            className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700 transition-colors"
                          >
                            ✏️ Modifier la fiche sortie →
                          </a>
                        )}
                      </div>
                      <button
                        onClick={() => dismissNotif(n.id)}
                        className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors text-xs mt-0.5"
                        title="Supprimer cette notification"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>}

        {/* Prochaines activités & sorties */}
        {showProchaines && <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-bold text-gray-800">📅 Prochaines activités & sorties</h2>
            <Link href="/animateur/activites" className="text-xs text-[#1B3870] font-semibold hover:underline">Tout voir →</Link>
          </div>
          {prochaines.length === 0 ? (
            <div className="px-6 py-10 text-center text-gray-400">
              <div className="text-3xl mb-2">📭</div>
              <p className="text-sm">Aucune activité à venir</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {prochaines.map(item => (
                <Link
                  key={item.id}
                  href={item._type === 'sortie' ? `/animateur/sorties/${item.id}` : `/animateur/activites/${item.id}`}
                  className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="w-12 h-12 rounded-xl bg-[#1B3870]/10 flex flex-col items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-[#1B3870] leading-none">
                      {new Date(item.date).toLocaleDateString('fr-FR', { day: 'numeric' })}
                    </span>
                    <span className="text-[10px] text-[#1B3870]/70 uppercase">
                      {new Date(item.date).toLocaleDateString('fr-FR', { month: 'short' })}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {item._type === 'sortie' && <span className="text-sm">🗺️</span>}
                      <p className="font-semibold text-gray-800 text-sm truncate">{item.titre}</p>
                    </div>
                    {item._type === 'sortie' ? (
                      <p className="text-xs text-gray-400">{item.lieuDestination ?? 'Sortie'}</p>
                    ) : (
                      <p className="text-xs text-gray-400">{item.heureDebut}</p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>}
      </div>

      {/* Points d'attention */}
      {pointsAttention && (() => {
        const { activitesCompletes, activitesPeuDePlaces, sortiesCompletes, sortiesEnAttente,
                inscriptionsEnAttente, listeAttenteParActivite, totalListeAttente } = pointsAttention;
        const aucun = activitesCompletes.length === 0 && activitesPeuDePlaces.length === 0 &&
          sortiesCompletes.length === 0 && sortiesEnAttente.length === 0 &&
          inscriptionsEnAttente.length === 0 && totalListeAttente === 0;
        return (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-amber-500 text-lg">⚠️</span>
              <h3 className="font-bold text-amber-800">Points d&apos;attention</h3>
            </div>
            <div className="space-y-2">
              {activitesCompletes.map((a: any) => (
                <div key={a.id} className="text-sm text-amber-700 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <Link href={`/animateur/activites/${a.id}`} className="font-semibold hover:underline">{a.titre}</Link>
                  <span>— Activité complète ({a.placesTotal} places) · {new Date(a.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                </div>
              ))}
              {activitesPeuDePlaces.map((a: any) => (
                <div key={a.id + '-low'} className="text-sm text-amber-700 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <Link href={`/animateur/activites/${a.id}`} className="font-semibold hover:underline">{a.titre}</Link>
                  <span>— Plus que {a.placesDisponibles} place(s) · {new Date(a.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                </div>
              ))}
              {sortiesCompletes.map((s: any) => (
                <div key={s.id + '-sc'} className="text-sm text-amber-700 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  🗺️ <Link href={`/animateur/sorties/${s.id}`} className="font-semibold hover:underline">{s.titre}</Link>
                  <span>— Sortie complète ({(s.participants ?? []).length}/{s.capacite}) · {new Date(s.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                </div>
              ))}
              {sortiesEnAttente.map((s: any) => (
                <div key={s.id + '-sa'} className="text-sm text-orange-700 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                  🗺️ <Link href={`/animateur/sorties/${s.id}`} className="font-semibold hover:underline">{s.titre}</Link>
                  <span>— {(s.participantsAttente ?? []).length} en liste d&apos;attente · {new Date(s.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                </div>
              ))}
              {inscriptionsEnAttente.length > 0 && (
                <div className="text-sm text-amber-700 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <strong>{inscriptionsEnAttente.length} inscription(s) en attente</strong> de validation
                </div>
              )}
              {totalListeAttente > 0 && (
                <div className="text-sm text-orange-700 flex items-center gap-2 flex-wrap">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                  <strong>{totalListeAttente} jeune(s) en liste d&apos;attente</strong> —
                  {listeAttenteParActivite.map((a) => (
                    <Link key={a.id} href={`/animateur/activites/${a.id}`} className="underline font-semibold hover:text-orange-900">
                      {a.titre} ({a.attente})
                    </Link>
                  ))}
                </div>
              )}
              {aucun && (
                <div className="text-sm text-amber-700">✅ Aucun point d&apos;attention pour le moment</div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Événements à venir */}
      {showEvts && <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-gray-800">📅 Événements du pôle jeunesse à venir</h2>
          <Link href="/animateur/evenements" className="text-xs text-[#1B3870] font-semibold hover:underline">Tout voir →</Link>
        </div>
        {evenements.length === 0 ? (
          <div className="px-6 py-10 text-center text-gray-400">
            <div className="text-3xl mb-2">📭</div>
            <p className="text-sm">Aucun événement à venir</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 divide-x divide-gray-50 md:grid-cols-3">
            {evenements.map(e => (
              <div key={e.id} className="flex items-center gap-4 px-6 py-3.5">
                <div className="w-11 h-11 rounded-xl bg-amber-50 flex flex-col items-center justify-center shrink-0 border border-amber-100">
                  <span className="text-xs font-bold text-amber-700 leading-none">{new Date(e.date).toLocaleDateString('fr-FR', { day: 'numeric' })}</span>
                  <span className="text-[10px] text-amber-500 uppercase">{new Date(e.date).toLocaleDateString('fr-FR', { month: 'short' })}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-800 text-sm truncate">{e.titre}</p>
                  <p className="text-xs text-gray-400 truncate">📍 {e.lieu} · {e.heureDebut}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>}

      {/* Actualites */}
      {initialActualites.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-bold text-gray-800 flex items-center gap-2">
              📰 Actualités à Nogent-sur-Marne
              {visibleActualites.length > 0 && (
                <span className="bg-[#6B1A6E] text-white text-xs font-bold px-2 py-0.5 rounded-full">
                  {visibleActualites.length}
                </span>
              )}
            </h2>
            {prefs.dismissed.length > 0 && (
              <span className="text-xs text-gray-400">
                {prefs.dismissed.length} masquee{prefs.dismissed.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
          {visibleActualites.length === 0 ? (
            <div className="px-6 py-10 text-center text-gray-400">
              <div className="text-3xl mb-2">📰</div>
              <p className="text-sm">Aucune actualite pour le moment</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {visibleActualites.map(actu => {
                const isFav = prefs.favorites.includes(actu.id);
                const isExpanded = expandedActu === actu.id;
                const isAnimating = actuAnimating === actu.id;
                const catConfig = ACTU_CAT_CONFIG[actu.categorie] ?? { label: actu.categorie, color: 'text-gray-600', bg: 'bg-gray-100' };

                return (
                  <div
                    key={actu.id}
                    className={`px-6 py-4 transition-all duration-300 ${
                      isAnimating ? 'opacity-0 max-h-0 py-0 overflow-hidden' : 'opacity-100 max-h-[500px]'
                    } ${isFav ? 'bg-amber-50/40' : 'hover:bg-gray-50/50'} ${
                      actu.categorie === 'Urgence' ? 'border-l-4 border-l-red-400' : ''
                    }`}
                  >
                    <div className="flex gap-3">
                      {/* Favorite star */}
                      <button
                        onClick={() => toggleFavorite(actu.id)}
                        className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0 transition-all duration-200 ${
                          isFav
                            ? 'bg-amber-100 text-amber-500 scale-110'
                            : 'bg-gray-100 text-gray-300 hover:bg-amber-50 hover:text-amber-400'
                        }`}
                        title={isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                      >
                        {isFav ? '\u2605' : '\u2606'}
                      </button>

                      {/* Content */}
                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => setExpandedActu(isExpanded ? null : actu.id)}
                      >
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${catConfig.bg} ${catConfig.color}`}>
                            {catConfig.label}
                          </span>
                          {isFav && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-600">
                              Favori
                            </span>
                          )}
                          {actu.categorie === 'Urgence' && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500 text-white animate-pulse">
                              URGENT
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-gray-900">{actu.titre}</p>
                        {!isExpanded && (
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{actu.contenu}</p>
                        )}
                        {isExpanded && (
                          <div className="mt-2 text-sm text-gray-600 whitespace-pre-line leading-relaxed bg-gray-50 rounded-xl p-4 border border-gray-100">
                            {actu.contenu}
                          </div>
                        )}
                        <p className="text-xs text-gray-400 mt-2">
                          {actu.auteur} · {new Date(actu.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                          {!isExpanded && (
                            <span className="ml-2 text-[#6B1A6E] font-medium">Cliquer pour lire</span>
                          )}
                        </p>
                      </div>

                      {/* Dismiss button */}
                      <button
                        onClick={() => dismissActualite(actu.id)}
                        className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors text-xs mt-0.5"
                        title="Masquer cette actualite"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
