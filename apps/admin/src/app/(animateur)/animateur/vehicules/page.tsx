import PageHeader from '@/components/PageHeader';
import VehiculesClient from './VehiculesClient';

export const dynamic = 'force-dynamic';

export default function VehiculesPage() {
  return (
    <div>
      <PageHeader
        titre="Réservation Véhicule"
        sousTitre="Calendrier de réservation — Renault Trafic"
      />
      <div className="p-8">
        <VehiculesClient />
      </div>
    </div>
  );
}
