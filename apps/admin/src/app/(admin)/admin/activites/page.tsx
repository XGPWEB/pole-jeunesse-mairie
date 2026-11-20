import Link from 'next/link';
import { getTenantId } from '@/lib/auth';
import PageHeader from '@/components/PageHeader';
import ActivitesAdminClient from './ActivitesAdminClient';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function ActivitesAdminPage() {
  const tenant_id = await getTenantId();
  const enriched = await query<any>(`
    SELECT a.id, a.titre, a.description, a.espace_id AS "espaceId",
           a.date::text AS date, a.heure_debut AS "heureDebut", a.heure_fin AS "heureFin",
           a.lieu, a.animateur, a.places_total AS "placesTotal", a.statut, a.tags,
           GREATEST(0, a.places_total - COALESCE((SELECT COUNT(*) FROM inscriptions i WHERE i.activite_id = a.id AND i.statut = 'confirmee'), 0))::int AS "placesDisponibles"
    FROM activites a WHERE a.tenant_id = $1 ORDER BY a.date ASC, a.heure_debut ASC
  `, [tenant_id]);

  return (
    <div>
      <PageHeader
        titre="Activités"
        sousTitre={`${enriched.length} activités au total`}
        action={
          <Link href="/admin/activites/nouvelle" className="bg-[#6B1A6E] text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#551558] transition-colors flex items-center gap-2">
            ＋ Nouvelle activité
          </Link>
        }
      />
      <ActivitesAdminClient activites={enriched} />
    </div>
  );
}
