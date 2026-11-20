import Link from 'next/link';
import { getTenantId } from '@/lib/auth';
import { ESPACE_LABELS, formatDate } from '@/lib/data';
import PageHeader from '@/components/PageHeader';
import EspaceBadge from '@/components/EspaceBadge';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const ESPACE_FILTERS = [
  { id: '', label: 'Tous' },
  { id: 'collegiens', label: 'Collégiens' },
  { id: 'lyceens', label: 'Lycéens' },
  { id: 'pij', label: 'PIJ' },
  { id: 'clas', label: 'CLAS' },
];

export default async function ActivitesPage({ searchParams: props_searchParams }: { searchParams?: Promise<{ espace?: string }> }) {
  const searchParams = await props_searchParams;
  const tenant_id = await getTenantId();
  const espaceFilter = searchParams?.espace || '';
  const activites = await query<any>(`
    SELECT a.id, a.titre, a.description, a.espace_id AS "espaceId",
           a.date::text AS date, a.heure_debut AS "heureDebut", a.heure_fin AS "heureFin",
           a.lieu, a.animateur, a.places_total AS "placesTotal", a.statut, a.tags,
           GREATEST(0, a.places_total - COALESCE((SELECT COUNT(*) FROM inscriptions i WHERE i.activite_id = a.id AND i.statut = 'confirmee'), 0))::int AS "placesDisponibles"
    FROM activites a
    WHERE a.tenant_id = $1 AND ($2 = '' OR a.espace_id = $2)
    ORDER BY a.date ASC, a.heure_debut ASC
  `, [tenant_id, espaceFilter]);

  return (
    <div>
      <PageHeader
        titre="Activités"
        sousTitre={`${activites.length} activités au total`}
        action={
          <Link href="/admin/activites/nouvelle" className="bg-[#6B1A6E] text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#551558] transition-colors flex items-center gap-2">
            ＋ Nouvelle activité
          </Link>
        }
      />
      <div className="p-8">
        {/* Filtres */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {ESPACE_FILTERS.map(f => {
            const active = f.id === espaceFilter;
            return (
              <Link key={f.id} href={f.id ? `/admin/activites?espace=${f.id}` : '/admin/activites'}
                className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-colors ${active ? 'bg-[#6B1A6E] text-white border-[#6B1A6E]' : 'bg-white text-gray-600 border-gray-200 hover:border-[#6B1A6E] hover:text-[#6B1A6E]'}`}>
                {f.label}
              </Link>
            );
          })}
          <div className="ml-auto">
            <input
              type="text"
              placeholder="Rechercher une activité…"
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
              {activites.map((a: any) => {
                const taux = Math.round(((a.placesTotal - a.placesDisponibles) / a.placesTotal) * 100);
                return (
                  <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-gray-800">{new Date(a.date).getDate()} {new Date(a.date).toLocaleDateString('fr-FR', { month: 'short' })}</div>
                      <div className="text-xs text-gray-400 capitalize">{new Date(a.date).toLocaleDateString('fr-FR', { weekday: 'short' })}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      <Link href={`/admin/activites/${a.id}`} className="font-semibold text-gray-800 hover:text-[#6B1A6E] transition-colors">{a.titre}</Link>
                      <div className="text-xs text-gray-400 truncate max-w-xs">{(a.description || '').slice(0, 60)}…</div>
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
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {a.statut.charAt(0).toUpperCase() + a.statut.slice(1)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex gap-1">
                        <Link href={`/admin/activites/${a.id}/modifier`} className="p-1.5 rounded-lg hover:bg-purple-50 text-gray-400 hover:text-[#6B1A6E] transition-colors" title="Modifier">✏️</Link>
                        <button className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" title="Supprimer">🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
