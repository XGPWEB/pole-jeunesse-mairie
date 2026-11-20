export const dynamic = 'force-dynamic';
import { getTenantId } from '@/lib/auth';
import { query } from '@/lib/db';
import PageHeader from '@/components/PageHeader';
import InscriptionsClient from './InscriptionsClient';

export default async function InscriptionsPage() {
  const tenant_id = await getTenantId();
  const [inscriptions, espacesList] = await Promise.all([
    query<any>(`
      SELECT id, jeune_id AS "jeuneId", jeune_nom AS "jeuneNom", jeune_prenom AS "jeunePrenom",
             activite_id AS "activiteId", activite_titre AS "activiteTitre", espace_id AS "espaceId",
             date_inscription AS "dateInscription", statut, note, manuel,
             auto_refus AS "autoRefus", date_refus::text AS "dateRefus"
      FROM inscriptions WHERE tenant_id = $1 ORDER BY date_inscription DESC
    `, [tenant_id]),
    query<any>('SELECT id, nom FROM espaces WHERE tenant_id = $1 ORDER BY id', [tenant_id]),
  ]);

  const enAttente = inscriptions.filter((i: any) => i.statut === 'en-attente').length;

  return (
    <div>
      <PageHeader
        titre="Inscriptions"
        sousTitre={`${inscriptions.length} inscription${inscriptions.length !== 1 ? 's' : ''} au total${enAttente > 0 ? ` · ${enAttente} en attente de validation` : ''}`}
        action={
          <a
            href="/api/export/caf"
            download="inscriptions.csv"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#6B1A6E] text-white text-sm font-semibold hover:bg-[#5a1660] transition-colors shadow-sm"
          >
            <span>⬇</span>
            Export CSV
          </a>
        }
      />
      <InscriptionsClient inscriptions={inscriptions as any} espaces={espacesList} />
    </div>
  );
}
