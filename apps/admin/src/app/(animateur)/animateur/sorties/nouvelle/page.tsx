import PageHeader from '@/components/PageHeader';
import FicheSortieForm from '../FicheSortieForm';

export default function NouvelleSortiePage() {
  return (
    <div>
      <PageHeader titre="Nouvelle sortie" sousTitre="Créez votre fiche sortie" />
      <div className="p-8">
        <FicheSortieForm />
      </div>
    </div>
  );
}
