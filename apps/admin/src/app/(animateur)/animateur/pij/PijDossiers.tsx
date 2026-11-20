'use client';
import { useMemo, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from 'react';
import Field from '@/components/Field';
import {
  TYPES_DOSSIER, TYPES_DOSSIER_AFFICHES, heuresRestantes,
  type ChampDossier, type ColonneDossier, type DossierPij, type TypeDossier,
} from '@/lib/pij';
import {
  BTN_DANGER, BTN_PRIMAIRE, BTN_SECONDAIRE, BarreOutils, INPUT, Info, ListeEtPanneau, ListeNoms, Panneau,
  PanneauVide, PiedSaisie, Section, dateFr, enregistrerPij, nombreFr, sansAccent, supprimerPij,
} from './PijUi';
import PijImport from './PijImport';
import PijMissions from './PijMissions';

/**
 * Rubrique « Dossiers » : permis de conduire, chantiers jeunes et bourses
 * (TYPES_DOSSIER_AFFICHES). Même présentation que l'accueil ; les champs de chaque type viennent
 * de TYPES_DOSSIER (les colonnes des feuilles du tableur).
 */

type FormDossier = { id?: string; type: TypeDossier } & Record<ChampDossier, string>;

const CHAMPS: ChampDossier[] = [
  'dateRef', 'nom', 'prenom', 'dateNaissance', 'telephone', 'objet', 'horaire', 'prochainRdv',
  'remarques', 'organisme', 'montant', 'heuresARealiser', 'heuresRealisees', 'missions', 'etat',
];
const ICONES: Record<TypeDossier, string> = { permis: '🚗', chantier: '🛠️', bourse: '🎓', bafa: '🎒' };

function formDossier(type: TypeDossier, d?: DossierPij): FormDossier {
  const f = { id: d?.id, type } as FormDossier;
  for (const champ of CHAMPS) {
    const v = d?.[champ];
    f[champ] = v === null || v === undefined ? '' : String(v);
  }
  return f;
}

function valeur(d: DossierPij, col: ColonneDossier): ReactNode {
  const v = d[col.champ];
  if (v === null || v === undefined || v === '') return null;
  if (col.saisie === 'date') return dateFr(String(v));
  if (col.champ === 'montant') return `${v} €`;
  if (col.saisie === 'nombre') return `${v} h`;
  return String(v);
}

/** Avancement des heures d'un permis (colonnes « à réaliser » et « déjà réalisé »). */
function Heures({ dossier }: { dossier: DossierPij }) {
  const restantes = heuresRestantes(dossier);
  if (restantes === null || !dossier.heuresARealiser) return null;
  const faites = dossier.heuresRealisees ?? 0;
  const part = Math.max(0, Math.min(100, (faites / dossier.heuresARealiser) * 100));
  return (
    <span className="block mt-1.5">
      <span className="flex justify-between text-xs text-gray-500">
        <span>{nombreFr(faites)} h réalisées sur {nombreFr(dossier.heuresARealiser)} h</span>
        <span className={`font-semibold ${restantes <= 0 ? 'text-green-700' : 'text-gray-700'}`}>
          {restantes <= 0 ? 'Heures terminées' : `${nombreFr(restantes)} h restantes`}
        </span>
      </span>
      <span className="block h-1.5 rounded-full bg-gray-100 overflow-hidden mt-1" aria-hidden="true">
        <span className={`block h-full rounded-full ${restantes <= 0 ? 'bg-green-500' : 'bg-[#6B1A6E]'}`} style={{ width: `${part}%` }} />
      </span>
    </span>
  );
}

type Vue = { mode: 'lecture'; id: string } | { mode: 'saisie'; form: FormDossier } | null;

export default function PijDossiers({ dossiers, setDossiers, peutSaisir, estAdmin, onImporte }: {
  dossiers: DossierPij[]; setDossiers: Dispatch<SetStateAction<DossierPij[]>>;
  peutSaisir: boolean; estAdmin: boolean; onImporte: () => void;
}) {
  const [type, setType] = useState<TypeDossier>('permis');
  const [recherche, setRecherche] = useState('');
  const [vue, setVue] = useState<Vue>(null);
  const [importOuvert, setImportOuvert] = useState(false);
  const [erreur, setErreur] = useState('');
  const config = TYPES_DOSSIER[type];

  const filtres = useMemo(() => {
    const q = sansAccent(recherche.trim());
    return dossiers
      .filter(d => d.type === type && (q === '' || sansAccent(`${d.nom} ${d.prenom} ${d.nom}`).includes(q)))
      .sort((a, b) => `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, 'fr', { sensitivity: 'base' }));
  }, [dossiers, type, recherche]);

  const choisi = vue?.mode === 'lecture' ? dossiers.find(d => d.id === vue.id) : undefined;
  const idActif = vue?.mode === 'lecture' ? vue.id : vue?.mode === 'saisie' ? vue.form.id : undefined;

  async function supprimer(d: { id: string; prenom: string; nom: string }) {
    const resultat = await supprimerPij('dossiers', d.id, `le dossier de ${d.prenom} ${d.nom}`);
    if (resultat === undefined) return;
    if (resultat) { setErreur(resultat); return; }
    setDossiers(l => l.filter(x => x.id !== d.id));
    setVue(null);
  }

  const types = (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Type de dossier">
      {TYPES_DOSSIER_AFFICHES.map(t => {
        const actif = t === type;
        const nb = dossiers.filter(d => d.type === t).length;
        return (
          <button
            key={t}
            role="tab"
            aria-selected={actif}
            onClick={() => { setType(t); setVue(null); }}
            className={`px-3 py-1.5 rounded-full border text-sm font-medium transition-colors ${actif ? 'bg-[#1B3870] border-[#1B3870] text-white' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            <span aria-hidden="true" className="mr-1">{ICONES[t]}</span>{TYPES_DOSSIER[t].label}
            <span className={`ml-1.5 text-xs tabular-nums ${actif ? 'text-white/70' : 'text-gray-400'}`}>{nb}</span>
          </button>
        );
      })}
    </div>
  );

  const barre = (
    <BarreOutils
      actions={<>
        {estAdmin && type === 'permis' && <button onClick={() => setImportOuvert(true)} className={BTN_SECONDAIRE}>Importer du tableur</button>}
        {peutSaisir && <button onClick={() => setVue({ mode: 'saisie', form: formDossier(type) })} className={BTN_PRIMAIRE}>+ {config.nouveau}</button>}
      </>}
    >
      {types}
    </BarreOutils>
  );

  const liste = (
    <ListeNoms
      lignes={filtres.map(d => {
        const restantes = d.type === 'permis' ? heuresRestantes(d) : null;
        return {
          id: d.id, nom: d.nom, prenom: d.prenom,
          detail: restantes !== null ? (restantes <= 0 ? 'terminé' : `${nombreFr(restantes)} h`) : d.dateRef ? dateFr(d.dateRef).slice(0, 5) : undefined,
        };
      })}
      idActif={idActif}
      onChoisir={id => setVue({ mode: 'lecture', id })}
      recherche={recherche}
      onRecherche={setRecherche}
      parLettre
      compte={`${filtres.length} dossier${filtres.length > 1 ? 's' : ''} « ${config.label} »`}
      vide={recherche.trim() ? 'Aucun dossier ne correspond.' : `Aucun dossier « ${config.label} » pour cette année.`}
    />
  );

  const panneau = vue?.mode === 'saisie' ? (
    <SaisieDossier
      key={vue.form.id ?? `nouveau-${vue.form.type}`}
      initial={vue.form}
      onAnnuler={() => setVue(vue.form.id ? { mode: 'lecture', id: vue.form.id } : null)}
      onEnregistre={d => {
        setDossiers(l => (l.some(x => x.id === d.id) ? l.map(x => (x.id === d.id ? d : x)) : [d, ...l]));
        setVue({ mode: 'lecture', id: d.id });
      }}
      onSupprimer={vue.form.id ? () => supprimer({ id: vue.form.id as string, prenom: vue.form.prenom, nom: vue.form.nom }) : undefined}
    />
  ) : choisi ? (
    <Panneau
      titre={`${choisi.prenom} ${choisi.nom}`}
      sousTitre={TYPES_DOSSIER[choisi.type].label}
      enTete={<span aria-hidden="true" className="w-11 h-11 shrink-0 rounded-full bg-[#6B1A6E]/10 text-xl flex items-center justify-center">{ICONES[choisi.type]}</span>}
      onFermer={() => setVue(null)}
      pied={peutSaisir ? (
        <div className="flex items-center gap-2">
          <button onClick={() => supprimer(choisi)} className={BTN_DANGER}>Supprimer</button>
          <button onClick={() => setVue({ mode: 'saisie', form: formDossier(choisi.type, choisi) })} className={`${BTN_PRIMAIRE} ml-auto`}>Modifier</button>
        </div>
      ) : undefined}
    >
      {choisi.type === 'permis' && <div className="max-w-md"><Heures dossier={choisi} /></div>}
      {choisi.type === 'permis' && (
        <PijMissions
          key={choisi.id}
          dossierId={choisi.id}
          peutSaisir={peutSaisir}
          onTotal={heuresRealisees => setDossiers(l => l.map(d => (d.id === choisi.id ? { ...d, heuresRealisees } : d)))}
        />
      )}
      <Section titre="Dossier">
        <dl className="grid grid-cols-1 2xl:grid-cols-2 gap-x-10 gap-y-2">
          {TYPES_DOSSIER[choisi.type].colonnes
            .filter(col => col.champ !== 'nom' && col.champ !== 'prenom' && !col.journal)
            .map(col => <Info key={col.champ} label={col.label}>{valeur(choisi, col)}</Info>)}
        </dl>
      </Section>
    </Panneau>
  ) : (
    <PanneauVide icone={ICONES[type]} titre="Aucun dossier ouvert" texte="Choisissez un dossier dans la liste pour l’afficher." />
  );

  return (
    <>
      {barre}
      {erreur && <p role="alert" className="mb-3 px-4 py-2.5 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700">{erreur}</p>}
      <ListeEtPanneau liste={liste} panneau={panneau} />
      {importOuvert && <PijImport feuille="permis" onFermer={() => setImportOuvert(false)} onImporte={onImporte} />}
    </>
  );
}

