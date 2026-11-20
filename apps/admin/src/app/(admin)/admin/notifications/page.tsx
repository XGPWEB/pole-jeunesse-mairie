import NotificationsAdminClient from './NotificationsAdminClient';
import PageHeader from '@/components/PageHeader';

export const dynamic = 'force-dynamic';

export default function NotificationsAdminPage() {
  return (
    <div>
      <PageHeader
        titre="Notifications Push"
        sousTitre="Envoyez des messages instantanés aux animateurs"
      />
      <div className="p-8">
        <NotificationsAdminClient />
      </div>
    </div>
  );
}
