export const dynamic = 'force-dynamic';
import { getTenantId } from '@/lib/auth';
import { query } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import FrequentationClient from '@/app/(admin)/admin/frequentation/FrequentationClient';

export default async function AnimateurFrequentationPage() {
  const tenant_id = await getTenantId();
  const pointages = await query<any>(`
    SELECT p.id, p.jeune_id AS "jeuneId",
           COALESCE(p.espace_id, a.espace_id, j.espace_id) AS "espaceId",
           p.date::text AS date, p.heure_arrivee AS "heureArrivee", p.heure_sortie AS "heureSortie",
           p.animateur, p.type, p.activite_id AS "activiteId", p.manuel, p.source, p.statut
    FROM pointages p
    LEFT JOIN activites a ON a.id = p.activite_id
    LEFT JOIN jeunes j ON j.id = p.jeune_id
    WHERE p.tenant_id = $1
      AND (p.type = 'accueil-libre'
           OR (p.statut IS DISTINCT FROM 'absent' AND p.statut IS DISTINCT FROM 'excuse'))
    ORDER BY p.date ASC, p.heure_arrivee ASC
  `, [tenant_id]);

  return (
    <div>
      <PageHeader
        titre="Frequentation"
        sousTitre="Suivi journalier et hebdomadaire des presences"
      />
      <FrequentationClient pointages={pointages} />
    </div>
  );
}
