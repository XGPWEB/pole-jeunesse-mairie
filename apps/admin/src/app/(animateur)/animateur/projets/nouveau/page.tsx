import PageHeader from '@/components/PageHeader';
import ProjetForm from '../ProjetForm';

export default function NouveauProjetPage() {
  return (
    <div>
      <PageHeader titre="Nouveau projet" sousTitre="Saisissez votre fiche projet" />
      <div className="p-8">
        <ProjetForm />
      </div>
    </div>
  );
}
