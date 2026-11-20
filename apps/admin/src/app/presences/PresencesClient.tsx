'use client';

import { useState, useTransition, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import EspaceBadge from '@/components/EspaceBadge';
import { ajouterPointage, modifierPointage, supprimerPointage } from './actions';

type JournalierRow = {
  date: string;
  total: number;
  manuel: number;
  espaces: Record<string, number>;
};

type JeuneLight = {
  id: string;
  nom: string;
  prenom: string;
  espaceId: string;
};

type PointageLibre = {
  id: string;
  jeuneId: string | null;
  espaceId: string;
  date: string;
  heureArrivee: string;
  heureSortie?: string;
  animateur: string;
  manuel: boolean;
  source?: string;
  prenomManuel?: string | null;
  nomManuel?: string | null;
};

type Props = {
  journalierList: JournalierRow[];
  activitesList: any[];
  totalJournalier: number;
  totalActivite: number;
  totalManuel: number;
  jeunes: JeuneLight[];
  pointagesLibreRaw: PointageLibre[];
};

const JOURS_FR = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

// Accueil libre = Collégiens + Lycéens seulement
const ACCUEIL_LIBRE_ESPACES = ['collegiens', 'lyceens'];

const ESPACES_CONFIG: Record<string, { label: string; dot: string; text: string; bg: string; border: string }> = {
  collegiens: { label: 'Collégiens', dot: 'bg-[#6B1A6E]', text: 'text-[#6B1A6E]', bg: 'bg-purple-50',  border: 'border-purple-200' },
  lyceens:    { label: 'Lycéens',    dot: 'bg-blue-600',  text: 'text-blue-700',   bg: 'bg-blue-50',    border: 'border-blue-200'   },
};

function formatDateFR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function getDayName(iso: string): string {
  return JOURS_FR[new Date(iso).getDay()];
}

function isToday(iso: string): boolean {
  const today = new Date();
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return iso === todayISO;
}

function getTodayISO(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function getNowHHMM(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function getMonthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

// ─── Add Pointage Modal ───────────────────────────────────────────────────────

interface AddPointageModalProps {
  jeunes: JeuneLight[];
  onClose: () => void;
  onSuccess: () => void;
}

function AddPointageModal({ jeunes, onClose, onSuccess }: AddPointageModalProps) {
  const [form, setForm] = useState({
    date: getTodayISO(),
    jeuneId: '',
    espaceId: '',
    heureArrivee: getNowHHMM(),
    heureSortie: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  function updateForm(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  function handleJeuneChange(jeuneId: string) {
    const jeune = jeunes.find(j => j.id === jeuneId);
    setForm(f => ({ ...f, jeuneId, espaceId: jeune?.espaceId ?? f.espaceId }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.jeuneId) { setError('Sélectionnez un jeune.'); return; }
    if (!form.espaceId) { setError('Sélectionnez un espace.'); return; }
    setSaving(true);
    setError('');
    const result = await ajouterPointage({
      jeuneId: form.jeuneId,
      espaceId: form.espaceId,
      date: form.date,
      heureArrivee: form.heureArrivee,
      heureSortie: form.heureSortie || undefined,
      type: 'accueil-libre',
      activiteId: null,
      manuel: true,
    });
    setSaving(false);
    if (result.success) {
      setDone(true);
    } else {
      setError(result.error ?? "Erreur lors de l'ajout");
    }
  }

  // Seulement Collégiens + Lycéens
  const jeunesSorted = [...jeunes]
    .filter(j => ACCUEIL_LIBRE_ESPACES.includes(j.espaceId))
    .sort((a, b) => a.nom.localeCompare(b.nom));

  const selectedJeune = jeunes.find(j => j.id === form.jeuneId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-[#6B1A6E] px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-white font-bold text-lg">Pointer un jeune</h2>
            <p className="text-purple-200 text-sm mt-0.5">Accueil libre — Collégiens · Lycéens</p>
          </div>
          <button onClick={onClose} className="text-purple-200 hover:text-white text-xl font-bold leading-none">×</button>
        </div>

        {!done ? (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* Date */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={e => updateForm('date', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6B1A6E]"
                required
              />
            </div>

            {/* Heures */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Heure d'arrivée <span className="text-red-400">*</span>
                </label>
                <input
                  type="time"
                  value={form.heureArrivee}
                  onChange={e => updateForm('heureArrivee', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6B1A6E]"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Heure de départ <span className="text-gray-300 font-normal normal-case">(optionnel)</span>
                </label>
                <input
                  type="time"
                  value={form.heureSortie}
                  onChange={e => updateForm('heureSortie', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6B1A6E]"
                />
              </div>
            </div>

            {/* Jeune */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Jeune <span className="text-red-400">*</span>
              </label>
              <select
                value={form.jeuneId}
                onChange={e => handleJeuneChange(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#6B1A6E]"
                required
              >
                <option value="">— Sélectionner un jeune —</option>
                <optgroup label="Collégiens">
                  {jeunesSorted.filter(j => j.espaceId === 'collegiens').map(j => (
                    <option key={j.id} value={j.id}>{j.nom} {j.prenom}</option>
                  ))}
                </optgroup>
                <optgroup label="Lycéens">
                  {jeunesSorted.filter(j => j.espaceId === 'lyceens').map(j => (
                    <option key={j.id} value={j.id}>{j.nom} {j.prenom}</option>
                  ))}
                </optgroup>
              </select>
            </div>

            {/* Espace */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Espace</label>
              <div className="flex gap-2">
                {ACCUEIL_LIBRE_ESPACES.map(id => {
                  const cfg = ESPACES_CONFIG[id];
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => updateForm('espaceId', id)}
                      className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                        form.espaceId === id
                          ? 'bg-[#6B1A6E] text-white border-[#6B1A6E]'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-[#6B1A6E]'
                      }`}
                    >
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Manuel notice */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 flex items-center gap-2 text-xs text-amber-700">
              <span>✏️</span>
              <span>Ce pointage sera enregistré comme <strong>saisie manuelle</strong></span>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">⚠️ {error}</div>
            )}

            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                Annuler
              </button>
              <button type="submit" disabled={saving}
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors ${saving ? 'bg-purple-300 cursor-wait' : 'bg-[#6B1A6E] hover:bg-[#551558]'}`}>
                {saving ? '⏳ Enregistrement...' : '✓ Enregistrer'}
              </button>
            </div>
          </form>
        ) : (
          <div className="p-6 space-y-4">
            <div className="flex flex-col items-center text-center py-4">
              <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center text-2xl mb-3">✓</div>
              <h3 className="text-lg font-bold text-gray-800">Pointage enregistré !</h3>
              <p className="text-sm text-gray-500 mt-1">
                {selectedJeune ? `${selectedJeune.prenom} ${selectedJeune.nom}` : 'Le jeune'} — {formatDateFR(form.date)} à {form.heureArrivee}
                {form.heureSortie ? ` → ${form.heureSortie}` : ''}
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setDone(false); setForm({ date: getTodayISO(), jeuneId: '', espaceId: '', heureArrivee: getNowHHMM(), heureSortie: '' }); }}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                + Pointer un autre
              </button>
              <button onClick={onSuccess}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold bg-[#6B1A6E] text-white hover:bg-[#551558] transition-colors">
                Fermer et actualiser
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PresencesClient({
  journalierList,
  activitesList,
  totalJournalier,
  totalActivite,
  totalManuel,
  jeunes,
  pointagesLibreRaw,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<'journalier' | 'activite'>('journalier');
  const [filterMonth, setFilterMonth] = useState('tous');
  const [filterEspace, setFilterEspace] = useState('tous');
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [lastSync, setLastSync] = useState<Date>(new Date());

  // ── Auto-refresh toutes les 30s pour voir les saisies mobiles ────────────────
  const doRefresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
      setLastSync(new Date());
    });
  }, [router, startTransition]);

  useEffect(() => {
    const interval = setInterval(doRefresh, 10_000);
    return () => clearInterval(interval);
  }, [doRefresh]);
  const [showPointerModal, setShowPointerModal] = useState(false);

  // Departure recording states
  const [showingDepartFor, setShowingDepartFor] = useState<string | null>(null);
  const [departInputs, setDepartInputs] = useState<Record<string, string>>({});
  const [departSaving, setDepartSaving] = useState<Record<string, boolean>>({});
  // Deletion state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── KPI cards ────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Pointages accueil libre', value: totalJournalier, bg: 'bg-blue-50', border: 'border-blue-100', text: 'text-blue-700', iconBg: 'bg-blue-100', icon: '🚪' },
    { label: 'Pointages activités',     value: totalActivite,   bg: 'bg-purple-50', border: 'border-purple-100', text: 'text-[#6B1A6E]', iconBg: 'bg-purple-100', icon: '📅' },
    { label: 'Ajouts manuels',          value: totalManuel,     bg: 'bg-amber-50', border: 'border-amber-100',  text: 'text-amber-700',   iconBg: 'bg-amber-100',  icon: '✏️' },
  ];

  // ── Available months ──────────────────────────────────────────────────────────
  const availableMonths = Array.from(
    new Set(
      journalierList
        .filter(r => (r.espaces['collegiens'] || 0) + (r.espaces['lyceens'] || 0) > 0)
        .map(r => r.date.substring(0, 7))
    )
  ).sort().reverse();

  // ── Filtered journalier (Collégiens + Lycéens only) ───────────────────────────
  const filteredJournalier = journalierList.filter(row => {
    // Accueil libre = Collégiens + Lycéens uniquement
    const hasLibreEspace = (row.espaces['collegiens'] || 0) + (row.espaces['lyceens'] || 0) > 0;
    if (!hasLibreEspace) return false;
    if (filterMonth !== 'tous' && !row.date.startsWith(filterMonth)) return false;
    if (filterEspace !== 'tous' && !(row.espaces[filterEspace] > 0)) return false;
    return true;
  });

  // ── Period stats ──────────────────────────────────────────────────────────────
  const getRowCount = (row: JournalierRow) =>
    filterEspace !== 'tous'
      ? (row.espaces[filterEspace] || 0)
      : (row.espaces['collegiens'] || 0) + (row.espaces['lyceens'] || 0);

  const periodTotal = filteredJournalier.reduce((s, r) => s + getRowCount(r), 0);
  const periodDays = filteredJournalier.length;
  const periodAvg = periodDays > 0 ? (periodTotal / periodDays).toFixed(1) : '0';
  const periodMax = filteredJournalier.reduce((max, r) => Math.max(max, getRowCount(r)), 0);

  // ── Toggle expanded ───────────────────────────────────────────────────────────
  function toggleExpand(date: string) {
    setExpandedDates(prev => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });
  }

  // ── Pointages for a date (Collégiens + Lycéens only) ─────────────────────────
  function getPointagesForDate(date: string): PointageLibre[] {
    return pointagesLibreRaw
      .filter(p => {
        if (p.date !== date) return false;
        if (!ACCUEIL_LIBRE_ESPACES.includes(p.espaceId)) return false;
        if (filterEspace !== 'tous' && p.espaceId !== filterEspace) return false;
        return true;
      })
      .sort((a, b) => a.heureArrivee.localeCompare(b.heureArrivee));
  }

  function getJeune(id: string | null): JeuneLight | undefined {
    if (!id) return undefined;
    return jeunes.find(j => j.id === id);
  }

  // ── Save departure time ───────────────────────────────────────────────────────
  async function handleSaveDeparture(ptId: string) {
    const heure = departInputs[ptId];
    if (!heure) return;
    setDepartSaving(prev => ({ ...prev, [ptId]: true }));
    await modifierPointage(ptId, { heureSortie: heure });
    setDepartSaving(prev => ({ ...prev, [ptId]: false }));
    setShowingDepartFor(null);
    startTransition(() => router.refresh());
  }

  function handlePointageSuccess() {
    setShowPointerModal(false);
    startTransition(() => router.refresh());
  }

  async function handleDeletePointage(ptId: string) {
    if (!window.confirm('Retirer ce pointage ? Cette action est irréversible.')) return;
    setDeletingId(ptId);
    await supprimerPointage(ptId);
    setDeletingId(null);
    startTransition(() => router.refresh());
  }

  const tabs = [
    { key: 'journalier' as const, label: '🚪 Accueil libre' },
    { key: 'activite'   as const, label: '📅 Par activité'  },
  ];

  return (
    <div>
      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="px-8 py-5 border-b border-gray-100 bg-white flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-gray-900">✅ Présences</h1>
          <p className="text-sm text-gray-500 mt-0.5">Fiche journalière + présences par activité</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={doRefresh}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            title="Actualiser maintenant"
          >
            <span>↻</span>
            <span>Sync {lastSync.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          </button>
          <button className="text-sm font-semibold text-[#6B1A6E] border border-[#6B1A6E]/30 px-4 py-2 rounded-lg hover:bg-purple-50">
            ↓ Exporter CSV
          </button>
        </div>
      </div>

      <div className="p-8 space-y-6">
        {/* ── KPI cards ──────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-5">
          {kpis.map(k => (
            <div key={k.label} className={`rounded-xl border ${k.border} ${k.bg} p-5 flex items-center gap-4 shadow-sm`}>
              <div className={`w-12 h-12 rounded-xl ${k.iconBg} flex items-center justify-center text-2xl shrink-0`}>
                {k.icon}
              </div>
              <div>
                <div className={`text-2xl font-extrabold ${k.text}`}>{k.value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{k.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Tab switcher ───────────────────────────────────────────────────── */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === tab.key ? 'bg-white text-[#6B1A6E] shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ════════════════════════════════════════════════════════════════════
            TAB: ACCUEIL LIBRE — PAR JOUR  (Collégiens + Lycéens)
            ════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'journalier' && (
          <div className="space-y-4">
            {/* ── Info band ──────────────────────────────────────────────────── */}
            <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
              <span>ℹ️</span>
              <span>L'accueil libre concerne uniquement les espaces <strong>Collégiens</strong> et <strong>Lycéens</strong></span>
            </div>

            {/* ── Filter bar ─────────────────────────────────────────────────── */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Mois</span>
                <select
                  value={filterMonth}
                  onChange={e => setFilterMonth(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6B1A6E] bg-white"
                >
                  <option value="tous">Tous</option>
                  {availableMonths.map(ym => (
                    <option key={ym} value={ym}>{getMonthLabel(ym)}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Espace</span>
                <div className="flex gap-1">
                  {[
                    { id: 'tous', label: 'Tous' },
                    { id: 'collegiens', label: 'Collégiens' },
                    { id: 'lyceens', label: 'Lycéens' },
                  ].map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setFilterEspace(opt.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                        filterEspace === opt.id
                          ? 'bg-[#6B1A6E] text-white border-[#6B1A6E]'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-[#6B1A6E] hover:text-[#6B1A6E]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1" />

              <button
                onClick={() => setShowPointerModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#6B1A6E] text-white text-sm font-semibold hover:bg-[#551558] transition-colors shadow-sm"
              >
                <span>+</span>
                <span>Pointer un jeune</span>
              </button>
            </div>

            {/* ── Period stats ───────────────────────────────────────────────── */}
            {filteredJournalier.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white border border-gray-100 rounded-xl px-4 py-3 flex items-center gap-3 shadow-sm">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center text-base shrink-0">📊</div>
                  <div>
                    <div className="text-xl font-extrabold text-gray-900">{periodTotal}</div>
                    <div className="text-xs text-gray-400">présences{filterMonth !== 'tous' ? ` · ${getMonthLabel(filterMonth)}` : ' au total'}</div>
                  </div>
                </div>
                <div className="bg-white border border-gray-100 rounded-xl px-4 py-3 flex items-center gap-3 shadow-sm">
                  <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center text-base shrink-0">📈</div>
                  <div>
                    <div className="text-xl font-extrabold text-gray-900">{periodAvg}</div>
                    <div className="text-xs text-gray-400">moyenne / jour ouvert</div>
                  </div>
                </div>
                <div className="bg-white border border-gray-100 rounded-xl px-4 py-3 flex items-center gap-3 shadow-sm">
                  <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center text-base shrink-0">🏆</div>
                  <div>
                    <div className="text-xl font-extrabold text-gray-900">{periodMax}</div>
                    <div className="text-xs text-gray-400">record sur la période</div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Table ──────────────────────────────────────────────────────── */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-gray-800">Accueil libre — par jour</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {filteredJournalier.length} jour{filteredJournalier.length !== 1 ? 's' : ''} — cliquez sur une ligne pour voir les jeunes présents
                  </p>
                </div>
                {expandedDates.size > 0 && (
                  <button onClick={() => setExpandedDates(new Set())} className="text-xs text-gray-400 hover:text-gray-600">
                    Tout replier ↑
                  </button>
                )}
              </div>

              {filteredJournalier.length === 0 ? (
                <div className="text-sm text-gray-400 text-center py-16">
                  <div className="text-3xl mb-3">🚪</div>
                  <div className="font-medium text-gray-500">Aucune donnée pour cette période</div>
                  <div className="text-xs mt-1">Modifiez les filtres ou ajoutez un pointage</div>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {filteredJournalier.map(row => {
                    const today = isToday(row.date);
                    const isExpanded = expandedDates.has(row.date);
                    const rowCount = getRowCount(row);
                    const pointagesJour = getPointagesForDate(row.date);

                    return (
                      <div key={row.date}>
                        {/* ── Main row ─────────────────────────────────────── */}
                        <div
                          onClick={() => toggleExpand(row.date)}
                          className={`flex items-center gap-4 px-5 py-3.5 cursor-pointer transition-colors ${
                            isExpanded ? 'bg-purple-50' : today ? 'bg-blue-50/50 hover:bg-blue-50' : 'hover:bg-gray-50'
                          }`}
                        >
                          {/* Date + jour */}
                          <div className="w-40 shrink-0">
                            <div className="font-semibold text-gray-800 text-sm">
                              {formatDateFR(row.date)}
                              {today && (
                                <span className="ml-2 text-[10px] font-bold bg-[#6B1A6E] text-white px-1.5 py-0.5 rounded-full">
                                  Aujourd'hui
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5">{getDayName(row.date)}</div>
                          </div>

                          {/* Total badge */}
                          <div className="w-14 shrink-0">
                            <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full font-bold text-sm ${
                              rowCount === 0 ? 'bg-gray-100 text-gray-400' :
                              rowCount >= 5 ? 'bg-[#6B1A6E] text-white' :
                              'bg-purple-100 text-[#6B1A6E]'
                            }`}>
                              {rowCount}
                            </span>
                          </div>

                          {/* Espace breakdown */}
                          <div className="flex-1 flex items-center gap-4">
                            {ACCUEIL_LIBRE_ESPACES.map(espaceId => {
                              const count = row.espaces[espaceId] || 0;
                              const cfg = ESPACES_CONFIG[espaceId];
                              if (filterEspace !== 'tous' && filterEspace !== espaceId) return null;
                              return (
                                <div key={espaceId} className="flex items-center gap-1.5">
                                  <span className={`w-2 h-2 rounded-full ${cfg.dot} shrink-0`} />
                                  <span className="text-xs font-semibold text-gray-600">{cfg.label}</span>
                                  <span className={`text-xs font-bold ${count > 0 ? cfg.text : 'text-gray-300'}`}>{count}</span>
                                </div>
                              );
                            })}
                          </div>

                          {/* Manuel badge */}
                          <div className="w-24 shrink-0 text-right">
                            {row.manuel > 0 ? (
                              <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                                {row.manuel} manuel{row.manuel > 1 ? 's' : ''}
                              </span>
                            ) : (
                              <span className="text-gray-200 text-xs">—</span>
                            )}
                          </div>

                          {/* Chevron */}
                          <div className={`w-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▾</div>
                        </div>

                        {/* ── Expanded detail ──────────────────────────────── */}
                        {isExpanded && (
                          <div className="bg-gray-50 border-t border-gray-100 px-5 py-4">
                            {pointagesJour.length === 0 ? (
                              <p className="text-sm text-gray-400 text-center py-3">Aucun pointage pour cet espace ce jour-là.</p>
                            ) : (
                              <div className="space-y-2">
                                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                                  {pointagesJour.length} jeune{pointagesJour.length !== 1 ? 's' : ''} présent{pointagesJour.length !== 1 ? 's' : ''}
                                </div>
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                  {pointagesJour.map(pt => {
                                    const jeune = pt.jeuneId ? getJeune(pt.jeuneId) : undefined;
                                    // Nom à afficher : jeune inscrit OU entrée manuelle
                                    const displayPrenom = jeune?.prenom ?? pt.prenomManuel ?? '?';
                                    const displayNom    = jeune?.nom    ?? pt.nomManuel    ?? '';
                                    const cfg = ESPACES_CONFIG[pt.espaceId];
                                    const isShowingDepart = showingDepartFor === pt.id;
                                    const isManualEntry = !pt.jeuneId; // jeuneId null = non inscrit

                                    return (
                                      <div key={pt.id} className="flex items-start gap-3 bg-white rounded-lg border border-gray-100 px-3 py-2.5 shadow-sm relative group">
                                        {/* Avatar */}
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${cfg?.bg ?? 'bg-gray-100'} ${cfg?.text ?? 'text-gray-600'} border ${cfg?.border ?? 'border-gray-200'}`}>
                                          {displayPrenom[0]?.toUpperCase() ?? '?'}{displayNom[0]?.toUpperCase() ?? ''}
                                        </div>

                                        {/* Name + espace + times */}
                                        <div className="flex-1 min-w-0">
                                          {/* Nom cliquable si inscrit, sinon texte simple */}
                                          {jeune ? (
                                            <Link
                                              href={`/admin/jeunes/${jeune.id}`}
                                              className={`text-sm font-semibold truncate block hover:underline ${cfg?.text ?? 'text-gray-800'}`}
                                            >
                                              {jeune.prenom} {jeune.nom} ↗
                                            </Link>
                                          ) : (
                                            <div className="text-sm font-semibold text-gray-700 truncate">
                                              {displayPrenom} {displayNom.toUpperCase()}
                                            </div>
                                          )}

                                          {/* Espace + badges Manuel / Mobile */}
                                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                            <span className={`text-xs font-medium ${cfg?.text ?? 'text-gray-500'}`}>{cfg?.label ?? pt.espaceId}</span>
                                            {pt.manuel && (
                                              <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 rounded-full">Manuel</span>
                                            )}
                                            {pt.source === 'mobile' && (
                                              <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-1.5 rounded-full">📱 Mobile</span>
                                            )}
                                            {isManualEntry && !jeune && (
                                              <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 border border-gray-200 px-1.5 rounded-full">Non inscrit</span>
                                            )}
                                          </div>

                                          {/* Times */}
                                          <div className="flex items-center gap-3 mt-1.5">
                                            {/* Arrivée */}
                                            <div className="flex items-center gap-1">
                                              <span className="text-[10px] text-gray-400">↓ Arrivée</span>
                                              <span className="text-xs font-mono font-semibold text-gray-700">{pt.heureArrivee}</span>
                                            </div>

                                            {/* Départ */}
                                            {pt.heureSortie ? (
                                              <div className="flex items-center gap-1">
                                                <span className="text-[10px] text-gray-400">↑ Départ</span>
                                                <span className="text-xs font-mono font-semibold text-green-600">{pt.heureSortie}</span>
                                              </div>
                                            ) : isShowingDepart ? (
                                              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                                <input
                                                  type="time"
                                                  value={departInputs[pt.id] ?? ''}
                                                  onChange={e => setDepartInputs(prev => ({ ...prev, [pt.id]: e.target.value }))}
                                                  className="text-xs border border-[#6B1A6E]/40 rounded px-1.5 py-0.5 w-24 focus:outline-none focus:border-[#6B1A6E]"
                                                  autoFocus
                                                />
                                                <button
                                                  onClick={() => handleSaveDeparture(pt.id)}
                                                  disabled={departSaving[pt.id]}
                                                  className="text-xs font-bold text-white bg-[#6B1A6E] px-1.5 py-0.5 rounded hover:bg-[#551558] disabled:opacity-50"
                                                >
                                                  {departSaving[pt.id] ? '…' : '✓'}
                                                </button>
                                                <button
                                                  onClick={() => setShowingDepartFor(null)}
                                                  className="text-xs text-gray-400 hover:text-gray-600"
                                                >×</button>
                                              </div>
                                            ) : (
                                              <button
                                                onClick={e => { e.stopPropagation(); setShowingDepartFor(pt.id); setDepartInputs(prev => ({ ...prev, [pt.id]: getNowHHMM() })); }}
                                                className="text-[10px] text-[#6B1A6E] hover:underline font-semibold"
                                              >
                                                + Saisir départ
                                              </button>
                                            )}
                                          </div>
                                          {/* Bouton supprimer — droit à l'erreur */}
                                          <button
                                            onClick={e => { e.stopPropagation(); handleDeletePointage(pt.id); }}
                                            disabled={deletingId === pt.id}
                                            className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 flex items-center justify-center rounded-full bg-red-50 hover:bg-red-100 text-red-400 hover:text-red-600 text-xs disabled:opacity-50"
                                            title="Retirer ce pointage"
                                          >
                                            {deletingId === pt.id ? '…' : '✕'}
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════════
            TAB: PAR ACTIVITÉ
            ════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'activite' && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">Présences par activité</h2>
            </div>
            {activitesList.length === 0 ? (
              <div className="text-sm text-gray-400 text-center py-12">Aucune activité disponible</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Date</th>
                    <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Activité</th>
                    <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Espace</th>
                    <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Présents ✓</th>
                    <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Absents ✗</th>
                    <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Excusés ~</th>
                    <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Manuel</th>
                    <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Taux</th>
                    <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">État</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {activitesList.map(a => {
                    const p = a.presences;
                    const taux = p.total > 0 ? Math.round((p.present / p.total) * 100) : 0;
                    const pointe = p.total > 0;
                    return (
                      <tr key={a.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3.5 text-gray-600">{formatDateFR(a.date)}</td>
                        <td className="px-5 py-3.5 font-semibold text-gray-800">{a.titre}</td>
                        <td className="px-5 py-3.5"><EspaceBadge espaceId={a.espaceId} /></td>
                        <td className="px-5 py-3.5"><span className="font-semibold text-green-600">{p.present}</span></td>
                        <td className="px-5 py-3.5"><span className="font-semibold text-red-500">{p.absent}</span></td>
                        <td className="px-5 py-3.5"><span className="font-semibold text-amber-500">{p.excuse}</span></td>
                        <td className="px-5 py-3.5">
                          {p.manuel > 0 ? (
                            <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                              {p.manuel} manuel{p.manuel > 1 ? 's' : ''}
                            </span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-5 py-3.5">
                          {pointe ? (
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-[#6B1A6E] rounded-full" style={{ width: `${taux}%` }} />
                              </div>
                              <span className="text-xs font-semibold text-gray-600">{taux}%</span>
                            </div>
                          ) : <span className="text-xs text-gray-300">—</span>}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${pointe ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {pointe ? '✓ Pointé' : 'À faire'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* ── Add Pointage Modal ──────────────────────────────────────────────────── */}
      {showPointerModal && (
        <AddPointageModal
          jeunes={jeunes}
          onClose={() => setShowPointerModal(false)}
          onSuccess={handlePointageSuccess}
        />
      )}
    </div>
  );
}
