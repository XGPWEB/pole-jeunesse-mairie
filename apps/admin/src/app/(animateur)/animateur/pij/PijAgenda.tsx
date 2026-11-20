'use client';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Field from '@/components/Field';
import { todayLocal, toLocalDateStr } from '@/lib/dates';
import { OBJETS_PIJ, labelObjet, type AccueilPij } from '@/lib/pij';
import { FIN_JOURNEE_PIJ, LIEU_RDV_DEFAUT, STATUTS_POINTAGE, STATUTS_RDV, heureFinRdv, labelStatutRdv, minutesDe, plageRdv, rdvCommence, type RdvPij } from '@/lib/pij-agenda';
import {
  BTN_DANGER, BTN_PRIMAIRE, BTN_SECONDAIRE, Badge, Fenetre, INPUT, Info, Panneau, PiedSaisie, Section,
  dateFr, enregistrerPij, supprimerPij,
} from './PijUi';

/**
 * Rubrique « Agenda » : calendrier du mois à gauche ; à droite, les prochains
 * rendez-vous, ou la fiche du rendez-vous choisi. `peutSaisir` ne fait que
 * masquer les actions ; le contrôle réel est dans /api/pij/rdv.
 *
 * Les rendez-vous pris dans LE HUB (`hubId`) portent la mention « LE HUB » :
 * on les pointe ici (honoré, absent), on ne les modifie ni ne les supprime.
 */

const STATUT_COULEURS: Record<string, string> = {
  prevu: 'bg-sky-50 text-sky-800 border-sky-200',
  honore: 'bg-green-50 text-green-800 border-green-200',
  absent: 'bg-amber-50 text-amber-800 border-amber-200',
  annule: 'bg-gray-100 text-gray-500 border-gray-200',
};
const BADGE_HUB = 'bg-[#6B1A6E]/10 text-[#6B1A6E] border-[#6B1A6E]/20';
const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

interface FormRdv {
  id?: string;
  date: string; heure: string; heureFin: string; nom: string; prenom: string; telephone: string;
  objet: string; lieu: string; notes: string; statut: string; accueilId: string;
}

const formVide = (date: string): FormRdv => ({
  date, heure: '14:00', heureFin: '14:30', nom: '', prenom: '', telephone: '', objet: '',
  lieu: LIEU_RDV_DEFAUT, notes: '', statut: 'prevu', accueilId: '',
});
const formDepuis = (r: RdvPij): FormRdv => ({
  id: r.id, date: r.date, heure: r.heure, heureFin: heureFinRdv(r.heure, r.dureeMinutes), nom: r.nom, prenom: r.prenom,
  telephone: r.telephone ?? '', objet: r.objet ?? '', lieu: r.lieu ?? '', notes: r.notes ?? '',
  statut: r.statut, accueilId: r.accueilId ?? '',
});

/** Semaines (lundi → dimanche) couvrant un mois. */
function semainesDuMois(annee: number, mois: number): string[][] {
  const jour = new Date(annee, mois, 1);
  jour.setDate(1 - ((jour.getDay() + 6) % 7));
  const semaines: string[][] = [];
  do {
    const semaine: string[] = [];
    for (let i = 0; i < 7; i++) { semaine.push(toLocalDateStr(jour)); jour.setDate(jour.getDate() + 1); }
    semaines.push(semaine);
  } while (jour.getMonth() === mois && jour.getFullYear() === annee);
  return semaines;
}

const jourLong = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

type Vue = { mode: 'lecture'; id: string } | { mode: 'saisie'; form: FormRdv } | null;

