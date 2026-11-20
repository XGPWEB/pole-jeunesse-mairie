export const dynamic = 'force-dynamic';
import { getTenantId } from '@/lib/auth';
import { chargerTableauDeBord } from '@/lib/dashboard-data';
import StatCard from '@/components/StatCard';
import PageHeader from '@/components/PageHeader';
import EspaceBadge from '@/components/EspaceBadge';
import Link from 'next/link';
import AdminNotificationsPanel from '@/components/AdminNotificationsPanel';
import CongesJourWidget from '@/components/CongesJourWidget';
import { computeDashboardAlerts, formatDateFr } from '@/lib/dashboardAlerts';
import { getSession } from '@/lib/session';
import { todayLocal, toLocalDateStr } from '@/lib/dates';

const STATUT_COLORS: Record<string, string> = {
  planifiee: 'bg-blue-100 text-blue-700',
  realisee: 'bg-green-100 text-green-700',
  annulee: 'bg-red-100 text-red-600',
};

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default async function DashboardPage() {
  const adminSession = await getSession();
  const tenant_id = await getTenantId();
  const today = todayLocal();

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { activitesAVenir, sortiesAVenir, compteurs, jeunesParEspace, actualitesFeed, espaces, evenements, animateurs } =
    await chargerTableauDeBord(tenant_id, today, toLocalDateStr(thirtyDaysAgo));

  const totalJeunes = compteurs.jeunes;
  const nouveauxJeunesCeMois = compteurs.nouveauxJeunesCeMois;

  const todayDate = new Date();
  const { birthdays, contractAlerts } = computeDashboardAlerts(animateurs, todayDate);

  const prochainesItems = [
    ...activitesAVenir.map(a => ({ ...a, _type: 'activite' })),
    ...sortiesAVenir.map(s => ({ ...s, _type: 'sortie' })),
  ]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, 6) as any[];

  const statsEspaces = espaces.map((e: any) => ({
    ...e,
    // Le PIJ ne crée pas de fiches jeunes : sa carte compte les personnes de son registre.
    count: e.id === 'pij' ? compteurs.jeunesPij : Number(jeunesParEspace.find(j => j.espaceId === e.id)?.count ?? 0),
  }));
  // Les barres comparent les espaces entre eux ; le PIJ n'entre pas dans « Jeunes inscrits ».
  const plusGrandEspace = Math.max(1, ...statsEspaces.map((e: any) => e.count));

  const tauxPresence = compteurs.pointagesTotal > 0 ? Math.round((compteurs.pointagesPresents / compteurs.pointagesTotal) * 100) : 0;

  const listeAttenteParActivite = activitesAVenir.filter(a => a.attente > 0);

  const activitesCompletes    = activitesAVenir.filter(a => a.statut === 'complet');
  const activitesPeuDePlaces  = activitesAVenir.filter(a => a.placesDisponibles > 0 && a.placesDisponibles <= 3);
  const sortiesCompletes      = sortiesAVenir.filter(s => s.capacite > 0 && s.participantsCount >= s.capacite);
  const sortiesEnAttente      = sortiesAVenir.filter(s => s.participantsAttenteCount > 0);

  const totalListeAttenteActivites = listeAttenteParActivite.reduce((sum, a) => sum + a.attente, 0);
  const totalListeAttenteSorties   = sortiesEnAttente.reduce((sum, s) => sum + s.participantsAttenteCount, 0);
  const totalListeAttente          = totalListeAttenteActivites + totalListeAttenteSorties;

  const aucunPointAttention =
    activitesCompletes.length === 0 && activitesPeuDePlaces.length === 0 &&
    sortiesCompletes.length === 0 && sortiesEnAttente.length === 0 &&
    compteurs.inscriptionsEnAttente === 0 && totalListeAttente === 0;

  return (
    <div>
      <PageHeader
        titre="Tableau de bord"
        sousTitre={`Administration — ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
      />

      <div className="p-8 space-y-8">
        <AdminNotificationsPanel adminId={adminSession?.id ?? ''} />

        <CongesJourWidget href="/admin/conges" />

        {birthdays.length > 0 && (
          <div className="space-y-3">
            {birthdays.map(b => (
              <div key={b.animateurId} className="relative overflow-hidden rounded-2xl border-2 border-pink-200 bg-gradient-to-r from-pink-50 via-purple-50 to-yellow-50 p-5 shadow-sm">
                <div className="absolute -top-2 -right-2 text-6xl opacity-20 select-none">🎈</div>
                <div className="absolute -bottom-2 -left-2 text-5xl opacity-20 select-none">🎉</div>
                <div className="relative flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-2xl shadow-lg">🎂</div>
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

        {contractAlerts.length > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl">📋</span>
              <h3 className="font-bold text-amber-800">Contrats arrivant à échéance</h3>
            </div>
            <div className="space-y-2">
              {contractAlerts.map(c => (
                <div key={c.animateurId} className="flex items-center gap-2 text-sm text-amber-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                  <span>
                    ⚠️ Contrat de <strong>{c.prenom} {c.nom}</strong> expire le{' '}
                    <strong>{formatDateFr(c.dateFinContrat)}</strong>
                    {c.joursRestants === 0 ? ' — Expire aujourd\'hui !' : ` — ${c.joursRestants} jour${c.joursRestants > 1 ? 's' : ''} restant${c.joursRestants > 1 ? 's' : ''}`}
                    {' '}— Pensez à renouveler
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-5 gap-5">
          <StatCard label="Jeunes inscrits"      value={totalJeunes}                      icon="👥" color="purple" href="/admin/jeunes"
            delta={nouveauxJeunesCeMois > 0 ? `+${nouveauxJeunesCeMois} ce mois` : undefined} />
          <StatCard label="Activités & Sorties"  value={compteurs.activites + compteurs.sorties} icon="📅" color="navy"   href="/admin/activites" />
          <StatCard label="Taux de présence"     value={`${tauxPresence}%`}                icon="✅" color="green"  href="/admin/frequentation" />
          <StatCard label="Actualités publiées"  value={compteurs.actualites}               icon="📰" color="cyan"   href="/admin/actualites" />
          <StatCard label="Liste d'attente"      value={totalListeAttente}                 icon="⏳" color="amber"  href="/admin/inscriptions" />
        </div>

        <div>
          <h2 className="text-lg font-bold text-gray-800 mb-4">Répartition par espace</h2>
          <div className="grid grid-cols-4 gap-4">
            {statsEspaces.map((e: any) => (
              <div key={e.id} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm"
                // Mêmes lignes sur les quatre cartes ; la précision propre au PIJ est en info-bulle.
                title={e.id === 'pij' ? 'Personnes reçues ou suivies par le PIJ (module PIJ)' : undefined}>
                <div className="flex items-center justify-between mb-3">
                  <EspaceBadge espaceId={e.id} />
                  <span className="text-2xl font-extrabold text-gray-800">{e.count}</span>
                </div>
                <div className="text-xs text-gray-500">{e.trancheAge}</div>
                <div className="text-xs text-gray-400 mt-1">{e.animateurRef}</div>
                <div className="mt-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-[#6B1A6E]"
                    style={{ width: `${Math.round((e.count / plusGrandEspace) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">Prochaines activités & sorties</h2>
              <Link href="/admin/activites" className="text-xs text-[#6B1A6E] font-semibold hover:underline">Tout voir →</Link>
            </div>
            <div className="divide-y divide-gray-50">
              {prochainesItems.map((item: any) => (
                <div key={item.id} className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50">
                  <div className={`w-10 h-10 rounded-lg flex flex-col items-center justify-center shrink-0 ${item._type === 'sortie' ? 'bg-[#1B3870]/10' : 'bg-purple-50'}`}>
                    <span className={`text-xs font-bold leading-none ${item._type === 'sortie' ? 'text-[#1B3870]' : 'text-[#6B1A6E]'}`}>{new Date(item.date).getDate()}</span>
                    <span className={`text-[9px] uppercase font-semibold ${item._type === 'sortie' ? 'text-[#1B3870]/70' : 'text-[#6B1A6E]'}`}>{new Date(item.date).toLocaleDateString('fr-FR', { month: 'short' })}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-800 truncate">{item.titre}</div>
                    {item._type === 'sortie' ? (
                      <div className="text-xs text-gray-400">🗺️ Sortie · {item.lieuDestination} · {item.animateurNom}</div>
                    ) : (
                      <div className="text-xs text-gray-400">{item.heureDebut}–{item.heureFin} · {item.animateur}</div>
                    )}
                  </div>
                  {item._type === 'sortie' ? (
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUT_COLORS[item.statut] ?? 'bg-gray-100 text-gray-500'}`}>
                      {item.statut === 'planifiee' ? 'Planifiée' : item.statut}
                    </span>
                  ) : (
                    <EspaceBadge espaceId={item.espaceId} />
                  )}
                </div>
              ))}
              {prochainesItems.length === 0 && (
                <div className="px-5 py-8 text-center text-sm text-gray-400">Aucun événement à venir</div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">Actualités à Nogent-sur-Marne</h2>
              <Link href="/admin/actualites" className="text-xs text-[#6B1A6E] font-semibold hover:underline">Gérer →</Link>
            </div>
            <div className="divide-y divide-gray-50">
              {actualitesFeed.map((a: any) => (
                <div key={a.id} className="px-5 py-3 flex items-start gap-3 hover:bg-gray-50">
                  <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${a.epingle ? 'bg-[#6B1A6E]' : 'bg-gray-300'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-800 truncate">{a.titre}</div>
                    <div className="text-xs text-gray-400">{a.auteur} · {formatDate(a.date)}</div>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium capitalize">{a.categorie}</span>
                </div>
              ))}
              {actualitesFeed.length === 0 && <div className="px-5 py-8 text-center text-sm text-gray-400">Aucune actualité publiée</div>}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-bold text-gray-800">📅 Événements du pôle jeunesse à venir</h2>
            <Link href="/admin/evenements" className="text-xs text-[#6B1A6E] font-semibold hover:underline">Gérer →</Link>
          </div>
          {evenements.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400">Aucun événement à venir</div>
          ) : (
            <div className="grid grid-cols-2 divide-x divide-gray-50">
              {evenements.map((e: any) => (
                <div key={e.id} className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50">
                  <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-100 flex flex-col items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-amber-700 leading-none">{new Date(e.date).getDate()}</span>
                    <span className="text-[9px] text-amber-500 uppercase">{new Date(e.date).toLocaleDateString('fr-FR', { month: 'short' })}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-800 truncate">{e.titre}</div>
                    <div className="text-xs text-gray-400 truncate">📍 {e.lieu} · {e.heureDebut}</div>
                  </div>
                  <div className="flex gap-1 shrink-0 flex-wrap max-w-[80px]">
                    {e.espaces?.slice(0, 2).map((esp: string) => (
                      <span key={esp} className="text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded font-medium">{esp}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-amber-500 text-lg">⚠️</span>
            <h3 className="font-bold text-amber-800">Points d&apos;attention</h3>
          </div>
          <div className="space-y-2">
            {activitesCompletes.map((a: any) => (
              <div key={a.id} className="text-sm text-amber-700 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                <strong>{a.titre}</strong> — Activité complète ({a.placesTotal} places) · {new Date(a.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
              </div>
            ))}
            {activitesPeuDePlaces.map((a: any) => (
              <div key={a.id + '-low'} className="text-sm text-amber-700 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                <strong>{a.titre}</strong> — Plus que {a.placesDisponibles} place(s) · {new Date(a.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
              </div>
            ))}
            {sortiesCompletes.map((s: any) => (
              <div key={s.id + '-sc'} className="text-sm text-amber-700 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                🗺️ <strong>{s.titre}</strong> — Sortie complète ({s.participantsCount}/{s.capacite} participants) · {new Date(s.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
              </div>
            ))}
            {sortiesEnAttente.map((s: any) => (
              <div key={s.id + '-sa'} className="text-sm text-orange-700 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                🗺️ <strong>{s.titre}</strong> — {s.participantsAttenteCount} en liste d&apos;attente · {new Date(s.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
              </div>
            ))}
            {compteurs.inscriptionsEnAttente > 0 && (
              <div className="text-sm text-amber-700 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                <strong>{compteurs.inscriptionsEnAttente} inscription(s) en attente</strong> —{' '}
                <Link href="/admin/inscriptions" className="underline font-semibold hover:text-amber-900">Gérer →</Link>
              </div>
            )}
            {totalListeAttente > 0 && (
              <div className="text-sm text-orange-700 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                <strong>{totalListeAttente} jeune(s) en liste d&apos;attente</strong> —{' '}
                {listeAttenteParActivite.map((a: any) => (
                  <span key={a.id}>
                    <Link href={`/admin/activites/${a.id}`} className="underline font-semibold hover:text-orange-900">
                      {a.titre} ({a.attente})
                    </Link>{' '}
                  </span>
                ))}
              </div>
            )}
            {aucunPointAttention && (
              <div className="text-sm text-amber-700">✅ Aucun point d&apos;attention pour le moment</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
