'use client';

import { useState, useMemo } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────
type Pointage = {
  date: string;
  espaceId?: string;
  [key: string]: any;
};

type Props = {
  pointages: Pointage[];
};

// ── Couleurs par espace ──────────────────────────────────────────────────────
const ESPACE_COLORS: Record<string, string> = {
  collegiens: '#1B3870',
  lyceens: '#6B1A6E',
  pij: '#29B5E8',
  clas: '#8DC63F',
};

const ESPACE_LABELS: Record<string, string> = {
  collegiens: 'Collegiens',
  lyceens: 'Lyceens',
  pij: 'PIJ',
  clas: 'CLAS',
};

const ESPACE_IDS = ['collegiens', 'lyceens', 'pij', 'clas'] as const;

const JOUR_NOMS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const JOUR_COURTS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MOIS_NOMS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];

// ── Helpers ISO semaine ──────────────────────────────────────────────────────
function getISOWeekNumber(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getISOWeekYear(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  return d.getFullYear();
}

function getWeekKey(date: Date): string {
  return `${getISOWeekYear(date)}-Sem${String(getISOWeekNumber(date)).padStart(2, '0')}`;
}

function getMonthKey(dateStr: string): string {
  return dateStr.substring(0, 7);
}

// ── Structures de donnees par jour ───────────────────────────────────────────
type DayData = {
  date: string;
  dayOfWeek: number;
  collegiens: number;
  lyceens: number;
  pij: number;
  clas: number;
  total: number;
  weekKey: string;
  monthKey: string;
};

type WeekData = {
  weekKey: string;
  startDate: string;
  endDate: string;
  collegiens: number;
  lyceens: number;
  pij: number;
  clas: number;
  total: number;
  daysCount: number;
};

type MonthData = {
  monthKey: string;
  label: string;
  collegiens: number;
  lyceens: number;
  pij: number;
  clas: number;
  total: number;
  daysOpen: number;
};

// ══════════════════════════════════════════════════════════════════════════════
export default function FrequentationClient({ pointages }: Props) {
  const currentYear = new Date().getFullYear();
  const [annee, setAnnee] = useState(currentYear);
  const [vue, setVue] = useState<'jour' | 'semaine' | 'mois'>('jour');
  const [filtreEspace, setFiltreEspace] = useState<string>('all');

  // Annees disponibles
  const anneesDisponibles = useMemo(() => {
    const years = new Set<number>();
    pointages.forEach(p => {
      if (p.date) {
        const y = new Date(p.date).getFullYear();
        if (!isNaN(y)) years.add(y);
      }
    });
    if (years.size === 0) years.add(currentYear);
    return Array.from(years).sort((a, b) => b - a);
  }, [pointages, currentYear]);

  // Filtrer par annee
  const pointagesAnnee = useMemo(() => {
    return pointages.filter(p => {
      if (!p.date) return false;
      const d = new Date(p.date);
      return d.getFullYear() === annee;
    });
  }, [pointages, annee]);

  // Donnees par jour
  const dayDataMap = useMemo(() => {
    const map: Record<string, DayData> = {};
    pointagesAnnee.forEach(p => {
      const dateStr = p.date;
      if (!dateStr) return;
      if (!map[dateStr]) {
        const d = new Date(dateStr);
        map[dateStr] = {
          date: dateStr,
          dayOfWeek: d.getDay(),
          collegiens: 0,
          lyceens: 0,
          pij: 0,
          clas: 0,
          total: 0,
          weekKey: getWeekKey(d),
          monthKey: getMonthKey(dateStr),
        };
      }
      const espace = p.espaceId;
      if (espace === 'collegiens') map[dateStr].collegiens++;
      else if (espace === 'lyceens') map[dateStr].lyceens++;
      else if (espace === 'pij') map[dateStr].pij++;
      else if (espace === 'clas') map[dateStr].clas++;
      map[dateStr].total++;
    });
    return map;
  }, [pointagesAnnee]);

  const sortedDays = useMemo(() => {
    return Object.values(dayDataMap).sort((a, b) => b.date.localeCompare(a.date));
  }, [dayDataMap]);

  // Donnees par semaine
  const weekDataMap = useMemo(() => {
    const map: Record<string, WeekData> = {};
    sortedDays.forEach(day => {
      if (!map[day.weekKey]) {
        map[day.weekKey] = {
          weekKey: day.weekKey,
          startDate: day.date,
          endDate: day.date,
          collegiens: 0,
          lyceens: 0,
          pij: 0,
          clas: 0,
          total: 0,
          daysCount: 0,
        };
      }
      const w = map[day.weekKey];
      w.collegiens += day.collegiens;
      w.lyceens += day.lyceens;
      w.pij += day.pij;
      w.clas += day.clas;
      w.total += day.total;
      w.daysCount++;
      if (day.date < w.startDate) w.startDate = day.date;
      if (day.date > w.endDate) w.endDate = day.date;
    });
    return map;
  }, [sortedDays]);

  const sortedWeeks = useMemo(() => {
    return Object.values(weekDataMap).sort((a, b) => b.weekKey.localeCompare(a.weekKey));
  }, [weekDataMap]);

  // Donnees par mois
  const monthDataMap = useMemo(() => {
    const map: Record<string, MonthData> = {};
    sortedDays.forEach(day => {
      const mk = day.monthKey;
      if (!map[mk]) {
        const monthIdx = parseInt(mk.split('-')[1], 10) - 1;
        map[mk] = {
          monthKey: mk,
          label: MOIS_NOMS[monthIdx] || mk,
          collegiens: 0,
          lyceens: 0,
          pij: 0,
          clas: 0,
          total: 0,
          daysOpen: 0,
        };
      }
      const m = map[mk];
      m.collegiens += day.collegiens;
      m.lyceens += day.lyceens;
      m.pij += day.pij;
      m.clas += day.clas;
      m.total += day.total;
      m.daysOpen++;
    });
    return map;
  }, [sortedDays]);

  const sortedMonths = useMemo(() => {
    return Object.values(monthDataMap).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  }, [monthDataMap]);

  // ── KPI ────────────────────────────────────────────────────────────────────
  const totalPresences = pointagesAnnee.length;

  const daysWithPresences = sortedDays.length;
  const moyParJour = daysWithPresences > 0 ? Math.round(totalPresences / daysWithPresences) : 0;

  const jourPlusFrequente = useMemo(() => {
    if (sortedDays.length === 0) return '-';
    const best = sortedDays.reduce((a, b) => a.total > b.total ? a : b);
    const d = new Date(best.date);
    return `${JOUR_COURTS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1} (${best.total})`;
  }, [sortedDays]);

  const semainePlusActive = useMemo(() => {
    if (sortedWeeks.length === 0) return '-';
    const best = sortedWeeks.reduce((a, b) => a.total > b.total ? a : b);
    return `S${best.weekKey.split('-Sem')[1]} (${best.total})`;
  }, [sortedWeeks]);

  // ── Filtrage par espace ────────────────────────────────────────────────────
  function espaceValue(data: { collegiens: number; lyceens: number; pij: number; clas: number; total: number }) {
    if (filtreEspace === 'all') return data.total;
    return (data as any)[filtreEspace] ?? 0;
  }

  // ── Export Excel ───────────────────────────────────────────────────────────
  async function exportExcel() {
    try {
      const res = await fetch(`/api/frequentation/export?annee=${annee}`);
      if (!res.ok) throw new Error('Erreur export');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `frequentation-${annee}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Erreur lors de l'export Excel");
    }
  }

  // ── Helpers pour sous-totaux ───────────────────────────────────────────────
  function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }

  function formatDateRange(start: string, end: string): string {
    const s = new Date(start);
    const e = new Date(end);
    return `${String(s.getDate()).padStart(2, '0')}/${String(s.getMonth() + 1).padStart(2, '0')} - ${String(e.getDate()).padStart(2, '0')}/${String(e.getMonth() + 1).padStart(2, '0')}`;
  }

  // Regroupement jours par semaine et mois (pour sous-totaux dans la vue jour)
  const daysByWeek = useMemo(() => {
    const groups: Record<string, DayData[]> = {};
    sortedDays.forEach(d => {
      if (!groups[d.weekKey]) groups[d.weekKey] = [];
      groups[d.weekKey].push(d);
    });
    return groups;
  }, [sortedDays]);

  const daysByMonth = useMemo(() => {
    const groups: Record<string, DayData[]> = {};
    sortedDays.forEach(d => {
      if (!groups[d.monthKey]) groups[d.monthKey] = [];
      groups[d.monthKey].push(d);
    });
    return groups;
  }, [sortedDays]);

  // ── Rendu ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-8 space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-5">
        {[
          { label: 'Total presences cette annee', value: totalPresences, icon: '📊', bg: 'bg-purple-50', text: 'text-[#6B1A6E]', border: 'border-purple-100', iconBg: 'bg-purple-100' },
          { label: 'Moyenne / jour', value: moyParJour, icon: '📈', bg: 'bg-blue-50', text: 'text-[#1B3870]', border: 'border-blue-100', iconBg: 'bg-blue-100' },
          { label: 'Jour le plus frequente', value: jourPlusFrequente, icon: '🏆', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-100', iconBg: 'bg-amber-100' },
          { label: 'Semaine la plus active', value: semainePlusActive, icon: '📅', bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-100', iconBg: 'bg-green-100' },
        ].map(k => (
          <div key={k.label} className={`rounded-xl border ${k.border} ${k.bg} p-5 flex items-center gap-4 shadow-sm`}>
            <div className={`w-12 h-12 rounded-xl ${k.iconBg} flex items-center justify-center text-2xl shrink-0`}>{k.icon}</div>
            <div className="min-w-0">
              <div className={`text-xl font-extrabold ${k.text} truncate`}>{k.value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Controls bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          {/* Year selector */}
          <select
            value={annee}
            onChange={e => setAnnee(Number(e.target.value))}
            className="text-sm font-semibold border border-gray-200 rounded-lg px-3 py-2 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30"
          >
            {anneesDisponibles.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>

          {/* Vue toggle */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {(['jour', 'semaine', 'mois'] as const).map(v => (
              <button
                key={v}
                onClick={() => setVue(v)}
                className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  vue === v
                    ? 'bg-[#6B1A6E] text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {v === 'jour' ? 'Jour' : v === 'semaine' ? 'Semaine' : 'Mois'}
              </button>
            ))}
          </div>

          {/* Filtre espace */}
          <select
            value={filtreEspace}
            onChange={e => setFiltreEspace(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30"
          >
            <option value="all">Tous les espaces</option>
            {ESPACE_IDS.map(id => (
              <option key={id} value={id}>{ESPACE_LABELS[id]}</option>
            ))}
          </select>
        </div>

        {/* Export */}
        <button
          onClick={exportExcel}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 transition-colors shadow-sm"
        >
          <span>📥</span> Exporter Excel
        </button>
      </div>

      {/* ── VUE JOUR ──────────────────────────────────────────────────────── */}
      {vue === 'jour' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Jour</th>
                  {(filtreEspace === 'all' ? ESPACE_IDS : [filtreEspace]).map(id => (
                    <th key={id} className="px-4 py-3 text-center text-xs font-semibold" style={{ color: ESPACE_COLORS[id] }}>
                      {ESPACE_LABELS[id]}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(() => {
                  const rows: React.ReactNode[] = [];
                  let lastWeekKey = '';
                  let lastMonthKey = '';

                  sortedDays.forEach((day, idx) => {
                    const isWeekend = day.dayOfWeek === 0 || day.dayOfWeek === 6;

                    // Monthly subtotal before month change
                    if (lastMonthKey && day.monthKey !== lastMonthKey) {
                      const monthDays = daysByMonth[lastMonthKey] || [];
                      const mTotal = { collegiens: 0, lyceens: 0, pij: 0, clas: 0, total: 0 };
                      monthDays.forEach(d => {
                        mTotal.collegiens += d.collegiens;
                        mTotal.lyceens += d.lyceens;
                        mTotal.pij += d.pij;
                        mTotal.clas += d.clas;
                        mTotal.total += d.total;
                      });
                      const monthIdx = parseInt(lastMonthKey.split('-')[1], 10) - 1;
                      rows.push(
                        <tr key={`month-${lastMonthKey}`} className="bg-[#6B1A6E]/5 border-t-2 border-[#6B1A6E]/20">
                          <td colSpan={2} className="px-4 py-2 text-xs font-bold text-[#6B1A6E]">
                            Total {MOIS_NOMS[monthIdx]}
                          </td>
                          {(filtreEspace === 'all' ? ESPACE_IDS : [filtreEspace]).map(id => (
                            <td key={id} className="px-4 py-2 text-center text-xs font-bold" style={{ color: ESPACE_COLORS[id] }}>
                              {(mTotal as any)[id]}
                            </td>
                          ))}
                          <td className="px-4 py-2 text-center text-xs font-extrabold text-gray-800">
                            {filtreEspace === 'all' ? mTotal.total : (mTotal as any)[filtreEspace]}
                          </td>
                        </tr>
                      );
                    }

                    // Weekly subtotal before week change
                    if (lastWeekKey && day.weekKey !== lastWeekKey) {
                      const weekDays = daysByWeek[lastWeekKey] || [];
                      const wTotal = { collegiens: 0, lyceens: 0, pij: 0, clas: 0, total: 0 };
                      weekDays.forEach(d => {
                        wTotal.collegiens += d.collegiens;
                        wTotal.lyceens += d.lyceens;
                        wTotal.pij += d.pij;
                        wTotal.clas += d.clas;
                        wTotal.total += d.total;
                      });
                      rows.push(
                        <tr key={`week-${lastWeekKey}`} className="bg-gray-50/80 border-t border-gray-200">
                          <td colSpan={2} className="px-4 py-1.5 text-[11px] font-semibold text-gray-500 italic">
                            Sous-total S{lastWeekKey.split('-Sem')[1]}
                          </td>
                          {(filtreEspace === 'all' ? ESPACE_IDS : [filtreEspace]).map(id => (
                            <td key={id} className="px-4 py-1.5 text-center text-[11px] font-semibold text-gray-500">
                              {(wTotal as any)[id]}
                            </td>
                          ))}
                          <td className="px-4 py-1.5 text-center text-[11px] font-bold text-gray-600">
                            {filtreEspace === 'all' ? wTotal.total : (wTotal as any)[filtreEspace]}
                          </td>
                        </tr>
                      );
                    }

                    lastWeekKey = day.weekKey;
                    lastMonthKey = day.monthKey;

                    // Day row
                    rows.push(
                      <tr
                        key={day.date}
                        className={`hover:bg-gray-50/60 transition-colors ${isWeekend ? 'bg-orange-50/40' : ''}`}
                      >
                        <td className={`px-4 py-2 text-xs ${isWeekend ? 'text-orange-600 font-semibold' : 'text-gray-700'}`}>
                          {formatDate(day.date)}
                        </td>
                        <td className={`px-4 py-2 text-xs ${isWeekend ? 'text-orange-600 font-semibold' : 'text-gray-500'}`}>
                          {JOUR_NOMS[day.dayOfWeek]}
                        </td>
                        {(filtreEspace === 'all' ? ESPACE_IDS : [filtreEspace]).map(id => {
                          const val = (day as any)[id];
                          return (
                            <td key={id} className="px-4 py-2 text-center text-xs font-medium" style={{ color: val > 0 ? ESPACE_COLORS[id] : '#D1D5DB' }}>
                              {val > 0 ? val : '-'}
                            </td>
                          );
                        })}
                        <td className="px-4 py-2 text-center text-xs font-bold text-gray-800">
                          {filtreEspace === 'all' ? day.total : ((day as any)[filtreEspace] || 0)}
                        </td>
                      </tr>
                    );
                  });

                  // Final week subtotal
                  if (lastWeekKey && daysByWeek[lastWeekKey]) {
                    const weekDays = daysByWeek[lastWeekKey];
                    const wTotal = { collegiens: 0, lyceens: 0, pij: 0, clas: 0, total: 0 };
                    weekDays.forEach(d => {
                      wTotal.collegiens += d.collegiens;
                      wTotal.lyceens += d.lyceens;
                      wTotal.pij += d.pij;
                      wTotal.clas += d.clas;
                      wTotal.total += d.total;
                    });
                    rows.push(
                      <tr key={`week-${lastWeekKey}-final`} className="bg-gray-50/80 border-t border-gray-200">
                        <td colSpan={2} className="px-4 py-1.5 text-[11px] font-semibold text-gray-500 italic">
                          Sous-total S{lastWeekKey.split('-Sem')[1]}
                        </td>
                        {(filtreEspace === 'all' ? ESPACE_IDS : [filtreEspace]).map(id => (
                          <td key={id} className="px-4 py-1.5 text-center text-[11px] font-semibold text-gray-500">
                            {(wTotal as any)[id]}
                          </td>
                        ))}
                        <td className="px-4 py-1.5 text-center text-[11px] font-bold text-gray-600">
                          {filtreEspace === 'all' ? wTotal.total : (wTotal as any)[filtreEspace]}
                        </td>
                      </tr>
                    );
                  }

                  // Final month subtotal
                  if (lastMonthKey && daysByMonth[lastMonthKey]) {
                    const monthDays = daysByMonth[lastMonthKey];
                    const mTotal = { collegiens: 0, lyceens: 0, pij: 0, clas: 0, total: 0 };
                    monthDays.forEach(d => {
                      mTotal.collegiens += d.collegiens;
                      mTotal.lyceens += d.lyceens;
                      mTotal.pij += d.pij;
                      mTotal.clas += d.clas;
                      mTotal.total += d.total;
                    });
                    const monthIdx = parseInt(lastMonthKey.split('-')[1], 10) - 1;
                    rows.push(
                      <tr key={`month-${lastMonthKey}-final`} className="bg-[#6B1A6E]/5 border-t-2 border-[#6B1A6E]/20">
                        <td colSpan={2} className="px-4 py-2 text-xs font-bold text-[#6B1A6E]">
                          Total {MOIS_NOMS[monthIdx]}
                        </td>
                        {(filtreEspace === 'all' ? ESPACE_IDS : [filtreEspace]).map(id => (
                          <td key={id} className="px-4 py-2 text-center text-xs font-bold" style={{ color: ESPACE_COLORS[id] }}>
                            {(mTotal as any)[id]}
                          </td>
                        ))}
                        <td className="px-4 py-2 text-center text-xs font-extrabold text-gray-800">
                          {filtreEspace === 'all' ? mTotal.total : (mTotal as any)[filtreEspace]}
                        </td>
                      </tr>
                    );
                  }

                  if (rows.length === 0) {
                    rows.push(
                      <tr key="empty">
                        <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-400">
                          Aucun pointage pour {annee}
                        </td>
                      </tr>
                    );
                  }

                  return rows;
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── VUE SEMAINE ───────────────────────────────────────────────────── */}
      {vue === 'semaine' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Semaine</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Dates</th>
                  {(filtreEspace === 'all' ? ESPACE_IDS : [filtreEspace]).map(id => (
                    <th key={id} className="px-4 py-3 text-center text-xs font-semibold" style={{ color: ESPACE_COLORS[id] }}>
                      {ESPACE_LABELS[id]}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700">Total</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500">Moy/jour</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sortedWeeks.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-sm text-gray-400">
                      Aucun pointage pour {annee}
                    </td>
                  </tr>
                ) : sortedWeeks.map(w => (
                  <tr key={w.weekKey} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-4 py-2.5 text-xs font-semibold text-[#6B1A6E]">
                      S{w.weekKey.split('-Sem')[1]}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">
                      {formatDateRange(w.startDate, w.endDate)}
                    </td>
                    {(filtreEspace === 'all' ? ESPACE_IDS : [filtreEspace]).map(id => {
                      const val = (w as any)[id];
                      return (
                        <td key={id} className="px-4 py-2.5 text-center text-xs font-medium" style={{ color: val > 0 ? ESPACE_COLORS[id] : '#D1D5DB' }}>
                          {val > 0 ? val : '-'}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2.5 text-center text-xs font-bold text-gray-800">
                      {filtreEspace === 'all' ? w.total : ((w as any)[filtreEspace] || 0)}
                    </td>
                    <td className="px-4 py-2.5 text-center text-xs text-gray-500">
                      {w.daysCount > 0 ? Math.round((filtreEspace === 'all' ? w.total : ((w as any)[filtreEspace] || 0)) / w.daysCount) : 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── VUE MOIS ──────────────────────────────────────────────────────── */}
      {vue === 'mois' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Mois</th>
                  {(filtreEspace === 'all' ? ESPACE_IDS : [filtreEspace]).map(id => (
                    <th key={id} className="px-4 py-3 text-center text-xs font-semibold" style={{ color: ESPACE_COLORS[id] }}>
                      {ESPACE_LABELS[id]}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700">Total</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500">Jours d'ouverture</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500">Moyenne/jour</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sortedMonths.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-sm text-gray-400">
                      Aucun pointage pour {annee}
                    </td>
                  </tr>
                ) : (
                  <>
                    {sortedMonths.map(m => (
                      <tr key={m.monthKey} className="hover:bg-gray-50/60 transition-colors">
                        <td className="px-4 py-2.5 text-xs font-semibold text-gray-800">{m.label}</td>
                        {(filtreEspace === 'all' ? ESPACE_IDS : [filtreEspace]).map(id => {
                          const val = (m as any)[id];
                          return (
                            <td key={id} className="px-4 py-2.5 text-center text-xs font-medium" style={{ color: val > 0 ? ESPACE_COLORS[id] : '#D1D5DB' }}>
                              {val > 0 ? val : '-'}
                            </td>
                          );
                        })}
                        <td className="px-4 py-2.5 text-center text-xs font-bold text-gray-800">
                          {filtreEspace === 'all' ? m.total : ((m as any)[filtreEspace] || 0)}
                        </td>
                        <td className="px-4 py-2.5 text-center text-xs text-gray-500">{m.daysOpen}</td>
                        <td className="px-4 py-2.5 text-center text-xs text-gray-500">
                          {m.daysOpen > 0 ? Math.round((filtreEspace === 'all' ? m.total : ((m as any)[filtreEspace] || 0)) / m.daysOpen) : 0}
                        </td>
                      </tr>
                    ))}
                    {/* Total row */}
                    <tr className="bg-[#6B1A6E]/5 border-t-2 border-[#6B1A6E]/20 font-bold">
                      <td className="px-4 py-3 text-xs font-extrabold text-[#6B1A6E]">TOTAL</td>
                      {(filtreEspace === 'all' ? ESPACE_IDS : [filtreEspace]).map(id => {
                        const val = sortedMonths.reduce((sum, m) => sum + ((m as any)[id] || 0), 0);
                        return (
                          <td key={id} className="px-4 py-3 text-center text-xs font-extrabold" style={{ color: ESPACE_COLORS[id] }}>
                            {val}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-center text-xs font-extrabold text-gray-900">
                        {filtreEspace === 'all'
                          ? sortedMonths.reduce((s, m) => s + m.total, 0)
                          : sortedMonths.reduce((s, m) => s + ((m as any)[filtreEspace] || 0), 0)}
                      </td>
                      <td className="px-4 py-3 text-center text-xs font-bold text-gray-600">
                        {sortedMonths.reduce((s, m) => s + m.daysOpen, 0)}
                      </td>
                      <td className="px-4 py-3 text-center text-xs font-bold text-gray-600">
                        {(() => {
                          const totalDays = sortedMonths.reduce((s, m) => s + m.daysOpen, 0);
                          const totalVal = filtreEspace === 'all'
                            ? sortedMonths.reduce((s, m) => s + m.total, 0)
                            : sortedMonths.reduce((s, m) => s + ((m as any)[filtreEspace] || 0), 0);
                          return totalDays > 0 ? Math.round(totalVal / totalDays) : 0;
                        })()}
                      </td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
