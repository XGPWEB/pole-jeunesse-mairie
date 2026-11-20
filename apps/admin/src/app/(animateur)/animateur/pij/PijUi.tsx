'use client';
import { useEffect, useMemo, useRef, type FormEvent, type ReactNode } from 'react';

/** Éléments d'interface partagés par les écrans du module PIJ. */

export const INPUT = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#6B1A6E] focus:ring-2 focus:ring-[#6B1A6E]/15 disabled:bg-gray-50 disabled:text-gray-600';
/** Même champ, mais à la largeur de son contenu (filtres d'une barre d'outils). */
export const INPUT_COMPACT = INPUT.replace('w-full', 'w-auto');
export const BTN_PRIMAIRE = 'inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#6B1A6E] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40';
export const BTN_SECONDAIRE = 'inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50 disabled:opacity-40';
export const BTN_DANGER = 'px-3 py-2 rounded-lg text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40';

/** Nombre à la française : 12,5 et non 12.5. */
export const nombreFr = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
export const dateFr = (d: string | null | undefined) => (d ? d.split('-').reverse().join('/') : '—');
export const sansAccent = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const initiales = (prenom: string, nom: string) => `${prenom.trim().charAt(0)}${nom.trim().charAt(0)}`.toUpperCase();

/** Fenêtre modale : réservée aux actions rares (import, lien Outlook). */
export function Fenetre({ titre, onFermer, children }: { titre: string; onFermer: () => void; children: ReactNode }) {
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => { if (e.key === 'Escape') onFermer(); };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, [onFermer]);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-6" role="dialog" aria-modal="true" aria-label={titre}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">{titre}</h2>
          <button onClick={onFermer} aria-label="Fermer la fenêtre" className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Hauteur commune de la liste et de la fiche : ce qui reste sous les onglets
 * et la barre d'outils. Chacune défile dans son cadre, la page ne bouge pas.
 */
const HAUTEUR_CADRE = 'lg:h-[calc(100vh-19.5rem)] lg:min-h-[26rem]';

/**
 * Carnet d'adresses : liste étroite à gauche, fiche en grand à droite.
 */
export function ListeEtPanneau({ liste, panneau }: { liste: ReactNode; panneau: ReactNode }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[19rem_minmax(0,1fr)] gap-5 items-start">
      <div className="min-w-0">{liste}</div>
      <div className="min-w-0">{panneau}</div>
    </div>
  );
}

export interface LigneNom {
  id: string; nom: string; prenom: string;
  /** Petit texte à droite du nom (âge, date, heures restantes…). */
  detail?: string;
  /** Pastille de couleur (classe Tailwind de fond) et sa signification. */
  point?: string; pointTitre?: string;
}

const lettreDe = (nom: string) => {
  const l = sansAccent(nom.trim()).charAt(0).toUpperCase();
  return /[A-Z]/.test(l) ? l : '#';
};

/**
 * Liste dense de personnes : un nom par ligne, recherche au-dessus,
 * défilement propre. Triée par nom (`parLettre`), elle porte des repères par
 * lettre et une barre de lettres pour sauter directement à une initiale.
 */
