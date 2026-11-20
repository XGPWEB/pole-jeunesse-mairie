import { notFound } from 'next/navigation';
import { getTenantId } from '@/lib/auth';
import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import FicheSortieForm from '@/app/(animateur)/animateur/sorties/FicheSortieForm';
import ParticipantsManager from '@/components/ParticipantsManager';
import { query } from '@/lib/db';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

async function getSortieWithParticipants(id: string, tenant_id: string) {
  const client = await pool.connect();
  try {
    const row = await client.query(`
      SELECT s.id, s.titre, s.date::text AS date,
             s.heure_depart AS "heureDepart", s.heure_retour AS "heureRetour",
             s.lieu_depart AS "lieuDepart", s.lieu_destination AS "lieuDestination",
             s.transport, s.itineraire, s.nb_encadrants AS "nbEncadrants",
             s.autre_encadrant AS "autreEncadrant", s.capacite, s.observations,
             s.animateur_id AS "animateurId", s.animateur_nom AS "animateurNom",
             s.espace_id AS "espaceId", s.statut, s.editeurs, s.historique,
             (s.bon_commande IS NOT NULL) AS "hasBonCommande",
             s.bon_commande_nom AS "bonCommandeNom",
             s.created_at AS "createdAt"
      FROM sorties s WHERE s.id = $1 AND s.tenant_id = $2
    `, [id, tenant_id]);
    if (!row.rows[0]) return null;
    const s = row.rows[0];

    const parts = await client.query(
      `SELECT jeune_id AS "jeuneId", en_attente AS "enAttente" FROM sorties_participants WHERE sortie_id = $1 ORDER BY ordre`,
      [id],
    );
    s.participants = parts.rows.filter((p: any) => !p.enAttente).map((p: any) => p.jeuneId);
    s.participantsAttente = parts.rows.filter((p: any) => p.enAttente).map((p: any) => p.jeuneId);
    s.historique = s.historique ?? [];
    return s;
  } finally {
    client.release();
  }
}

export default async function AdminSortieEditPage({ params: props_params }: { params: Promise<{ id: string }> }) {
  const params = await props_params;
  const tenant_id = await getTenantId();
  const sortie = await getSortieWithParticipants(params.id, tenant_id);
  if (!sortie) notFound();

  const allJeunes = await query<any>(`
    SELECT id, nom, prenom, espace_id AS "espaceId" FROM jeunes WHERE tenant_id = $1 ORDER BY nom, prenom
  `, [tenant_id]);
  const jeunesMap = new Map(allJeunes.map((j: any) => [j.id, j]));

  const initialParticipants = [
    ...(sortie.participants ?? []).map((jeuneId: string) => {
      const j = jeunesMap.get(jeuneId);
      return { jeuneId, jeuneNom: j?.nom ?? 'Inconnu', jeunePrenom: j?.prenom ?? '', espaceId: j?.espaceId ?? sortie.espaceId ?? 'collegiens', statut: 'confirmee' as const };
    }),
    ...(sortie.participantsAttente ?? []).map((jeuneId: string) => {
      const j = jeunesMap.get(jeuneId);
      return { jeuneId, jeuneNom: j?.nom ?? 'Inconnu', jeunePrenom: j?.prenom ?? '', espaceId: j?.espaceId ?? sortie.espaceId ?? 'collegiens', statut: 'liste-attente' as const };
    }),
  ];

  const historique: any[] = sortie.historique ?? [];

  return (
    <div>
      <PageHeader
        titre={sortie.titre ?? 'Fiche sortie'}
        sousTitre="Fiche sortie — édition admin"
        action={
          <div className="flex gap-2">
            {sortie.hasBonCommande && (
              <a href={`/api/sorties/bon-commande?id=${params.id}`} target="_blank" rel="noopener noreferrer"
                className="px-4 py-2 text-sm bg-gray-100 text-gray-600 font-medium rounded-xl hover:bg-gray-200">
                📄 Bon de commande
              </a>
            )}
            <Link href={`/animateur/sorties/${params.id}/print`} target="_blank"
              className="px-4 py-2 text-sm bg-gray-100 text-gray-600 font-medium rounded-xl hover:bg-gray-200">
              🖨 PDF
            </Link>
            <Link href={`/animateur/sorties/${params.id}/fiches-sanitaires`} target="_blank"
              className="px-4 py-2 text-sm bg-gray-100 text-gray-600 font-medium rounded-xl hover:bg-gray-200">
              🩺 Fiches sanitaires
            </Link>
          </div>
        }
      />
      <div className="p-8">
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2">
            <FicheSortieForm
              initialData={sortie}
              sortieId={params.id}
              basePath="/admin/sorties"
            />
          </div>
          <div>
            <ParticipantsManager
              mode="sortie"
              entityId={sortie.id}
              entityTitre={sortie.titre}
              espaceId={sortie.espaceId ?? 'collegiens'}
              placesTotal={sortie.capacite ?? 0}
              jeunes={allJeunes}
              initialParticipants={initialParticipants}
            />
          </div>
        </div>

        {historique.length > 0 && (
          <div className="mt-8 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
              <span className="text-base">🕒</span>
              <h3 className="text-sm font-bold text-gray-700">Historique des modifications</h3>
              <span className="ml-auto text-xs text-gray-400">{historique.length} entrée{historique.length > 1 ? 's' : ''}</span>
            </div>
            <div className="divide-y divide-gray-50">
              {[...historique].reverse().map((entry: any, i: number) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0 ${entry.action === 'creation' ? 'bg-blue-100 text-blue-600' : 'bg-amber-100 text-amber-600'}`}>
                    {entry.action === 'creation' ? '✨' : '✏️'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold text-gray-800">{entry.auteurNom}</span>
                    <span className="text-xs text-gray-400 ml-2">{entry.action === 'creation' ? 'Création' : 'Modification'}</span>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">
                    {new Date(entry.date).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
