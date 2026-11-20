import PageHeader from '@/components/PageHeader';
import ProjetForm from '@/app/(animateur)/animateur/projets/ProjetForm';

export default function AdminNouveauProjetPage() {
  return (
    <div>
      <PageHeader titre="Nouveau projet" sousTitre="Saisissez votre fiche projet (admin)" />
      <div className="p-8">
        <ProjetForm basePath="/admin/projets" />
      </div>
    </div>
  );
}
