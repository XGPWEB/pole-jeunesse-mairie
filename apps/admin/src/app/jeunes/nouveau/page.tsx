import Link from 'next/link';
import FicheJeuneForm from '../FicheJeuneForm';
import { getTenantId } from '@/lib/auth';
import { listerEspacesCommune } from '@/lib/espaces';

export const dynamic = 'force-dynamic';

export default async function NouveauJeunePage() {
  const espaces = await listerEspacesCommune(await getTenantId());
  return (
    <div>
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-8 py-5">
        <div className="flex items-center gap-3 mb-1">
          <Link href="/admin/jeunes" className="text-gray-400 hover:text-[#6B1A6E] text-sm font-medium transition-colors">
            ← Fiches Jeunes
          </Link>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-extrabold text-gray-900">➕ Nouveau jeune</h1>
            <p className="text-sm text-gray-500 mt-0.5">Créer une nouvelle fiche d'inscription</p>
          </div>
        </div>
      </div>

      <FicheJeuneForm mode="creation" espaces={espaces} />
    </div>
  );
}
