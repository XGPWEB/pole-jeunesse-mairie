'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import EspaceBadge from '@/components/EspaceBadge';
import { StatutInscription } from '@/lib/data';
import { updateStatutInscription } from './actions';

interface Inscription {
  id: string;
  jeuneId: string;
  jeuneNom: string;
  jeunePrenom: string;
  activiteId: string;
  activiteTitre: string;
  espaceId: string;
  dateInscription: string;
  statut: StatutInscription;
  note?: string;
}

interface InscriptionsClientProps {
  inscriptions: Inscription[];
  espaces: { id: string; nom: string }[];
}

const STATUT_LABELS: Record<string, string> = {
  confirmee: 'Confirmée',
  'en-attente': 'En attente',
  'liste-attente': 'Liste d\'attente',
  annulee: 'Annulée',
  refusee: 'Refusée',
};

const STATUT_STYLES: Record<string, string> = {
  confirmee: 'bg-green-100 text-green-700',
  'en-attente': 'bg-amber-100 text-amber-700',
  'liste-attente': 'bg-orange-100 text-orange-700',
  annulee: 'bg-gray-100 text-gray-500',
  refusee: 'bg-red-100 text-red-600',
};

const FILTRE_PILLS: { value: 'toutes' | StatutInscription; label: string }[] = [
  { value: 'toutes', label: 'Toutes' },
  { value: 'confirmee', label: 'Confirmées' },
  { value: 'en-attente', label: 'En attente' },
  { value: 'annulee', label: 'Annulées' },
  { value: 'refusee', label: 'Refusées' },
];

