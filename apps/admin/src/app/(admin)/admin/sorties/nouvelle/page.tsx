import PageHeader from '@/components/PageHeader';
import FicheSortieForm from '@/app/(animateur)/animateur/sorties/FicheSortieForm';

export const dynamic = 'force-dynamic';

export default function AdminNouvellesortiePage() {
  return (
    <div>
      <PageHeader titre="Nouvelle sortie" sousTitre="Créer une fiche sortie" />
      <div className="p-8">
        <FicheSortieForm basePath="/admin/sorties" />
      </div>
    </div>
  );
}
