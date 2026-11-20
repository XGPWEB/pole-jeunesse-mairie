'use client';
import { useState } from 'react';
import Field from '@/components/Field';
import { ErreurXlsx, lireXlsx, versTexteTabule } from '@/lib/xlsx-lecture';
import { BTN_PRIMAIRE, BTN_SECONDAIRE, Fenetre, INPUT } from './PijUi';

/**
 * Reprise du tableur PIJ : on choisit le classeur Excel (lu dans le
 * navigateur, il ne part pas au serveur), l'application annonce ce qu'elle va
 * importer, puis n'enregistre qu'après confirmation. Le collage d'une feuille
 * copiée reste possible.
 */

interface BilanImport { importe: boolean; nouveaux: number; doublons: number[]; refus: { ligne: number; motif: string }[] }

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

export default function PijImport({ feuille, onFermer, onImporte }: {
  feuille: 'accueil' | 'permis'; onFermer: () => void; onImporte: () => void;
}) {
  const [texte, setTexte] = useState('');
  const [source, setSource] = useState('');
  const [collage, setCollage] = useState(false);
  const [bilan, setBilan] = useState<BilanImport | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState('');
  const nomFeuille = feuille === 'accueil' ? 'Accueil' : 'Permis de conduire';

  async function envoyer(contenu: string, confirmer: boolean) {
    setEnCours(true);
    setErreur('');
    try {
      const res = await fetch('/api/pij/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feuille, texte: contenu, confirmer }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErreur(data.error ?? 'Import impossible.'); setBilan(null); }
      else { setBilan(data); if (data.importe) onImporte(); }
    } catch {
      setErreur('Connexion au serveur impossible. Réessayez.');
    } finally {
      setEnCours(false);
    }
  }

  /** Classeur Excel : on en extrait la bonne feuille ; autre fichier : lu comme du texte (CSV). */
  async function choisirFichier(fichier: File) {
    setBilan(null);
    setErreur('');
    setSource('');
    try {
      let contenu: string;
      if (/\.xlsx$/i.test(fichier.name)) {
        const feuilles = await lireXlsx(await fichier.arrayBuffer());
        const trouvee = feuilles.find(f => f.nom.toLowerCase().includes(feuille === 'accueil' ? 'accueil' : 'permis'));
        if (!trouvee) {
          setErreur(`Ce classeur n’a pas de feuille « ${nomFeuille} ». Feuilles trouvées : ${feuilles.map(f => f.nom).join(', ')}.`);
          return;
        }
        contenu = versTexteTabule(trouvee.lignes);
        setSource(`${fichier.name} — feuille « ${trouvee.nom} »`);
      } else if (/\.xls$/i.test(fichier.name)) {
        setErreur('Ancien format Excel (.xls) : ouvrez le fichier dans Excel et enregistrez-le en « Classeur Excel (.xlsx) ».');
        return;
      } else {
        contenu = await fichier.text();
        setSource(fichier.name);
      }
      setTexte(contenu);
      await envoyer(contenu, false);
    } catch (e) {
      setErreur(e instanceof ErreurXlsx ? e.message : 'Fichier illisible. Vérifiez qu’il s’agit bien du classeur Excel du PIJ.');
    }
  }

  return (
    <Fenetre titre={`Importer la feuille « ${nomFeuille} »`} onFermer={onFermer}>
      <div className="px-6 py-5 space-y-4">
        {!bilan?.importe && (
          <>
            <label className="block rounded-xl border-2 border-dashed border-gray-200 hover:border-[#6B1A6E]/50 hover:bg-[#6B1A6E]/5 transition-colors px-6 py-8 text-center cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#6B1A6E]/40">
              <span className="block text-3xl mb-2" aria-hidden="true">📄</span>
              <span className="block text-sm font-semibold text-gray-800">Choisir le fichier Excel du PIJ</span>
              <span className="block text-xs text-gray-500 mt-1">
                Fichier .xlsx : la feuille « {nomFeuille} » est lue automatiquement. Rien n’est enregistré avant votre confirmation.
              </span>
              <input
                type="file"
                accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
                aria-label="Fichier Excel du PIJ"
                className="sr-only"
                onChange={e => {
                  const fichier = e.target.files?.[0];
                  e.target.value = '';
                  if (fichier) void choisirFichier(fichier);
                }}
              />
            </label>
            {source && <p className="text-xs text-gray-500">Fichier lu : {source}</p>}

            {collage ? (
              <Field label="Ou collez la feuille copiée depuis Excel" hint="Sélectionnez toutes les cellules, ligne des titres comprise, copiez, puis collez ici.">
                <textarea
                  rows={6}
                  value={texte}
                  onChange={e => { setTexte(e.target.value); setBilan(null); setSource(''); }}
                  className={`${INPUT} font-mono text-xs whitespace-pre`}
                />
              </Field>
            ) : (
              <button type="button" onClick={() => setCollage(true)} className="text-xs font-semibold text-[#6B1A6E] hover:underline">
                Coller la feuille à la place
              </button>
            )}
          </>
        )}

        {enCours && !bilan && <p className="text-sm text-gray-400">Lecture en cours…</p>}

        {bilan && (
          <div className={`rounded-xl border px-4 py-3 text-sm space-y-2 ${bilan.importe ? 'border-green-200 bg-green-50 text-green-900' : 'border-gray-100 bg-gray-50 text-gray-700'}`} role="status">
            <p className="font-semibold">
              {bilan.importe
                ? `✓ ${pluriel(bilan.nouveaux, 'fiche')} importée${bilan.nouveaux > 1 ? 's' : ''}.`
                : `${pluriel(bilan.nouveaux, 'fiche')} à importer.`}
            </p>
            {bilan.doublons.length > 0 && (
              <p>{bilan.doublons.length} déjà présente{bilan.doublons.length > 1 ? 's' : ''}, ignorée{bilan.doublons.length > 1 ? 's' : ''} (ligne{bilan.doublons.length > 1 ? 's' : ''} {bilan.doublons.join(', ')} du tableur).</p>
            )}
            {bilan.refus.length > 0 && (
              <div>
                <p className="text-red-700 font-semibold">{pluriel(bilan.refus.length, 'ligne')} refusée{bilan.refus.length > 1 ? 's' : ''} — à corriger dans le tableur ou à saisir à la main :</p>
                <ul className="list-disc pl-5 text-red-700">
                  {bilan.refus.map(r => <li key={r.ligne}>Ligne {r.ligne} : {r.motif}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="px-6 py-4 border-t border-gray-100 space-y-3">
        {erreur && <p role="alert" className="text-sm text-red-600 font-medium">{erreur}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onFermer} className={BTN_SECONDAIRE}>{bilan?.importe ? 'Fermer' : 'Annuler'}</button>
          {!bilan?.importe && (
            bilan && bilan.nouveaux > 0
              ? <button type="button" disabled={enCours} onClick={() => envoyer(texte, true)} className={BTN_PRIMAIRE}>Importer {pluriel(bilan.nouveaux, 'fiche')}</button>
              : collage && <button type="button" disabled={enCours || texte.trim() === ''} onClick={() => envoyer(texte, false)} className={BTN_PRIMAIRE}>Vérifier</button>
          )}
        </div>
      </div>
    </Fenetre>
  );
}
