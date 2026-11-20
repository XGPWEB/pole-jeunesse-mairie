import PageHeader from '@/components/PageHeader';
import VehiculesClient from '@/app/(animateur)/animateur/vehicules/VehiculesClient';

export const dynamic = 'force-dynamic';

export default function AdminVehiculesPage() {
  return (
    <div>
      <PageHeader
        titre="Réservation Véhicule"
        sousTitre="Calendrier de réservation — Tous les animateurs"
      />
      <div className="p-8">
        <VehiculesClient />
      </div>
    </div>
  );
}
