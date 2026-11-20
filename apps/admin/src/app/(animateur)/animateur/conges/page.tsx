export const dynamic = 'force-dynamic';
import PageHeader from '@/components/PageHeader';
import { getSession } from '@/lib/session';
import { getTenantId } from '@/lib/auth';
import { query } from '@/lib/db';
import CongesRecupClient from './CongesRecupClient';

export default async function CongesAnimateurPage() {
  const session = await getSession();
  const tenant_id = await getTenantId();

  // Liste des animateurs (utile seulement pour l'admin, mais chargée ici pour
  // partager le composant ; l'animateur ne verra pas le formulaire de saisie).
  const animateurs = await query<{ id: string; nom: string }>(
    `SELECT id, (prenom || ' ' || nom) AS nom FROM animateurs
     WHERE tenant_id = $1 AND statut = 'actif' AND COALESCE(role, 'animateur') <> 'admin' ORDER BY nom`,
    [tenant_id],
  );

  return (
    <div>
      <PageHeader titre="Congés & Récupération" sousTitre="Planning de l'équipe et gestion de vos heures" />
      <div className="p-8">
        <CongesRecupClient isAdmin={false} currentUserId={session?.id ?? ''} animateurs={animateurs} />
      </div>
    </div>
  );
}
