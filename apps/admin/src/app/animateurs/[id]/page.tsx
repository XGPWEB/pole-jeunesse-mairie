export const dynamic = 'force-dynamic';
import { notFound } from 'next/navigation';
import { exigerAdminPage } from '@/lib/session';
import { queryOne } from '@/lib/db';
import FicheAnimateurClient from './FicheAnimateurClient';
import { rubriquesEffectives } from '@/lib/rubriques';

export default async function FicheAnimateurPage({ params: props_params }: { params: Promise<{ id: string }> }) {
  const params = await props_params;
  const session = await exigerAdminPage('animateurs');
  const { tenant_id } = session;
  const animateur = await queryOne<any>(`
    SELECT id, nom, prenom, email, espace_assigne AS "espaceAssigne", poste, unite,
           statut, role, rubriques, photo_url AS "photoUrl", username,
           telephone, date_naissance::text AS "dateNaissance", adresse,
           password_reset_requested AS "passwordResetRequested",
           date_embauche::text AS "dateEmbauche", date_fin_contrat::text AS "dateFinContrat",
           type_contrat AS "typeContrat",
           created_at AS "createdAt", last_login AS "lastLogin"
    FROM animateurs WHERE id = $1 AND tenant_id = $2
  `, [params.id, tenant_id]);

  if (!animateur) notFound();
  return (
    <FicheAnimateurClient
      animateur={animateur}
      editeur={{ id: session.id, rubriques: [...rubriquesEffectives(session)], gereDroits: session.gereDroits === true }}
    />
  );
}
