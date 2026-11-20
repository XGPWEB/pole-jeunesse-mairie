'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface FicheSortieFormProps {
  initialData?: any;
  sortieId?: string;
  basePath?: string;
}

interface Journey {
  duree: number;
  depart: string;
  arrivee: string;
  texte: string;
  sections: { mode: string; ligne: string; direction: string }[];
}

interface PlaceSuggestion {
  id: string;
  label: string;
  type: string;
}

// ── Couleurs officielles IDFM par mode et par ligne ──────────────────────────
const METRO_COLORS: Record<string, [string, string]> = {
  '1':    ['#FFCD00','#000'], '2':  ['#003CA6','#fff'], '3':    ['#837902','#fff'],
  '3BIS': ['#6EC4E8','#000'], '4':  ['#CF009E','#fff'], '5':    ['#FF7E2E','#fff'],
  '6':    ['#6ECA97','#000'], '7':  ['#FA9ABA','#000'], '7BIS': ['#83C491','#000'],
  '8':    ['#E19BDF','#000'], '9':  ['#B6BD00','#000'], '10':   ['#C9910D','#fff'],
  '11':   ['#704B1C','#fff'], '12': ['#007852','#fff'], '13':   ['#98D4E2','#000'],
  '14':   ['#662483','#fff'], '15': ['#B90845','#fff'], '16':   ['#F3A825','#000'],
  '17':   ['#D5C900','#000'], '18': ['#00A88F','#fff'],
};
const RER_COLORS: Record<string, [string, string]> = {
  'A': ['#FF2442','#fff'], 'B': ['#3B93CD','#fff'], 'C': ['#FFCE00','#000'],
  'D': ['#00814F','#fff'], 'E': ['#C04191','#fff'],
};
const TRAM_COLORS: Record<string, [string, string]> = {
  'T1':['#CD2F1D','#fff'], 'T2':['#003CA6','#fff'], 'T3A':['#6ECA97','#000'],
  'T3B':['#6ECA97','#000'], 'T4':['#7B3F00','#fff'], 'T5':['#662483','#fff'],
  'T6':['#662483','#fff'], 'T7':['#808000','#fff'], 'T8':['#CD2F1D','#fff'],
  'T11':['#003CA6','#fff'], 'T12':['#00A86B','#fff'], 'T13':['#FFCD00','#000'],
};

function getLineStyle(mode: string, ligne: string): { bg: string; fg: string } {
  const m = mode.toLowerCase();
  const l = ligne.toUpperCase().replace('BIS','BIS').trim();
  if (m.includes('métro') || m.includes('metro')) {
    const c = METRO_COLORS[l] ?? ['#003DA5','#fff'];
    return { bg: c[0], fg: c[1] };
  }
  if (m.includes('rer')) {
    const c = RER_COLORS[l] ?? ['#003DA5','#fff'];
    return { bg: c[0], fg: c[1] };
  }
  if (m.includes('tramway') || m.includes('tram')) {
    const c = TRAM_COLORS[l] ?? ['#007852','#fff'];
    return { bg: c[0], fg: c[1] };
  }
  if (m.includes('bus'))         return { bg: '#82C8E6', fg: '#0a3d62' };
  if (m.includes('transilien'))  return { bg: '#004C97', fg: '#fff' };
  if (m.includes('navette'))     return { bg: '#F48022', fg: '#fff' };
  if (m.includes('bateau') || m.includes('ferry')) return { bg: '#006EB6', fg: '#fff' };
  return { bg: '#6b7280', fg: '#fff' };
}

function modeIcon(mode: string): string {
  const m = mode.toLowerCase();
  if (m.includes('métro') || m.includes('metro'))  return 'M';
  if (m.includes('rer'))                            return 'RER';
  if (m.includes('tramway') || m.includes('tram')) return 'T';
  if (m.includes('bus'))                            return '🚌';
  if (m.includes('transilien'))                     return 'N';
  if (m.includes('navette'))                        return '✈';
  if (m.includes('ferry') || m.includes('bateau')) return '⛴';
  return '🚋';
}

