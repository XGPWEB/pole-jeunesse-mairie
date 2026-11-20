'use client';

import { useState } from 'react';

export interface FicheAImprimer {
  /** Identifiant DOM de la page de ce jeune (`fiche-0`, `fiche-1`…). */
  ancre: string;
  jeuneId: string;
  nom: string;
  prenom: string;
  /** Vrai si au moins un renseignement médical est saisi. */
  renseignee: boolean;
  /** Vrai si l'édition AGORA « Fiche santé » d'origine est jointe à la fiche du jeune. */
  aFicheAgora: boolean;
}

/**
 * Choix des fiches sanitaires à imprimer. Rien ne part à l'impression sans
 * clic : l'animateur décoche les jeunes dont il a déjà la fiche papier.
 * Les fiches décochées sont masquées à l'écran comme à l'impression.
 */
export default function SelectionFiches({ fiches }: { fiches: FicheAImprimer[] }) {
  const [exclues, setExclues] = useState<Set<string>>(new Set());
  const retenues = fiches.length - exclues.size;

  function basculer(ancre: string) {
    setExclues(prev => {
      const suivant = new Set(prev);
      if (suivant.has(ancre)) suivant.delete(ancre); else suivant.add(ancre);
      return suivant;
    });
  }

  return (
    <div className="no-print selection">
      {/* Les ancres sont générées par la page (`fiche-<index>`), jamais saisies. */}
      <style dangerouslySetInnerHTML={{ __html: [...exclues].map(a => `#${a} { display: none !important; }`).join('\n') }} />
      <div className="selection-tete">
        <div>
          <strong>Fiches sanitaires à imprimer</strong>
          <div className="selection-aide">Décochez les jeunes dont vous avez déjà la fiche.</div>
        </div>
        <div className="selection-actions">
          <button type="button" className="lien" onClick={() => setExclues(new Set())}>Tout cocher</button>
          <button type="button" className="lien" onClick={() => setExclues(new Set(fiches.map(f => f.ancre)))}>Tout décocher</button>
          <button type="button" className="imprimer" disabled={retenues === 0} onClick={() => window.print()}>
            🖨 Imprimer {retenues} fiche{retenues > 1 ? 's' : ''}
          </button>
        </div>
      </div>
      <ul className="selection-liste">
        {fiches.map(f => (
          <li key={f.ancre}>
            <label>
              <input type="checkbox" checked={!exclues.has(f.ancre)} onChange={() => basculer(f.ancre)} />
              <span className="nom">{f.nom.toUpperCase()} {f.prenom}</span>
            </label>
            {!f.renseignee && <span className="vide">aucun renseignement médical saisi</span>}
            {f.aFicheAgora && (
              <a href={`/api/jeunes/fiche-agora?id=${encodeURIComponent(f.jeuneId)}&piece=sante`} target="_blank" rel="noopener noreferrer">
                fiche santé AGORA d’origine
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
