import { redirect } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import { exigerAdminPage } from '@/lib/session';
import { tenantExploitant } from '@/lib/monitoring';
import { versionComplete } from '@/lib/version';
import MonitoringClient from './MonitoringClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Monitoring — Pôle Jeunesse' };

export default async function MonitoringPage() {
  const session = await exigerAdminPage();
  // Même règle que l'API : journal réservé à la commune exploitante.
  if (session.tenant_id !== tenantExploitant()) redirect('/admin/dashboard');
  return (
    <div>
      <PageHeader titre="Monitoring" sousTitre={`Erreurs du serveur et du navigateur, tâches d'exploitation — version ${versionComplete()}`} />
      <div className="p-8">
        <MonitoringClient />
      </div>
    </div>
  );
}
