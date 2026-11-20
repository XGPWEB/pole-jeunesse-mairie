import PageHeader from '@/components/PageHeader';
import { getTenantId } from '@/lib/auth';
import EspacesAdminClient from './EspacesAdminClient';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function EspacesAdminPage() {
  const tenant_id = await getTenantId();
  const [espaces, jeunes, activites, pointages, animateurs, sorties] = await Promise.all([
    query<any>(`SELECT id, nom, description, tranche_age AS "trancheAge", adresse, horaires,
                      animateur_ref AS "animateurRef", couleur, icon, capacite,
                      COALESCE(telephone,'') AS telephone,
                      COALESCE(email,'')     AS email,
                      COALESCE(statut,'actif') AS statut
               FROM espaces WHERE tenant_id = $1 ORDER BY nom`, [tenant_id]),
    query<any>(`SELECT id, nom, prenom, espace_id AS "espaceId" FROM jeunes WHERE tenant_id = $1`, [tenant_id]),
    query<any>(`SELECT id, titre, espace_id AS "espaceId" FROM activites WHERE tenant_id = $1`, [tenant_id]),
    query<any>(`SELECT id, espace_id AS "espaceId", date::text AS date FROM pointages WHERE tenant_id = $1`, [tenant_id]),
    query<any>(`SELECT id, nom, prenom, espace_assigne AS "espaceAssigne", statut FROM animateurs WHERE tenant_id = $1 AND COALESCE(role, 'animateur') <> 'admin'`, [tenant_id]),
    query<any>(`SELECT id, espace_id AS "espaceId" FROM sorties WHERE tenant_id = $1`, [tenant_id]),
  ]);

  return (
    <div>
      <PageHeader
        titre="Espaces"
        sousTitre={`Gestion des ${espaces.length} espaces du Pôle Jeunesse`}
      />
      <EspacesAdminClient
        initialEspaces={espaces}
        jeunes={jeunes}
        activites={activites}
        pointages={pointages}
        animateurs={animateurs}
        sorties={sorties}
      />
    </div>
  );
}
