'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { todayLocal } from '@/lib/dates';
import type { MissionPij } from '@/lib/pij';
import { BTN_PRIMAIRE, INPUT, Section, dateFr, nombreFr } from './PijUi';

/**
 * Journal des missions d'un dossier permis, sur la fiche même : on ajoute une
 * mission (date, intitulé, heures) sans passer par « Modifier », et ses heures
 * se déduisent aussitôt des heures à réaliser. Chaque ligne garde son auteur.
 */
export default function PijMissions({ dossierId, peutSaisir, onTotal }: {
  dossierId: string; peutSaisir: boolean;
  /** Nouveau total des heures réalisées, après un ajout ou un retrait. */
  onTotal: (heuresRealisees: number) => void;
}) {
  const [missions, setMissions] = useState<MissionPij[] | null>(null);
  const [date, setDate] = useState(todayLocal);
  const [libelle, setLibelle] = useState('');
  const [heures, setHeures] = useState('');
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    let annule = false;
    setMissions(null);
    setErreur('');
    fetch(`/api/pij/missions?dossierId=${encodeURIComponent(dossierId)}`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => { if (!annule) setMissions(d.missions ?? []); })
      .catch(() => { if (!annule) { setMissions([]); setErreur('Impossible de charger les missions.'); } });
    return () => { annule = true; };
  }, [dossierId]);

  async function appeler(url: string, init: RequestInit): Promise<boolean> {
    setEnCours(true);
    setErreur('');
    try {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErreur(data.error ?? 'Opération impossible.'); return false; }
      setMissions(data.missions ?? []);
      onTotal(data.heuresRealisees ?? 0);
      return true;
    } catch {
      setErreur('Connexion au serveur impossible. Réessayez.');
      return false;
    } finally {
      setEnCours(false);
    }
  }

  async function ajouter(e: FormEvent) {
    e.preventDefault();
    const ok = await appeler('/api/pij/missions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dossierId, date, libelle, heures }),
    });
    if (ok) { setLibelle(''); setHeures(''); }
  }

  async function retirer(m: MissionPij) {
    if (!window.confirm(`Retirer la mission « ${m.libelle} » (${nombreFr(m.heures)} h) ? Ses heures reviendront au reste à faire.`)) return;
    await appeler(`/api/pij/missions?id=${encodeURIComponent(m.id)}`, { method: 'DELETE' });
  }

  const total = (missions ?? []).reduce((n, m) => n + m.heures, 0);

  return (
    <Section titre="Missions réalisées">
      {peutSaisir && (
        <form onSubmit={ajouter} noValidate className="flex flex-wrap items-end gap-2 p-3 rounded-xl bg-gray-50 border border-gray-100">
          <label className="text-xs font-semibold text-gray-600">
            <span className="block mb-1">Date</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={INPUT} />
          </label>
          <label className="text-xs font-semibold text-gray-600 flex-1 min-w-48">
            <span className="block mb-1">Mission</span>
            <input value={libelle} onChange={e => setLibelle(e.target.value)} placeholder="Ex. Chasse aux œufs" className={INPUT} />
          </label>
          <label className="text-xs font-semibold text-gray-600 w-24">
            <span className="block mb-1">Heures</span>
            <input inputMode="decimal" value={heures} onChange={e => setHeures(e.target.value)} placeholder="5" className={INPUT} />
          </label>
          <button type="submit" disabled={enCours} className={BTN_PRIMAIRE}>+ Ajouter la mission</button>
        </form>
      )}
      {erreur && <p role="alert" className="text-sm text-red-600 font-medium">{erreur}</p>}

      {missions === null ? (
        <p className="text-sm text-gray-400">Chargement…</p>
      ) : missions.length === 0 ? (
        <p className="text-sm text-gray-400">Aucune mission enregistrée pour ce dossier.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-gray-400 border-b border-gray-100">
              <th scope="col" className="py-1.5 pr-3 w-24">Date</th>
              <th scope="col" className="py-1.5 pr-3">Mission</th>
              <th scope="col" className="py-1.5 pr-3 text-right w-16">Heures</th>
              <th scope="col" className="py-1.5 pr-3 w-40">Saisie par</th>
              {peutSaisir && <th scope="col" className="w-8"><span className="sr-only">Retirer</span></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {missions.map(m => (
              <tr key={m.id}>
                <td className="py-1.5 pr-3 text-gray-600 tabular-nums whitespace-nowrap">{dateFr(m.date)}</td>
                <td className="py-1.5 pr-3 text-gray-900 break-words">{m.libelle}</td>
                <td className="py-1.5 pr-3 text-right font-semibold text-gray-900 tabular-nums whitespace-nowrap">{nombreFr(m.heures)} h</td>
                <td className="py-1.5 pr-3 text-xs text-gray-500">
                  {m.creePar ?? '—'}
                  <span className="block text-gray-400">le {dateFr(String(m.creeLe).slice(0, 10))}</span>
                </td>
                {peutSaisir && (
                  <td className="py-1.5 text-right">
                    <button onClick={() => retirer(m)} disabled={enCours} aria-label={`Retirer la mission ${m.libelle}`} title="Retirer cette mission" className="w-6 h-6 rounded text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40">×</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200">
              <th scope="row" colSpan={2} className="py-2 pr-3 text-left text-xs font-bold uppercase tracking-wide text-gray-500">Total réalisé</th>
              <td className="py-2 pr-3 text-right font-bold text-[#6B1A6E] tabular-nums whitespace-nowrap">{nombreFr(total)} h</td>
              <td colSpan={peutSaisir ? 2 : 1} />
            </tr>
          </tfoot>
        </table>
      )}
    </Section>
  );
}
