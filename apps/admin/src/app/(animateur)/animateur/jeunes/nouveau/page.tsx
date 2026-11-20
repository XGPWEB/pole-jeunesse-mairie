import FicheJeuneForm from '@/app/jeunes/FicheJeuneForm';
import PageHeader from '@/components/PageHeader';
import { getTenantId } from '@/lib/auth';
import { listerEspacesCommune } from '@/lib/espaces';

export const dynamic = 'force-dynamic';

export default async function NouveauJeuneAnimateurPage() {
  const espaces = await listerEspacesCommune(await getTenantId());
  return (
    <div>
      <PageHeader titre="Nouveau jeune" sousTitre="Créer une fiche jeune" />
      <FicheJeuneForm mode="creation" returnPrefix="/animateur/jeunes" espaces={espaces} />
    </div>
  );
}
