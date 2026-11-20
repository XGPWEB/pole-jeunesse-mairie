export const dynamic = 'force-dynamic';
import { exigerAdminPage } from '@/lib/session';
import { rubriquesEffectives } from '@/lib/rubriques';
import { query } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import AnimateursClient from '@/app/animateurs/AnimateursClient';

export default async function AdminAnimateursPage({ searchParams: props_searchParams }: { searchParams?: Promise<{ espace?: string }> }) {
  const searchParams = await props_searchParams;
  const session = await exigerAdminPage('animateurs');
  const { tenant_id } = session;
  // Les administrateurs ne font pas partie de l'équipe : Administration › Administrateurs.
  const animateurs = await query<any>(`
    SELECT id, nom, prenom, email, espace_assigne AS "espaceAssigne", poste, unite, statut, role, rubriques,
           photo_url AS "photoUrl", username, telephone,
           date_naissance::text AS "dateNaissance", adresse,
           password_reset_requested AS "passwordResetRequested",
           date_embauche::text AS "dateEmbauche", type_contrat AS "typeContrat",
           created_at AS "createdAt", last_login AS "lastLogin"
    FROM animateurs
    WHERE tenant_id = $1 AND statut != 'archive' AND COALESCE(role, 'animateur') <> 'admin'
    ORDER BY nom, prenom
  `, [tenant_id]);
  const actifs   = animateurs.filter((a: any) => a.statut === 'actif').length;
  const inactifs = animateurs.filter((a: any) => a.statut !== 'actif').length;

  return (
    <div>
      <PageHeader
        titre="Équipe"
        sousTitre={`${actifs} actif(s) · ${inactifs} inactif(s)`}
      />
      <AnimateursClient role="animateur" animateurs={animateurs} editeur={{ id: session.id, rubriques: [...rubriquesEffectives(session)], gereDroits: session.gereDroits === true }} initialEspace={searchParams?.espace || 'tous'} />
    </div>
  );
}
