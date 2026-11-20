'use client';

import { useState, useTransition, useRef, useEffect } from 'react';
import { ajouterInscriptionManuelle } from '../actions';

interface Jeune {
  id: string;
  nom: string;
  prenom: string;
  espaceId: string;
}

interface Props {
  activiteId: string;
  activiteTitre: string;
  espaceId: string;
  jeunes: Jeune[];
}

export default function AjoutManuelPanel({ activiteId, activiteTitre, espaceId, jeunes }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Jeune | null>(null);
  const [nomManuel, setNomManuel] = useState('');
  const [prenomManuel, setPrenomManuel] = useState('');
  const [modeManuel, setModeManuel] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query.length >= 2
    ? jeunes.filter(j =>
        `${j.prenom} ${j.nom}`.toLowerCase().includes(query.toLowerCase()) ||
        `${j.nom} ${j.prenom}`.toLowerCase().includes(query.toLowerCase()),
      ).slice(0, 8)
    : [];

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  function reset() {
    setQuery('');
    setSelected(null);
    setNomManuel('');
    setPrenomManuel('');
    setModeManuel(false);
    setMessage(null);
  }

  function handleSubmit() {
    const jeuneId = selected?.id ?? null;
    const nom     = selected ? selected.nom     : nomManuel.trim();
    const prenom  = selected ? selected.prenom  : prenomManuel.trim();
    const espace  = selected ? selected.espaceId : espaceId;

    if (!nom || !prenom) {
      setMessage({ type: 'err', text: 'Nom et prénom obligatoires.' });
      return;
    }

    startTransition(async () => {
      const res = await ajouterInscriptionManuelle(activiteId, activiteTitre, espace, jeuneId, nom, prenom);
      if (res.success) {
        const msg = res.statut === 'liste-attente'
          ? `${prenom} ${nom.toUpperCase()} ajouté(e) en liste d'attente (activité complète).`
          : `${prenom} ${nom.toUpperCase()} inscrit(e) et confirmé(e).`;
        setMessage({ type: 'ok', text: msg });
        reset();
        setTimeout(() => { setMessage(null); setOpen(false); window.location.reload(); }, 2200);
      } else {
        setMessage({ type: 'err', text: res.error ?? 'Erreur inconnue.' });
      }
    });
  }

  return (
    <div className="mt-4">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 text-sm font-semibold text-[#6B1A6E] border border-[#6B1A6E]/30 bg-purple-50 hover:bg-purple-100 rounded-lg px-4 py-2 transition-colors"
        >
          <span>➕</span> Ajouter un jeune manuellement
        </button>
      ) : (
        <div className="border border-[#6B1A6E]/20 rounded-xl bg-purple-50/40 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-[#6B1A6E]">Ajout manuel</h3>
            <button onClick={() => { setOpen(false); reset(); }} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
          </div>

          {/* Tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => { setModeManuel(false); reset(); }}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${!modeManuel ? 'bg-[#6B1A6E] text-white' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'}`}
            >
              Jeune inscrit
            </button>
            <button
              onClick={() => { setModeManuel(true); reset(); }}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${modeManuel ? 'bg-[#6B1A6E] text-white' : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'}`}
            >
              Nom libre
            </button>
          </div>

          {!modeManuel ? (
            /* Recherche dans les jeunes existants */
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={selected ? `${selected.prenom} ${selected.nom.toUpperCase()}` : query}
                onChange={e => { setSelected(null); setQuery(e.target.value); }}
                placeholder="Rechercher un jeune inscrit…"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6B1A6E] bg-white"
              />
              {selected && (
                <button
                  onClick={() => { setSelected(null); setQuery(''); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >✕</button>
              )}
              {!selected && filtered.length > 0 && (
                <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 z-10 overflow-hidden">
                  {filtered.map(j => (
                    <button
                      key={j.id}
                      onClick={() => { setSelected(j); setQuery(''); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-purple-50 flex items-center gap-2 border-b border-gray-50 last:border-0"
                    >
                      <span className="w-6 h-6 rounded-full bg-[#6B1A6E]/10 flex items-center justify-center text-xs font-bold text-[#6B1A6E] shrink-0">
                        {j.prenom[0]}{j.nom[0]}
                      </span>
                      <span className="font-medium">{j.prenom} {j.nom.toUpperCase()}</span>
                      <span className="text-xs text-gray-400 ml-auto">{j.espaceId}</span>
                    </button>
                  ))}
                </div>
              )}
              {!selected && query.length >= 2 && filtered.length === 0 && (
                <div className="mt-1 text-xs text-gray-400 px-1">Aucun résultat — utilisez «&nbsp;Nom libre&nbsp;» pour ajouter quelqu'un de non inscrit.</div>
              )}
            </div>
          ) : (
            /* Saisie libre */
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={prenomManuel}
                onChange={e => setPrenomManuel(e.target.value)}
                placeholder="Prénom"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6B1A6E] bg-white"
              />
              <input
                type="text"
                value={nomManuel}
                onChange={e => setNomManuel(e.target.value)}
                placeholder="Nom"
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6B1A6E] bg-white"
              />
            </div>
          )}

          {/* Message retour */}
          {message && (
            <div className={`text-xs font-semibold px-3 py-2 rounded-lg ${message.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
              {message.type === 'ok' ? '✅ ' : '⚠️ '}{message.text}
            </div>
          )}

          {/* Bouton valider */}
          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={isPending || (!selected && !modeManuel) || (modeManuel && (!nomManuel.trim() || !prenomManuel.trim()))}
              className="flex-1 bg-[#6B1A6E] text-white text-sm font-semibold py-2 rounded-lg hover:bg-[#5a1560] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isPending ? 'Ajout en cours…' : 'Confirmer l\'ajout'}
            </button>
            <button
              onClick={() => { setOpen(false); reset(); }}
              className="border border-gray-200 text-gray-500 text-sm font-semibold px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
