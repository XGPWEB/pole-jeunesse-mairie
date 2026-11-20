import PageHeader from '@/components/PageHeader';
import ProjetsClient from './ProjetsClient';

export const dynamic = 'force-dynamic';

export default function ProjetsPage() {
  return (
    <div>
      <PageHeader
        titre="Espace Projet"
        sousTitre="Créez, suivez et imprimez vos fiches projet"
      />
      <div className="p-8">
        <ProjetsClient />
      </div>
    </div>
  );
}
