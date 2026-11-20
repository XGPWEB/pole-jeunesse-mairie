export const dynamic = 'force-dynamic';
import { redirect } from 'next/navigation';
import { exigerAdminPage } from '@/lib/session';
import { rubriquesEffectives } from '@/lib/rubriques';
import { query } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import AnimateursClient from '@/app/animateurs/AnimateursClient';

/**
 * Administration › Administrateurs : comptes qui supervisent. Ils ne font pas
 * partie de l'équipe mobilisable (activités, sorties, congés…), d'où une page
 * à part de la page Équipe, réservée au compte qui gère les droits.
 */
export default async function AdministrateursPage() {
  const session = await exigerAdminPage();
  if (!session.gereDroits) redirect('/admin/dashboard');
  const administrateurs = await query<any>(`
    SELECT id, nom, prenom, email, espace_assigne AS "espaceAssigne", poste, unite, statut, role, rubriques,
           photo_url AS "photoUrl", username, telephone,
           date_naissance::text AS "dateNaissance", adresse,
           password_reset_requested AS "passwordResetRequested",
           date_embauche::text AS "dateEmbauche", type_contrat AS "typeContrat",
           created_at AS "createdAt", last_login AS "lastLogin"
    FROM animateurs
    WHERE tenant_id = $1 AND statut != 'archive' AND role = 'admin'
    ORDER BY nom, prenom
  `, [session.tenant_id]);
  const actifs = administrateurs.filter((a: any) => a.statut === 'actif').length;

  return (
    <div>
      <PageHeader titre="Administrateurs" sousTitre={`${actifs} actif(s) · supervision, hors équipe d'animation`} />
      <AnimateursClient role="admin" animateurs={administrateurs} editeur={{ id: session.id, rubriques: [...rubriquesEffectives(session)], gereDroits: true }} />
    </div>
  );
}
