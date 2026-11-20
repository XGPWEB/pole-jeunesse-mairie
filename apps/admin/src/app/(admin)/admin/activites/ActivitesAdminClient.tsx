'use client';

import { useState } from 'react';
import Link from 'next/link';
import EspaceBadge from '@/components/EspaceBadge';
import DeleteActiviteAdminButton from './DeleteActiviteAdminButton';

function espaceIdFromFilter(label: string): string | null {
  const map: Record<string, string> = {
    'Collégiens': 'collegiens',
    'Lycéens': 'lyceens',
    'PIJ': 'pij',
    'CLAS': 'clas',
  };
  return map[label] ?? null;
}

export default function ActivitesAdminClient({ activites: initialActivites }: { activites: any[] }) {
  const [filter, setFilter] = useState('Tous');
  const [search, setSearch] = useState('');

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

  return (
    <div className="p-8">
      {/* Filtres */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {['Tous', 'Collégiens', 'Lycéens', 'PIJ', 'CLAS'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-colors ${
              f === filter
                ? 'bg-[#6B1A6E] text-white border-[#6B1A6E]'
                : 'bg-white text-gray-600 border-gray-200 hover:border-[#6B1A6E] hover:text-[#6B1A6E]'
            }`}
          >
            {f}
          </button>
        ))}
        <div className="ml-auto">
          <input
            type="text"
            placeholder="Rechercher une activité…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-[#6B1A6E] w-64"
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
                    <Link href={`/admin/activites/${a.id}`} className="font-semibold text-gray-800 hover:text-[#6B1A6E] transition-colors">{a.titre}</Link>
                    {a.description && (
                      <div className="text-xs text-gray-400 truncate max-w-xs">{a.description.slice(0, 60)}...</div>
                    )}
                  </td>
                  <td className="px-5 py-3.5"><EspaceBadge espaceId={a.espaceId} /></td>
                  <td className="px-5 py-3.5 text-gray-600">{a.heureDebut}–{a.heureFin}</td>
                  <td className="px-5 py-3.5 text-gray-600">{a.animateur}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-[#6B1A6E] rounded-full" style={{ width: `${taux}%` }} />
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
                      <Link href={`/admin/activites/${a.id}/modifier`} className="p-1.5 rounded-lg hover:bg-purple-50 text-gray-400 hover:text-[#6B1A6E] transition-colors" title="Modifier">✏️</Link>
                      <DeleteActiviteAdminButton activiteId={a.id} />
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
  );
}
