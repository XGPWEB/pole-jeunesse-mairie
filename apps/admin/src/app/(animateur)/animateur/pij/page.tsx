export const dynamic = 'force-dynamic';
import PageHeader from '@/components/PageHeader';
import { getSession } from '@/lib/session';
import { peutSaisirPij } from '@/lib/pij';
import PijClient from './PijClient';

export default async function PijAnimateurPage() {
  const session = await getSession();
  // Affichage seulement : chaque écriture est recontrôlée par /api/pij/*.
  const peutSaisir = peutSaisirPij(session);

  return (
    <div>
      <PageHeader titre="PIJ — Point Information Jeunesse" />
      <div className="p-8">
        <PijClient peutSaisir={peutSaisir} />
      </div>
    </div>
  );
}
