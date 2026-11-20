export const dynamic = 'force-dynamic';
import PageHeader from '@/components/PageHeader';
import { getSession } from '@/lib/session';
import { getTenantId } from '@/lib/auth';
import { query } from '@/lib/db';
import CongesRecupClient from '@/app/(animateur)/animateur/conges/CongesRecupClient';

export default async function CongesAdminPage() {
  const session = await getSession();
  const tenant_id = await getTenantId();

  const animateurs = await query<{ id: string; nom: string }>(
    `SELECT id, (prenom || ' ' || nom) AS nom FROM animateurs
     WHERE tenant_id = $1 AND statut = 'actif' AND COALESCE(role, 'animateur') <> 'admin' ORDER BY nom`,
    [tenant_id],
  );

  return (
    <div>
      <PageHeader titre="Congés & Récupération" sousTitre="Saisie des congés, validation des récupérations" />
      <div className="p-8">
        <CongesRecupClient isAdmin currentUserId={session?.id ?? ''} animateurs={animateurs} />
      </div>
    </div>
  );
}
