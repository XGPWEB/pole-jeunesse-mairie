'use client';
import { useEffect, useMemo, useState } from 'react';
import { todayLocal } from '@/lib/dates';
import { TYPES_DOSSIER_AFFICHES, type AccueilPij, type DossierPij } from '@/lib/pij';
import { INPUT_COMPACT } from './PijUi';
import PijAccueil from './PijAccueil';
import PijDossiers from './PijDossiers';
import PijAgenda from './PijAgenda';
import PijStats from './PijStats';

/**
 * Écran PIJ, partagé par /admin/pij et /animateur/pij. Quatre rubriques :
 * Accueil (registre), Dossiers (permis, chantiers, bourses), Agenda et
 * Statistiques. `peutSaisir` ne fait que masquer les actions ; le contrôle
 * réel est dans les routes /api/pij/*.
 */

type Rubrique = 'accueil' | 'dossiers' | 'agenda' | 'stats';

const anneeDossier = (d: DossierPij) => (d.dateRef ?? d.creeLe ?? '').slice(0, 4);

export default function PijClient({ peutSaisir, estAdmin = false }: { peutSaisir: boolean; estAdmin?: boolean }) {
  const [rubrique, setRubrique] = useState<Rubrique>('accueil');
  const [accueils, setAccueils] = useState<AccueilPij[]>([]);
  const [dossiers, setDossiers] = useState<DossierPij[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [annee, setAnnee] = useState(() => todayLocal().slice(0, 4));
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const [ra, rd] = await Promise.all([fetch('/api/pij/accueils'), fetch('/api/pij/dossiers')]);
        if (!ra.ok || !rd.ok) throw new Error('chargement');
        const [da, dd] = await Promise.all([ra.json(), rd.json()]);
        if (annule) return;
        setAccueils(da.accueils ?? []);
        setDossiers(dd.dossiers ?? []);
      } catch {
        if (!annule) setErreur('Impossible de charger les données du PIJ. Rechargez la page.');
      } finally {
        if (!annule) setChargement(false);
      }
    })();
    return () => { annule = true; };
  }, [version]);

  const annees = useMemo(() => {
    const s = new Set<string>([todayLocal().slice(0, 4)]);
    accueils.forEach(a => s.add(a.dateVisite.slice(0, 4)));
    dossiers.forEach(d => { const an = anneeDossier(d); if (an) s.add(an); });
    return [...s].sort().reverse();
  }, [accueils, dossiers]);

  const accueilsAnnee = useMemo(
    () => accueils.filter(a => annee === 'toutes' || a.dateVisite.startsWith(annee)),
    [accueils, annee],
  );
  const dossiersAnnee = useMemo(
    () => dossiers.filter(d => annee === 'toutes' || anneeDossier(d) === annee),
    [dossiers, annee],
  );

  /** Après un import : tout recharger, et ne rien masquer par le filtre d'année. */
  const apresImport = () => { setAnnee('toutes'); setVersion(v => v + 1); };

  const rubriques: { id: Rubrique; label: string; icone: string; nb?: number }[] = [
    { id: 'accueil', label: 'Accueil', icone: '👋', nb: accueilsAnnee.length },
    { id: 'dossiers', label: 'Dossiers', icone: '📂', nb: dossiersAnnee.filter(d => TYPES_DOSSIER_AFFICHES.includes(d.type)).length },
    { id: 'agenda', label: 'Agenda', icone: '📅' },
    { id: 'stats', label: 'Statistiques', icone: '📊' },
  ];

  return (
    <div className="space-y-5">
      {!peutSaisir && (
        <p className="px-4 py-3 rounded-xl bg-blue-50 border border-blue-100 text-sm text-blue-800">
          Consultation uniquement : la saisie est réservée aux informateurs PIJ et aux administrateurs.
        </p>
      )}
      {erreur && (
        <p role="alert" className="px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700">{erreur}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex p-1 rounded-xl bg-white border border-gray-200 shadow-sm" role="tablist" aria-label="Rubriques du PIJ">
          {rubriques.map(r => {
            const actif = rubrique === r.id;
            return (
              <button
                key={r.id}
                role="tab"
                aria-selected={actif}
                onClick={() => setRubrique(r.id)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${actif ? 'bg-[#6B1A6E] text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <span aria-hidden="true" className="mr-1.5">{r.icone}</span>{r.label}
                {r.nb !== undefined && (
                  <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[11px] tabular-nums ${actif ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>{r.nb}</span>
                )}
              </button>
            );
          })}
        </div>
        {rubrique !== 'agenda' && (
          <label className="ml-auto flex items-center gap-2 text-sm text-gray-500">
            Année
            <select value={annee} onChange={e => setAnnee(e.target.value)} className={INPUT_COMPACT}>
              {annees.map(a => <option key={a} value={a}>{a}</option>)}
              <option value="toutes">Toutes</option>
            </select>
          </label>
        )}
      </div>

      {chargement ? (
        <p className="py-10 text-center text-sm text-gray-400">Chargement…</p>
      ) : rubrique === 'accueil' ? (
        <PijAccueil accueils={accueilsAnnee} setAccueils={setAccueils} peutSaisir={peutSaisir} estAdmin={estAdmin} onImporte={apresImport} />
      ) : rubrique === 'dossiers' ? (
        <PijDossiers dossiers={dossiersAnnee} setDossiers={setDossiers} peutSaisir={peutSaisir} estAdmin={estAdmin} onImporte={apresImport} />
      ) : rubrique === 'agenda' ? (
        <PijAgenda peutSaisir={peutSaisir} accueils={accueils} />
      ) : (
        <PijStats accueils={accueilsAnnee} annee={annee} />
      )}
    </div>
  );
}
