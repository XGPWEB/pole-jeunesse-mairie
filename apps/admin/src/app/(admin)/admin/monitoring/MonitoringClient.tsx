'use client';

import { useCallback, useEffect, useState } from 'react';

interface Evenement {
  id: string; at: string; source: string; type: string; message: string; detail: string | null; path: string | null;
}

const PERIODES = [
  { value: 7, label: '7 jours' },
  { value: 30, label: '30 jours' },
  { value: 90, label: '90 jours' },
];
const PAR_PAGE = 10;
const SOURCES: Record<string, string> = {
  serveur: 'Serveur', navigateur: 'Navigateur', exploitation: 'Exploitation', securite: 'Sécurité',
};

function formaterDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function MonitoringClient() {
  const [days, setDays] = useState(7);
  const [items, setItems] = useState<Evenement[]>([]);
  const [byType, setByType] = useState<Record<string, number>>({});
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [page, setPage] = useState(1);
  const [aSupprimer, setASupprimer] = useState<Evenement | null>(null);
  const [suppression, setSuppression] = useState(false);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur('');
    try {
      const res = await fetch(`/api/monitoring/events?days=${days}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { items?: Evenement[]; byType?: Record<string, number> };
      setItems(data.items ?? []);
      setByType(data.byType ?? {});
    } catch {
      setErreur('Impossible de charger le journal.');
    } finally {
      setChargement(false);
    }
  }, [days]);

  useEffect(() => { void charger(); }, [charger]);
  useEffect(() => { setPage(1); }, [days]);

  async function confirmerSuppression() {
    if (!aSupprimer) return;
    setSuppression(true);
    try {
      const res = await fetch('/api/monitoring/events', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [aSupprimer.id] }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setASupprimer(null);
      await charger();
    } catch {
      setErreur('Échec de la suppression.');
      setASupprimer(null);
    } finally {
      setSuppression(false);
    }
  }

  const types = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  const nbPages = Math.max(1, Math.ceil(items.length / PAR_PAGE));
  const pageCourante = Math.min(page, nbPages);
  const visibles = items.slice((pageCourante - 1) * PAR_PAGE, pageCourante * PAR_PAGE);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2" role="group" aria-label="Période">
          {PERIODES.map(p => (
            <button
              key={p.value}
              onClick={() => setDays(p.value)}
              aria-pressed={days === p.value}
              className={`px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                days === p.value ? 'bg-[#6B1A6E] text-white border-[#6B1A6E]' : 'bg-white text-gray-700 border-gray-200 hover:border-[#6B1A6E]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button onClick={() => void charger()} className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-200 bg-white text-gray-700 hover:bg-gray-50">
          Rafraîchir
        </button>
      </div>

      {chargement && <p className="text-sm text-gray-500">Chargement…</p>}
      {erreur && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erreur}</div>}

      {!chargement && !erreur && (
        <>
          <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <h2 className="font-bold text-gray-800 mb-3">Répartition par type</h2>
            {types.length === 0 ? (
              <p className="text-sm text-gray-500">Aucun événement sur cette période — tout va bien.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {types.map(([type, n]) => (
                  <span key={type} className="inline-flex items-center gap-2 rounded-full bg-pink-50 text-pink-800 border border-pink-100 px-3 py-1 text-sm">
                    {type} <strong>{n}</strong>
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <h2 className="font-bold text-gray-800 mb-3">Journal ({items.length})</h2>
            {items.length === 0 && <p className="text-sm text-gray-500">Aucun événement sur cette période.</p>}
            <ul className="space-y-2">
              {visibles.map(e => (
                <li key={e.id} className="rounded-lg border border-gray-100 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <strong className="text-pink-800">{e.type}</strong>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-gray-500 whitespace-nowrap">{SOURCES[e.source] ?? e.source} · {formaterDate(e.at)}</span>
                      <button
                        onClick={() => setASupprimer(e)}
                        aria-label={`Supprimer l'entrée « ${e.type} » du ${formaterDate(e.at)}`}
                        title="Supprimer cette entrée"
                        className="text-gray-400 hover:text-red-600 text-base leading-none px-1"
                      >✕</button>
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-gray-800">{e.message}</p>
                  {e.path && <p className="mt-0.5 text-xs text-gray-500">{e.path}</p>}
                  {e.detail && (
                    <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-2 text-[11.5px] text-gray-700">{e.detail}</pre>
                  )}
                </li>
              ))}
            </ul>
            {nbPages > 1 && (
              <div className="mt-4 flex items-center justify-center gap-3 text-sm">
                <button disabled={pageCourante <= 1} onClick={() => setPage(pageCourante - 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40">Précédent</button>
                <span className="text-gray-600">Page {pageCourante} / {nbPages}</span>
                <button disabled={pageCourante >= nbPages} onClick={() => setPage(pageCourante + 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40">Suivant</button>
              </div>
            )}
          </section>
        </>
      )}

      {aSupprimer && (
        <div role="dialog" aria-modal="true" aria-labelledby="titre-suppression" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 id="titre-suppression" className="font-bold text-gray-900">Supprimer cette entrée ?</h3>
            <p className="mt-2 text-sm text-gray-600">Supprimer « {aSupprimer.type} » du journal ? Cette action est définitive.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setASupprimer(null)} disabled={suppression} className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700">Annuler</button>
              <button onClick={() => void confirmerSuppression()} disabled={suppression} className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold disabled:opacity-60">
                {suppression ? 'Suppression…' : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
