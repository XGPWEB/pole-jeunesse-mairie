import { getTenantId } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import EspaceBadge from '@/components/EspaceBadge';
import ParticipantsManager from '@/components/ParticipantsManager';
import DeleteActiviteButton from './DeleteActiviteButton';

export const dynamic = 'force-dynamic';

const STATUT_STYLE: Record<string, string> = {
  ouvert:    'bg-green-50 text-green-700 border-green-200',
  complet:   'bg-red-50 text-red-700 border-red-200',
  annule:    'bg-gray-100 text-gray-500 border-gray-200',
  brouillon: 'bg-amber-50 text-amber-700 border-amber-200',
};

export default async function ActiviteAnimateurPage({ params: props_params }: { params: Promise<{ id: string }> }) {
  const params = await props_params;
  const tenant_id = await getTenantId();
  const [activite, activeInscrits, pointes, allJeunes] = await Promise.all([
    queryOne<any>(`
      SELECT id, titre, description, espace_id AS "espaceId", date::text AS date,
             heure_debut AS "heureDebut", heure_fin AS "heureFin", lieu, animateur,
             places_total AS "placesTotal", statut, tags
      FROM activites WHERE id = $1 AND tenant_id = $2
    `, [params.id, tenant_id]),
    query<any>(`
      SELECT id, jeune_id AS "jeuneId", jeune_nom AS "jeuneNom", jeune_prenom AS "jeunePrenom",
             espace_id AS "espaceId", statut
      FROM inscriptions WHERE activite_id = $1 AND tenant_id = $2 AND statut NOT IN ('annulee','refusee')
    `, [params.id, tenant_id]),
    query<any>(`
      SELECT id, jeune_id AS "jeuneId", heure_arrivee AS "heureArrivee"
      FROM pointages WHERE activite_id = $1 AND tenant_id = $2
        -- Exclut les absents : sans ce filtre, un jeune marque absent etait
        -- compte et affiche comme present sur la fiche activite.
        AND (statut IS NULL OR statut NOT IN ('absent','excuse'))
    `, [params.id, tenant_id]),
    query<any>(`SELECT id, nom, prenom, espace_id AS "espaceId" FROM jeunes WHERE tenant_id = $1 ORDER BY nom`, [tenant_id]),
  ]);

  if (!activite) notFound();

  const confirmes = activeInscrits.filter((i: any) => i.statut === 'confirmee').length;
  const attenteCount = activeInscrits.filter((i: any) => i.statut === 'en-attente' || i.statut === 'liste-attente').length;
  const tauxRemplissage = activite.placesTotal > 0
    ? Math.round((confirmes / activite.placesTotal) * 100)
    : 0;
  const isPassed = new Date(activite.date) < new Date();

  const initialParticipants = activeInscrits.map((i: any) => ({
    jeuneId: i.jeuneId,
    jeuneNom: i.jeuneNom,
    jeunePrenom: i.jeunePrenom,
    espaceId: i.espaceId,
    statut: i.statut,
    inscriptionId: i.id,
  }));

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-8 py-5">
        <div className="flex items-center gap-2 mb-4 text-sm">
          <Link href="/animateur/activites" className="text-gray-400 hover:text-[#1B3870] font-medium transition-colors">
            &larr; Activités
          </Link>
        </div>
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-start gap-5">
            <div className="w-14 h-14 rounded-xl bg-[#1B3870]/10 flex items-center justify-center text-2xl shrink-0">
              📋
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-extrabold text-gray-900">{activite.titre}</h1>
                <span className={`text-xs font-bold px-3 py-1 rounded-full border ${STATUT_STYLE[activite.statut] ?? 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                  {activite.statut.charAt(0).toUpperCase() + activite.statut.slice(1)}
                </span>
                {isPassed && (
                  <span className="text-xs font-bold px-3 py-1 rounded-full bg-gray-100 text-gray-400 border border-gray-200">
                    Passée
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <EspaceBadge espaceId={activite.espaceId} />
                <span className="text-sm text-gray-500">
                  {new Date(activite.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
                <span className="text-sm text-gray-400">&bull;</span>
                <span className="text-sm text-gray-500">{activite.heureDebut} – {activite.heureFin}</span>
                {activite.lieu && (
                  <>
                    <span className="text-sm text-gray-400">&bull;</span>
                    <span className="text-sm text-gray-500">📍 {activite.lieu}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Link
              href={`/animateur/activites/${params.id}/modifier`}
              className="border border-[#1B3870] text-[#1B3870] px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-50 transition-colors"
            >
              Modifier
            </Link>
            <DeleteActiviteButton activiteId={params.id} />
          </div>
        </div>

        {/* KPIs */}
        <div className="flex gap-8 mt-5 pt-4 border-t border-gray-100">
          <div>
            <div className="text-xl font-extrabold text-[#1B3870]">{confirmes}</div>
            <div className="text-xs text-gray-400 mt-0.5">Confirmés</div>
          </div>
          <div>
            <div className="text-xl font-extrabold text-amber-500">{attenteCount}</div>
            <div className="text-xs text-gray-400 mt-0.5">En attente</div>
          </div>
          <div>
            <div className="text-xl font-extrabold text-gray-600">{Math.max(0, activite.placesTotal - confirmes)}</div>
            <div className="text-xs text-gray-400 mt-0.5">Places restantes</div>
          </div>
          <div>
            <div className="text-xl font-extrabold text-green-600">{pointes.length}</div>
            <div className="text-xs text-gray-400 mt-0.5">Présences</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-24 h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${tauxRemplissage >= 100 ? 'bg-red-500' : tauxRemplissage >= 75 ? 'bg-amber-400' : 'bg-[#1B3870]'}`}
                style={{ width: `${Math.min(tauxRemplissage, 100)}%` }}
              />
            </div>
            <span className="text-sm font-bold text-gray-600">{tauxRemplissage}%</span>
          </div>
        </div>
      </div>

      <div className="p-8 grid grid-cols-3 gap-6">

        {/* Colonne gauche */}
        <div className="space-y-5">
          {activite.description && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h2 className="text-xs font-extrabold text-gray-400 uppercase tracking-widest mb-3">Description</h2>
              <p className="text-sm text-gray-700 leading-relaxed">{activite.description}</p>
            </div>
          )}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-xs font-extrabold text-gray-400 uppercase tracking-widest mb-4">Détails</h2>
            <dl className="space-y-3">
              <div>
                <dt className="text-xs text-gray-400 mb-0.5">Animateur référent</dt>
                <dd className="text-sm font-semibold text-gray-700">{activite.animateur || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400 mb-0.5">Lieu</dt>
                <dd className="text-sm text-gray-700">{activite.lieu || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-400 mb-0.5">Capacité</dt>
                <dd className="text-sm text-gray-700">{activite.placesTotal} places</dd>
              </div>
            </dl>
          </div>
          {activite.tags?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h2 className="text-xs font-extrabold text-gray-400 uppercase tracking-widest mb-3">Tags</h2>
              <div className="flex flex-wrap gap-2">
                {activite.tags.map((t: string) => (
                  <span key={t} className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#1B3870]/10 text-[#1B3870] border border-[#1B3870]/20">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          <Link
            href={`/animateur/activites/${params.id}/pointage`}
            className="flex items-center justify-center gap-2 w-full py-3 bg-[#1B3870] text-white font-bold rounded-xl hover:bg-[#162d5e] transition-colors"
          >
            Faire le pointage — {confirmes} inscrits
          </Link>
        </div>

        {/* Colonne droite */}
        <div className="col-span-2 space-y-5">
          <ParticipantsManager
            mode="activite"
            entityId={activite.id}
            entityTitre={activite.titre}
            espaceId={activite.espaceId}
            placesTotal={activite.placesTotal ?? 0}
            jeunes={allJeunes}
            initialParticipants={initialParticipants}
          />

          {/* Présences pointées */}
          {pointes.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-extrabold text-gray-400 uppercase tracking-widest">
                  ✅ Présences pointées
                </h2>
                <span className="text-xs font-bold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                  {pointes.length} présent{pointes.length > 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {pointes.map((p: any) => {
                  const jeune = allJeunes.find((j: any) => j.id === p.jeuneId);
                  return (
                    <div key={p.id} className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                      <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-white text-xs font-bold">
                        {(jeune?.prenom?.[0] ?? '?').toUpperCase()}
                      </div>
                      <div className="text-xs font-semibold text-gray-800">
                        {jeune ? `${jeune.prenom} ${jeune.nom.toUpperCase()}` : p.jeuneId}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
