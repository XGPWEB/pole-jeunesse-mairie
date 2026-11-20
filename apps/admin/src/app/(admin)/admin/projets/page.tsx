import PageHeader from '@/components/PageHeader';
import ProjetsClient from '@/app/(animateur)/animateur/projets/ProjetsClient';

export const dynamic = 'force-dynamic';

export default function AdminProjetsPage() {
  return (
    <div>
      <PageHeader
        titre="Espace Projet"
        sousTitre="Créez, suivez et imprimez vos fiches projet — Tous les animateurs"
      />
      <div className="p-8">
        <ProjetsClient basePath="/admin/projets" />
      </div>
    </div>
  );
}
