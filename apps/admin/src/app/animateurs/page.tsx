export const dynamic = 'force-dynamic';
import { exigerAdminPage } from '@/lib/session';
import { query } from '@/lib/db';
import AnimateursClient from './AnimateursClient';
import { rubriquesEffectives } from '@/lib/rubriques';

export default async function AnimateursPage() {
  const session = await exigerAdminPage('animateurs');
  const { tenant_id } = session;
  const animateurs = await query<any>(`
    SELECT id, nom, prenom, email, espace_assigne AS "espaceAssigne", poste, unite, statut, role, rubriques,
           photo_url AS "photoUrl", password_reset_requested AS "passwordResetRequested",
           date_embauche::text AS "dateEmbauche", date_fin_contrat::text AS "dateFinContrat",
           type_contrat AS "typeContrat",
           created_at AS "createdAt", last_login AS "lastLogin"
    FROM animateurs WHERE tenant_id = $1 AND COALESCE(role, 'animateur') <> 'admin' ORDER BY nom, prenom
  `, [tenant_id]);
  return <AnimateursClient role="animateur" animateurs={animateurs} editeur={{ id: session.id, rubriques: [...rubriquesEffectives(session)], gereDroits: session.gereDroits === true }} />;
}