// Conservée pour compatibilité (non utilisée dans le rendu amélioré)
function modeBg(mode: string): string {
  const { bg, fg } = getLineStyle(mode, '');
  return `bg-[${bg}] text-[${fg}]`;
}

// ── Autocomplete adresse ──────────────────────────────────────────────────────
function AddressAutocomplete({
  value,
  onChange,
  placeholder,
  required,
}: {
  value: string;
  onChange: (v: string, id?: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 3) { setSuggestions([]); setOpen(false); return; }
    try {
      const res = await fetch(`/api/idfm-places?q=${encodeURIComponent(q)}&count=6`);
      const data: PlaceSuggestion[] = await res.json();
      setSuggestions(data);
      setOpen(data.length > 0);
    } catch {
      setSuggestions([]);
    }
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    onChange(val, undefined); // clear ID when user types manually
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 450);
  }

  function select(label: string, id: string) {
    onChange(label, id);
    setSuggestions([]);
    setOpen(false);
  }

  // Fermer si clic en dehors
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const typeIcon = (type: string) => {
    if (type === 'stop') return '🚉';
    if (type === 'poi')  return '📍';
    if (type === 'city') return '🏙️';
    return '🏠';
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        required={required}
        autoComplete="one-time-code"
        className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30 focus:border-[#1B3870]"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onMouseDown={() => select(s.label, s.id)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-[#1B3870]/5 transition-colors border-b border-gray-50 last:border-0"
            >
              <span className="text-base shrink-0">{typeIcon(s.type)}</span>
              <span className="text-sm text-gray-800 truncate">{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function FicheSortieForm({ initialData, sortieId, basePath = '/animateur/sorties' }: FicheSortieFormProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [trajetLoading, setTrajetLoading] = useState(false);
  const [trajetResult, setTrajetResult] = useState<{
    success?: boolean;
    journeys?: Journey[];
    fallbackUrl?: string;
    error?: string;
    mapsUrl?: string;
  } | null>(null);
  const [trajetApplied, setTrajetApplied] = useState(false);

  const [placeIds, setPlaceIds] = useState<{ depart?: string; destination?: string }>({
    depart:      initialData?.lieuDepartId      ?? undefined,
    destination: initialData?.lieuDestinationId ?? undefined,
  });

  function buildSortieForm(d?: any) {
    return {
      titre:           d?.titre           ?? '',
      date:            d?.date            ?? '',
      heureDepart:     d?.heureDepart     ?? '',
      heureRetour:     d?.heureRetour     ?? '',
      lieuDepart:      d?.lieuDepart      ?? '68 rue de Plaisance, Nogent-sur-Marne',
      lieuDestination: d?.lieuDestination ?? '',
      transport:       d?.transport       ?? '',
      nbEncadrants:    d?.nbEncadrants    ?? 1,
      autreEncadrant:  d?.autreEncadrant  ?? '',
      capacite:        d?.capacite        ?? '' as string | number,
      itineraire:      d?.itineraire      ?? '',
      observations:    d?.observations    ?? '',
    };
  }

  const [form, setForm] = useState(buildSortieForm(initialData));

  // ── Bon de commande (PDF ou image) ──────────────────────────────────────────
  // Le fichier existant n'est pas rechargé (on n'expose pas le base64 dans les
  // GET) : on affiche juste son nom. Un nouveau fichier ou un retrait explicite
  // sont gérés à part et n'écrasent l'existant que s'ils sont réellement posés.
  const [bonFile, setBonFile] = useState<{ dataUri: string; nom: string } | null>(null);
  const [bonRetire, setBonRetire] = useState(false);
  const [bonErreur, setBonErreur] = useState('');

  function handleBonFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permet de re-choisir le même fichier
    if (!file) return;
    setBonErreur('');
    const okTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
    if (!okTypes.includes(file.type)) { setBonErreur('Format accepté : PDF, PNG, JPEG ou WEBP.'); return; }
    if (file.size > 5 * 1024 * 1024) { setBonErreur('Fichier trop lourd (5 Mo maximum).'); return; }
    const reader = new FileReader();
    reader.onload = ev => { setBonFile({ dataUri: ev.target?.result as string, nom: file.name }); setBonRetire(false); };
    reader.readAsDataURL(file);
  }

  // Reset le formulaire quand on navigue vers une autre sortie ou vers "nouvelle"
  useEffect(() => {
    setForm(buildSortieForm(initialData));
    setError('');
    setSaving(false);
    setTrajetResult(null);
    setTrajetApplied(false);
    setBonFile(null);
    setBonRetire(false);
    setBonErreur('');
    setPlaceIds({
      depart:      initialData?.lieuDepartId      ?? undefined,
      destination: initialData?.lieuDestinationId ?? undefined,
    });
  }, [sortieId]);

  function setField(field: string, value: any, placeId?: string) {
    setForm(f => ({ ...f, [field]: value }));
    if (field === 'lieuDepart') {
      setPlaceIds(p => ({ ...p, depart: placeId }));
      setTrajetResult(null);
      setTrajetApplied(false);
    }
    if (field === 'lieuDestination') {
      setPlaceIds(p => ({ ...p, destination: placeId }));
      setTrajetResult(null);
      setTrajetApplied(false);
    }
  }

  async function calculerTrajet() {
    if (!form.lieuDepart.trim() || !form.lieuDestination.trim()) return;
    setTrajetLoading(true);
    setTrajetResult(null);
    setTrajetApplied(false);
    try {
      let datetime: string | undefined;
      if (form.date && form.heureDepart) {
        datetime = form.date.replace(/-/g, '') + 'T' + form.heureDepart.replace(':', '') + '00';
      }
      const res = await fetch('/api/idfm-trajet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          depart: form.lieuDepart,
          destination: form.lieuDestination,
          departId: placeIds.depart,
          destinationId: placeIds.destination,
          datetime,
        }),
      });
      const data = await res.json();
      setTrajetResult(data);
    } catch {
      setTrajetResult({ error: 'Erreur réseau lors du calcul du trajet.' });
    } finally {
      setTrajetLoading(false);
    }
  }

  function appliquerItineraire(journey: Journey) {
    const lignes = journey.sections.length
      ? journey.sections.map(s => `${modeIcon(s.mode)} ${s.ligne}${s.direction ? ' → ' + s.direction : ''}`).join('  +  ')
      : 'À pied';
    const detail = `Départ ${journey.depart} — Arrivée ${journey.arrivee} (${journey.duree} min)\n${lignes}`;
    setForm(f => ({ ...f, transport: lignes, itineraire: detail }));
    setTrajetApplied(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body: any = sortieId ? { ...form, id: sortieId } : { ...form };
      // On ne renseigne `bonCommande` QUE s'il change : nouveau fichier posé,
      // ou retrait explicite. Sinon on laisse l'existant intact.
      if (bonFile) { body.bonCommande = bonFile.dataUri; body.bonCommandeNom = bonFile.nom; }
      else if (bonRetire) { body.bonCommande = null; }
      const res = await fetch('/api/sorties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        router.push(`${basePath}/${data.sortie.id}`);
      } else {
        setError(data.error ?? "Erreur lors de l'enregistrement.");
      }
    } catch {
      setError('Erreur de connexion.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-5">
      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* ── Informations générales ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest border-b pb-3">
          Informations générales
        </h3>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Titre de la sortie *</label>
          <input type="text" required value={form.titre} onChange={e => setField('titre', e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Date *</label>
            <input type="date" required value={form.date} onChange={e => setField('date', e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Départ *</label>
            <input type="time" required value={form.heureDepart} onChange={e => setField('heureDepart', e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Retour</label>
            <input type="time" value={form.heureRetour} onChange={e => setField('heureRetour', e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Nb encadrants</label>
            <input type="number" min="1" value={form.nbEncadrants} onChange={e => setField('nbEncadrants', parseInt(e.target.value))}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Nombre de places</label>
            <input type="number" min="1" value={form.capacite} onChange={e => setField('capacite', e.target.value === '' ? '' : parseInt(e.target.value))}
              placeholder="Ex: 20"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Autre encadrant</label>
            <input type="text" value={form.autreEncadrant} onChange={e => setField('autreEncadrant', e.target.value)}
              placeholder="Nom et prénom"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30" />
          </div>
        </div>
      </div>

      {/* ── Itinéraire ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest border-b pb-3">
          🗺️ Itinéraire &amp; Transport
        </h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Lieu de départ</label>
            <AddressAutocomplete
              value={form.lieuDepart}
              onChange={(v, id) => setField('lieuDepart', v, id)}
              placeholder="Adresse de départ…"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Destination *</label>
            <AddressAutocomplete
              value={form.lieuDestination}
              onChange={(v, id) => setField('lieuDestination', v, id)}
              placeholder="Adresse ou nom du lieu…"
              required
            />
          </div>
        </div>

        {/* Bouton calcul */}
        <button
          type="button"
          onClick={calculerTrajet}
          disabled={trajetLoading || !form.lieuDepart.trim() || !form.lieuDestination.trim()}
          className="w-full flex items-center justify-center gap-2 py-3 bg-[#003189] text-white font-semibold rounded-xl hover:bg-[#002366] transition-colors disabled:opacity-40 text-sm"
        >
          {trajetLoading ? (
            <><span className="animate-spin inline-block">⟳</span> Calcul en cours…</>
          ) : (
            <>🚇 Calculer le trajet Île-de-France Mobilités</>
          )}
        </button>

        {/* Résultats trajets */}
        {trajetResult && (
          <div className="rounded-xl border border-gray-200 overflow-hidden">
            {!trajetResult.success ? (
              /* ── Erreur / fallback ── */
              <div className="p-4 bg-amber-50 flex items-start gap-3">
                <span className="text-xl shrink-0">⚠️</span>
                <div className="flex-1">
                  <p className="text-sm text-amber-800 font-medium">{trajetResult.error}</p>
                  {trajetResult.fallbackUrl && (
                    <a href={trajetResult.fallbackUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 mt-2 text-sm font-bold text-[#1B3870] underline">
                      🗺️ Ouvrir dans Google Maps →
                    </a>
                  )}
                </div>
              </div>
            ) : (
              /* ── Trajets trouvés ── */
              <>
                <div className="px-4 py-3 bg-[#003189]/5 border-b border-blue-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🚇</span>
                    <span className="text-sm font-bold text-[#003189]">
                      {trajetResult.journeys?.length} trajet(s) — Île-de-France Mobilités
                    </span>
                  </div>
                  {trajetResult.mapsUrl && (
                    <a href={trajetResult.mapsUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-gray-400 hover:text-gray-600 underline">
                      Google Maps
                    </a>
                  )}
                </div>

                {trajetResult.journeys?.map((j, idx) => (
                  <div key={idx} className="border-b border-gray-50 last:border-0 p-4 hover:bg-gray-50/50 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      {/* Colonne gauche : horaires + durée */}
                      <div className="shrink-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-base font-bold text-gray-800">{j.depart}</span>
                          <span className="text-gray-300 text-xs">→</span>
                          <span className="text-base font-bold text-gray-800">{j.arrivee}</span>
                        </div>
                        <span className="inline-flex items-center gap-1 text-xs font-semibold bg-[#003189]/10 text-[#003189] px-2 py-0.5 rounded-full">
                          ⏱ {j.duree} min
                        </span>
                      </div>

                      {/* Colonne centre : lignes avec couleurs IDFM officielles */}
                      <div className="flex-1 flex flex-wrap gap-1.5 items-center">
                        {j.sections.length === 0 ? (
                          <span className="text-sm text-gray-500 italic">🚶 À pied</span>
                        ) : (
                          j.sections.map((s, si) => {
                            const { bg, fg } = getLineStyle(s.mode, s.ligne);
                            return (
                              <div key={si} className="flex items-center gap-1">
                                {si > 0 && <span className="text-gray-300 text-xs">+</span>}
                                <span
                                  className="inline-flex items-center gap-0.5 text-xs font-black px-2 py-1 rounded-lg"
                                  style={{ background: bg, color: fg }}
                                >
                                  <span className="text-[10px] opacity-80">{modeIcon(s.mode)}</span>
                                  <span>{s.ligne}</span>
                                </span>
                                {s.direction && (
                                  <span className="text-xs text-gray-400 max-w-[90px] truncate" title={s.direction}>
                                    → {s.direction.split(' ')[0]}
                                  </span>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>

                      {/* Bouton utiliser */}
                      <button
                        type="button"
                        onClick={() => appliquerItineraire(j)}
                        className={`shrink-0 px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                          trajetApplied && idx === 0
                            ? 'bg-green-500 text-white'
                            : 'bg-[#1B3870] text-white hover:bg-[#162d5e]'
                        }`}
                      >
                        ✓ Utiliser
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* Transport saisi */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Moyen de transport</label>
          <input type="text" value={form.transport} onChange={e => setField('transport', e.target.value)}
            placeholder="Ex: 🚇 M1 + 🚌 113  ou  🚐 Renault Trafic…"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30" />
        </div>

        {/* Itinéraire détaillé */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Détail de l'itinéraire</label>
          <textarea value={form.itineraire} onChange={e => setField('itineraire', e.target.value)} rows={2}
            placeholder="Renseigné automatiquement, ou à compléter manuellement…"
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30 resize-none" />
        </div>
      </div>

      {/* ── Observations ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest border-b pb-3 mb-4">
          Observations
        </h3>
        <textarea value={form.observations} onChange={e => setField('observations', e.target.value)} rows={3}
          placeholder="Informations complémentaires, autorisations particulières…"
          className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1B3870]/30 resize-none" />
      </div>

      {/* ── Bon de commande ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest border-b pb-3 mb-4">
          Bon de commande <span className="normal-case font-normal text-gray-300">(PDF ou image, facultatif)</span>
        </h3>

        {bonErreur && (
          <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">⚠️ {bonErreur}</div>
        )}

        {bonFile ? (
          // Nouveau fichier sélectionné, pas encore enregistré
          <div className="flex items-center gap-3">
            <span className="text-xl">📄</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 truncate">{bonFile.nom}</p>
              <p className="text-xs text-green-600">Nouveau fichier — sera enregistré avec la fiche.</p>
            </div>
            <button type="button" onClick={() => setBonFile(null)}
              className="text-sm text-red-400 hover:text-red-600 font-medium">Retirer</button>
          </div>
        ) : (initialData?.hasBonCommande && !bonRetire) ? (
          // Fichier déjà présent (édition)
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xl">📄</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 truncate">{initialData.bonCommandeNom || 'Bon de commande'}</p>
            </div>
            <a href={`/api/sorties/bon-commande?id=${sortieId}`} target="_blank" rel="noopener noreferrer"
              className="text-sm text-[#1B3870] hover:underline font-medium">Voir / Imprimer</a>
            <label className="text-sm text-gray-600 hover:text-gray-800 font-medium cursor-pointer">
              Remplacer
              <input type="file" accept=".pdf,image/*" onChange={handleBonFile} className="hidden" />
            </label>
            <button type="button" onClick={() => setBonRetire(true)}
              className="text-sm text-red-400 hover:text-red-600 font-medium">Retirer</button>
          </div>
        ) : (
          // Aucun fichier (ou retrait demandé)
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 px-4 py-2.5 border border-dashed border-gray-300 rounded-xl text-sm text-gray-600 hover:border-[#1B3870] hover:text-[#1B3870] cursor-pointer">
              📎 Choisir un fichier
              <input type="file" accept=".pdf,image/*" onChange={handleBonFile} className="hidden" />
            </label>
            {bonRetire && initialData?.hasBonCommande && (
              <span className="text-xs text-amber-600">Le bon de commande sera retiré à l’enregistrement.</span>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <button type="submit" disabled={saving}
          className="flex-1 py-3 bg-[#1B3870] text-white font-bold rounded-xl hover:bg-[#162d5e] transition-colors disabled:opacity-50">
          {saving ? '⟳ Enregistrement…' : sortieId ? '💾 Mettre à jour' : '🗺️ Créer la fiche sortie'}
        </button>
        <button type="button" onClick={() => router.back()}
          className="px-6 py-3 bg-gray-100 text-gray-600 font-medium rounded-xl hover:bg-gray-200">
          Annuler
        </button>
      </div>
    </form>
  );
}
