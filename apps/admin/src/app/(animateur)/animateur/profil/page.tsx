export const dynamic = 'force-dynamic';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { queryOne } from '@/lib/db';
import ProfilClient from './ProfilClient';
import MenuPersonnalisation from './MenuPersonnalisation';
import { rubriquesEffectives } from '@/lib/rubriques';

export default async function ProfilPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const animateur = await queryOne<any>(`
    SELECT id, nom, prenom, email, espace_assigne AS "espaceAssigne", poste, unite,
           statut, role, photo_url AS "photoUrl",
           password_reset_requested AS "passwordResetRequested",
           date_embauche::text AS "dateEmbauche", type_contrat AS "typeContrat",
           totp_enabled AS "totpEnabled", created_at AS "createdAt", last_login AS "lastLogin",
           nav_prefs AS "navPrefs"
    FROM animateurs WHERE id = $1 AND tenant_id = $2
  `, [session.id, session.tenant_id ?? 'nogent']);

  if (!animateur) redirect('/animateur/dashboard');

  return (
    <div className="p-6 space-y-6">
      <ProfilClient animateur={animateur} />
      <MenuPersonnalisation navPrefs={animateur.navPrefs ?? null} rubriques={[...rubriquesEffectives(session)]} />
    </div>
  );
}