function SaisieDossier({ initial, onAnnuler, onEnregistre, onSupprimer }: {
  initial: FormDossier; onAnnuler: () => void; onEnregistre: (d: DossierPij) => void; onSupprimer?: () => void;
}) {
  const [f, setF] = useState(initial);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState('');
  const config = TYPES_DOSSIER[f.type];
  const maj = (champ: ChampDossier, v: string) => setF(p => ({ ...p, [champ]: v }));

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setEnCours(true);
    setErreur('');
    const res = await enregistrerPij<DossierPij>('dossiers', 'dossier', f);
    setEnCours(false);
    if (res.ok) onEnregistre(res.valeur);
    else setErreur(res.erreur);
  }

  function controle(col: ColonneDossier) {
    const commun = { value: f[col.champ], className: INPUT };
    const surChange = (e: { target: { value: string } }) => maj(col.champ, e.target.value);
    switch (col.saisie) {
      case 'long': return <textarea rows={2} {...commun} onChange={surChange} />;
      case 'date': return <input type="date" {...commun} onChange={surChange} />;
      case 'nombre': return <input type="number" min={0} step="any" inputMode="decimal" {...commun} onChange={surChange} />;
      case 'liste': return (
        <select {...commun} onChange={surChange}>
          <option value="">—</option>
          {/* Valeur enregistrée hors liste : conservée telle quelle. */}
          {[...new Set([...(col.options ?? []), ...(f[col.champ] ? [f[col.champ]] : [])])].map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
      case 'suggestions': return (
        <>
          <input list={`pij-${col.champ}`} {...commun} onChange={surChange} />
          <datalist id={`pij-${col.champ}`}>{(col.options ?? []).map(o => <option key={o} value={o} />)}</datalist>
        </>
      );
      default: return <input type={col.champ === 'telephone' ? 'tel' : 'text'} {...commun} onChange={surChange} />;
    }
  }


  return (
    <Panneau
      titre={f.id ? `Modifier — ${initial.prenom} ${initial.nom}` : config.nouveau}
      sousTitre={config.label}
      onFermer={onAnnuler}
      onSubmit={soumettre}
      pied={<PiedSaisie erreur={erreur} enCours={enCours} onAnnuler={onAnnuler} onSupprimer={onSupprimer} />}
    >
      {f.type === 'permis' && (
        <p className="text-sm text-gray-500">Les missions et les heures réalisées s’ajoutent depuis la fiche du dossier, rubrique « Missions réalisées ».</p>
      )}
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
        {config.colonnes.filter(col => !col.journal).map(col => (
          <div key={col.champ} className={col.saisie === 'long' ? 'col-span-full' : ''}>
            {col.saisie === 'suggestions' ? (
              // Deux éléments (champ + liste) : Field ne peut en cloner qu'un.
              <label className="block text-xs font-semibold text-gray-600">
                <span className="block mb-1.5">{col.label}</span>
                {controle(col)}
              </label>
            ) : (
              <Field
                label={col.champ === 'nom' || col.champ === 'prenom' ? `${col.label} *` : col.label}
              >
                {controle(col)}
              </Field>
            )}
          </div>
        ))}
      </div>
    </Panneau>
  );
}
