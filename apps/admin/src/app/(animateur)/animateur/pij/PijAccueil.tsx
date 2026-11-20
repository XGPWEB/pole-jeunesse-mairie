'use client';
import { useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import Field from '@/components/Field';
import { todayLocal } from '@/lib/dates';
import {
  COMMUNES_PIJ, ETATS_PIJ, OBJETS_PIJ, ORIENTATIONS_PIJ, QUARTIERS_PIJ, agePij, labelEtat, labelObjet,
  type AccueilPij,
} from '@/lib/pij';
import {
  BTN_DANGER, BTN_PRIMAIRE, BTN_SECONDAIRE, Badge, BarreOutils, INPUT, INPUT_COMPACT, Info, ListeEtPanneau, ListeNoms,
  Panneau, PanneauVide, Pastilles, PiedSaisie, Section, dateFr, enregistrerPij, initiales, sansAccent,
  supprimerPij,
} from './PijUi';
import PijImport from './PijImport';

/**
 * Rubrique « Accueil » : le registre des jeunes reçus. Liste à gauche, fiche
 * du jeune choisi à droite — en lecture, puis en saisie dans le même panneau.
 */

const ETAT_POINTS: Record<string, string> = { en_cours: 'bg-amber-400', finalise: 'bg-green-500', non_finalise: 'bg-red-500' };
const ETAT_COULEURS: Record<string, string> = {
  en_cours: 'bg-amber-50 text-amber-800 border-amber-200',
  finalise: 'bg-green-50 text-green-800 border-green-200',
  non_finalise: 'bg-red-50 text-red-700 border-red-200',
};

interface FormAccueil {
  id?: string;
  dateVisite: string; nom: string; prenom: string; dateNaissance: string; sexe: string;
  adresse: string; codePostal: string; commune: string; quartier: string; email: string; telephone: string;
  objets: string[]; objetPrecision: string; prochainRdv: string; remarques: string;
  orientations: string[]; orientationAutre: string; suivi: string; etat: string;
}

function formVide(): FormAccueil {
  return {
    dateVisite: todayLocal(), nom: '', prenom: '', dateNaissance: '', sexe: '', adresse: '',
    codePostal: '94130', commune: 'Nogent-sur-Marne', quartier: '', email: '', telephone: '',
    objets: [], objetPrecision: '', prochainRdv: '', remarques: '', orientations: [],
    orientationAutre: '', suivi: '', etat: 'en_cours',
  };
}

function formDepuis(a: AccueilPij): FormAccueil {
  const connues = ORIENTATIONS_PIJ as readonly string[];
  return {
    id: a.id, dateVisite: a.dateVisite, nom: a.nom, prenom: a.prenom,
    dateNaissance: a.dateNaissance ?? '', sexe: a.sexe ?? '', adresse: a.adresse ?? '',
    codePostal: a.codePostal ?? '', commune: a.commune ?? '', quartier: a.quartier ?? '',
    email: a.email ?? '', telephone: a.telephone ?? '', objets: a.objets,
    objetPrecision: a.objetPrecision ?? '', prochainRdv: a.prochainRdv ?? '', remarques: a.remarques ?? '',
    orientations: a.orientations.filter(o => connues.includes(o)),
    orientationAutre: a.orientations.filter(o => !connues.includes(o)).join(', '),
    suivi: a.suivi ?? '', etat: a.etat,
  };
}

const libelleObjet = (a: AccueilPij, o: string) => (o === 'autre' && a.objetPrecision ? `Autre (${a.objetPrecision})` : labelObjet(o));

type Vue = { mode: 'lecture'; id: string } | { mode: 'saisie'; form: FormAccueil } | null;

export default function PijAccueil({ accueils, setAccueils, peutSaisir, estAdmin, onImporte }: {
  accueils: AccueilPij[]; setAccueils: Dispatch<SetStateAction<AccueilPij[]>>;
  peutSaisir: boolean; estAdmin: boolean; onImporte: () => void;
}) {
  const aujourdhui = todayLocal();
  const [recherche, setRecherche] = useState('');
  const [etat, setEtat] = useState('');
  const [objet, setObjet] = useState('');
  const [tri, setTri] = useState<'nom' | 'date'>('nom');
  const [vue, setVue] = useState<Vue>(null);
  const [importOuvert, setImportOuvert] = useState(false);
  const [erreur, setErreur] = useState('');

  const filtres = useMemo(() => {
    const q = sansAccent(recherche.trim());
    const gardes = accueils.filter(a =>
      (q === '' || sansAccent(`${a.nom} ${a.prenom} ${a.nom}`).includes(q))
      && (etat === '' || a.etat === etat)
      && (objet === '' || a.objets.includes(objet)));
    return tri === 'nom'
      ? gardes.sort((a, b) => `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, 'fr', { sensitivity: 'base' }))
      : gardes.sort((a, b) => b.dateVisite.localeCompare(a.dateVisite));
  }, [accueils, recherche, etat, objet, tri]);

  const choisi = vue?.mode === 'lecture' ? accueils.find(a => a.id === vue.id) : undefined;
  const idActif = vue?.mode === 'lecture' ? vue.id : vue?.mode === 'saisie' ? vue.form.id : undefined;

  async function supprimer(a: { id: string; prenom: string; nom: string }) {
    const resultat = await supprimerPij('accueils', a.id, `la fiche de ${a.prenom} ${a.nom}`);
    if (resultat === undefined) return;
    if (resultat) { setErreur(resultat); return; }
    setAccueils(l => l.filter(x => x.id !== a.id));
    setVue(null);
  }

  const barre = (
    <BarreOutils
      actions={<>
        {estAdmin && <button onClick={() => setImportOuvert(true)} className={BTN_SECONDAIRE}>Importer du tableur</button>}
        {peutSaisir && <button onClick={() => setVue({ mode: 'saisie', form: formVide() })} className={BTN_PRIMAIRE}>+ Nouvel accueil</button>}
      </>}
    >
      <select aria-label="Trier la liste" value={tri} onChange={e => setTri(e.target.value as 'nom' | 'date')} className={INPUT_COMPACT}>
        <option value="nom">Par nom (A → Z)</option>
        <option value="date">Par dernière visite</option>
      </select>
      <select aria-label="Filtrer par état" value={etat} onChange={e => setEtat(e.target.value)} className={INPUT_COMPACT}>
        <option value="">Tous les états</option>
        {ETATS_PIJ.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
      </select>
      <select aria-label="Filtrer par objet" value={objet} onChange={e => setObjet(e.target.value)} className={`${INPUT_COMPACT} max-w-52`}>
        <option value="">Tous les objets</option>
        {OBJETS_PIJ.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </BarreOutils>
  );

  const liste = (
    <ListeNoms
      lignes={filtres.map(a => {
        const age = agePij(a.dateNaissance, aujourdhui);
        return {
          id: a.id, nom: a.nom, prenom: a.prenom,
          detail: tri === 'date' ? dateFr(a.dateVisite).slice(0, 5) : age === null ? undefined : `${age} ans`,
          point: ETAT_POINTS[a.etat], pointTitre: labelEtat(a.etat),
        };
      })}
      idActif={idActif}
      onChoisir={id => setVue({ mode: 'lecture', id })}
      recherche={recherche}
      onRecherche={setRecherche}
      parLettre={tri === 'nom'}
      compte={`${filtres.length} jeune${filtres.length > 1 ? 's' : ''}${filtres.length !== accueils.length ? ` sur ${accueils.length}` : ''}`}
      vide={accueils.length === 0 ? 'Aucun accueil enregistré pour cette année.' : 'Aucun jeune ne correspond.'}
    />
  );

  const panneau = vue?.mode === 'saisie' ? (
    <SaisieAccueil
      key={vue.form.id ?? 'nouveau'}
      initial={vue.form}
      onAnnuler={() => setVue(vue.form.id ? { mode: 'lecture', id: vue.form.id } : null)}
      onEnregistre={a => {
        setAccueils(l => (l.some(x => x.id === a.id) ? l.map(x => (x.id === a.id ? a : x)) : [a, ...l]));
        setVue({ mode: 'lecture', id: a.id });
      }}
      onSupprimer={vue.form.id ? () => supprimer({ id: vue.form.id as string, prenom: vue.form.prenom, nom: vue.form.nom }) : undefined}
    />
  ) : choisi ? (
    <LectureAccueil
      accueil={choisi}
      peutSaisir={peutSaisir}
      onFermer={() => setVue(null)}
      onModifier={() => setVue({ mode: 'saisie', form: formDepuis(choisi) })}
      onSupprimer={() => supprimer(choisi)}
    />
  ) : (
    <PanneauVide
      icone="👋"
      titre="Aucune fiche ouverte"
      texte="Choisissez un jeune dans la liste pour afficher sa fiche."
    />
  );

  return (
    <>
      {barre}
      {erreur && <p role="alert" className="mb-3 px-4 py-2.5 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700">{erreur}</p>}
      <ListeEtPanneau liste={liste} panneau={panneau} />
      {importOuvert && <PijImport feuille="accueil" onFermer={() => setImportOuvert(false)} onImporte={onImporte} />}
    </>
  );
}

function LectureAccueil({ accueil: a, peutSaisir, onFermer, onModifier, onSupprimer }: {
  accueil: AccueilPij; peutSaisir: boolean; onFermer: () => void; onModifier: () => void; onSupprimer: () => void;
}) {
  const age = agePij(a.dateNaissance, todayLocal());
  const adresse = [a.adresse, [a.codePostal, a.commune].filter(Boolean).join(' ')].filter(Boolean).join('\n');
  return (
    <Panneau
      titre={`${a.prenom} ${a.nom}`}
      sousTitre={[age === null ? null : `${age} ans`, a.sexe === 'F' ? 'Fille' : a.sexe === 'M' ? 'Garçon' : null, `1re visite le ${dateFr(a.dateVisite)}`].filter(Boolean).join(' · ')}
      enTete={
        <span aria-hidden="true" className="w-11 h-11 shrink-0 rounded-full bg-[#6B1A6E] text-white text-sm font-bold flex items-center justify-center">
          {initiales(a.prenom, a.nom)}
        </span>
      }
      onFermer={onFermer}
      pied={peutSaisir ? (
        <div className="flex items-center gap-2">
          <button onClick={onSupprimer} className={BTN_DANGER}>Supprimer</button>
          <button onClick={onModifier} className={`${BTN_PRIMAIRE} ml-auto`}>Modifier</button>
        </div>
      ) : undefined}
    >
      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-x-10 gap-y-6">
        <div className="space-y-6">
          <Section titre="Demande">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge couleur={ETAT_COULEURS[a.etat]}>{labelEtat(a.etat)}</Badge>
              {a.objets.map(o => <Badge key={o} couleur="bg-sky-50 text-sky-700 border-sky-100">{libelleObjet(a, o)}</Badge>)}
            </div>
            <dl className="space-y-2">
              <Info label="Prochain RDV">{a.prochainRdv}</Info>
              <Info label="Remarques">{a.remarques}</Info>
            </dl>
          </Section>

          <Section titre="Orientation et suivi">
            {a.orientations.length > 0
              ? <div className="flex flex-wrap gap-1.5">{a.orientations.map(o => <Badge key={o}>{o}</Badge>)}</div>
              : <p className="text-sm text-gray-400">Aucune orientation renseignée.</p>}
            <dl className="space-y-2"><Info label="Suivi">{a.suivi}</Info></dl>
          </Section>
        </div>

        <Section titre="Coordonnées">
          <dl className="space-y-2">
            <Info label="Téléphone">{a.telephone}</Info>
            <Info label="Mail">{a.email}</Info>
            <Info label="Adresse">{adresse}</Info>
            <Info label="Quartier">{a.quartier}</Info>
            <Info label="Date de naissance">{a.dateNaissance ? dateFr(a.dateNaissance) : null}</Info>
          </dl>
          {!a.telephone && !a.email && !adresse && !a.dateNaissance && <p className="text-sm text-gray-400">Aucune coordonnée renseignée.</p>}
        </Section>
      </div>
    </Panneau>
  );
}

function SaisieAccueil({ initial, onAnnuler, onEnregistre, onSupprimer }: {
  initial: FormAccueil; onAnnuler: () => void; onEnregistre: (a: AccueilPij) => void; onSupprimer?: () => void;
}) {
  const [f, setF] = useState(initial);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState('');
  const maj = <K extends keyof FormAccueil>(k: K, v: FormAccueil[K]) => setF(p => ({ ...p, [k]: v }));
  const age = agePij(f.dateNaissance || null, todayLocal());
  const nogentais = sansAccent(f.commune).replace(/[\s-]+/g, ' ').trim() === 'nogent sur marne';

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setEnCours(true);
    setErreur('');
    const { orientationAutre, ...reste } = f;
    const autres = orientationAutre.split(',').map(s => s.trim()).filter(Boolean);
    const res = await enregistrerPij<AccueilPij>('accueils', 'accueil', {
      ...reste,
      quartier: nogentais ? f.quartier : '',
      objetPrecision: f.objets.includes('autre') ? f.objetPrecision : '',
      orientations: [...f.orientations, ...autres],
    });
    setEnCours(false);
    if (res.ok) onEnregistre(res.valeur);
    else setErreur(res.erreur);
  }

  return (
    <Panneau
      titre={f.id ? `Modifier — ${initial.prenom} ${initial.nom}` : 'Nouvel accueil'}
      sousTitre="Les champs marqués * sont obligatoires."
      onFermer={onAnnuler}
      onSubmit={soumettre}
      pied={<PiedSaisie erreur={erreur} enCours={enCours} onAnnuler={onAnnuler} onSupprimer={onSupprimer} />}
    >
      <Section titre="Le jeune">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <Field label="Nom *"><input value={f.nom} onChange={e => maj('nom', e.target.value)} className={INPUT} /></Field>
          <Field label="Prénom *"><input value={f.prenom} onChange={e => maj('prenom', e.target.value)} className={INPUT} /></Field>
          <Field label="Date de naissance" hint={age === null ? undefined : `${age} ans aujourd’hui`}>
            <input type="date" value={f.dateNaissance} onChange={e => maj('dateNaissance', e.target.value)} className={INPUT} />
          </Field>
          <Field label="Sexe">
            <select value={f.sexe} onChange={e => maj('sexe', e.target.value)} className={INPUT}>
              <option value="">—</option>
              <option value="F">F</option>
              <option value="M">M</option>
            </select>
          </Field>
        </div>
      </Section>

      <Section titre="La demande">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <Field label="Date de la première visite *"><input type="date" value={f.dateVisite} onChange={e => maj('dateVisite', e.target.value)} className={INPUT} /></Field>
          <Field label="État de la demande">
            <select value={f.etat} onChange={e => maj('etat', e.target.value)} className={INPUT}>
              {ETATS_PIJ.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </Field>
        </div>
        <Pastilles legende="Objet de la demande * (plusieurs choix possibles)" options={[...OBJETS_PIJ]} valeurs={f.objets} onChange={v => maj('objets', v)} />
        {f.objets.includes('autre') && (
          <Field label="Précision pour « Autre »"><input value={f.objetPrecision} onChange={e => maj('objetPrecision', e.target.value)} placeholder="Ex. ASSR2" className={INPUT} /></Field>
        )}
        <div className="grid grid-cols-1 xl:grid-cols-[16rem_1fr] gap-3">
          <Field label="Date(s) du prochain RDV"><input value={f.prochainRdv} onChange={e => maj('prochainRdv', e.target.value)} placeholder="Ex. 14/01/2026 à 17h" className={INPUT} /></Field>
          <Field label="Remarques complémentaires"><textarea rows={2} value={f.remarques} onChange={e => maj('remarques', e.target.value)} className={INPUT} /></Field>
        </div>
      </Section>

      <Section titre="Orientation et suivi">
        <Pastilles legende="Orientation (vers qui ?)" options={ORIENTATIONS_PIJ.map(o => ({ id: o, label: o }))} valeurs={f.orientations} onChange={v => maj('orientations', v)} />
        <Field label="Autre orientation" hint="Plusieurs structures : séparez-les par une virgule.">
          <input value={f.orientationAutre} onChange={e => maj('orientationAutre', e.target.value)} className={INPUT} />
        </Field>
        <Field label="Suivi (résultat de la demande, retour après quelques mois)"><textarea rows={3} value={f.suivi} onChange={e => maj('suivi', e.target.value)} className={INPUT} /></Field>
      </Section>

      <Section titre="Coordonnées">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <Field label="Téléphone portable"><input type="tel" value={f.telephone} onChange={e => maj('telephone', e.target.value)} className={INPUT} /></Field>
          <Field label="Mail"><input type="email" value={f.email} onChange={e => maj('email', e.target.value)} className={INPUT} /></Field>
          <div className="col-span-2">
            <Field label="Adresse postale"><input value={f.adresse} onChange={e => maj('adresse', e.target.value)} className={INPUT} /></Field>
          </div>
          <Field label="Code postal"><input value={f.codePostal} onChange={e => maj('codePostal', e.target.value)} className={INPUT} /></Field>
          <Field label="Commune"><input list="pij-communes" value={f.commune} onChange={e => maj('commune', e.target.value)} className={INPUT} /></Field>
          {nogentais && (
            <Field label="Quartier">
              <select value={f.quartier} onChange={e => maj('quartier', e.target.value)} className={INPUT}>
                <option value="">—</option>
                {QUARTIERS_PIJ.map(q => <option key={q} value={q}>{q}</option>)}
              </select>
            </Field>
          )}
        </div>
        <datalist id="pij-communes">{COMMUNES_PIJ.map(c => <option key={c} value={c} />)}</datalist>
      </Section>
    </Panneau>
  );
}
