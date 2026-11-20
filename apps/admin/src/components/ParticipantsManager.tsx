'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface Jeune {
  id: string;
  nom: string;
  prenom: string;
  espaceId: string;
}

interface Participant {
  jeuneId: string;
  jeuneNom: string;
  jeunePrenom: string;
  espaceId: string;
  statut: 'confirmee' | 'liste-attente' | 'en-attente';
  inscriptionId?: string;
}

interface Props {
  /** 'activite' utilise /api/inscriptions, 'sortie' utilise /api/sorties/participants */
  mode: 'activite' | 'sortie';
  entityId: string;
  entityTitre: string;
  espaceId: string;
  placesTotal: number;
  /** Liste complète des jeunes pour la recherche */
  jeunes: Jeune[];
  /** Participants initiaux (confirmés + attente) */
  initialParticipants: Participant[];
}

const ESPACE_COLORS: Record<string, string> = {
  collegiens: '#1B3870',
  lyceens: '#6B1A6E',
  pij: '#29B5E8',
  clas: '#8DC63F',
};

export default function ParticipantsManager({
  mode,
  entityId,
  entityTitre,
  espaceId,
  placesTotal,
  jeunes,
  initialParticipants,
}: Props) {
  const [participants, setParticipants] = useState<Participant[]>(initialParticipants);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null); // jeuneId en cours d'ajout/retrait
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const confirmes = participants.filter(p => p.statut === 'confirmee');
  const attente = participants.filter(p => p.statut === 'liste-attente' || p.statut === 'en-attente');
  const nbConfirmes = confirmes.length;
  const pct = placesTotal > 0 ? Math.min(100, Math.round((nbConfirmes / placesTotal) * 100)) : 0;
  const barColor = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-400' : 'bg-emerald-500';

  // IDs déjà inscrits
  const registeredIds = new Set(participants.map(p => p.jeuneId));

  // Recherche filtrée
  const filtered = query.length >= 2
    ? jeunes
        .filter(j => !registeredIds.has(j.id))
        .filter(j =>
          `${j.prenom} ${j.nom}`.toLowerCase().includes(query.toLowerCase()) ||
          `${j.nom} ${j.prenom}`.toLowerCase().includes(query.toLowerCase())
        )
        .slice(0, 8)
    : [];

  // Fermer dropdown au clic extérieur
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const showFeedback = useCallback((type: 'ok' | 'err', text: string) => {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 3000);
  }, []);

  // ── AJOUTER ──
  async function handleAdd(jeune: Jeune) {
    setBusy(jeune.id);
    setQuery('');
    setDropdownOpen(false);

    try {
      if (mode === 'activite') {
        const res = await fetch('/api/inscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            activiteId: entityId,
            activiteTitre: entityTitre,
            espaceId: jeune.espaceId || espaceId,
            jeuneId: jeune.id,
            jeuneNom: jeune.nom,
            jeunePrenom: jeune.prenom,
          }),
        });
        const data = await res.json();
        if (data.success) {
          const ins = data.inscription;
          const statut = ins?.statut === 'en-attente' ? 'en-attente'
            : ins?.statut === 'liste-attente' ? 'liste-attente'
            : 'confirmee';
          if (!data.alreadyExists) {
            setParticipants(prev => [...prev, {
              jeuneId: jeune.id,
              jeuneNom: jeune.nom,
              jeunePrenom: jeune.prenom,
              espaceId: jeune.espaceId,
              statut,
              inscriptionId: ins?.id,
            }]);
          }
          const label = data.alreadyExists
            ? `${jeune.prenom} ${jeune.nom.toUpperCase()} est déjà inscrit(e)`
            : statut === 'confirmee'
              ? `${jeune.prenom} ${jeune.nom.toUpperCase()} inscrit(e) et confirmé(e)`
              : `${jeune.prenom} ${jeune.nom.toUpperCase()} ajouté(e) en liste d'attente`;
          showFeedback(data.alreadyExists ? 'err' : 'ok', label);
        } else {
          showFeedback('err', data.error || 'Erreur');
        }
      } else {
        // mode sortie
        const res = await fetch('/api/sorties/participants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sortieId: entityId, jeuneId: jeune.id }),
        });
        const data = await res.json();
        if (data.success) {
          const statut = data.statut === 'liste-attente' ? 'liste-attente' : 'confirmee';
          setParticipants(prev => [...prev, {
            jeuneId: jeune.id,
            jeuneNom: jeune.nom,
            jeunePrenom: jeune.prenom,
            espaceId: jeune.espaceId,
            statut,
          }]);
          const label = statut === 'confirmee'
            ? `${jeune.prenom} ${jeune.nom.toUpperCase()} inscrit(e) et confirmé(e)`
            : `${jeune.prenom} ${jeune.nom.toUpperCase()} ajouté(e) en liste d'attente`;
          showFeedback('ok', label);
        } else {
          showFeedback('err', data.error || 'Erreur');
        }
      }
    } catch {
      showFeedback('err', 'Erreur de connexion');
    } finally {
      setBusy(null);
      inputRef.current?.focus();
    }
  }

  // ── RETIRER ──
  async function handleRemove(p: Participant) {
    if (!confirm(`Retirer ${p.jeunePrenom} ${p.jeuneNom.toUpperCase()} ?`)) return;
    setBusy(p.jeuneId);

    try {
      if (mode === 'activite') {
        const res = await fetch(`/api/inscriptions?jeuneId=${p.jeuneId}&activiteId=${entityId}`, {
          method: 'DELETE',
        });
        const data = await res.json();
        if (data.success) {
          // Recharger les participants depuis le serveur pour avoir l'auto-promotion
          await reloadParticipants();
          showFeedback('ok', `${p.jeunePrenom} ${p.jeuneNom.toUpperCase()} retiré(e)`);
        } else {
          showFeedback('err', data.error || 'Erreur');
        }
      } else {
        const res = await fetch('/api/sorties/participants', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sortieId: entityId, jeuneId: p.jeuneId }),
        });
        const data = await res.json();
        if (data.success) {
          // Reconstruire depuis les tableaux retournés
          rebuildFromArrays(data.participants, data.participantsAttente);
          showFeedback('ok', `${p.jeunePrenom} ${p.jeuneNom.toUpperCase()} retiré(e)`);
        } else {
          showFeedback('err', data.error || 'Erreur');
        }
      }
    } catch {
      showFeedback('err', 'Erreur de connexion');
    } finally {
      setBusy(null);
    }
  }

  async function reloadParticipants() {
    try {
      const res = await fetch(`/api/inscriptions?activiteId=${entityId}`);
      const data = await res.json();
      const list: Participant[] = (Array.isArray(data) ? data : [])
        .filter((i: any) => i.statut !== 'annulee' && i.statut !== 'refusee')
        .map((i: any) => ({
          jeuneId: i.jeuneId,
          jeuneNom: i.jeuneNom,
          jeunePrenom: i.jeunePrenom,
          espaceId: i.espaceId,
          statut: i.statut,
          inscriptionId: i.id,
        }));
      setParticipants(list);
    } catch {}
  }

  function rebuildFromArrays(confirmed: string[], waitlist: string[]) {
    const jeunesMap = new Map(jeunes.map(j => [j.id, j]));
    const newParts: Participant[] = [];
    for (const id of confirmed) {
      const j = jeunesMap.get(id);
      if (j) newParts.push({ jeuneId: id, jeuneNom: j.nom, jeunePrenom: j.prenom, espaceId: j.espaceId, statut: 'confirmee' });
    }
    for (const id of waitlist) {
      const j = jeunesMap.get(id);
      if (j) newParts.push({ jeuneId: id, jeuneNom: j.nom, jeunePrenom: j.prenom, espaceId: j.espaceId, statut: 'liste-attente' });
    }
    setParticipants(newParts);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
      {/* ── En-tête + jauge ── */}
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-extrabold text-gray-400 uppercase tracking-widest">
            Participants
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-gray-800">
              {nbConfirmes}{placesTotal > 0 ? ` / ${placesTotal}` : ''} confirmé{nbConfirmes > 1 ? 's' : ''}
            </span>
            {attente.length > 0 && (
              <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                {attente.length} en attente
              </span>
            )}
          </div>
        </div>

        {/* Jauge de remplissage */}
        {placesTotal > 0 && (
          <div className="space-y-1">
            <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">{pct}% rempli</span>
              <span className={`font-semibold ${placesTotal - nbConfirmes <= 0 ? 'text-red-500' : 'text-gray-500'}`}>
                {Math.max(0, placesTotal - nbConfirmes)} place{placesTotal - nbConfirmes > 1 ? 's' : ''} restante{placesTotal - nbConfirmes > 1 ? 's' : ''}
              </span>
            </div>
          </div>
        )}

        {placesTotal > 0 && nbConfirmes >= placesTotal && (
          <p className="text-xs text-red-500 font-semibold mt-2">
            Capacité atteinte — les nouveaux participants seront placés en liste d'attente
          </p>
        )}
      </div>

      {/* ── Recherche rapide ── */}
      <div className="p-5 border-b border-gray-100" ref={containerRef}>
        <div className="relative">
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-lg">🔍</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setDropdownOpen(true); }}
              onFocus={() => query.length >= 2 && setDropdownOpen(true)}
              placeholder="Rechercher un jeune pour l'ajouter..."
              className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30 focus:border-[#6B1A6E]"
            />
          </div>

          {/* Dropdown résultats */}
          {dropdownOpen && filtered.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-20 overflow-hidden">
              {filtered.map(j => {
                const color = ESPACE_COLORS[j.espaceId] || '#6b7280';
                const isBusy = busy === j.id;
                return (
                  <button
                    key={j.id}
                    onClick={() => handleAdd(j)}
                    disabled={isBusy}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0 disabled:opacity-50"
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                      style={{ backgroundColor: color }}
                    >
                      {j.prenom[0]}{j.nom[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-gray-800">{j.prenom} {j.nom.toUpperCase()}</span>
                    </div>
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white shrink-0"
                      style={{ backgroundColor: color }}
                    >
                      {j.espaceId}
                    </span>
                    <span className="text-xs text-emerald-600 font-semibold shrink-0">
                      {isBusy ? '...' : '+ Ajouter'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {dropdownOpen && query.length >= 2 && filtered.length === 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 p-4 text-center">
              <p className="text-sm text-gray-400">Aucun jeune trouvé pour "{query}"</p>
            </div>
          )}
        </div>

        {/* Feedback */}
        {feedback && (
          <div className={`mt-3 text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-2 ${
            feedback.type === 'ok'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-600 border border-red-200'
          }`}>
            {feedback.type === 'ok' ? '✅' : '⚠️'} {feedback.text}
          </div>
        )}
      </div>

      {/* ── Liste des confirmés ── */}
      <div className="p-5">
        {confirmes.length === 0 && attente.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            Aucun participant inscrit — utilisez la recherche ci-dessus pour ajouter des jeunes
          </div>
        ) : (
          <div className="space-y-4">
            {/* Confirmés */}
            {confirmes.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-emerald-700 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Confirmés ({confirmes.length})
                </h3>
                <div className="space-y-1">
                  {confirmes.map(p => {
                    const color = ESPACE_COLORS[p.espaceId] || '#6b7280';
                    const isBusy = busy === p.jeuneId;
                    return (
                      <div
                        key={p.jeuneId}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors group"
                      >
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                          style={{ backgroundColor: color }}
                        >
                          {(p.jeunePrenom?.[0] ?? '?')}{(p.jeuneNom?.[0] ?? '')}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-gray-800">
                            {p.jeunePrenom} {p.jeuneNom?.toUpperCase()}
                          </span>
                        </div>
                        <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                          Confirmé
                        </span>
                        <button
                          onClick={() => handleRemove(p)}
                          disabled={isBusy}
                          className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-all text-sm disabled:opacity-30"
                          title="Retirer"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Liste d'attente */}
            {attente.length > 0 && (
              <div className="mt-3 bg-amber-50 rounded-xl border border-amber-200 p-4">
                <h3 className="text-xs font-bold text-amber-700 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  Liste d'attente ({attente.length})
                </h3>
                <p className="text-xs text-amber-600 mb-3">
                  Ces jeunes seront promus automatiquement si une place se libère.
                </p>
                <div className="space-y-1">
                  {attente.map((p, idx) => {
                    const isBusy = busy === p.jeuneId;
                    return (
                      <div
                        key={p.jeuneId}
                        className="flex items-center gap-3 px-3 py-2.5 bg-white rounded-lg border border-amber-100 group"
                      >
                        <span className="text-xs font-bold text-amber-400 w-5">#{idx + 1}</span>
                        <div className="w-8 h-8 rounded-full bg-amber-400 flex items-center justify-center text-xs font-bold text-white shrink-0">
                          {(p.jeunePrenom?.[0] ?? '?')}{(p.jeuneNom?.[0] ?? '')}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-gray-800">
                            {p.jeunePrenom} {p.jeuneNom?.toUpperCase()}
                          </span>
                        </div>
                        <span className="text-xs font-semibold text-amber-700 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full">
                          En attente
                        </span>
                        <button
                          onClick={() => handleRemove(p)}
                          disabled={isBusy}
                          className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-all text-sm disabled:opacity-30"
                          title="Retirer"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
