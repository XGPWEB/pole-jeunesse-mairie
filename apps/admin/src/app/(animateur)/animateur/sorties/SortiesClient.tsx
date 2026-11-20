'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Sortie {
  id: string;
  titre: string;
  date: string;
  animateurNom: string;
  espaceId: string;
  lieuDestination: string;
  statut: string;
  participants: string[];
}

const STATUT_LABELS: Record<string, string> = {
  planifiee: '📅 Planifiée',
  realisee: '✅ Réalisée',
  annulee: '❌ Annulée',
};

export default function SortiesClient() {
  const [sorties, setSorties] = useState<Sortie[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/sorties').then(r => r.json()).then(d => {
      const list: Sortie[] = d.sorties ?? [];
      list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setSorties(list);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-400">Chargement...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Link
          href="/animateur/sorties/nouvelle"
          className="flex items-center gap-2 px-6 py-3 bg-[#1B3870] text-white font-bold rounded-xl hover:bg-[#162d5e] transition-colors"
        >
          🗺️ Nouvelle sortie
        </Link>
      </div>

      {sorties.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-16 text-center">
          <div className="text-4xl mb-4">🗺️</div>
          <p className="text-gray-500 font-medium">Aucune sortie créée</p>
          <p className="text-gray-400 text-sm mt-1">Créez votre première fiche sortie.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorties.map(s => (
            <div key={s.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[#1B3870]/10 flex flex-col items-center justify-center shrink-0">
                <span className="text-base font-extrabold text-[#1B3870]">{new Date(s.date).getDate()}</span>
                <span className="text-[10px] text-[#1B3870]/70 uppercase">{new Date(s.date).toLocaleDateString('fr-FR', { month: 'short' })}</span>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <p className="font-bold text-gray-800">{s.titre}</p>
                  <span className="text-xs">{STATUT_LABELS[s.statut] ?? s.statut}</span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  📍 {s.lieuDestination} · {s.participants?.length ?? 0} participants · {s.animateurNom}
                </p>
              </div>
              <div className="flex gap-2">
                <Link href={`/animateur/sorties/${s.id}`}
                  className="px-3 py-1.5 text-sm bg-[#1B3870]/10 text-[#1B3870] font-medium rounded-lg hover:bg-[#1B3870]/20">
                  Modifier
                </Link>
                <Link href={`/animateur/sorties/${s.id}/print`} target="_blank"
                  className="px-3 py-1.5 text-sm bg-gray-100 text-gray-600 font-medium rounded-lg hover:bg-gray-200">
                  🖨 PDF
                </Link>
                <Link href={`/animateur/sorties/${s.id}/fiches-sanitaires`} target="_blank"
                  className="px-3 py-1.5 text-sm bg-gray-100 text-gray-600 font-medium rounded-lg hover:bg-gray-200">
                  🩺 Fiches sanitaires
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
