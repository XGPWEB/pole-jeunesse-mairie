export const dynamic = 'force-dynamic';
import { notFound } from 'next/navigation';
import { getTenantId } from '@/lib/auth';
import { getSession } from '@/lib/session';
import PageHeader from '@/components/PageHeader';
import ProjetForm from '../ProjetForm';
import DeleteProjetButton from '@/components/DeleteProjetButton';
import Link from 'next/link';
import { queryOne, query } from '@/lib/db';

export default async function ProjetDetailPage({ params: props_params }: { params: Promise<{ id: string }> }) {
  const params = await props_params;
  const tenant_id = await getTenantId();
  const session = await getSession();

  const [projet, lignesBudget] = await Promise.all([
    queryOne<any>(`
      SELECT id, titre, animateur_id AS "animateurId", animateur_nom AS "animateurNom",
             espace_id AS "espaceId", statut, date_depot::text AS "dateDepot",
             duree, lieu, objectifs_synthetiques AS "objectifsSynthetiques",
             public_cible AS "publicCible", constat, objectifs,
             resultats_attendus AS "resultatsAttendus", deroulement,
             moyens_humains AS "moyensHumains", moyens_materiels AS "moyensMateriels",
             partenaires, modes_communication AS "modesCommunication",
             retro_planning AS "retroPlanning", outils_evaluation AS "outilsEvaluation",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM projets WHERE id = $1 AND tenant_id = $2
    `, [params.id, tenant_id]),
    // projets_budget n'a pas de tenant_id : la lecture est bornée par le projet parent.
    query<any>(`SELECT b.id, b.designation, b.cout FROM projets_budget b JOIN projets p ON p.id = b.projet_id
                WHERE b.projet_id = $1 AND p.tenant_id = $2 ORDER BY b.id`, [params.id, tenant_id]),
  ]);

  if (!projet) notFound();

  const projetWithBudget = { ...projet, lignesBudget };
  const canEdit = projet.animateurId === session?.id || session?.role === 'admin';

  return (
    <div>
      <PageHeader
        titre={projet.titre}
        sousTitre={`${projet.animateurNom} · ${projet.espaceId}`}
      />
      <div className="p-8">
        <div className="flex justify-between gap-3 mb-6">
          <div>
            {canEdit && (
              <DeleteProjetButton projetId={params.id} redirectTo="/animateur/projets" />
            )}
          </div>
          <div className="flex gap-3">
            <Link href="/animateur/projets"
              className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200 transition-colors">
              ← Retour
            </Link>
            {projet.statut === 'publie' && (
              <Link href={`/animateur/projets/${params.id}/print`} target="_blank"
                className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200 transition-colors">
                🖨 Générer PDF
              </Link>
            )}
          </div>
        </div>

        {canEdit ? (
          <ProjetForm initialData={projetWithBudget} projetId={params.id} />
        ) : (
          <div className="max-w-3xl space-y-6">
            {(() => {
              const sections = [
                { id: 'identite', label: '📋 Fiche d\'identité synthétique', fields: [
                  { k: 'Nom du projet', v: projet.titre },
                  { k: 'Date de dépôt', v: projet.dateDepot ? new Date(projet.dateDepot).toLocaleDateString('fr-FR') : '' },
                  { k: 'Durée', v: projet.duree },
                  { k: 'Lieu', v: projet.lieu },
                  { k: 'Objectif(s) du projet', v: projet.objectifsSynthetiques },
                  { k: 'Public cible', v: projet.publicCible },
                ]},
                { id: 'presentation', label: '📝 Présentation du projet', fields: [
                  { k: 'Constat / Contexte', v: projet.constat },
                  { k: 'Objectifs', v: projet.objectifs },
                  { k: 'Résultats attendus', v: projet.resultatsAttendus },
                ]},
                { id: 'deroulement', label: '🗓 Déroulement', fields: [{ k: '', v: projet.deroulement }] },
                { id: 'moyens', label: '🔧 Moyens', fields: [
                  { k: 'Moyens humains', v: projet.moyensHumains },
                  { k: 'Moyens matériels', v: projet.moyensMateriels },
                ]},
                { id: 'budget', label: '💰 Budget prévisionnel', fields: [] },
                { id: 'partenaires', label: '🤝 Partenaires', fields: [{ k: '', v: projet.partenaires }] },
                { id: 'communication', label: '📣 Modes de communication', fields: [{ k: '', v: projet.modesCommunication }] },
                { id: 'retro', label: '📅 Rétro-planning', fields: [{ k: '', v: projet.retroPlanning }] },
                { id: 'evaluation', label: '📊 Outils d\'évaluation / Bilan', fields: [{ k: '', v: projet.outilsEvaluation }] },
              ];

              const filteredLignes = lignesBudget.filter((l: any) => l.designation || l.cout);
              const totalBudget = filteredLignes.reduce((s: number, l: any) => {
                const n = parseFloat(String(l.cout).replace(',', '.'));
                return s + (isNaN(n) ? 0 : n);
              }, 0);

              return sections
                .filter(s => s.id === 'budget' ? filteredLignes.length > 0 : s.fields.some(f => f.v))
                .map(section => (
                  <div key={section.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                    <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4 border-b pb-2">{section.label}</h3>

                    {section.fields.length > 0 && (
                      <div className="space-y-3">
                        {section.fields.map(f => f.v ? (
                          <div key={f.k || section.id}>
                            {f.k && <p className="text-xs text-gray-400 font-semibold mb-0.5">{f.k}</p>}
                            <p className="text-sm text-gray-700 whitespace-pre-wrap">{f.v}</p>
                          </div>
                        ) : null)}
                      </div>
                    )}

                    {section.id === 'budget' && (
                      <div className="border border-gray-200 rounded-xl overflow-hidden">
                        <div className="grid grid-cols-[1fr_140px] bg-gray-50 border-b border-gray-200">
                          <div className="px-3 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider">Désignation</div>
                          <div className="px-3 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider text-right border-l border-gray-200">Coût (€)</div>
                        </div>
                        {filteredLignes.map((l: any, i: number) => (
                          <div key={i} className="grid grid-cols-[1fr_140px] border-b border-gray-100 last:border-b-0">
                            <div className="px-3 py-2 text-sm text-gray-700">{l.designation}</div>
                            <div className="px-3 py-2 text-sm text-gray-700 text-right font-mono border-l border-gray-100">
                              {l.cout ? `${parseFloat(String(l.cout).replace(',', '.')).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : '—'}
                            </div>
                          </div>
                        ))}
                        <div className="grid grid-cols-[1fr_140px] bg-gray-50 border-t-2 border-gray-200">
                          <div className="px-3 py-2.5 text-sm font-bold text-gray-700">TOTAL</div>
                          <div className="px-3 py-2.5 text-sm font-bold text-[#1B3870] text-right font-mono border-l border-gray-200">
                            {totalBudget.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ));
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
