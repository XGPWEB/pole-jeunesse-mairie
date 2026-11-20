'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import EspaceBadge from '@/components/EspaceBadge';
import { supprimerActivite } from '@/app/activites/actions';

function espaceIdFromFilter(label: string): string | null {
  const map: Record<string, string> = {
    'Collégiens': 'collegiens',
    'Lycéens': 'lyceens',
    'PIJ': 'pij',
    'CLAS': 'clas',
  };
  return map[label] ?? null;
}

export default function ActivitesAnimateurClient({ activites: initialActivites }: { activites: any[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState('Tous');
  const [search, setSearch] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filtered = initialActivites.filter(a => {
    if (filter !== 'Tous') {
      const espaceId = espaceIdFromFilter(filter);
      if (espaceId && a.espaceId !== espaceId) return false;
    }
    if (search) {
      const s = search.toLowerCase();
      if (
        !a.titre?.toLowerCase().includes(s) &&
        !a.animateur?.toLowerCase().includes(s) &&
        !a.lieu?.toLowerCase().includes(s)
      ) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await supprimerActivite(id);
      if (result.success) {
        setDeleteId(null);
        router.refresh();
      }
    });
  }

  return (
    <>
      <div className="p-8">
        {/* Filtres */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {['Tous', 'Collégiens', 'Lycéens', 'PIJ', 'CLAS'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
                f === filter
                  ? 'bg-[#1B3870] text-white border-[#1B3870]'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-[#1B3870] hover:text-[#1B3870]'
              }`}
            >
              {f}
            </button>
          ))}
          <div className="ml-auto">
            <input
              type="text"
              placeholder="Rechercher une activité..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-[#1B3870] w-64"
            />
          </div>
        </div>

        {/* Tableau */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Date</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Activité</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Espace</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Horaires</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Animateur</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Places</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Statut</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sorted.map(a => {
                const taux = a.placesTotal > 0
                  ? Math.round(((a.placesTotal - a.placesDisponibles) / a.placesTotal) * 100)
                  : 0;
                return (
                  <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-gray-800">{new Date(a.date).getDate()} {new Date(a.date).toLocaleDateString('fr-FR', { month: 'short' })}</div>
                      <div className="text-xs text-gray-400 capitalize">{new Date(a.date).toLocaleDateString('fr-FR', { weekday: 'short' })}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      <Link href={`/animateur/activites/${a.id}`} className="font-semibold text-gray-800 hover:text-[#1B3870] transition-colors">{a.titre}</Link>
                      {a.description && (
                        <div className="text-xs text-gray-400 truncate max-w-xs">{a.description.slice(0, 60)}...</div>
                      )}
                    </td>
                    <td className="px-5 py-3.5"><EspaceBadge espaceId={a.espaceId} /></td>
                    <td className="px-5 py-3.5 text-gray-600">{a.heureDebut}-{a.heureFin}</td>
                    <td className="px-5 py-3.5 text-gray-600">{a.animateur}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-[#1B3870] rounded-full" style={{ width: `${taux}%` }} />
                        </div>
                        <span className="text-xs text-gray-500">{a.placesDisponibles}/{a.placesTotal}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        a.statut === 'ouvert' ? 'bg-green-100 text-green-700' :
                        a.statut === 'complet' ? 'bg-red-100 text-red-700' :
                        a.statut === 'annule' ? 'bg-gray-100 text-gray-600' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {a.statut.charAt(0).toUpperCase() + a.statut.slice(1)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex gap-1">
                        <Link href={`/animateur/activites/${a.id}/modifier`} className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-[#1B3870] transition-colors" title="Modifier">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </Link>
                        <button
                          onClick={() => setDeleteId(a.id)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                          title="Supprimer"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-gray-400 text-sm">
                    Aucune activité trouvée.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de confirmation de suppression */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Supprimer cette activité ?</h3>
            <p className="text-sm text-gray-500 mb-6">
              Cette action est irréversible. L&apos;activité et toutes ses données associées seront définitivement supprimées.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={() => handleDelete(deleteId)}
                disabled={isPending}
                className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-semibold hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isPending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Suppression...
                  </>
                ) : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
