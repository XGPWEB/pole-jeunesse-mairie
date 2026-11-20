import PageHeader from '@/components/PageHeader';
import { getTenantId } from '@/lib/auth';
import ActualitesAdminClient from './ActualitesAdminClient';
import { getSession } from '@/lib/session';
import { query } from '@/lib/db';
import { todayLocal } from '@/lib/dates';
import { estEvenementPasse } from '@/lib/actualites';

export const dynamic = 'force-dynamic';

export default async function AdminActualitesPage() {
  const tenant_id = await getTenantId();
  const actualites = await query<any>(`
    SELECT id, titre, contenu, date::text AS date, categorie, auteur, epingle, espace_id AS "espaceId"
    FROM actualites WHERE tenant_id = $1 ORDER BY date DESC
  `, [tenant_id]);
  const aujourdhui = todayLocal();
  const archivees = actualites.filter((a: any) => estEvenementPasse(a, aujourdhui)).length;
  const courantes = actualites.length - archivees;
  const session = await getSession();
  const auteurDefault = session ? `${session.prenom ?? ''} ${session.nom ?? ''}`.trim() || 'Administration' : 'Administration';

  return (
    <div>
      <PageHeader
        titre="Actualités à Nogent-sur-Marne"
        sousTitre={`${courantes} article${courantes > 1 ? 's' : ''} publié${courantes > 1 ? 's' : ''}${archivees > 0 ? ` · ${archivees} événement${archivees > 1 ? 's' : ''} archivé${archivees > 1 ? 's' : ''}` : ''}`}
      />
      <div className="p-8">
        <ActualitesAdminClient initialActualites={actualites} auteurDefault={auteurDefault} />
      </div>
    </div>
  );
}
