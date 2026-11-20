export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { getTenantId } from '@/lib/auth';
import { query } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import JeunesClient from './JeunesClient';

export default async function JeunesPage({ searchParams: props_searchParams }: { searchParams?: Promise<{ espace?: string }> }) {
  const searchParams = await props_searchParams;
  const tenant_id = await getTenantId();
  const jeunes = await query<any>(`
    SELECT id, nom, prenom,
           date_naissance::text AS "dateNaissance",
           espace_id AS "espaceId",
           COALESCE(secteur, '') AS secteur,
           etablissement, classe,
           autorisation_sortie AS "autorisationSortie",
           autorisation_photo AS "autorisationPhoto",
           autorisation_soins_benins AS "autorisationSoinsBenins"
    FROM jeunes WHERE tenant_id = $1
    ORDER BY nom, prenom
  `, [tenant_id]);

  return (
    <div>
      <PageHeader
        titre="Fiches Jeunes"
        sousTitre={`${jeunes.length} jeune${jeunes.length > 1 ? 's' : ''} inscrit${jeunes.length > 1 ? 's' : ''}`}
        action={
          <div className="flex gap-2">
            <Link
              href="/api/export/caf"
              className="border border-gray-200 text-gray-600 px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-gray-50 flex items-center gap-2"
            >
              📤 Exporter CSV
            </Link>
            <Link
              href="/admin/jeunes/nouveau"
              className="bg-[#6B1A6E] text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#551558] flex items-center gap-2"
            >
              ＋ Nouveau jeune
            </Link>
          </div>
        }
      />

      <div className="p-8">
        <JeunesClient jeunes={jeunes} initialEspace={searchParams?.espace || ''} />
      </div>
    </div>
  );
}
