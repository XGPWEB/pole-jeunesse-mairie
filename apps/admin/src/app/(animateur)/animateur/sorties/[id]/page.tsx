import { notFound } from 'next/navigation';
import { getTenantId } from '@/lib/auth';
import PageHeader from '@/components/PageHeader';
import FicheSortieForm from '../FicheSortieForm';
import ParticipantsManager from '@/components/ParticipantsManager';
import DemandeModifSortieButton from '@/components/DemandeModifSortieButton';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { query, queryOne } from '@/lib/db';
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

export default async function SortieDetailPage({ params: props_params }: { params: Promise<{ id: string }> }) {
  const params = await props_params;
  const tenant_id = await getTenantId();
  const session = await getSession();
  const sortie = await getSortieWithParticipants(params.id, tenant_id);
  if (!sortie) notFound();

  const isAdmin   = session?.role === 'admin';
  const isCreator = sortie.animateurId === session?.id;
  const isEditeur = (sortie.editeurs ?? []).includes(session?.id ?? '');
  const canEdit   = isAdmin || isCreator || isEditeur;

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

  const HistoriqueBlock = historique.length > 0 ? (
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
  ) : null;

  return (
    <div>
      <PageHeader titre={sortie.titre} sousTitre={`${sortie.animateurNom} · ${sortie.espaceId}`} />
      <div className="p-8">
        <div className="flex justify-end gap-3 mb-6">
          {sortie.hasBonCommande && (
            <a href={`/api/sorties/bon-commande?id=${params.id}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200">
              📄 Imprimer le bon de commande
            </a>
          )}
          <Link href={`/animateur/sorties/${params.id}/print`} target="_blank"
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200">
            🖨 Imprimer la fiche
          </Link>
          <Link href={`/animateur/sorties/${params.id}/fiches-sanitaires`} target="_blank"
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200">
            🩺 Fiches sanitaires
          </Link>
        </div>

        {canEdit ? (
          <>
            <div className="grid grid-cols-3 gap-6">
              <div className="col-span-2">
                <FicheSortieForm initialData={sortie} sortieId={params.id} />
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
            {HistoriqueBlock}
          </>
        ) : (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest border-b pb-3">
                Informations de la sortie
              </h3>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ['Date', new Date(sortie.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })],
                  ['Départ', `${sortie.heureDepart}${sortie.heureRetour ? ' → ' + sortie.heureRetour : ''}`],
                  ['Lieu de départ', sortie.lieuDepart],
                  ['Destination', sortie.lieuDestination],
                  ['Transport', sortie.transport || '—'],
                  ['Nb encadrants', String(sortie.nbEncadrants ?? 1)],
                  ['Participants', `${sortie.participants?.length ?? 0} jeunes`],
                  ['Places', sortie.capacite ? `${sortie.participants?.length ?? 0} / ${sortie.capacite}` : '—'],
                ].map(([label, value]) => (
                  <div key={label as string} className="flex flex-col gap-0.5">
                    <dt className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</dt>
                    <dd className="text-gray-800 font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
              {sortie.observations && (
                <div className="pt-3 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Observations</p>
                  <p className="text-sm text-gray-700">{sortie.observations}</p>
                </div>
              )}
            </div>

            <ParticipantsManager
              mode="sortie"
              entityId={sortie.id}
              entityTitre={sortie.titre}
              espaceId={sortie.espaceId ?? 'collegiens'}
              placesTotal={sortie.capacite ?? 0}
              jeunes={allJeunes}
              initialParticipants={initialParticipants}
            />

            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-start gap-4">
              <span className="text-2xl shrink-0">🔒</span>
              <div className="flex-1">
                <p className="font-bold text-amber-800 text-sm mb-1">
                  Cette sortie a été créée par <strong>{sortie.animateurNom}</strong>
                </p>
                <p className="text-amber-700 text-xs mb-3">
                  Seul l'animateur référent ou un administrateur peut modifier cette fiche.
                </p>
                <DemandeModifSortieButton
                  sortieId={params.id}
                  sortieCreateur={sortie.animateurNom}
                />
              </div>
            </div>

            {HistoriqueBlock}
          </div>
        )}
      </div>
    </div>
  );
}
