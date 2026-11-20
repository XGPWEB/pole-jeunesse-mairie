import { getTenantId } from '@/lib/auth';
import { query } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import Link from 'next/link';
import JeunesClient from '@/app/jeunes/JeunesClient';

export const dynamic = 'force-dynamic';

export default async function AnimateurJeunesPage() {
  const tenant_id = await getTenantId();
  const jeunes = await query<any>(`
    SELECT id, nom, prenom, date_naissance::text AS "dateNaissance", espace_id AS "espaceId",
           COALESCE(secteur, '') AS secteur, etablissement, classe,
           autorisation_sortie AS "autorisationSortie",
           autorisation_photo AS "autorisationPhoto",
           autorisation_soins_benins AS "autorisationSoinsBenins"
    FROM jeunes WHERE tenant_id = $1 ORDER BY nom, prenom
  `, [tenant_id]);

  return (
    <div>
      <PageHeader
        titre="Fiches Jeunes"
        sousTitre={`${jeunes.length} jeune${jeunes.length > 1 ? 's' : ''} inscrit${jeunes.length > 1 ? 's' : ''}`}
        action={
          <Link
            href="/animateur/jeunes/nouveau"
            className="bg-[#1B3870] text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#162d5e] transition-colors flex items-center gap-2"
          >
            + Nouveau jeune
          </Link>
        }
      />
      <div className="p-8">
        <JeunesClient jeunes={jeunes} basePath="/animateur/jeunes" accentColor="#1B3870" />
      </div>
    </div>
  );
}