function getInitiales(prenom: string | null | undefined, nom: string | null | undefined) {
  return `${(prenom ?? '?').charAt(0)}${(nom ?? '?').charAt(0)}`.toUpperCase();
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function InscriptionsClient({ inscriptions, espaces }: InscriptionsClientProps) {
  const [filtreStatut, setFiltreStatut] = useState<'toutes' | StatutInscription>('toutes');
  const [filtreEspace, setFiltreEspace] = useState<string>('');
  const [recherche, setRecherche] = useState('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const [actionError, setActionError] = useState<string | null>(null);

  function handleStatut(id: string, statut: 'confirmee' | 'refusee') {
    setActionError(null);
    startTransition(async () => {
      try {
        const result = await updateStatutInscription(id, statut);
        if (result?.success) {
          router.refresh();
        } else {
          setActionError(result?.error ?? 'Erreur lors de la mise à jour.');
        }
      } catch {
        // Action introuvable (déploiement récent) — rechargement de la page
        window.location.reload();
      }
    });
  }

  const inscriptionsFiltrees = inscriptions.filter(i => {
    if (filtreStatut !== 'toutes' && i.statut !== filtreStatut) return false;
    if (filtreEspace && i.espaceId !== filtreEspace) return false;
    if (recherche) {
      const q = recherche.toLowerCase();
      const matchNom = `${i.jeunePrenom ?? ''} ${i.jeuneNom ?? ''}`.toLowerCase().includes(q);
      const matchActivite = (i.activiteTitre ?? '').toLowerCase().includes(q);
      if (!matchNom && !matchActivite) return false;
    }
    return true;
  });

  const totalConfirmees = inscriptions.filter(i => i.statut === 'confirmee').length;
  const totalEnAttente = inscriptions.filter(i => i.statut === 'en-attente').length;
  const totalAnnuleesRefusees = inscriptions.filter(i => i.statut === 'annulee' || i.statut === 'refusee').length;

  function handleExportCSV() {
    const headers = ['Nom', 'Prénom', 'Activité', 'Espace', "Date d'inscription", 'Statut', 'Note'];
    const rows = inscriptionsFiltrees.map(i => [
      i.jeuneNom,
      i.jeunePrenom,
      i.activiteTitre,
      i.espaceId,
      formatDate(i.dateInscription),
      STATUT_LABELS[i.statut],
      i.note ?? '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inscriptions.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-8 space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-5">
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center text-2xl">📋</div>
          <div>
            <div className="text-3xl font-extrabold text-[#6B1A6E]">{inscriptions.length}</div>
            <div className="text-sm text-gray-500 font-medium mt-0.5">Total inscriptions</div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center text-2xl">✅</div>
          <div>
            <div className="text-3xl font-extrabold text-green-600">{totalConfirmees}</div>
            <div className="text-sm text-gray-500 font-medium mt-0.5">Confirmées</div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center text-2xl">⏳</div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-3xl font-extrabold text-amber-600">{totalEnAttente}</span>
              {totalEnAttente > 0 && (
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white text-xs font-bold animate-pulse">
                  !
                </span>
              )}
            </div>
            <div className="text-sm text-gray-500 font-medium mt-0.5">En attente</div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center text-2xl">❌</div>
          <div>
            <div className="text-3xl font-extrabold text-red-600">{totalAnnuleesRefusees}</div>
            <div className="text-sm text-gray-500 font-medium mt-0.5">Annulées / Refusées</div>
          </div>
        </div>
      </div>

      {/* Filtres */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
        {/* Pills statut */}
        <div className="flex items-center gap-2 flex-wrap">
          {FILTRE_PILLS.map(pill => (
            <button
              key={pill.value}
              onClick={() => setFiltreStatut(pill.value)}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-all ${
                filtreStatut === pill.value
                  ? 'bg-[#6B1A6E] text-white border-[#6B1A6E]'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-[#6B1A6E] hover:text-[#6B1A6E]'
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>

        {/* Filtre espace + recherche */}
        <div className="flex gap-3">
          <select
            value={filtreEspace}
            onChange={e => setFiltreEspace(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30"
          >
            <option value="">Tous les espaces</option>
            {espaces.map(e => (
              <option key={e.id} value={e.id}>{e.nom}</option>
            ))}
          </select>
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
            <input
              type="text"
              placeholder="Rechercher un jeune ou une activité…"
              value={recherche}
              onChange={e => setRecherche(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30"
            />
          </div>
        </div>
      </div>

      {/* Erreur action */}
      {actionError && (
        <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <span>⚠️</span>
          <span className="flex-1">{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-600 text-base">✕</button>
        </div>
      )}

      {/* Tableau */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 text-sm text-gray-500 font-medium">
          {inscriptionsFiltrees.length} inscription{inscriptionsFiltrees.length !== 1 ? 's' : ''} affichée{inscriptionsFiltrees.length !== 1 ? 's' : ''}
        </div>

        {inscriptionsFiltrees.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-4xl mb-3">📋</div>
            <div className="text-gray-500 font-medium">Aucune inscription trouvée</div>
            <div className="text-gray-400 text-sm mt-1">Modifiez les filtres ou attendez de nouvelles inscriptions</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="px-5 py-3 text-left">Jeune</th>
                  <th className="px-5 py-3 text-left">Activité</th>
                  <th className="px-5 py-3 text-left">Espace</th>
                  <th className="px-5 py-3 text-left">Date inscription</th>
                  <th className="px-5 py-3 text-left">Statut</th>
                  <th className="px-5 py-3 text-left">Note</th>
                  <th className="px-5 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {inscriptionsFiltrees.map(i => (
                  <tr key={i.id} className="hover:bg-gray-50 transition-colors">
                    {/* Jeune */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#6B1A6E]/10 flex items-center justify-center text-xs font-bold text-[#6B1A6E] shrink-0">
                          {getInitiales(i.jeunePrenom, i.jeuneNom)}
                        </div>
                        <div>
                          <div className="font-semibold text-gray-800">{i.jeunePrenom} {i.jeuneNom}</div>
                        </div>
                      </div>
                    </td>
                    {/* Activité */}
                    <td className="px-5 py-3 text-gray-700">{i.activiteTitre}</td>
                    {/* Espace */}
                    <td className="px-5 py-3">
                      <EspaceBadge espaceId={i.espaceId} />
                    </td>
                    {/* Date */}
                    <td className="px-5 py-3 text-gray-500">{formatDate(i.dateInscription)}</td>
                    {/* Statut */}
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUT_STYLES[i.statut]}`}>
                        {STATUT_LABELS[i.statut]}
                      </span>
                    </td>
                    {/* Note */}
                    <td className="px-5 py-3 text-gray-400 text-xs max-w-[160px] truncate">
                      {i.note ?? '—'}
                    </td>
                    {/* Actions */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        {i.statut === 'en-attente' && (
                          <>
                            <button
                              onClick={() => handleStatut(i.id, 'confirmee')}
                              disabled={pending}
                              className="px-2.5 py-1 rounded-lg bg-green-50 text-green-700 text-xs font-semibold border border-green-200 hover:bg-green-100 transition-colors disabled:opacity-50"
                            >
                              Confirmer
                            </button>
                            <button
                              onClick={() => handleStatut(i.id, 'refusee')}
                              disabled={pending}
                              className="px-2.5 py-1 rounded-lg bg-red-50 text-red-600 text-xs font-semibold border border-red-200 hover:bg-red-100 transition-colors disabled:opacity-50"
                            >
                              Refuser
                            </button>
                          </>
                        )}
                        <a
                          href={`/admin/jeunes/${i.jeuneId}`}
                          className="px-2.5 py-1 rounded-lg bg-gray-50 text-gray-600 text-xs font-semibold border border-gray-200 hover:bg-gray-100 transition-colors"
                        >
                          Voir fiche
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
