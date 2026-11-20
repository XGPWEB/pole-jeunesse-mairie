import Link from 'next/link';
import { getTenantId } from '@/lib/auth';
import FicheActiviteForm from '@/app/activites/FicheActiviteForm';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function NouvelleActiviteAnimateurPage() {
  const tenant_id = await getTenantId();
  const rows = await query<any>(`SELECT prenom || ' ' || nom AS name FROM animateurs WHERE tenant_id = $1 AND statut = 'actif' AND COALESCE(role, 'animateur') <> 'admin' ORDER BY nom`, [tenant_id]);
  const animateurs = rows.map((a: any) => a.name);
  return (
    <div>
      <div className="bg-white border-b border-gray-100 px-8 py-5">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/animateur/activites" className="text-gray-400 hover:text-[#1B3870] text-sm font-medium transition-colors">
            &larr; Activités
          </Link>
        </div>
        <h1 className="text-xl font-extrabold text-gray-900">Nouvelle activité</h1>
        <p className="text-sm text-gray-500 mt-0.5">Créer une nouvelle activité pour le Pôle Jeunesse</p>
      </div>
      <FicheActiviteForm mode="creation" basePath="/animateur/activites" animateurs={animateurs} />
    </div>
  );
}
