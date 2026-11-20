export const dynamic = 'force-dynamic';
import PageHeader from '@/components/PageHeader';
import PijClient from '@/app/(animateur)/animateur/pij/PijClient';

export default function PijAdminPage() {
  return (
    <div>
      <PageHeader titre="PIJ — Point Information Jeunesse" />
      <div className="p-8">
        <PijClient peutSaisir estAdmin />
      </div>
    </div>
  );
}
