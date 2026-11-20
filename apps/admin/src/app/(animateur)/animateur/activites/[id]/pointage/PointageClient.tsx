'use client';
import { useState } from 'react';
import { todayLocal } from '@/lib/dates';

interface Jeune {
  id: string;
  nom: string;
  prenom: string;
  espaceId: string;
}

interface Pointage {
  jeuneId: string;
  statut: 'present' | 'absent';
}

export default function PointageClient({
  activiteId,
  inscrits,
  pointagesInitiaux,
}: {
  activiteId: string;
  inscrits: Jeune[];
  pointagesInitiaux: Pointage[];
}) {
  const [statuts, setStatuts] = useState<Record<string, 'present' | 'absent' | null>>(() => {
    const init: Record<string, 'present' | 'absent' | null> = {};
    inscrits.forEach(j => { init[j.id] = null; });
    pointagesInitiaux.forEach(p => { init[p.jeuneId] = p.statut; });
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  function toggle(id: string, val: 'present' | 'absent') {
    setStatuts(prev => ({ ...prev, [id]: prev[id] === val ? null : val }));
    setSaved(false);
    setError('');
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    const today = todayLocal();
    const entries = Object.entries(statuts)
      .filter(([, s]) => s !== null)
      .map(([jeuneId, statut]) => ({
        jeuneId,
        activiteId,
        date: today,
        statut,
      }));

    // Le résultat DOIT être vérifié : sans ce contrôle, une session expirée ou
    // une erreur serveur affichait « Pointage enregistré » alors que toute la
    // feuille de présence était perdue, sans que l'animateur puisse le savoir.
    try {
      const res = await fetch('/api/pointages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entries),
      });

      if (!res.ok) {
        setError(
          res.status === 401
            ? 'Session expirée — reconnectez-vous, puis réenregistrez le pointage.'
            : 'Le pointage n’a PAS été enregistré. Réessayez.',
        );
        return;
      }

      setSaved(true);
    } catch {
      setError('Connexion perdue — le pointage n’a PAS été enregistré. Réessayez.');
    } finally {
      setSaving(false);
    }
  }

  const presents = Object.values(statuts).filter(s => s === 'present').length;
  const absents = Object.values(statuts).filter(s => s === 'absent').length;

  return (
    <div className="max-w-2xl space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-center">
          <div className="text-2xl font-extrabold text-gray-800">{inscrits.length}</div>
          <div className="text-xs text-gray-400">Inscrits</div>
        </div>
        <div className="bg-green-50 rounded-xl border border-green-200 p-4 text-center">
          <div className="text-2xl font-extrabold text-green-700">{presents}</div>
          <div className="text-xs text-green-500">Présents</div>
        </div>
        <div className="bg-red-50 rounded-xl border border-red-200 p-4 text-center">
          <div className="text-2xl font-extrabold text-red-600">{absents}</div>
          <div className="text-xs text-red-400">Absents</div>
        </div>
      </div>

      {/* Liste */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-gray-800">Liste de présence</h2>
          <div className="flex gap-2 text-xs text-gray-400">
            <span className="w-4 h-4 rounded bg-green-100 inline-block" /> Présent
            <span className="w-4 h-4 rounded bg-red-100 inline-block ml-2" /> Absent
          </div>
        </div>

        {inscrits.length === 0 ? (
          <div className="px-6 py-10 text-center text-gray-400 text-sm">
            Aucun jeune inscrit à cette activité.
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {inscrits.map(j => {
              const s = statuts[j.id];
              return (
                <div key={j.id} className="flex items-center justify-between px-6 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-[#1B3870]/10 flex items-center justify-center text-sm font-bold text-[#1B3870]">
                      {j.prenom[0]}{j.nom[0]}
                    </div>
                    <span className="font-medium text-gray-800 text-sm">{j.prenom} {j.nom}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => toggle(j.id, 'present')}
                      className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                        s === 'present'
                          ? 'bg-green-500 text-white shadow-sm'
                          : 'bg-green-50 text-green-700 hover:bg-green-100'
                      }`}
                    >
                      ✓ Présent
                    </button>
                    <button
                      onClick={() => toggle(j.id, 'absent')}
                      className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                        s === 'absent'
                          ? 'bg-red-500 text-white shadow-sm'
                          : 'bg-red-50 text-red-600 hover:bg-red-100'
                      }`}
                    >
                      ✗ Absent
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="px-6 py-4 border-t border-gray-100">
          {error && (
            <div role="alert" className="mb-3 px-4 py-3 bg-red-50 border border-red-300 rounded-xl text-red-700 text-sm font-medium">
              ⚠️ {error}
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3 bg-[#1B3870] text-white font-bold rounded-xl hover:bg-[#162d5e] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saved ? '✅ Pointage enregistré' : saving ? '⟳ Enregistrement...' : '💾 Enregistrer le pointage'}
          </button>
        </div>
      </div>
    </div>
  );
}
