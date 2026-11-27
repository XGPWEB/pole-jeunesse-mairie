'use client';

import { useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

type TexteLegal = { ref: string; desc: string };
type AutoriteSurveillance = { nom: string; site: string; telephone: string; adresse: string };
type CadreJuridique = { textes: TexteLegal[]; ageMajoriteNumerique: number; autoriteSurveillance: AutoriteSurveillance };

type Traitement = {
  id: string; nom: string; finalite: string;
  baseJuridique: string; referenceRgpd: string; referenceLoi: string;
  categoriesDonnees: string[]; donnesSensibles: boolean; concerMineurs: boolean;
  destinataires: string[]; sousTraitants: string[]; transfertHorsUE: boolean;
  dureeConservationActive: string; dureeArchiveIntermediaire: string; dureeArchiveDefinitive: string;
  referentielCNIL: string; mesuresSecurite: string;
  aipdRequise: boolean; aipdStatut: string;
  responsable: string; miseAJour: string;
};

type AIPD = {
  id: string; traitementId: string; nom: string; statut: string;
  dateRealisation: string; dateRevision: string;
  risquesIdentifies: string[]; mesuresRetenues: string[];
  avisConsultatifCNIL: boolean; responsableAIPD: string;
};

type ViolationDonnees = {
  id: string; date: string; description: string; personnesConcernees: number;
  gravite: string; notificationCNIL: boolean; raisonNonNotification: string;
  mesuresPrises: string; statut: string;
};

type DemandeDroit = {
  id: string; type: string; nomDemandeur: string; email: string;
  concerneJeune: string; ageJeune: number;
  dateDemande: string; statut: string; delaiLegal: string; delaiProlonge: boolean; notes: string;
};

type Consentement = {
  jeuneId: string; nom: string; age: number;
  consentementParental: boolean; representantLegal: string | null;
  notifications: boolean; communication: boolean; photos: boolean;
  dateConsentement: string;
};

type DPO = {
  nom: string; email: string; telephone: string; adresse: string;
  dateDesignation: string; declareCNIL: boolean; numeroCNIL: string;
  obligatoire: boolean; fondementObligation: string;
};

type RgpdData = {
  cadreJuridique: CadreJuridique;
  registreTraitements: Traitement[];
  aipd: AIPD[];
  violationsDonnees: ViolationDonnees[];
  demandesDroits: DemandeDroit[];
  consentements: Consentement[];
  dpo: DPO;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysUntil(dateStr: string): number {
  const now = new Date();
  const target = new Date(dateStr);
  return Math.floor((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ─── Badges ───────────────────────────────────────────────────────────────────

function BaseJuridiqueBadge({ value, reference }: { value: string; reference: string }) {
  const colors: Record<string, string> = {
    'Mission de service public': 'bg-purple-100 text-purple-700 border-purple-200',
    'Obligation légale': 'bg-red-100 text-red-700 border-red-200',
    'Consentement': 'bg-green-100 text-green-700 border-green-200',
    'Exécution du contrat': 'bg-blue-100 text-blue-700 border-blue-200',
  };
  const cls = colors[value] ?? 'bg-gray-100 text-gray-600 border-gray-200';
  return (
    <div className="space-y-0.5">
      <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full border ${cls}`}>{value}</span>
      <div className="text-[10px] text-gray-400 font-mono pl-0.5">{reference}</div>
    </div>
  );
}

function TypeDemandeBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; article: string; cls: string }> = {
    acces:         { label: 'Accès',        article: 'Art. 15', cls: 'bg-blue-100 text-blue-700' },
    rectification: { label: 'Rectification',article: 'Art. 16', cls: 'bg-yellow-100 text-yellow-700' },
    suppression:   { label: 'Effacement',   article: 'Art. 17', cls: 'bg-red-100 text-red-700' },
    portabilite:   { label: 'Portabilité',  article: 'Art. 20', cls: 'bg-purple-100 text-purple-700' },
    opposition:    { label: 'Opposition',   article: 'Art. 21', cls: 'bg-orange-100 text-orange-700' },
  };
  const { label, article, cls } = map[type] ?? { label: type, article: '', cls: 'bg-gray-100 text-gray-600' };
  return (
    <div>
      <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${cls}`}>{label}</span>
      {article && <div className="text-[10px] text-gray-400 font-mono mt-0.5 pl-0.5">{article} RGPD</div>}
    </div>
  );
}

function StatutBadge({ statut }: { statut: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    'en-attente': { label: 'En attente', cls: 'bg-orange-100 text-orange-700' },
    'en-cours':   { label: 'En cours',   cls: 'bg-blue-100 text-blue-700' },
    'traite':     { label: 'Traité ✓',   cls: 'bg-green-100 text-green-700' },
  };
  const { label, cls } = map[statut] ?? { label: statut, cls: 'bg-gray-100 text-gray-600' };
  return <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${cls}`}>{label}</span>;
}

function AipdBadge({ statut }: { statut: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    'réalisée':    { label: '✓ AIPD réalisée',   cls: 'bg-green-100 text-green-700' },
    'non requise': { label: '— Non requise',       cls: 'bg-gray-100 text-gray-500' },
    'en-cours':    { label: '⏳ En cours',          cls: 'bg-yellow-100 text-yellow-700' },
    'requise':     { label: '⚠ AIPD requise',     cls: 'bg-red-100 text-red-700' },
  };
  const { label, cls } = map[statut] ?? { label: statut, cls: 'bg-gray-100 text-gray-600' };
  return <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

function ConsentDot({ value }: { value: boolean }) {
  return (
    <span className={`inline-block w-3 h-3 rounded-full ${value ? 'bg-green-500' : 'bg-red-400'}`}
      title={value ? 'Accordé' : 'Refusé'} />
  );
}

function GraviteBadge({ gravite }: { gravite: string }) {
  const map: Record<string, string> = {
    faible:  'bg-green-100 text-green-700',
    moyen:   'bg-yellow-100 text-yellow-700',
    eleve:   'bg-red-100 text-red-700',
    critique:'bg-red-200 text-red-900',
  };
  return <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${map[gravite] ?? 'bg-gray-100 text-gray-600'}`}>{gravite}</span>;
}

// ─── Tab: Vue d'ensemble ──────────────────────────────────────────────────────

function TabOverview({ data }: { data: RgpdData }) {
  const demandesEnCours = data.demandesDroits.filter(d => d.statut !== 'traite');
  const alertes = data.demandesDroits.filter(d => d.statut !== 'traite' && daysUntil(d.delaiLegal) <= 30);
  const mineurs = data.consentements.filter(c => c.age < data.cadreJuridique.ageMajoriteNumerique);
  const sansConsentParental = mineurs.filter(c => !c.consentementParental);

  const kpis = [
    { label: 'Traitements enregistrés', value: data.registreTraitements.length, icon: '📋', color: 'bg-purple-50 text-[#6B1A6E]', sub: 'Art. 30 RGPD' },
    { label: 'AIPD réalisées', value: data.aipd.length, icon: '🔍', color: 'bg-blue-50 text-blue-700', sub: 'Art. 35 RGPD' },
    { label: 'Demandes en cours', value: demandesEnCours.length, icon: '📬', color: 'bg-amber-50 text-amber-700', sub: 'Délai 1 mois — Art. 12' },
    { label: 'Violations recensées', value: data.violationsDonnees.length, icon: '🚨', color: 'bg-red-50 text-red-700', sub: 'Art. 33 RGPD — 72h CNIL' },
  ];

  return (
    <div className="space-y-6">
      {/* Bandeau cadre légal */}
      <div className="bg-[#6B1A6E]/5 border border-[#6B1A6E]/20 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[#6B1A6E] font-bold text-sm">⚖️ Cadre juridique applicable</span>
          <span className="text-xs text-gray-400">— Collectivité territoriale française</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.cadreJuridique.textes.map(t => (
            <div key={t.ref} className="bg-white border border-[#6B1A6E]/20 rounded-lg px-3 py-1.5">
              <div className="text-xs font-bold text-[#6B1A6E]">{t.ref}</div>
              <div className="text-[10px] text-gray-500">{t.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Alerte mineurs < 15 ans */}
      {sansConsentParental.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <span className="text-red-500 text-xl shrink-0">⚠️</span>
          <div>
            <div className="font-bold text-red-800 text-sm">Consentement parental manquant</div>
            <div className="text-xs text-red-700 mt-0.5">
              {sansConsentParental.length} jeune(s) de moins de {data.cadreJuridique.ageMajoriteNumerique} ans sans consentement parental formalisé.
              En France, l'âge du consentement numérique est <strong>{data.cadreJuridique.ageMajoriteNumerique} ans</strong> (art. 45 Loi I&L).
              Le représentant légal doit consentir pour les mineurs en dessous de cet âge.
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {sansConsentParental.map(c => (
                <span key={c.jeuneId} className="text-xs bg-red-100 text-red-700 font-semibold px-2 py-0.5 rounded-full">
                  {c.nom} ({c.age} ans)
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-5">
        {kpis.map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl ${k.color}`}>{k.icon}</div>
            <div>
              <div className="text-2xl font-extrabold text-gray-800">{k.value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{k.label}</div>
              <div className="text-[10px] text-gray-400 font-mono mt-0.5">{k.sub}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* DPO Card */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <span className="text-[#6B1A6E]">🔒</span> Délégué à la Protection des Données
            </h3>
            <span className="text-[10px] bg-[#6B1A6E]/10 text-[#6B1A6E] font-bold px-2 py-0.5 rounded-full">
              Obligatoire — Art. 37 RGPD
            </span>
          </div>
          <div className="px-5 py-4 space-y-2.5">
            {[
              { label: 'Organisme', value: data.dpo.nom },
              { label: 'Email DPO', value: data.dpo.email, link: true },
              { label: 'Téléphone', value: data.dpo.telephone },
              { label: 'Adresse', value: data.dpo.adresse },
              // Vides tant que la désignation du DPO n'a pas été vérifiée.
              { label: 'Désigné le', value: formatDate(data.dpo.dateDesignation) || 'À compléter' },
              { label: 'N° CNIL', value: data.dpo.numeroCNIL || 'À compléter' },
            ].map(row => (
              <div key={row.label} className="flex items-center gap-3">
                <span className="text-gray-400 text-xs w-24 shrink-0">{row.label}</span>
                {row.link
                  ? <a href={`mailto:${row.value}`} className="text-sm font-semibold text-[#6B1A6E] hover:underline">{row.value}</a>
                  : <span className="text-sm font-semibold text-gray-800">{row.value}</span>
                }
              </div>
            ))}
            <div className="mt-2 pt-2 border-t border-gray-100">
              <div className="text-[10px] text-gray-400">{data.dpo.fondementObligation}</div>
            </div>
          </div>
        </div>

        {/* CNIL + Alertes */}
        <div className="space-y-4">
          {/* CNIL */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2">
                <span>🏛</span> Autorité de contrôle
              </h3>
            </div>
            <div className="px-5 py-3 space-y-1.5">
              <div className="font-semibold text-sm text-gray-800">{data.cadreJuridique.autoriteSurveillance.nom}</div>
              <div className="text-xs text-gray-500">{data.cadreJuridique.autoriteSurveillance.adresse}</div>
              <div className="flex gap-3 mt-2">
                <a href={`tel:${data.cadreJuridique.autoriteSurveillance.telephone}`} className="text-xs text-[#6B1A6E] font-semibold hover:underline">
                  📞 {data.cadreJuridique.autoriteSurveillance.telephone}
                </a>
                <a href={data.cadreJuridique.autoriteSurveillance.site} target="_blank" rel="noreferrer" className="text-xs text-[#6B1A6E] font-semibold hover:underline">
                  🌐 cnil.fr →
                </a>
              </div>
              <div className="text-[10px] text-gray-400 pt-1">Droit de réclamation — Art. 77 RGPD</div>
            </div>
          </div>

          {/* Alertes délais */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden flex-1">
            <div className="px-5 py-3 border-b border-gray-100">
              <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2">
                <span className="text-amber-500">⚠️</span> Alertes délais légaux (1 mois — Art. 12)
              </h3>
            </div>
            <div className="px-5 py-3">
              {alertes.length === 0 ? (
                <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
                  <span className="w-2 h-2 rounded-full bg-green-500" /> Toutes les demandes sont dans les délais
                </div>
              ) : (
                <div className="space-y-2">
                  {alertes.map(a => {
                    const jours = daysUntil(a.delaiLegal);
                    return (
                      <div key={a.id} className="flex items-start gap-3 p-2.5 rounded-lg bg-red-50 border border-red-100">
                        <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 mt-1.5" />
                        <div>
                          <div className="text-sm font-semibold text-red-800">{a.nomDemandeur} — <TypeDemandeBadge type={a.type} /></div>
                          <div className="text-xs text-red-600 mt-0.5">
                            {jours <= 0 ? '🚨 Délai dépassé !' : `${jours} jour(s) — échéance le ${formatDate(a.delaiLegal)}`}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Répartition bases juridiques */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800">Bases juridiques des traitements</h3>
          <span className="text-xs text-gray-400">Conformité Art. 5.1 & Art. 6 RGPD</span>
        </div>
        <div className="px-5 py-4 flex flex-wrap gap-4">
          {data.registreTraitements.map(t => (
            <div key={t.id} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50 border border-gray-100 min-w-0">
              <div className="flex flex-col gap-1">
                <div className="text-sm font-semibold text-gray-800">{t.nom}</div>
                <BaseJuridiqueBadge value={t.baseJuridique} reference={t.referenceRgpd} />
                <div className="flex gap-1.5 mt-0.5">
                  {t.concerMineurs && <span className="text-[10px] bg-purple-50 text-purple-600 font-semibold px-1.5 py-0.5 rounded">Mineurs</span>}
                  {t.donnesSensibles && <span className="text-[10px] bg-red-50 text-red-600 font-semibold px-1.5 py-0.5 rounded">Données sensibles</span>}
                  {t.transfertHorsUE ? <span className="text-[10px] bg-orange-50 text-orange-600 font-semibold px-1.5 py-0.5 rounded">Transfert hors UE</span> : <span className="text-[10px] bg-green-50 text-green-600 font-semibold px-1.5 py-0.5 rounded">✓ UE uniquement</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Registre des traitements ────────────────────────────────────────────

function TabRegistre({ traitements }: { traitements: Traitement[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h3 className="font-bold text-gray-800">Registre des activités de traitement</h3>
          <div className="text-xs text-gray-400 mt-0.5">Art. 30 RGPD — Obligatoire pour toute autorité publique · {traitements.length} traitement(s)</div>
        </div>
        <button className="text-xs font-semibold text-[#6B1A6E] border border-[#6B1A6E]/30 px-3 py-1.5 rounded-lg hover:bg-purple-50">
          ↓ Exporter PDF
        </button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100">
            {['Traitement', 'Base juridique', 'Conservation', 'AIPD', 'Mineurs', 'Mis à jour', ''].map(h => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {traitements.map(t => (
            <>
              <tr key={t.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setExpanded(expanded === t.id ? null : t.id)}>
                <td className="px-4 py-4">
                  <div className="font-semibold text-gray-800">{t.nom}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{t.responsable}</div>
                  {t.donnesSensibles && <span className="text-[10px] bg-red-50 text-red-500 font-bold px-1.5 py-0.5 rounded mt-1 inline-block">⚠ Données sensibles</span>}
                </td>
                <td className="px-4 py-4">
                  <BaseJuridiqueBadge value={t.baseJuridique} reference={t.referenceRgpd} />
                </td>
                <td className="px-4 py-4 text-xs text-gray-600 max-w-[140px]">
                  <div className="font-medium">{t.dureeConservationActive}</div>
                  <div className="text-gray-400 mt-0.5">{t.dureeArchiveDefinitive}</div>
                </td>
                <td className="px-4 py-4"><AipdBadge statut={t.aipdStatut} /></td>
                <td className="px-4 py-4">
                  {t.concerMineurs
                    ? <span className="text-xs font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">Oui</span>
                    : <span className="text-xs text-gray-400">Non</span>
                  }
                </td>
                <td className="px-4 py-4 text-xs text-gray-500">{formatDate(t.miseAJour)}</td>
                <td className="px-4 py-4 text-right text-gray-400 text-xs">{expanded === t.id ? '▲' : '▼'}</td>
              </tr>
              {expanded === t.id && (
                <tr key={t.id + '-detail'} className="bg-purple-50/30">
                  <td colSpan={7} className="px-5 py-5">
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div>
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Finalité</div>
                          <p className="text-sm text-gray-700">{t.finalite}</p>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Catégories de données</div>
                          <div className="flex flex-wrap gap-1.5">
                            {t.categoriesDonnees.map(c => (
                              <span key={c} className="text-xs px-2 py-0.5 rounded-full bg-[#6B1A6E]/10 text-[#6B1A6E] font-medium">{c}</span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Destinataires</div>
                          <div className="flex flex-wrap gap-1.5">
                            {t.destinataires.map(d => (
                              <span key={d} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">{d}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Durées de conservation</div>
                          <div className="space-y-1 text-xs text-gray-600">
                            <div className="flex gap-2"><span className="font-medium w-28 shrink-0">Active :</span><span>{t.dureeConservationActive}</span></div>
                            <div className="flex gap-2"><span className="font-medium w-28 shrink-0">Intermédiaire :</span><span>{t.dureeArchiveIntermediaire}</span></div>
                            <div className="flex gap-2"><span className="font-medium w-28 shrink-0">Définitive :</span><span>{t.dureeArchiveDefinitive}</span></div>
                          </div>
                          <div className="text-[10px] text-[#6B1A6E] font-semibold mt-2 font-mono">{t.referentielCNIL}</div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Mesures de sécurité (Art. 32 RGPD)</div>
                          <p className="text-sm text-gray-700">{t.mesuresSecurite}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">Transfert hors UE :</span>
                          {t.transfertHorsUE
                            ? <span className="text-xs font-bold text-orange-600">⚠ Oui — garanties requises</span>
                            : <span className="text-xs font-bold text-green-600">✓ Non — données en France/UE</span>
                          }
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Tab: Consentements ───────────────────────────────────────────────────────

function TabConsentements({ consentements, ageMajoriteNumerique }: { consentements: Consentement[]; ageMajoriteNumerique: number }) {
  const total = consentements.length;
  const mineurs = consentements.filter(c => c.age < ageMajoriteNumerique);
  const sansConsentParental = mineurs.filter(c => !c.consentementParental);

  return (
    <div className="space-y-5">
      {/* Alerte */}
      {sansConsentParental.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <span className="text-red-500 text-lg shrink-0">⚠️</span>
          <div>
            <div className="font-bold text-red-800 text-sm">{sansConsentParental.length} mineur(s) sans consentement parental</div>
            <div className="text-xs text-red-700 mt-0.5">
              En France, le consentement du représentant légal est obligatoire pour les jeunes de moins de <strong>{ageMajoriteNumerique} ans</strong> (art. 45 Loi Informatique et Libertés).
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Notifications', count: consentements.filter(c => c.notifications).length, icon: '🔔' },
          { label: 'Communication', count: consentements.filter(c => c.communication).length, icon: '📧' },
          { label: 'Photos & médias', count: consentements.filter(c => c.photos).length, icon: '📸' },
          { label: `Mineurs < ${ageMajoriteNumerique} ans`, count: mineurs.length, icon: '👶', alert: sansConsentParental.length > 0 },
        ].map(s => (
          <div key={s.label} className={`bg-white rounded-xl border shadow-sm p-4 flex items-center gap-3 ${(s as any).alert ? 'border-red-200 bg-red-50/30' : 'border-gray-100'}`}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${(s as any).alert ? 'bg-red-100' : 'bg-purple-50'}`}>{s.icon}</div>
            <div>
              <div className="text-xl font-extrabold text-gray-800">{s.count}<span className="text-sm font-normal text-gray-400">/{total}</span></div>
              <div className="text-xs text-gray-500">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800">Consentements individuels</h3>
          <span className="text-xs text-gray-400">Art. 6.1.a & Art. 7 RGPD — Art. 45 Loi I&L (mineurs)</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              {['Jeune', 'Âge', 'Représentant légal', 'Notif.', 'Comm.', 'Photos', 'Consentement parental', 'Date'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {consentements.map(c => {
              const estMineur = c.age < ageMajoriteNumerique;
              const alerteParental = estMineur && !c.consentementParental;
              return (
                <tr key={c.jeuneId} className={`hover:bg-gray-50 ${alerteParental ? 'bg-red-50/30' : ''}`}>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-sm font-bold text-[#6B1A6E]">{c.nom.charAt(0)}</div>
                      <span className="font-semibold text-gray-800">{c.nom}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`text-sm font-bold ${estMineur ? 'text-purple-600' : 'text-gray-600'}`}>{c.age} ans</span>
                    {estMineur && <div className="text-[10px] text-purple-400 font-medium">mineur</div>}
                  </td>
                  <td className="px-4 py-4 text-xs text-gray-600">
                    {c.representantLegal ?? <span className="text-gray-300 italic">—</span>}
                  </td>
                  <td className="px-4 py-4 text-center"><ConsentDot value={c.notifications} /></td>
                  <td className="px-4 py-4 text-center"><ConsentDot value={c.communication} /></td>
                  <td className="px-4 py-4 text-center"><ConsentDot value={c.photos} /></td>
                  <td className="px-4 py-4">
                    {!estMineur
                      ? <span className="text-xs text-gray-400 italic">Non requis (≥ {ageMajoriteNumerique} ans)</span>
                      : c.consentementParental
                        ? <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">✓ Obtenu</span>
                        : <span className="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">⚠ Manquant</span>
                    }
                  </td>
                  <td className="px-4 py-4 text-xs text-gray-500">{formatDate(c.dateConsentement)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tab: Demandes de droits ──────────────────────────────────────────────────

function TabDemandes({ demandes }: { demandes: DemandeDroit[] }) {
  return (
    <div className="space-y-5">
      {/* Info légale */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
        <span className="text-blue-500 text-lg shrink-0">ℹ️</span>
        <div className="text-sm text-blue-800">
          <strong>Délais légaux (Art. 12 RGPD) :</strong> Répondre dans un délai d'<strong>1 mois</strong> à compter de la réception. Prorogeable de <strong>2 mois</strong> supplémentaires en cas de demande complexe (avec information de la personne dans le délai d'1 mois). En cas de refus, informer le demandeur et l'informer de son droit de saisir la <strong>CNIL (Art. 77 RGPD)</strong>.
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800">Demandes d'exercice de droits ({demandes.length})</h3>
          <button className="text-xs font-semibold text-[#6B1A6E] border border-[#6B1A6E]/30 px-3 py-1.5 rounded-lg hover:bg-purple-50">
            ↓ Exporter registre
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              {['Demandeur', 'Concerne', 'Droit exercé', 'Statut', 'Reçue le', 'Échéance légale', 'Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {demandes.map(d => {
              const jours = daysUntil(d.delaiLegal);
              const urgent = d.statut !== 'traite' && jours <= 7;
              return (
                <tr key={d.id} className={`hover:bg-gray-50 ${urgent ? 'bg-red-50/20' : ''}`}>
                  <td className="px-4 py-4">
                    <div className="font-semibold text-gray-800">{d.nomDemandeur}</div>
                    <div className="text-xs text-gray-400">{d.email}</div>
                    {d.ageJeune < 15 && <span className="text-[10px] bg-purple-50 text-purple-600 font-bold px-1.5 py-0.5 rounded mt-1 inline-block">Représentant légal</span>}
                  </td>
                  <td className="px-4 py-4">
                    <div className="font-medium text-gray-700">{d.concerneJeune}</div>
                    <div className="text-xs text-gray-400">{d.ageJeune} ans</div>
                  </td>
                  <td className="px-4 py-4"><TypeDemandeBadge type={d.type} /></td>
                  <td className="px-4 py-4"><StatutBadge statut={d.statut} /></td>
                  <td className="px-4 py-4 text-xs text-gray-500">{formatDate(d.dateDemande)}</td>
                  <td className="px-4 py-4">
                    <div className={`text-xs font-semibold ${urgent ? 'text-red-600' : d.statut === 'traite' ? 'text-gray-400' : 'text-gray-700'}`}>
                      {formatDate(d.delaiLegal)}
                      {d.statut !== 'traite' && (
                        <div className={`mt-0.5 font-mono ${jours <= 0 ? 'text-red-700' : jours <= 7 ? 'text-red-600' : 'text-gray-400'}`}>
                          {jours <= 0 ? '🚨 Dépassé' : `J-${jours}`}
                          {d.delaiProlonge && <span className="ml-1 text-blue-500">(+2m)</span>}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-1.5">
                      {d.statut !== 'traite' && (
                        <button className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-[#6B1A6E] text-white hover:bg-[#8B2E8E]">Traiter</button>
                      )}
                      <button className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">Voir</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-500">
          <div className="font-semibold text-gray-600 mb-1.5">Notes par demande :</div>
          <div className="space-y-1">
            {demandes.map(d => (
              <div key={d.id} className="flex gap-2">
                <span className="font-medium text-gray-700 shrink-0">{d.nomDemandeur} :</span>
                <span>{d.notes}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: AIPD & Violations ───────────────────────────────────────────────────

function TabAIPD({ aipd, violations }: { aipd: AIPD[]; violations: ViolationDonnees[] }) {
  return (
    <div className="space-y-6">
      {/* AIPD */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-800">Analyses d'Impact (AIPD)</h3>
            <div className="text-xs text-gray-400 mt-0.5">Art. 35 RGPD — Obligatoire pour les traitements à risque élevé (données de mineurs, données de santé)</div>
          </div>
          <span className="text-xs bg-blue-50 text-blue-700 font-semibold px-3 py-1.5 rounded-full border border-blue-200">
            Liste CNIL des traitements nécessitant une AIPD
          </span>
        </div>
        <div className="divide-y divide-gray-50">
          {aipd.map(a => (
            <div key={a.id} className="px-5 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="font-semibold text-gray-800">{a.nom}</div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${a.statut === 'approuvée' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {a.statut === 'approuvée' ? '✓ Approuvée' : a.statut}
                    </span>
                    {a.avisConsultatifCNIL && <span className="text-xs bg-blue-100 text-blue-700 font-semibold px-2 py-0.5 rounded-full">Avis CNIL demandé</span>}
                  </div>
                  <div className="grid grid-cols-2 gap-4 mt-3">
                    <div>
                      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Risques identifiés</div>
                      <div className="space-y-1">
                        {a.risquesIdentifies.map(r => (
                          <div key={r} className="flex items-start gap-1.5 text-xs text-gray-600">
                            <span className="text-red-400 shrink-0 mt-0.5">▸</span> {r}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Mesures retenues</div>
                      <div className="space-y-1">
                        {a.mesuresRetenues.map(m => (
                          <div key={m} className="flex items-start gap-1.5 text-xs text-gray-600">
                            <span className="text-green-500 shrink-0 mt-0.5">✓</span> {m}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="text-right space-y-1 shrink-0">
                  <div className="text-xs text-gray-400">Réalisée le</div>
                  <div className="text-sm font-semibold text-gray-700">{formatDate(a.dateRealisation)}</div>
                  <div className="text-xs text-gray-400 mt-2">Révision prévue</div>
                  <div className="text-sm font-semibold text-gray-700">{formatDate(a.dateRevision)}</div>
                  <div className="text-xs text-gray-400 mt-2">{a.responsableAIPD}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Violations */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-800">Journal des violations de données</h3>
            <div className="text-xs text-gray-400 mt-0.5">Art. 33 & 34 RGPD — Notification CNIL sous 72h — {violations.length} incident(s) recensé(s)</div>
          </div>
        </div>
        <div className="px-5 py-4 mb-2">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2 mb-4">
            <span className="text-amber-500 shrink-0">⏱</span>
            <div className="text-xs text-amber-800">
              <strong>Obligation légale :</strong> Toute violation susceptible d'engendrer un risque pour les droits et libertés doit être notifiée à la CNIL <strong>dans les 72 heures</strong> (Art. 33 RGPD). Si le risque est élevé, les personnes concernées doivent également être informées (Art. 34 RGPD).
            </div>
          </div>
          {violations.map(v => (
            <div key={v.id} className="border border-gray-100 rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="text-sm font-semibold text-gray-800">{v.description}</div>
                    <GraviteBadge gravite={v.gravite} />
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${v.statut === 'clos' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{v.statut}</span>
                  </div>
                  <div className="text-xs text-gray-500">Incident du {formatDate(v.date)} · {v.personnesConcernees} personne(s) concernée(s)</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`text-xs font-bold ${v.notificationCNIL ? 'text-green-600' : 'text-gray-500'}`}>
                    {v.notificationCNIL ? '✓ CNIL notifiée' : 'CNIL non notifiée'}
                  </div>
                  {!v.notificationCNIL && <div className="text-[10px] text-gray-400 mt-0.5">{v.raisonNonNotification}</div>}
                </div>
              </div>
              <div className="text-xs text-gray-600 bg-gray-50 rounded-lg p-3">
                <strong>Mesures prises :</strong> {v.mesuresPrises}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'registre' | 'consentements' | 'demandes' | 'aipd';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'overview',      label: 'Vue d\'ensemble',         icon: '📊' },
  { id: 'registre',      label: 'Registre des traitements', icon: '📋' },
  { id: 'consentements', label: 'Consentements',            icon: '✅' },
  { id: 'demandes',      label: 'Demandes de droits',       icon: '📬' },
  { id: 'aipd',          label: 'AIPD & Violations',        icon: '🔍' },
];

export default function RgpdClient({ data }: { data: RgpdData }) {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  const demandesActives = data.demandesDroits.filter(d => d.statut !== 'traite').length;
  const mineursSansParental = data.consentements.filter(
    c => c.age < data.cadreJuridique.ageMajoriteNumerique && !c.consentementParental
  ).length;

  return (
    <div>
      {/* Header */}
      <div className="px-8 py-5 border-b border-gray-100 bg-white flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-extrabold text-gray-900 flex items-center gap-2">
            🔒 RGPD — Protection des données personnelles
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Pôle Jeunesse — Mairie de Nogent-sur-Marne · Collectivité territoriale · Conformité RGPD & Loi Informatique et Libertés
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-green-600 font-semibold bg-green-50 px-3 py-1.5 rounded-full border border-green-200">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Registre à jour
          </span>
          {demandesActives > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-orange-600 font-semibold bg-orange-50 px-3 py-1.5 rounded-full border border-orange-200">
              ⚠ {demandesActives} demande(s) en attente
            </span>
          )}
          {mineursSansParental > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-red-600 font-semibold bg-red-50 px-3 py-1.5 rounded-full border border-red-200">
              🚨 {mineursSansParental} consent. parental manquant
            </span>
          )}
        </div>
      </div>

      <div className="p-8">
        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6 w-fit">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                activeTab === tab.id ? 'bg-white text-[#6B1A6E] shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
              {tab.id === 'demandes' && demandesActives > 0 && (
                <span className="ml-0.5 bg-orange-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {demandesActives}
                </span>
              )}
            </button>
          ))}
        </div>

        {activeTab === 'overview'      && <TabOverview data={data} />}
        {activeTab === 'registre'      && <TabRegistre traitements={data.registreTraitements} />}
        {activeTab === 'consentements' && <TabConsentements consentements={data.consentements} ageMajoriteNumerique={data.cadreJuridique.ageMajoriteNumerique} />}
        {activeTab === 'demandes'      && <TabDemandes demandes={data.demandesDroits} />}
        {activeTab === 'aipd'          && <TabAIPD aipd={data.aipd} violations={data.violationsDonnees} />}
      </div>
    </div>
  );
}