export default function PijAgenda({ peutSaisir, accueils }: { peutSaisir: boolean; accueils: AccueilPij[] }) {
  const aujourdhui = todayLocal();
  const [rdvs, setRdvs] = useState<RdvPij[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [decalage, setDecalage] = useState(0);
  const [vue, setVue] = useState<Vue>(null);
  const [lienOuvert, setLienOuvert] = useState(false);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const res = await fetch('/api/pij/rdv');
        if (!res.ok) throw new Error('chargement');
        const data = await res.json();
        if (!annule) setRdvs(data.rdvs ?? []);
      } catch {
        if (!annule) setErreur('Impossible de charger l’agenda. Rechargez la page.');
      } finally {
        if (!annule) setChargement(false);
      }
    })();
    return () => { annule = true; };
  }, []);

  const mois = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + decalage, 1);
  }, [decalage]);
  const semaines = useMemo(() => semainesDuMois(mois.getFullYear(), mois.getMonth()), [mois]);
  const prefixeMois = toLocalDateStr(mois).slice(0, 7);
  const titreMois = mois.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  const parJour = useMemo(() => {
    const m = new Map<string, RdvPij[]>();
    for (const r of rdvs) m.set(r.date, [...(m.get(r.date) ?? []), r]);
    for (const liste of m.values()) liste.sort((a, b) => a.heure.localeCompare(b.heure));
    return m;
  }, [rdvs]);

  /** Prochains rendez-vous prévus, regroupés par jour. */
  const prochains = useMemo(() => {
    const aVenir = rdvs
      .filter(r => r.date >= aujourdhui && r.statut === 'prevu')
      .sort((a, b) => `${a.date} ${a.heure}`.localeCompare(`${b.date} ${b.heure}`))
      .slice(0, 12);
    const groupes: { date: string; rdvs: RdvPij[] }[] = [];
    for (const r of aVenir) {
      const dernier = groupes[groupes.length - 1];
      if (dernier?.date === r.date) dernier.rdvs.push(r);
      else groupes.push({ date: r.date, rdvs: [r] });
    }
    return groupes;
  }, [rdvs, aujourdhui]);

  const choisi = vue?.mode === 'lecture' ? rdvs.find(r => r.id === vue.id) : undefined;
  const idActif = vue?.mode === 'lecture' ? vue.id : vue?.mode === 'saisie' ? vue.form.id : undefined;
  const ouvrir = (r: RdvPij) => setVue({ mode: 'lecture', id: r.id });

  /** Pointage d'un rendez-vous LE HUB : seul le statut change. */
  async function pointer(r: RdvPij, statut: string) {
    setErreur('');
    const res = await enregistrerPij<RdvPij>('rdv', 'rdv', { ...formDepuis(r), statut });
    if (res.ok) setRdvs(l => l.map(x => (x.id === r.id ? res.valeur : x)));
    else setErreur(res.erreur);
  }

  async function supprimer(id: string) {
    const resultat = await supprimerPij('rdv', id, 'ce rendez-vous');
    if (resultat === undefined) return;
    if (resultat) { setErreur(resultat); return; }
    setRdvs(l => l.filter(r => r.id !== id));
    setVue(null);
  }

  if (chargement) return <p className="py-10 text-center text-sm text-gray-400">Chargement…</p>;

  const panneau = vue?.mode === 'saisie' ? (
    <SaisieRdv
      key={vue.form.id ?? `nouveau-${vue.form.date}`}
      initial={vue.form}
      accueils={accueils}
      onAnnuler={() => setVue(vue.form.id ? { mode: 'lecture', id: vue.form.id } : null)}
      onEnregistre={r => {
        setRdvs(l => (l.some(x => x.id === r.id) ? l.map(x => (x.id === r.id ? r : x)) : [...l, r]));
        setVue(null);
      }}
      onSupprimer={vue.form.id ? () => supprimer(vue.form.id as string) : undefined}
    />
  ) : choisi ? (
    <Panneau
      titre={`${choisi.prenom} ${choisi.nom}`}
      sousTitre={<span className="capitalize">{jourLong(choisi.date)} · {plageRdv(choisi)}</span>}
      onFermer={() => setVue(null)}
      pied={peutSaisir && choisi.hubId && choisi.statut === 'annule' ? undefined : peutSaisir && choisi.hubId ? (
        <div className="flex items-center gap-2">
          {STATUTS_RDV.filter(s => s.id !== 'annule' && s.id !== choisi.statut && (!STATUTS_POINTAGE.has(s.id) || rdvCommence(choisi))).map(s => (
            <button key={s.id} onClick={() => pointer(choisi, s.id)} className={s.id === 'honore' ? `${BTN_PRIMAIRE} ml-auto` : BTN_SECONDAIRE}>
              {s.id === 'prevu' ? 'Remettre à « Prévu »' : `Marquer ${s.label.toLowerCase()}`}
            </button>
          ))}
        </div>
      ) : peutSaisir ? (
        <div className="flex items-center gap-2">
          <button onClick={() => supprimer(choisi.id)} className={BTN_DANGER}>Supprimer</button>
          <button onClick={() => setVue({ mode: 'saisie', form: formDepuis(choisi) })} className={`${BTN_PRIMAIRE} ml-auto`}>Modifier</button>
        </div>
      ) : undefined}
    >
      <div className="flex items-center gap-2">
        <Badge couleur={STATUT_COULEURS[choisi.statut]}>{labelStatutRdv(choisi.statut)}</Badge>
        {choisi.hubId && <Badge couleur={BADGE_HUB}>Pris dans LE HUB</Badge>}
      </div>
      {choisi.hubId && (
        <p className="text-xs text-gray-500">
          {choisi.statut === 'annule'
            ? 'Annulé dans LE HUB : ce rendez-vous ne se pointe plus ici.'
            : 'Réservé dans l’appli LE HUB : la date, l’heure et l’annulation se gèrent depuis LE HUB. Le pointage fait ici (honoré, absent) y est reporté.'}
        </p>
      )}
      {choisi.statut !== 'annule' && !rdvCommence(choisi) && (
        <p className="text-xs text-gray-500">Pointage (honoré, absent) possible à partir de {choisi.heure}, le jour du rendez-vous.</p>
      )}
      <Section titre="Rendez-vous">
        <dl className="space-y-2">
          <Info label="Objet">{choisi.objet}</Info>
          <Info label="Lieu">{choisi.lieu}</Info>
          <Info label="Téléphone">{choisi.telephone}</Info>
          <Info label="Notes">{choisi.notes}</Info>
          <Info label="Posé par">{choisi.hubId ? 'LE HUB (appli des jeunes)' : choisi.creePar}</Info>
        </dl>
      </Section>
    </Panneau>
  ) : (
    <Panneau titre="Prochains rendez-vous" sousTitre={prochains.length === 0 ? undefined : 'Cliquez sur un rendez-vous pour l’ouvrir.'}>
      {prochains.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">Aucun rendez-vous à venir.</p>
      ) : prochains.map(groupe => (
        <section key={groupe.date}>
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
            {groupe.date === aujourdhui ? 'Aujourd’hui' : jourLong(groupe.date)}
          </h3>
          <ul className="space-y-1.5">
            {groupe.rdvs.map(r => (
              <li key={r.id}>
                <button onClick={() => ouvrir(r)} className="w-full text-left flex items-start gap-3 px-3 py-2 rounded-lg border border-gray-100 hover:border-[#6B1A6E]/30 hover:bg-[#6B1A6E]/5 transition-colors">
                  <span className="text-sm font-bold text-[#6B1A6E] tabular-nums shrink-0 leading-tight">{r.heure}<span className="block text-xs font-medium text-gray-400">{heureFinRdv(r.heure, r.dureeMinutes)}</span></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-gray-900 truncate">{r.prenom} {r.nom}</span>
                    <span className="block text-xs text-gray-500 truncate">{[r.objet, r.lieu].filter(Boolean).join(' · ') || `${r.dureeMinutes} min`}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Panneau>
  );

  return (
    <div className="space-y-4">
      {erreur && <p role="alert" className="px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700">{erreur}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-lg border border-gray-200 bg-white">
          <button onClick={() => setDecalage(d => d - 1)} aria-label="Mois précédent" className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-l-lg">←</button>
          <h2 className="text-sm font-bold text-gray-900 capitalize w-36 text-center">{titreMois}</h2>
          <button onClick={() => setDecalage(d => d + 1)} aria-label="Mois suivant" className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-r-lg">→</button>
        </div>
        {decalage !== 0 && <button onClick={() => setDecalage(0)} className={BTN_SECONDAIRE}>Aujourd’hui</button>}
        <div className="ml-auto flex gap-2">
          {peutSaisir && <button onClick={() => setLienOuvert(true)} className={BTN_SECONDAIRE}>Connecter à Outlook</button>}
          {peutSaisir && <button onClick={() => setVue({ mode: 'saisie', form: formVide(aujourdhui) })} className={BTN_PRIMAIRE}>+ Nouveau rendez-vous</button>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] gap-5 items-start">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50">
            {JOURS.map(j => <div key={j} className="px-2 py-2 text-[11px] font-bold text-gray-500 uppercase tracking-wide">{j}</div>)}
          </div>
          {semaines.map(semaine => (
            <div key={semaine[0]} className="grid grid-cols-7 border-b border-gray-100 last:border-b-0">
              {semaine.map((jour, index) => {
                const duMois = jour.startsWith(prefixeMois);
                const weekend = index >= 5;
                // Un RDV annulé ne doit plus apparaître dans le calendrier (pas juste rayé).
                const duJour = (parJour.get(jour) ?? []).filter(r => r.statut !== 'annule');
                return (
                  <div key={jour} className={`group min-h-[5.5rem] p-1.5 border-r border-gray-100 last:border-r-0 ${!duMois ? 'bg-gray-50/70' : weekend ? 'bg-gray-50/40' : ''}`}>
                    <div className="flex items-center justify-between mb-1 h-5">
                      <span className={`text-xs tabular-nums ${jour === aujourdhui ? 'font-bold text-white bg-[#6B1A6E] rounded-full w-5 h-5 flex items-center justify-center' : duMois ? 'text-gray-600' : 'text-gray-300'}`}>
                        {Number(jour.slice(8))}
                      </span>
                      {peutSaisir && duMois && (
                        <button
                          onClick={() => setVue({ mode: 'saisie', form: formVide(jour) })}
                          aria-label={`Nouveau rendez-vous le ${dateFr(jour)}`}
                          className="w-5 h-5 rounded text-gray-400 hover:bg-[#6B1A6E] hover:text-white text-sm leading-none opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                        >+</button>
                      )}
                    </div>
                    <div className="space-y-1">
                      {duJour.map(r => (
                        <button
                          key={r.id}
                          onClick={() => ouvrir(r)}
                          title={`${plageRdv(r)} — ${r.prenom} ${r.nom}${r.objet ? ` — ${r.objet}` : ''} (${labelStatutRdv(r.statut)}${r.hubId ? ', pris dans LE HUB' : ''})`}
                          aria-label={`${plageRdv(r)} ${r.prenom} ${r.nom}`}
                          className={`w-full text-left text-[11px] leading-tight px-1.5 py-1 rounded border ${STATUT_COULEURS[r.statut] ?? ''} ${r.id === idActif ? 'ring-2 ring-[#6B1A6E]/50' : ''}`}
                        >
                          <span className="block font-bold tabular-nums">{r.heure}–{heureFinRdv(r.heure, r.dureeMinutes)}</span>
                          {r.hubId && <span className="block font-semibold opacity-70">HUB</span>}
                          <span className="block truncate">{r.prenom} {r.nom.charAt(0)}.</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          <div className="flex flex-wrap gap-3 px-3 py-2 border-t border-gray-100 bg-gray-50/60">
            {STATUTS_RDV.filter(s => s.id !== 'annule').map(s => (
              <span key={s.id} className="flex items-center gap-1.5 text-[11px] text-gray-500">
                <span className={`w-2.5 h-2.5 rounded-sm border ${STATUT_COULEURS[s.id]}`} aria-hidden="true" />{s.label}
              </span>
            ))}
          </div>
        </div>
        <div className="min-w-0 lg:sticky lg:top-6">{panneau}</div>
      </div>

      {lienOuvert && <LienOutlook onFermer={() => setLienOuvert(false)} />}
    </div>
  );
}

function SaisieRdv({ initial, accueils, onAnnuler, onEnregistre, onSupprimer }: {
  initial: FormRdv; accueils: AccueilPij[]; onAnnuler: () => void;
  onEnregistre: (r: RdvPij) => void; onSupprimer?: () => void;
}) {
  const [f, setF] = useState(initial);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState('');
  const maj = <K extends keyof FormRdv>(k: K, v: FormRdv[K]) => setF(p => ({ ...p, [k]: v }));

  const registre = useMemo(
    () => [...accueils].sort((a, b) => `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, 'fr')),
    [accueils],
  );

  /** Déplacer le début garde la durée du créneau (14:00–14:30 → 15:00–15:30). */
  function changerDebut(heure: string) {
    setF(p => {
      const duree = minutesDe(p.heureFin) - minutesDe(p.heure);
      const valide = /^\d{2}:\d{2}$/.test(heure) && /^\d{2}:\d{2}$/.test(p.heure) && /^\d{2}:\d{2}$/.test(p.heureFin) && duree > 0;
      return { ...p, heure, heureFin: valide ? heureFinRdv(heure, duree) : p.heureFin };
    });
  }

  /** Choisir un jeune du registre recopie son identité et son premier objet. */
  function choisirAccueil(id: string) {
    const a = accueils.find(x => x.id === id);
    setF(p => (a
      ? { ...p, accueilId: id, nom: a.nom, prenom: a.prenom, telephone: a.telephone ?? p.telephone, objet: p.objet || (a.objets[0] ? labelObjet(a.objets[0]) : '') }
      : { ...p, accueilId: '' }));
  }

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setEnCours(true);
    setErreur('');
    const res = await enregistrerPij<RdvPij>('rdv', 'rdv', { ...f });
    setEnCours(false);
    if (res.ok) onEnregistre(res.valeur);
    else setErreur(res.erreur);
  }

  return (
    <Panneau
      titre={f.id ? `Modifier — ${initial.prenom} ${initial.nom}` : 'Nouveau rendez-vous'}
      sousTitre="Les champs marqués * sont obligatoires."
      onFermer={onAnnuler}
      onSubmit={soumettre}
      pied={<PiedSaisie erreur={erreur} enCours={enCours} onAnnuler={onAnnuler} onSupprimer={onSupprimer} />}
    >
      <Section titre="Quand">
        <Field label="Date *"><input type="date" value={f.date} onChange={e => maj('date', e.target.value)} className={INPUT} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Heure de début *"><input type="time" value={f.heure} onChange={e => changerDebut(e.target.value)} className={INPUT} /></Field>
          <Field label="Heure de fin *" hint={`Au plus tard ${FIN_JOURNEE_PIJ}.`}><input type="time" max={FIN_JOURNEE_PIJ} value={f.heureFin} onChange={e => maj('heureFin', e.target.value)} className={INPUT} /></Field>
        </div>
      </Section>

      <Section titre="Avec qui">
        <Field label="Jeune du registre d’accueil" hint="Facultatif : recopie son nom, son prénom et son téléphone.">
          <select value={f.accueilId} onChange={e => choisirAccueil(e.target.value)} className={INPUT}>
            <option value="">— Saisie libre —</option>
            {registre.map(a => <option key={a.id} value={a.id}>{a.nom} {a.prenom}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nom *"><input value={f.nom} onChange={e => maj('nom', e.target.value)} className={INPUT} /></Field>
          <Field label="Prénom *"><input value={f.prenom} onChange={e => maj('prenom', e.target.value)} className={INPUT} /></Field>
        </div>
        <Field label="Téléphone portable"><input type="tel" value={f.telephone} onChange={e => maj('telephone', e.target.value)} className={INPUT} /></Field>
      </Section>

      <Section titre="Détails">
        <Field label="Objet du rendez-vous">
          <select value={f.objet} onChange={e => maj('objet', e.target.value)} className={INPUT}>
            <option value="">—</option>
            {/* Valeur enregistrée hors liste : conservée telle quelle. */}
            {[...new Set([...OBJETS_PIJ.map(o => o.label), ...(f.objet ? [f.objet] : [])])].map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Lieu"><input value={f.lieu} onChange={e => maj('lieu', e.target.value)} className={INPUT} /></Field>
          <Field label="Statut">
            <select value={f.statut} onChange={e => maj('statut', e.target.value)} className={INPUT}>
              {/* Honoré / absent : seulement une fois le rendez-vous commencé (contrôlé aussi par le serveur). */}
              {STATUTS_RDV.map(s => {
                const avant = STATUTS_POINTAGE.has(s.id) && /^\d{4}-\d{2}-\d{2}$/.test(f.date) && /^\d{2}:\d{2}$/.test(f.heure) && !rdvCommence({ date: f.date, heure: f.heure });
                return <option key={s.id} value={s.id} disabled={avant}>{s.label}{avant ? ' (après le début)' : ''}</option>;
              })}
            </select>
          </Field>
        </div>
        <Field label="Notes" hint="Visibles ici seulement : elles ne partent pas dans Outlook.">
          <textarea rows={3} value={f.notes} onChange={e => maj('notes', e.target.value)} className={INPUT} />
        </Field>
      </Section>
    </Panneau>
  );
}

function LienOutlook({ onFermer }: { onFermer: () => void }) {
  const [actif, setActif] = useState<boolean | null>(null);
  const [url, setUrl] = useState('');
  const [copie, setCopie] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    fetch('/api/pij/agenda/lien')
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => setActif(!!d.actif))
      .catch(() => setErreur('Impossible de lire l’état du lien.'));
  }, []);

  async function appeler(methode: 'POST' | 'DELETE') {
    setEnCours(true);
    setErreur('');
    setCopie(false);
    try {
      const res = await fetch('/api/pij/agenda/lien', { method: methode });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErreur(data.error ?? 'Opération impossible.'); return; }
      if (methode === 'POST') {
        setUrl(`${window.location.origin}/api/pij/agenda/flux/${data.jeton}.ics`);
        setActif(true);
      } else {
        setUrl('');
        setActif(false);
      }
    } catch {
      setErreur('Connexion au serveur impossible. Réessayez.');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Fenetre titre="Connecter l’agenda PIJ à Outlook" onFermer={onFermer}>
      <div className="px-6 py-5 space-y-4 text-sm text-gray-700">
        <p>
          Un lien d’abonnement personnel affiche les rendez-vous du PIJ dans Outlook, à côté de votre agenda.
          Outlook les relit tout seul, en général toutes les quelques heures ; les rendez-vous se modifient ici, pas dans Outlook.
        </p>
        <p className="px-4 py-3 rounded-xl bg-amber-50 border border-amber-100 text-amber-900">
          Ce lien vaut mot de passe : toute personne qui l’a voit l’agenda. Ne le transmettez pas.
          Outlook n’affiche que le prénom, l’initiale du nom, l’objet et le lieu.
        </p>

        {url ? (
          <div className="space-y-2">
            <Field label="Votre lien d’abonnement" hint="Il ne sera plus affiché après fermeture de cette fenêtre : copiez-le maintenant.">
              <input readOnly value={url} onFocus={e => e.target.select()} className={`${INPUT} font-mono text-xs`} />
            </Field>
            <button
              onClick={async () => {
                try { await navigator.clipboard.writeText(url); setCopie(true); } catch { setErreur('Copie impossible : sélectionnez le lien et copiez-le à la main.'); }
              }}
              className={BTN_SECONDAIRE}
            >{copie ? 'Lien copié ✓' : 'Copier le lien'}</button>
            <ol className="list-decimal pl-5 space-y-1 pt-2">
              <li>Dans Outlook, ouvrez le <strong>Calendrier</strong>, puis « Ajouter un calendrier ».</li>
              <li>Choisissez « S’abonner à partir du web ».</li>
              <li>Collez le lien, nommez le calendrier « RDV PIJ », puis « Importer ».</li>
            </ol>
          </div>
        ) : actif === null ? (
          !erreur && <p className="text-gray-400">Chargement…</p>
        ) : actif ? (
          <p>Un lien est actif pour votre compte. Il ne peut pas être réaffiché : créez-en un nouveau si vous l’avez perdu, l’ancien cessera aussitôt de fonctionner.</p>
        ) : (
          <p>Aucun lien n’est actif pour votre compte.</p>
        )}
      </div>
      <div className="px-6 py-4 border-t border-gray-100 space-y-3">
        {erreur && <p role="alert" className="text-sm text-red-600 font-medium">{erreur}</p>}
        <div className="flex items-center gap-2">
          {actif && (
            <button disabled={enCours} onClick={() => appeler('DELETE')} className={BTN_DANGER}>
              Supprimer le lien
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button onClick={onFermer} className={BTN_SECONDAIRE}>Fermer</button>
            {actif !== null && !url && (
              <button disabled={enCours} onClick={() => appeler('POST')} className={BTN_PRIMAIRE}>{actif ? 'Créer un nouveau lien' : 'Créer le lien'}</button>
            )}
          </div>
        </div>
      </div>
    </Fenetre>
  );
}
