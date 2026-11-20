import { notFound } from 'next/navigation';
import { getTenantId } from '@/lib/auth';
import Link from 'next/link';
import { query, queryOne } from '@/lib/db';
import FicheActiviteForm from '@/app/activites/FicheActiviteForm';

export const dynamic = 'force-dynamic';

export default async function ModifierActiviteAnimateurPage({ params: props_params }: { params: Promise<{ id: string }> }) {
  const params = await props_params;
  const tenant_id = await getTenantId();
  const [activite, animateursRows] = await Promise.all([
    queryOne<any>(`SELECT * FROM activites WHERE id = $1 AND tenant_id = $2`, [params.id, tenant_id]),
    query<any>(`SELECT prenom || ' ' || nom AS name FROM animateurs WHERE tenant_id = $1 AND statut = 'actif' AND COALESCE(role, 'animateur') <> 'admin' ORDER BY nom`, [tenant_id]),
  ]);
  if (!activite) notFound();
  const animateurs = animateursRows.map((a: any) => a.name);

  return (
    <div>
      <div className="bg-white border-b border-gray-100 px-8 py-5">
        <div className="flex items-center gap-2 mb-1 text-sm">
          <Link href="/animateur/activites" className="text-gray-400 hover:text-[#1B3870] font-medium transition-colors">
            &larr; Activités
          </Link>
          <span className="text-gray-300">/</span>
          <Link href={`/animateur/activites/${activite.id}`} className="text-gray-400 hover:text-[#1B3870] font-medium transition-colors">
            {activite.titre}
          </Link>
        </div>
        <h1 className="text-xl font-extrabold text-gray-900">Modifier — {activite.titre}</h1>
        <p className="text-sm text-gray-500 mt-0.5">Modifier les informations de l&apos;activité</p>
      </div>
      <FicheActiviteForm mode="modification" activiteId={activite.id} initial={activite} basePath="/animateur/activites" animateurs={animateurs} />
    </div>
  );
}
