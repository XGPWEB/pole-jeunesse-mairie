'use client';
import { useMemo } from 'react';
import { todayLocal } from '@/lib/dates';
import { calculerStatsPij, type AccueilPij, type LigneStat } from '@/lib/pij';

/** Rubrique « Statistiques » : la feuille « STATS » du tableur, recalculée. */

function BlocStat({ titre, lignes, large }: { titre: string; lignes: LigneStat[]; large?: boolean }) {
  const max = Math.max(1, ...lignes.map(l => l.effectif));
  const total = lignes.reduce((n, l) => n + l.effectif, 0);
  return (
    <section className={`bg-white rounded-xl border border-gray-100 shadow-sm p-5 ${large ? 'xl:col-span-2' : ''}`}>
      <h3 className="text-sm font-bold text-gray-800 mb-3">{titre}</h3>
      <table className="w-full text-sm">
        <thead className="sr-only"><tr><th scope="col">{titre}</th><th scope="col">Effectif</th><th scope="col">Part</th></tr></thead>
        <tbody>
          {lignes.map(l => (
            <tr key={l.label} className={l.effectif === 0 ? 'text-gray-300' : ''}>
              <th scope="row" className={`py-1 pr-3 text-left font-normal w-2/5 ${l.effectif === 0 ? 'text-gray-400' : 'text-gray-700'}`}>{l.label}</th>
              <td className="py-1 w-full">
                <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
                  <div className="h-full rounded-full" style={{ width: `${(l.effectif / max) * 100}%`, backgroundColor: 'var(--color-admin, #6B1A6E)' }} />
                </div>
              </td>
              <td className={`py-1 pl-3 text-right font-semibold tabular-nums ${l.effectif === 0 ? 'text-gray-300' : 'text-gray-900'}`}>{l.effectif}</td>
              <td className="py-1 pl-2 text-right text-xs text-gray-400 tabular-nums whitespace-nowrap w-12">
                {total > 0 ? `${Math.round((l.effectif / total) * 100)} %` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Chiffre({ label, valeur, detail }: { label: string; valeur: number | string; detail?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-extrabold text-[#6B1A6E] mt-1 tabular-nums">{valeur}</p>
      {detail && <p className="text-xs text-gray-400 mt-0.5">{detail}</p>}
    </div>
  );
}

export default function PijStats({ accueils, annee }: { accueils: AccueilPij[]; annee: string }) {
  const stats = useMemo(() => calculerStatsPij(accueils, todayLocal()), [accueils]);
  const effectif = (lignes: LigneStat[], label: string) => lignes.find(l => l.label === label)?.effectif ?? 0;
  const finalises = effectif(stats.parEtat, 'Finalisé');
  const part = stats.nbJeunes > 0 ? `${Math.round((finalises / stats.nbJeunes) * 100)} % des demandes` : undefined;

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-gray-900">Statistiques PIJ {annee === 'toutes' ? '— toutes années' : annee}</h2>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
        <Chiffre label="Nombre de jeunes" valeur={stats.nbJeunes} />
        <Chiffre label="Nombre de dossiers" valeur={stats.nbDossiers} detail="un par objet de demande" />
        <Chiffre label="Demandes finalisées" valeur={finalises} detail={part} />
        <Chiffre label="Demandes en cours" valeur={effectif(stats.parEtat, 'En cours de réalisation')} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <BlocStat titre="Objet de la demande" lignes={stats.parObjet} />
        <div className="space-y-5">
          <BlocStat titre="Répartition par sexe" lignes={stats.parSexe} />
          <BlocStat titre="État de la demande" lignes={stats.parEtat} />
          <BlocStat titre="Quartier (Nogentais)" lignes={stats.parQuartier} />
        </div>
        <BlocStat titre="Répartition par âges" lignes={stats.parAge} />
        <BlocStat titre="Orientation (vers qui ?)" lignes={stats.parOrientation} />
        <BlocStat titre="Commune" lignes={stats.parCommune} large />
      </div>
    </div>
  );
}