export function ListeNoms({ lignes, idActif, onChoisir, recherche, onRecherche, parLettre, compte, vide }: {
  lignes: LigneNom[]; idActif?: string; onChoisir: (id: string) => void;
  recherche: string; onRecherche: (v: string) => void; parLettre: boolean; compte: string; vide: string;
}) {
  const cadre = useRef<HTMLUListElement>(null);
  const lettres = useMemo(() => (parLettre ? [...new Set(lignes.map(l => lettreDe(l.nom)))] : []), [lignes, parLettre]);

  function allerA(lettre: string) {
    const repere = cadre.current?.querySelector<HTMLElement>(`[data-lettre="${lettre}"]`);
    if (cadre.current && repere) cadre.current.scrollTop = repere.offsetTop;
  }

  let precedente = '';
  return (
    <div className={`bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col overflow-hidden ${HAUTEUR_CADRE}`}>
      <div className="p-2.5 border-b border-gray-100 space-y-2">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" aria-hidden="true">🔎</span>
          <input type="search" aria-label="Rechercher un jeune" placeholder="Rechercher un jeune" value={recherche} onChange={e => onRecherche(e.target.value)} className={`${INPUT} pl-9`} />
        </div>
        {lettres.length > 1 && (
          <div className="flex flex-wrap gap-0.5" role="group" aria-label="Aller à une lettre">
            {lettres.map(l => (
              <button key={l} onClick={() => allerA(l)} aria-label={`Aller à la lettre ${l}`} className="w-6 h-6 rounded text-[11px] font-bold text-[#6B1A6E] hover:bg-[#6B1A6E] hover:text-white">
                {l}
              </button>
            ))}
          </div>
        )}
        <p className="text-[11px] text-gray-400 px-0.5">{compte}</p>
      </div>
      {lignes.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-gray-400">{vide}</p>
      ) : (
        <ul ref={cadre} className="relative flex-1 min-h-0 overflow-y-auto max-h-96 lg:max-h-none">
          {lignes.flatMap(l => {
            const lettre = parLettre ? lettreDe(l.nom) : '';
            const actif = l.id === idActif;
            const elements: ReactNode[] = [];
            if (parLettre && lettre !== precedente) {
              precedente = lettre;
              elements.push(
                <li key={`lettre-${lettre}`} role="presentation" data-lettre={lettre} className="sticky top-0 z-10 px-3 py-1 bg-gray-50 border-y border-gray-100 text-[11px] font-bold text-gray-500">
                  {lettre}
                </li>,
              );
            }
            elements.push(
              <li key={l.id}>
                <button
                  onClick={() => onChoisir(l.id)}
                  aria-current={actif ? 'true' : undefined}
                  className={`w-full flex items-center gap-2 pl-2.5 pr-3 py-1.5 text-left text-sm border-l-[3px] transition-colors ${actif ? 'border-[#6B1A6E] bg-[#6B1A6E]/10' : 'border-transparent hover:bg-gray-50'}`}
                >
                  <span className="min-w-0 flex-1 truncate text-gray-600">
                    <span className={`text-gray-900 ${actif ? 'font-semibold' : 'font-medium'}`}>{l.nom}</span> {l.prenom}
                  </span>
                  {l.detail && <span className="shrink-0 text-xs text-gray-400 tabular-nums">{l.detail}</span>}
                  {l.point && <span className={`shrink-0 w-2 h-2 rounded-full ${l.point}`} title={l.pointTitre} aria-label={l.pointTitre} role="img" />}
                </button>
              </li>,
            );
            return elements;
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Panneau de fiche : en-tête, corps défilant, pied toujours visible (les
 * boutons d'action ne sortent jamais de l'écran). Avec `onSubmit`, le panneau
 * est un formulaire.
 */
export function Panneau({ titre, sousTitre, enTete, onFermer, onSubmit, pied, children }: {
  titre: string; sousTitre?: ReactNode; enTete?: ReactNode; onFermer?: () => void;
  onSubmit?: (e: FormEvent) => void; pied?: ReactNode; children: ReactNode;
}) {
  const contenu = (
    <>
      <header className="flex items-center gap-4 px-6 py-4 border-b border-gray-100">
        {enTete}
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold text-gray-900 break-words">{titre}</h2>
          {sousTitre && <div className="text-sm text-gray-500 mt-0.5">{sousTitre}</div>}
        </div>
        {onFermer && (
          <button type="button" onClick={onFermer} aria-label="Fermer la fiche" className="text-gray-400 hover:text-gray-700 text-xl leading-none -mt-0.5">×</button>
        )}
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-6">{children}</div>
      {pied && <footer className="px-6 py-3 border-t border-gray-100">{pied}</footer>}
    </>
  );
  const classes = `flex flex-col min-h-0 ${HAUTEUR_CADRE}`;
  return (
    <aside aria-label={titre} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      {onSubmit
        ? <form onSubmit={onSubmit} noValidate className={classes}>{contenu}</form>
        : <div className={classes}>{contenu}</div>}
    </aside>
  );
}

/** Panneau affiché tant qu'aucune fiche n'est choisie. */
export function PanneauVide({ icone, titre, texte, action }: { icone: string; titre: string; texte: string; action?: ReactNode }) {
  return (
    <aside className={`bg-white rounded-xl border border-dashed border-gray-200 px-6 text-center flex flex-col items-center justify-center py-12 ${HAUTEUR_CADRE}`}>
      <div className="text-3xl mb-3" aria-hidden="true">{icone}</div>
      <p className="text-sm font-semibold text-gray-700">{titre}</p>
      <p className="text-sm text-gray-400 mt-1">{texte}</p>
      {action && <div className="mt-4">{action}</div>}
    </aside>
  );
}

/** Pied d'un panneau en saisie : message d'erreur, puis les boutons. */
export function PiedSaisie({ erreur, enCours, onAnnuler, onSupprimer }: {
  erreur: string; enCours: boolean; onAnnuler: () => void; onSupprimer?: () => void;
}) {
  return (
    <div className="space-y-2">
      {erreur && <p role="alert" className="text-sm text-red-600 font-medium">{erreur}</p>}
      <div className="flex items-center gap-2">
        {onSupprimer && <button type="button" onClick={onSupprimer} className={BTN_DANGER}>Supprimer</button>}
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onAnnuler} className={BTN_SECONDAIRE}>Annuler</button>
          <button type="submit" disabled={enCours} className={BTN_PRIMAIRE}>{enCours ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </div>
    </div>
  );
}

export function Section({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2.5">{titre}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** Ligne « libellé : valeur » d'une fiche en lecture ; masquée si vide. */
export function Info({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === '' || children === false) return null;
  return (
    <div className="flex gap-3 text-sm">
      <dt className="w-36 shrink-0 text-gray-500">{label}</dt>
      <dd className="min-w-0 flex-1 text-gray-900 break-words whitespace-pre-line">{children}</dd>
    </div>
  );
}

export function Badge({ children, couleur = 'bg-gray-100 text-gray-700 border-gray-200' }: { children: ReactNode; couleur?: string }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium whitespace-nowrap ${couleur}`}>{children}</span>;
}

/**
 * Choix multiples en pastilles. Ce sont de vraies cases à cocher (clavier,
 * lecteur d'écran), seulement dessinées autrement.
 */
export function Pastilles({ legende, options, valeurs, onChange }: {
  legende: string; options: { id: string; label: string }[]; valeurs: string[]; onChange: (v: string[]) => void;
}) {
  return (
    <fieldset>
      <legend className="block text-xs font-semibold text-gray-600 mb-1.5">{legende}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map(o => {
          const coche = valeurs.includes(o.id);
          return (
            <label
              key={o.id}
              className={`cursor-pointer select-none px-2.5 py-1 rounded-full border text-xs font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#6B1A6E]/40 ${
                coche ? 'bg-[#6B1A6E] border-[#6B1A6E] text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={coche}
                onChange={e => onChange(e.target.checked ? [...valeurs, o.id] : valeurs.filter(v => v !== o.id))}
              />
              {coche && <span aria-hidden="true">✓ </span>}{o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Barre d'outils d'une liste : recherche et filtres à gauche, actions à droite. */
export function BarreOutils({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      {children}
      {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Recherche({ valeur, onChange, label }: { valeur: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="relative w-56">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" aria-hidden="true">🔎</span>
      <input type="search" aria-label={label} placeholder={label} value={valeur} onChange={e => onChange(e.target.value)} className={`${INPUT} pl-9`} />
    </div>
  );
}

/** POST (création) ou PUT (modification) vers /api/pij/<ressource>. */
export async function enregistrerPij<T>(
  ressource: 'accueils' | 'dossiers' | 'rdv', cle: 'accueil' | 'dossier' | 'rdv', corps: { id?: string } & Record<string, unknown>,
): Promise<{ ok: true; valeur: T } | { ok: false; erreur: string }> {
  try {
    const res = await fetch(`/api/pij/${ressource}`, {
      method: corps.id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, erreur: data.error ?? 'Enregistrement impossible.' };
    return { ok: true, valeur: data[cle] as T };
  } catch {
    return { ok: false, erreur: 'Connexion au serveur impossible. Réessayez.' };
  }
}

/** Suppression après confirmation ; rend un message d'erreur, ou null. */
export async function supprimerPij(ressource: 'accueils' | 'dossiers' | 'rdv', id: string, libelle: string): Promise<string | null | undefined> {
  if (!window.confirm(`Supprimer définitivement ${libelle} ?`)) return undefined;
  try {
    const res = await fetch(`/api/pij/${ressource}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data.error ?? 'Suppression impossible.';
  } catch {
    return 'Connexion au serveur impossible. Réessayez.';
  }
}
