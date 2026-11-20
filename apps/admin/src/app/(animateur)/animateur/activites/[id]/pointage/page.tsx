import { query, queryOne } from '@/lib/db';
import { getTenantId } from '@/lib/auth';
import { notFound } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import PointageClient from './PointageClient';
import { formatDate } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function PointagePage({ params: props_params }: { params: Promise<{ id: string }> }) {
  const params = await props_params;
  const tenant_id = await getTenantId();
  const activite = await queryOne<any>(`
    SELECT id, titre, espace_id AS "espaceId", date::text AS date,
           heure_debut AS "heureDebut", heure_fin AS "heureFin"
    FROM activites WHERE id = $1 AND tenant_id = $2
  `, [params.id, tenant_id]);
  if (!activite) notFound();

  const [inscritsRaw, pointagesAujourdhui] = await Promise.all([
    query<any>(`
      SELECT i.statut, j.id, j.nom, j.prenom, j.espace_id AS "espaceId", j.date_naissance::text AS "dateNaissance"
      FROM inscriptions i
      JOIN jeunes j ON j.id = i.jeune_id
      WHERE i.activite_id = $1 AND i.tenant_id = $2 AND i.statut = 'confirmee'
    `, [params.id, tenant_id]),
    query<any>(`
      SELECT * FROM pointages WHERE activite_id = $1 AND tenant_id = $2 AND date = CURRENT_DATE
    `, [params.id, tenant_id]),
  ]);

  return (
    <div>
      <PageHeader
        titre={`Pointage — ${activite.titre}`}
        sousTitre={`${formatDate(activite.date)} · ${activite.heureDebut} – ${activite.heureFin}`}
      />
      <div className="p-8">
        <PointageClient
          activiteId={params.id}
          inscrits={inscritsRaw}
          pointagesInitiaux={pointagesAujourdhui}
        />
      </div>
    </div>
  );
}
