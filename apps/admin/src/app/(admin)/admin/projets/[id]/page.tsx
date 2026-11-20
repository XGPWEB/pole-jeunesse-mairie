export const dynamic = 'force-dynamic';
import { notFound } from 'next/navigation';
import { getTenantId } from '@/lib/auth';
import PageHeader from '@/components/PageHeader';
import ProjetForm from '@/app/(animateur)/animateur/projets/ProjetForm';
import DeleteProjetButton from '@/components/DeleteProjetButton';
import Link from 'next/link';
import { queryOne, query } from '@/lib/db';

export default async function AdminProjetDetailPage({ params: props_params }: { params: Promise<{ id: string }> }) {
  const params = await props_params;
  const tenant_id = await getTenantId();

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

  return (
    <div>
      <PageHeader
        titre={projet.titre || 'Fiche projet'}
        sousTitre={`${projet.animateurNom} · ${projet.espaceId}`}
      />
      <div className="p-8">
        <div className="flex justify-between gap-3 mb-6">
          <DeleteProjetButton projetId={params.id} redirectTo="/admin/projets" />
          <div className="flex gap-3">
            <Link href="/admin/projets" className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200 transition-colors">
              ← Retour
            </Link>
            {projet.statut === 'publie' && (
              <Link href={`/animateur/projets/${params.id}/print`} target="_blank"
                className="flex items-center gap-2 px-4 py-2.5 bg-[#6B1A6E] text-white font-semibold rounded-xl hover:bg-[#5a1460] transition-colors">
                🖨 Générer PDF
              </Link>
            )}
          </div>
        </div>
        <ProjetForm initialData={projetWithBudget} projetId={params.id} basePath="/admin/projets" />
      </div>
    </div>
  );
}
