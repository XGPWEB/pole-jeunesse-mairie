'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Projet {
  id: string;
  titre: string;
  espaceId: string;
  animateurNom: string;
  animateurId: string;
  dateDepot?: string;
  dateProjet?: string; // compat ancien champ
  statut: string;
  publicCible: string;
  updatedAt: string;
}

const STATUT_CONFIG: Record<string, { label: string; bg: string; text: string; icon: string }> = {
  brouillon: { label: 'Brouillon',  bg: 'bg-amber-100',  text: 'text-amber-700',  icon: '✏️' },
  publie:    { label: 'Publié',     bg: 'bg-green-100',  text: 'text-green-700',  icon: '🟢' },
  soumis:    { label: 'Soumis',     bg: 'bg-yellow-100', text: 'text-yellow-700', icon: '🟡' },
  valide:    { label: 'Validé',     bg: 'bg-green-100',  text: 'text-green-700',  icon: '✅' },
  en_cours:  { label: 'En cours',   bg: 'bg-blue-100',   text: 'text-blue-700',   icon: '🔵' },
  termine:   { label: 'Terminé',    bg: 'bg-gray-100',   text: 'text-gray-600',   icon: '⚫' },
  annule:    { label: 'Annulé',     bg: 'bg-red-100',    text: 'text-red-600',    icon: '🔴' },
};

export default function ProjetsClient({ basePath = '/animateur/projets' }: { basePath?: string }) {
  const [projets, setProjets] = useState<Projet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/projets').then(r => r.json()).then(d => {
      setProjets(d.projets ?? []);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-400">Chargement...</div>;

  const sortByDate = (a: Projet, b: Projet) => {
    const da = a.updatedAt || a.dateDepot || a.dateProjet || '';
    const db = b.updatedAt || b.dateDepot || b.dateProjet || '';
    return db.localeCompare(da);
  };
  const brouillons = projets.filter(p => p.statut === 'brouillon').sort(sortByDate);
  const publies    = projets.filter(p => p.statut !== 'brouillon').sort(sortByDate);

  function ProjetCard({ p }: { p: Projet }) {
    const cfg = STATUT_CONFIG[p.statut] ?? STATUT_CONFIG.brouillon;
    const date = p.dateDepot || p.dateProjet;
    return (
      <div className={`bg-white rounded-xl border shadow-sm p-5 flex items-center gap-4 ${p.statut === 'brouillon' ? 'border-amber-200' : 'border-gray-100'}`}>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl shrink-0 ${p.statut === 'brouillon' ? 'bg-amber-50' : 'bg-[#1B3870]/10'}`}>
          {cfg.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-gray-800 truncate">{p.titre || <span className="text-gray-400 italic">Sans titre</span>}</p>
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${cfg.bg} ${cfg.text}`}>
              {cfg.label}
            </span>
          </div>
          <div className="text-xs text-gray-400 mt-0.5 truncate">
            {p.animateurNom} · {p.espaceId}
            {p.publicCible && ` · ${p.publicCible}`}
            {date && ` · Dépôt : ${new Date(date).toLocaleDateString('fr-FR')}`}
          </div>
          <div className="text-xs text-gray-300 mt-0.5">
            Modifié le {new Date(p.updatedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link
            href={`${basePath}/${p.id}`}
            className="px-3 py-1.5 text-sm bg-[#1B3870]/10 text-[#1B3870] font-medium rounded-lg hover:bg-[#1B3870]/20 transition-colors"
          >
            Ouvrir
          </Link>
          {p.statut !== 'brouillon' && (
            <Link
              href={`/animateur/projets/${p.id}/print`}
              target="_blank"
              className="px-3 py-1.5 text-sm bg-gray-100 text-gray-600 font-medium rounded-lg hover:bg-gray-200 transition-colors"
            >
              🖨 PDF
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-end">
        <Link
          href={`${basePath}/nouveau`}
          className="flex items-center gap-2 px-6 py-3 bg-[#1B3870] text-white font-bold rounded-xl hover:bg-[#162d5e] transition-colors"
        >
          📁 Nouveau projet
        </Link>
      </div>

      {projets.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-16 text-center">
          <div className="text-4xl mb-4">📁</div>
          <p className="text-gray-500 font-medium">Aucun projet créé</p>
          <p className="text-gray-400 text-sm mt-1">Créez votre premier projet pour commencer.</p>
        </div>
      ) : (
        <>
          {/* Brouillons */}
          {brouillons.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-amber-600 uppercase tracking-wider flex items-center gap-2">
                <span>✏️</span> Brouillons en cours ({brouillons.length})
              </h2>
              {brouillons.map(p => <ProjetCard key={p.id} p={p} />)}
            </div>
          )}

          {/* Publiés */}
          {publies.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                <span>🟢</span> Projets publiés ({publies.length})
              </h2>
              {publies.map(p => <ProjetCard key={p.id} p={p} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
