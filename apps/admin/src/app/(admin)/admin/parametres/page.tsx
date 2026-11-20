import { getTenantId } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import ParametresClient, { type ParametresData } from './ParametresClient';

export const dynamic = 'force-dynamic';

export default async function ParametresPage() {
  const tenant_id = await getTenantId();
  const row = await queryOne<any>(`SELECT data FROM parametres WHERE id = $1`, [tenant_id]);
  const data: ParametresData = row?.data ?? {
    general: { nomPole: '', ville: '', adresse: '', telephone: '', email: '' },
    securite: { dureeSessionJours: 7, longueurMdpMin: 8, alerteContratJours: 45 },
    donnees: { sauvegardeAuto: true, retentionSauvegardes: 10 },
  };
  return (
    <div>
      <PageHeader titre="Parametres" sousTitre="Configuration de l'application" />
      <ParametresClient initial={data} />
    </div>
  );
}
