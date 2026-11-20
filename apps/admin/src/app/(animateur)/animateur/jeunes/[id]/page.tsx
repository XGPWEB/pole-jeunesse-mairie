export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { getTenantId } from '@/lib/auth';
import Link from 'next/link';
import { query, queryOne } from '@/lib/db';
import { colonnesSanteSql } from '@/lib/jeune-sante';
import SanteJeuneCard from '@/app/jeunes/SanteJeuneCard';
import { getAge, formatDate, ESPACE_LABELS } from '@/lib/data';
import EspaceBadge from '@/components/EspaceBadge';
import DeleteJeuneButton from './DeleteJeuneButton';
import { todayLocal } from '@/lib/dates';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUT_COLORS: Record<string, string> = {
  confirmee:    'bg-green-50 text-green-700 border-green-200',
  'en-attente': 'bg-amber-50 text-amber-700 border-amber-200',
  annulee:      'bg-red-50 text-red-600 border-red-200',
  refusee:      'bg-gray-100 text-gray-500 border-gray-200',
};
const STATUT_LABELS: Record<string, string> = {
  confirmee: 'Confirmée', 'en-attente': 'En attente', annulee: 'Annulée', refusee: 'Refusée',
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function FicheJeuneAnimateurPage({ params: props_params }: { params: Promise<{ id: string }> }) {
  const params = await props_params;
  const tenant_id = await getTenantId();
  const [jeuneRow, contacts, inscriptionsRaw, jeunePointages, activites] = await Promise.all([
    queryOne<any>(`
      SELECT id, nom, prenom, date_naissance::text AS "dateNaissance", sexe, secteur,
             espace_id AS "espaceId", etablissement, classe, observations, adresse,
             autorisation_sortie AS "autorisationSortie",
             autorisation_photo AS "autorisationPhoto",
             autorisation_soins_benins AS "autorisationSoinsBenins",
             (fiche_agora IS NOT NULL) AS "hasFicheAgora",
             fiche_agora_nom AS "ficheAgoraNom",
             (fiche_sante IS NOT NULL) AS "hasFicheSante",
             fiche_sante_nom AS "ficheSanteNom",
             ${colonnesSanteSql()}
      FROM jeunes WHERE id = $1 AND tenant_id = $2
    `, [params.id, tenant_id]),
    query<any>(`
      SELECT jc.nom, jc.lien, jc.email, jc.telephone
      FROM jeunes_contacts jc
      JOIN jeunes j ON j.id = jc.jeune_id
      WHERE jc.jeune_id = $1 AND j.tenant_id = $2
      ORDER BY jc.id
    `, [params.id, tenant_id]),
    query<any>(`
      SELECT i.id, i.jeune_id AS "jeuneId", i.activite_id AS "activiteId",
             i.activite_titre AS "activiteTitre", i.statut, i.date_inscription::text AS "dateInscription", i.note,
             a.titre AS "activiteTitreJoin", a.date::text AS "activiteDate",
             a.heure_debut AS "heureDebut", a.heure_fin AS "heureFin", a.lieu AS "activiteLieu"
      FROM inscriptions i
      LEFT JOIN activites a ON a.id = i.activite_id
      WHERE i.jeune_id = $1 AND i.tenant_id = $2
      ORDER BY a.date ASC NULLS LAST
    `, [params.id, tenant_id]),
    query<any>(`
      SELECT id, jeune_id AS "jeuneId", espace_id AS "espaceId", date::text AS date,
             heure_arrivee AS "heureArrivee", type, activite_id AS "activiteId", manuel
      FROM pointages WHERE jeune_id = $1 AND tenant_id = $2 ORDER BY date DESC
    `, [params.id, tenant_id]),
    query<any>(`SELECT id, titre, date::text AS date, heure_debut AS "heureDebut", heure_fin AS "heureFin", lieu FROM activites WHERE tenant_id = $1`, [tenant_id]),
  ]);

  if (!jeuneRow) notFound();
  const jeune = { ...jeuneRow, contacts };

  const age = getAge(jeune.dateNaissance);
  const espaceLabel = ESPACE_LABELS[jeune.espaceId] ?? jeune.espaceId;
  const activitesMap = new Map(activites.map((a: any) => [a.id, a]));

  const jeuneInscriptions = inscriptionsRaw.map((i: any) => ({
    ...i,
    activite: i.activiteDate ? {
      titre: i.activiteTitreJoin ?? i.activiteTitre,
      date: i.activiteDate,
      heureDebut: i.heureDebut,
      heureFin: i.heureFin,
      lieu: i.activiteLieu,
    } : null,
  }));

  const today = todayLocal();
  const inscriptionsAVenir  = jeuneInscriptions.filter((i: any) => (i.activite?.date ?? '') >= today);
  const inscriptionsPassees = jeuneInscriptions.filter((i: any) => (i.activite?.date ?? '') < today);

  const totalPointages    = jeunePointages.length;
  const pointagesLibre    = jeunePointages.filter((p: any) => p.type === 'accueil-libre').length;
  const pointagesActivite = jeunePointages.filter((p: any) => p.type === 'activite').length;

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Header ── */}
      <div className="bg-white border-b border-gray-100 px-8 py-5">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/animateur/jeunes" className="text-gray-400 hover:text-[#1B3870] text-sm font-medium transition-colors">
            ← Fiches Jeunes
          </Link>
        </div>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-2xl bg-[#1B3870]/10 flex items-center justify-center text-2xl font-extrabold text-[#1B3870]">
              {jeune.prenom[0]}{jeune.nom[0]}
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-gray-900">
                {jeune.prenom} <span className="uppercase">{jeune.nom}</span>
              </h1>
              <div className="flex items-center gap-3 mt-1">
                <EspaceBadge espaceId={jeune.espaceId} />
                <span className="text-sm text-gray-500">{age} ans</span>
                <span className="text-sm text-gray-400">•</span>
                <span className="text-sm text-gray-500">
                  Né(e) le {new Date(jeune.dateNaissance).toLocaleDateString('fr-FR')}{jeune.lieuNaissance ? ` à ${jeune.lieuNaissance}` : ''}
                </span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {jeune.hasFicheAgora && (
              <a href={`/api/jeunes/fiche-agora?id=${params.id}`} target="_blank" rel="noopener noreferrer"
                className="border border-gray-200 text-gray-600 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-50">
                📄 Imprimer la fiche AGORA
              </a>
            )}
            {jeune.hasFicheSante && (
              <a href={`/api/jeunes/fiche-agora?id=${params.id}&piece=sante`} target="_blank" rel="noopener noreferrer"
                className="border border-gray-200 text-gray-600 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-50">
                🩺 Imprimer la fiche santé
              </a>
            )}
            <Link
              href={`/animateur/jeunes/${params.id}/modifier`}
              className="border border-[#1B3870] text-[#1B3870] px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#1B3870]/5 transition-colors"
            >
              ✏️ Modifier
            </Link>
            <DeleteJeuneButton jeuneId={params.id} jeuneNom={`${jeune.prenom} ${jeune.nom}`} />
          </div>
        </div>

        {/* KPIs présences */}
        <div className="flex gap-6 mt-5 pt-4 border-t border-gray-100">
          <div className="text-center">
            <div className="text-xl font-extrabold text-[#1B3870]">{totalPointages}</div>
            <div className="text-xs text-gray-400 mt-0.5">Présences totales</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-extrabold text-blue-600">{pointagesActivite}</div>
            <div className="text-xs text-gray-400 mt-0.5">Via activités</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-extrabold text-gray-600">{pointagesLibre}</div>
            <div className="text-xs text-gray-400 mt-0.5">Accueil libre</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-extrabold text-green-600">{jeuneInscriptions.length}</div>
            <div className="text-xs text-gray-400 mt-0.5">Inscriptions</div>
          </div>
        </div>
      </div>

      <div className="p-8 grid grid-cols-3 gap-6">

        {/* ── Colonne gauche — Infos personnelles ── */}
        <div className="space-y-5">

          {/* Identité */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-xs font-extrabold text-gray-400 uppercase tracking-widest mb-4">Identité</h2>
            <dl className="space-y-3">
              <div>
                <dt className="text-xs text-gray-400 mb-0.5">Espace</dt>
                <dd><EspaceBadge espaceId={jeune.espaceId} /></dd>
              </div>
              {jeune.classe && (
                <div>
                  <dt className="text-xs text-gray-400 mb-0.5">Classe</dt>
                  <dd className="text-sm font-medium text-gray-700">{jeune.classe}</dd>
                </div>
              )}
              {jeune.etablissement && (
                <div>
                  <dt className="text-xs text-gray-400 mb-0.5">Établissement</dt>
                  <dd className="text-sm text-gray-700">{jeune.etablissement}</dd>
                </div>
              )}
              {jeune.adresse && (
                <div>
                  <dt className="text-xs text-gray-400 mb-0.5">Adresse</dt>
                  <dd className="text-sm text-gray-700">{jeune.adresse}</dd>
                </div>
              )}
              {jeune.secteur && (
                <div>
                  <dt className="text-xs text-gray-400 mb-0.5">Quartier</dt>
                  <dd className="text-sm text-gray-700">{jeune.secteur}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Contacts famille */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-xs font-extrabold text-gray-400 uppercase tracking-widest mb-4">
              Contact{contacts?.length > 1 ? 's' : ''} famille
            </h2>
            <div className="space-y-4">
              {(contacts ?? []).map((c: any, i: number) => (
                <div key={i} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-500 shrink-0">
                    {c.nom?.[0] ?? '?'}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-gray-800">{c.nom}</div>
                    <div className="text-xs text-gray-400">{c.lien}</div>
                    <div className="text-xs text-gray-500 mt-1">{c.telephone}</div>
                    {c.email && <div className="text-xs text-[#1B3870]">{c.email}</div>}
                  </div>
                </div>
              ))}
              {(!contacts || contacts.length === 0) && (
                <p className="text-sm text-gray-400">Aucun contact renseigné.</p>
              )}
            </div>
          </div>

          {/* Autorisations */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-xs font-extrabold text-gray-400 uppercase tracking-widest mb-4">Autorisations</h2>
            <div className="space-y-2.5">
              {[
                { key: 'autorisationSortie',      label: 'Sorties',         icon: '🚶' },
                { key: 'autorisationPhoto',        label: 'Photos / vidéos', icon: '📷' },
                { key: 'autorisationSoinsBenins',  label: 'Soins bénins',    icon: '🩹' },
              ].map(({ key, label, icon }) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{icon} {label}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                    (jeune as any)[key]
                      ? 'bg-green-50 text-green-700 border-green-200'
                      : 'bg-red-50 text-red-600 border-red-200'
                  }`}>
                    {(jeune as any)[key] ? 'Oui' : 'Non'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Santé */}
          <SanteJeuneCard jeune={jeune} />

          {/* Observations */}
          {jeune.observations && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
              <h2 className="text-xs font-extrabold text-amber-600 uppercase tracking-widest mb-3">📝 Observations</h2>
              <p className="text-sm text-amber-800 leading-relaxed">{jeune.observations}</p>
            </div>
          )}
        </div>

        {/* ── Colonne centrale + droite — Activités & Présences ── */}
        <div className="col-span-2 space-y-5">

          {/* Activités à venir */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-extrabold text-gray-400 uppercase tracking-widest">
                📅 Activités à venir
              </h2>
              <span className="text-xs font-bold text-[#1B3870] bg-[#1B3870]/5 border border-[#1B3870]/20 px-2 py-0.5 rounded-full">
                {inscriptionsAVenir.length}
              </span>
            </div>
            {inscriptionsAVenir.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">
                Aucune activité à venir
              </div>
            ) : (
              <div className="space-y-3">
                {inscriptionsAVenir.map((i: any) => (
                  <div key={i.id} className="flex items-center gap-4 p-3 rounded-lg bg-gray-50 border border-gray-100">
                    <div className="w-10 h-10 rounded-lg bg-[#1B3870]/10 flex items-center justify-center text-lg shrink-0">
                      📋
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-800 text-sm truncate">
                        {i.activite?.titre ?? i.activiteTitre}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {i.activite ? (
                          <>
                            {new Date(i.activite.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                            {' · '}{i.activite.heureDebut}–{i.activite.heureFin}
                            {i.activite.lieu && <> · {i.activite.lieu}</>}
                          </>
                        ) : formatDate(i.dateInscription)}
                      </div>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border shrink-0 ${STATUT_COLORS[i.statut] ?? ''}`}>
                      {STATUT_LABELS[i.statut] ?? i.statut}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Activités passées */}
          {inscriptionsPassees.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-extrabold text-gray-400 uppercase tracking-widest">
                  🗂 Activités passées
                </h2>
                <span className="text-xs font-bold text-gray-500 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-full">
                  {inscriptionsPassees.length}
                </span>
              </div>
              <div className="space-y-2">
                {inscriptionsPassees.map((i: any) => (
                  <div key={i.id} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                    <span className="text-xs text-gray-400 w-24 shrink-0">
                      {i.activite ? new Date(i.activite.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '—'}
                    </span>
                    <span className="flex-1 text-sm text-gray-700 truncate">
                      {i.activite?.titre ?? i.activiteTitre}
                    </span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border shrink-0 ${STATUT_COLORS[i.statut] ?? ''}`}>
                      {STATUT_LABELS[i.statut] ?? i.statut}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Journal de présences (pointages) */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-extrabold text-gray-400 uppercase tracking-widest">
                🗓 Journal de présences
              </h2>
              <div className="flex gap-2">
                <span className="text-xs text-gray-500">
                  <span className="font-bold text-[#1B3870]">{totalPointages}</span> passages enregistrés
                </span>
              </div>
            </div>

            {jeunePointages.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm">
                Aucune présence enregistrée
              </div>
            ) : (
              <div className="space-y-2">
                {jeunePointages.map((p: any) => {
                  const act = p.activiteId ? activitesMap.get(p.activiteId) : null;
                  return (
                    <div
                      key={p.id}
                      className="flex items-center gap-4 py-2.5 border-b border-gray-50 last:border-0"
                    >
                      {/* Date */}
                      <div className="w-24 shrink-0">
                        <div className="text-xs font-semibold text-gray-700">
                          {new Date(p.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                        </div>
                        <div className="text-[10px] text-gray-400">
                          {new Date(p.date).toLocaleDateString('fr-FR', { weekday: 'long' })}
                        </div>
                      </div>

                      {/* Type badge */}
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border shrink-0 ${
                        p.type === 'activite'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-gray-100 text-gray-600 border-gray-200'
                      }`}>
                        {p.type === 'activite' ? '📋 Activité' : '🚪 Accueil libre'}
                      </span>

                      {/* Activité liée */}
                      <div className="flex-1 min-w-0">
                        {act ? (
                          <span className="text-sm text-gray-700 truncate block">{(act as any).titre}</span>
                        ) : (
                          <span className="text-sm text-gray-400 italic">Passage libre</span>
                        )}
                      </div>

                      {/* Heure */}
                      {p.heureArrivee && (
                        <span className="text-xs text-gray-400 shrink-0">
                          Arrivée {p.heureArrivee}
                        </span>
                      )}

                      {/* Manuel */}
                      {p.manuel && (
                        <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full shrink-0">
                          Manuel
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
