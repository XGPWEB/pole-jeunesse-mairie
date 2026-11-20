import PageHeader from '@/components/PageHeader';
import SortiesClient from './SortiesClient';

export const dynamic = 'force-dynamic';

export default function SortiesPage() {
  return (
    <div>
      <PageHeader
        titre="Fiche Sortie"
        sousTitre="Organisez et imprimez vos fiches de sortie"
      />
      <div className="p-8">
        <SortiesClient />
      </div>
    </div>
  );
}
