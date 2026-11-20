'use client';
import { useState, useEffect } from 'react';

interface Jeune { id: string; nom: string; prenom: string; espaceId: string; }
interface Inscription { id: string; jeuneId: string; jeuneNom: string; jeunePrenom: string; statut: string; dateInscription: string; }

interface Props {
  activiteId: string;
  espaceId: string;
  placesTotal?: number;
}

export default function InscriptionsManager({ activiteId, espaceId, placesTotal }: Props) {
  const [inscriptions, setInscriptions] = useState<Inscription[]>([]);
  const [jeunes, setJeunes] = useState<Jeune[]>([]);
  const [showSelector, setShowSelector] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  async function loadData() {
    const [insRes, jeunesRes] = await Promise.all([
      fetch(`/api/inscriptions?activiteId=${activiteId}`),
      fetch('/api/jeunes'),
    ]);
    const insData = await insRes.json();
    const jeunesData = await jeunesRes.json();
    setInscriptions(Array.isArray(insData) ? insData : []);
    const allJeunes = Array.isArray(jeunesData) ? jeunesData : (jeunesData.jeunes ?? []);
    setJeunes(allJeunes);
  }

  useEffect(() => { loadData(); }, [activiteId]);

  async function inscrire(jeuneId: string) {
    setLoading(true);
    await fetch('/api/inscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jeuneId, activiteId }),
    });
    await loadData();
    setLoading(false);
  }

  async function desinscrire(jeuneId: string) {
    setLoading(true);
    await fetch(`/api/inscriptions?jeuneId=${jeuneId}&activiteId=${activiteId}`, { method: 'DELETE' });
    await loadData();
    setLoading(false);
  }

  const confirmes = inscriptions.filter(i => i.statut === 'confirmee');
  const enAttente = inscriptions.filter(i => i.statut === 'en-attente')
    .sort((a, b) => a.dateInscription.localeCompare(b.dateInscription));

  const inscritsIds = inscriptions.map(i => i.jeuneId);
  const disponibles = jeunes.filter(j =>
    !inscritsIds.includes(j.id) &&
    (j.nom.toLowerCase().includes(search.toLowerCase()) || j.prenom.toLowerCase().includes(search.toLowerCase()))
  );

  const pct = placesTotal ? Math.round((confirmes.length / placesTotal) * 100) : 0;
  const barColor = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-400' : 'bg-green-500';

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="font-bold text-gray-800">Jeunes inscrits</h2>
          {placesTotal ? (
            <div className="mt-1.5">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-xs text-gray-400">
                  {confirmes.length}/{placesTotal} places
                  {enAttente.length > 0 && ` · ${enAttente.length} en attente`}
                </p>
              </div>
              <div className="h-2 w-40 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${barColor}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400 mt-0.5">{confirmes.length} inscrit(s)</p>
          )}
        </div>
        <button
          onClick={() => setShowSelector(s => !s)}
          className="flex items-center gap-2 px-4 py-2 bg-[#1B3870] text-white text-sm font-semibold rounded-xl hover:bg-[#162d5e] transition-colors"
        >
          {showSelector ? '✕ Fermer' : '+ Ajouter'}
        </button>
      </div>

      {/* Sélecteur de jeunes */}
      {showSelector && (
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
          <input
            type="text"
            placeholder="Rechercher un jeune..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30 mb-3"
          />
          <div className="max-h-48 overflow-y-auto space-y-1">
            {disponibles.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">
                {search ? 'Aucun jeune trouvé' : 'Tous les jeunes sont déjà inscrits'}
              </p>
            )}
            {disponibles.map(j => (
              <div key={j.id} className="flex items-center justify-between px-3 py-2 bg-white rounded-lg border border-gray-100 hover:border-[#1B3870]/30">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-[#1B3870]/10 flex items-center justify-center text-xs font-bold text-[#1B3870]">
                    {j.prenom[0]}{j.nom[0]}
                  </div>
                  <span className="text-sm font-medium text-gray-800">{j.prenom} {j.nom}</span>
                </div>
                <button
                  onClick={() => inscrire(j.id)}
                  disabled={loading}
                  className="px-3 py-1 bg-green-500 text-white text-xs font-semibold rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50"
                >
                  + Inscrire
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Liste des inscrits confirmés */}
      <div className="divide-y divide-gray-50">
        {confirmes.length === 0 && enAttente.length === 0 ? (
          <div className="px-6 py-10 text-center text-gray-400 text-sm">
            Aucun jeune inscrit — cliquez sur "+ Ajouter" pour commencer.
          </div>
        ) : (
          <>
            {confirmes.map(i => (
              <div key={i.id} className="flex items-center justify-between px-6 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#1B3870]/10 flex items-center justify-center text-sm font-bold text-[#1B3870]">
                    {i.jeunePrenom?.[0]}{i.jeuneNom?.[0]}
                  </div>
                  <div>
                    <p className="font-medium text-gray-800 text-sm">{i.jeunePrenom} {i.jeuneNom}</p>
                    <p className="text-xs text-gray-400">Confirmé</p>
                  </div>
                </div>
                <button
                  onClick={() => desinscrire(i.jeuneId)}
                  disabled={loading}
                  className="w-7 h-7 rounded-full bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 flex items-center justify-center text-xs font-bold transition-colors disabled:opacity-50"
                >
                  ✕
                </button>
              </div>
            ))}

            {enAttente.length > 0 && (
              <>
                <div className="px-6 py-2 bg-amber-50 border-t border-amber-100">
                  <p className="text-xs font-bold text-amber-700">🕐 Liste d'attente ({enAttente.length})</p>
                </div>
                {enAttente.map((i, idx) => (
                  <div key={i.id} className="flex items-center justify-between px-6 py-3 bg-amber-50/40">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-sm font-bold text-amber-700">
                        #{idx + 1}
                      </div>
                      <div>
                        <p className="font-medium text-gray-800 text-sm">{i.jeunePrenom} {i.jeuneNom}</p>
                        <p className="text-xs text-amber-600">Position #{idx + 1} en attente</p>
                      </div>
                    </div>
                    <button
                      onClick={() => desinscrire(i.jeuneId)}
                      disabled={loading}
                      className="w-7 h-7 rounded-full bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 flex items-center justify-center text-xs font-bold transition-colors disabled:opacity-50"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
