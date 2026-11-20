import Link from 'next/link';
import { getTenantId } from '@/lib/auth';
import PageHeader from '@/components/PageHeader';
import { query } from '@/lib/db';
import DeleteSortieButton from '@/components/DeleteSortieButton';

export const dynamic = 'force-dynamic';

const STATUT_COLORS: Record<string, string> = {
  planifiee: 'bg-blue-100 text-blue-700',
  realisee:  'bg-green-100 text-green-700',
  annulee:   'bg-red-100 text-red-600',
};
const STATUT_LABELS: Record<string, string> = {
  planifiee: 'Planifiée', realisee: 'Réalisée', annulee: 'Annulée',
};

export default async function AdminSortiesPage() {
  const tenant_id = await getTenantId();
  const sorties = await query<any>(`
    SELECT s.id, s.titre, s.date::text AS date, s.animateur_nom AS "animateurNom",
           s.lieu_destination AS "lieuDestination", s.espace_id AS "espaceId", s.statut, s.capacite,
           (s.bon_commande IS NOT NULL) AS "hasBonCommande",
           (SELECT COUNT(*) FROM sorties_participants WHERE sortie_id = s.id AND NOT en_attente)::int AS "participantsCount"
    FROM sorties s WHERE s.tenant_id = $1 ORDER BY s.date DESC
  `, [tenant_id]);

  return (
    <div>
      <PageHeader titre="Fiches Sorties" sousTitre={`${sorties.length} fiche(s) au total`}
        action={
          <Link href="/admin/sorties/nouvelle"
            className="flex items-center gap-1.5 px-4 py-2 bg-[#6B1A6E] text-white text-sm font-semibold rounded-xl hover:bg-[#5a1560] transition-colors">
            + Nouvelle sortie
          </Link>
        }
      />
      <div className="p-8">
        {sorties.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-16 text-center">
            <div className="text-4xl mb-4">🗺️</div>
            <p className="text-gray-500 font-medium">Aucune sortie enregistrée</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sorties.map((s: any) => {
              return (
                <div key={s.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-[#6B1A6E]/10 flex flex-col items-center justify-center shrink-0">
                    <span className="text-base font-extrabold text-[#6B1A6E]">{new Date(s.date).getDate()}</span>
                    <span className="text-[10px] text-[#6B1A6E]/70 uppercase">{new Date(s.date).toLocaleDateString('fr-FR', { month: 'short' })}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <p className="font-bold text-gray-800">{s.titre}</p>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUT_COLORS[s.statut] ?? 'bg-gray-100 text-gray-500'}`}>
                        {STATUT_LABELS[s.statut] ?? s.statut}
                      </span>
                      {s.espaceId && (
                        <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-medium">{s.espaceId}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">
                      📍 {s.lieuDestination} · 👤 {s.animateurNom} · {s.participantsCount} jeunes
                      {s.capacite ? ` · ${s.participantsCount}/${s.capacite} places` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Link href={`/admin/sorties/${s.id}`}
                      className="px-3 py-1.5 text-sm bg-[#6B1A6E] text-white font-medium rounded-lg hover:bg-[#5a1560]">
                      ✏️ Modifier
                    </Link>
                    <Link href={`/animateur/sorties/${s.id}/print`} target="_blank"
                      className="px-3 py-1.5 text-sm bg-gray-100 text-gray-600 font-medium rounded-lg hover:bg-gray-200">
                      🖨 PDF
                    </Link>
                    <Link href={`/animateur/sorties/${s.id}/fiches-sanitaires`} target="_blank"
                      className="px-3 py-1.5 text-sm bg-gray-100 text-gray-600 font-medium rounded-lg hover:bg-gray-200">
                      🩺 Fiches sanitaires
                    </Link>
                    {s.hasBonCommande && (
                      <a href={`/api/sorties/bon-commande?id=${s.id}`} target="_blank" rel="noopener noreferrer"
                        title="Imprimer le bon de commande"
                        className="px-3 py-1.5 text-sm bg-gray-100 text-gray-600 font-medium rounded-lg hover:bg-gray-200">
                        📄 Bon de commande
                      </a>
                    )}
                    <DeleteSortieButton sortieId={s.id} titre={s.titre} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
