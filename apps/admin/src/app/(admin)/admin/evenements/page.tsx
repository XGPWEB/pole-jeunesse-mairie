import PageHeader from '@/components/PageHeader';
import { getTenantId } from '@/lib/auth';
import EvenementsClient from './EvenementsClient';
import { query } from '@/lib/db';
import { todayLocal } from '@/lib/dates';

export const dynamic = 'force-dynamic';

export default async function AdminEvenementsPage() {
  const tenant_id = await getTenantId();
  const evenements = await query<any>(`
    SELECT id, titre, description, date::text AS date, heure_debut AS "heureDebut", heure_fin AS "heureFin", lieu, espaces
    FROM evenements WHERE tenant_id = $1 ORDER BY date DESC
  `, [tenant_id]);
  const today = todayLocal();
  const avenir = evenements.filter((e: any) => e.date >= today).length;
  const passes = evenements.filter((e: any) => e.date < today).length;

  return (
    <div>
      <PageHeader
        titre="Événements"
        sousTitre={`${avenir} à venir · ${passes} passé(s)`}
      />
      <EvenementsClient initial={evenements} />
    </div>
  );
}
