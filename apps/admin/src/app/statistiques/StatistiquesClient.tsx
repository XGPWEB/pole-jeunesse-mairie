'use client';
import { todayLocal } from '@/lib/dates';

type CafSemaine = { sem: string; heures: string; minutes: number };
type CafMois    = { mois: string; label: string; heures: string; minutes: number };

type CafStats = {
  pointagesAvecDuree: number;
  parSemaineTop: CafSemaine[];
  parMoisCAF: CafMois[];
};

type ArchiveCaf = { filename: string; exportedAt: string; exportedBy: string; totalHeures: string };

type Props = {
  parSexe: Record<string, number>;
  parSecteur: Record<string, number>;
  parAge: Record<string, number>;
  parEspace: Record<string, number>;
  parJour: Record<string, number>;
  parJourCollegiens: Record<string, number>;
  parJourLyceens: Record<string, number>;
  parMois: { mois: string; label: string; count: number }[];
  totalJeunes: number;
  totalPointages: number;
  totalActivites: number;
  tauxPresenceMoyen: number;
  jeunePeuActifs: { nom: string; prenom: string; score: number }[];
  refusParMois: { mois: string; label: string; count: number }[];
  cafStats: CafStats;
  archivesCaf?: ArchiveCaf[];
  isAdmin?: boolean;
};

function BarH({
  label, value, max, color = 'bg-[#6B1A6E]', suffix = '',
}: { label: string; value: number; max: number; color?: string; suffix?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-600 w-24 shrink-0 truncate">{label}</span>
      <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-bold text-gray-700 w-8 text-right">{value}{suffix}</span>
    </div>
  );
}

// Codes couleurs officiels — Collégiens = #1B3870 (navy) · Lycéens = #6B1A6E (violet)
export const COLLEGIENS_COLOR = '#1B3870';
export const LYCEENS_COLOR    = '#6B1A6E';

export default function StatistiquesClient({
  parSexe, parSecteur, parAge, parEspace,
  parJour, parJourCollegiens, parJourLyceens,
  parMois, totalJeunes, totalPointages, totalActivites,
  tauxPresenceMoyen, jeunePeuActifs, refusParMois, cafStats,
  archivesCaf = [],
  isAdmin = false,
}: Props) {

  async function exportCAFExcel() {
    try {
      const res = await fetch('/api/caf/export');
      if (!res.ok) throw new Error('Erreur export');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `CAF-bilan-collegiens-${todayLocal()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      // Refresh page pour mettre à jour la liste des archives
      window.location.reload();
    } catch { alert('Erreur lors de l\'export Excel'); }
  }

  const kpis = [
    { label: 'Total jeunes',   value: totalJeunes,    icon: '👥', bg: 'bg-purple-50',    text: 'text-purple-700',  border: 'border-purple-100',  iconBg: 'bg-purple-100' },
    { label: 'Total pointages',value: totalPointages,  icon: '✅', bg: 'bg-green-50',     text: 'text-green-700',   border: 'border-green-100',   iconBg: 'bg-green-100' },
    { label: 'Total activités',value: totalActivites,  icon: '📅', bg: 'bg-[#EEF2FA]',   text: 'text-[#1B3870]',   border: 'border-[#C7D4EE]',   iconBg: 'bg-[#C7D4EE]' },
    { label: 'Taux présence',  value: `${tauxPresenceMoyen}%`, icon: '📈', bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-100', iconBg: 'bg-cyan-100' },
  ];

  const totalSexe = (parSexe.M || 0) + (parSexe.F || 0);
  const nbCollegiens = parEspace['collegiens'] || 0;
  const nbLyceens    = parEspace['lyceens'] || 0;
  const totalEspace  = nbCollegiens + nbLyceens;

  const secteurColors = ['bg-[#6B1A6E]','bg-[#8B3A90]','bg-[#A855B5]','bg-[#C07DC6]','bg-[#D9A8DC]'];

  const jourOrder = ['Lun','Mar','Mer','Jeu','Ven','Sam'];
  const maxJour = Math.max(...jourOrder.map(j => parJour[j] || 0), 1);
  const maxMois = Math.max(...parMois.map(m => m.count), 1);
  const maxLowScore = Math.max(...jeunePeuActifs.map(j => j.score), 1);
  const maxRefus = Math.max(...refusParMois.map(m => m.count), 1);

  return (
    <div>
      {/* Page header */}
      <div className="px-8 py-5 border-b border-gray-100 bg-white">
        <h1 className="text-xl font-extrabold text-gray-900">📊 Statistiques</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {isAdmin ? 'Tableau de bord analytique — Vue globale' : 'Tableau de bord analytique — Données consolidées'}
        </p>
        {isAdmin && (
          <span className="text-xs bg-red-50 text-red-600 font-semibold px-2 py-0.5 rounded-full border border-red-200 mt-1 inline-block">
            🔒 Données confidentielles — Admin only
          </span>
        )}
      </div>

      <div className="p-8 space-y-8">

        {/* Section 1 — KPI cards */}
        <div className="grid grid-cols-4 gap-5">
          {kpis.map(k => (
            <div key={k.label} className={`rounded-xl border ${k.border} ${k.bg} p-5 flex items-center gap-4 shadow-sm`}>
              <div className={`w-12 h-12 rounded-xl ${k.iconBg} flex items-center justify-center text-2xl shrink-0`}>{k.icon}</div>
              <div>
                <div className={`text-2xl font-extrabold ${k.text}`}>{k.value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{k.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Section 2 — Répartition des jeunes */}
        <div>
          <h2 className="text-lg font-bold text-gray-800 mb-4">Répartition des jeunes</h2>

          {/* Row 1 — Sexe + Collégiens/Lycéens */}
          <div className="grid grid-cols-2 gap-5 mb-5">
            {/* Par sexe */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h3 className="font-bold text-gray-700 mb-4 text-sm">Par sexe</h3>
              <div className="flex gap-4 mb-4">
                <div className="flex-1 rounded-xl bg-blue-50 border border-blue-100 p-4 flex flex-col items-center gap-1">
                  <span className="text-2xl font-extrabold text-blue-600">{parSexe.M || 0}</span>
                  <span className="text-xs font-semibold text-blue-500">Garçon{(parSexe.M||0)>1?'s':''}</span>
                  <span className="text-[11px] text-blue-400">{totalSexe>0?Math.round(((parSexe.M||0)/totalSexe)*100):0}%</span>
                </div>
                <div className="flex-1 rounded-xl bg-pink-50 border border-pink-100 p-4 flex flex-col items-center gap-1">
                  <span className="text-2xl font-extrabold text-pink-500">{parSexe.F || 0}</span>
                  <span className="text-xs font-semibold text-pink-400">Fille{(parSexe.F||0)>1?'s':''}</span>
                  <span className="text-[11px] text-pink-300">{totalSexe>0?Math.round(((parSexe.F||0)/totalSexe)*100):0}%</span>
                </div>
              </div>
              {totalSexe > 0 && (
                <div className="flex h-3 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-400 transition-all duration-700" style={{ width: `${Math.round(((parSexe.M||0)/totalSexe)*100)}%` }} />
                  <div className="h-full bg-pink-400 transition-all duration-700" style={{ width: `${Math.round(((parSexe.F||0)/totalSexe)*100)}%` }} />
                </div>
              )}
            </div>

            {/* Collégiens / Lycéens */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h3 className="font-bold text-gray-700 mb-4 text-sm">Collégiens / Lycéens</h3>
              <div className="flex gap-4 mb-4">
                <div className="flex-1 rounded-xl bg-[#EEF2FA] border border-[#C7D4EE] p-4 flex flex-col items-center gap-1">
                  <span className="text-2xl font-extrabold text-[#1B3870]">{nbCollegiens}</span>
                  <span className="text-xs font-semibold text-[#1B3870]/70">Collégiens</span>
                  <span className="text-[11px] text-[#1B3870]/50">{totalEspace>0?Math.round((nbCollegiens/totalEspace)*100):0}%</span>
                </div>
                <div className="flex-1 rounded-xl bg-purple-50 border border-purple-100 p-4 flex flex-col items-center gap-1">
                  <span className="text-2xl font-extrabold text-[#6B1A6E]">{nbLyceens}</span>
                  <span className="text-xs font-semibold text-[#6B1A6E]/70">Lycéens</span>
                  <span className="text-[11px] text-[#6B1A6E]/50">{totalEspace>0?Math.round((nbLyceens/totalEspace)*100):0}%</span>
                </div>
              </div>
              {totalEspace > 0 && (
                <div className="flex h-3 rounded-full overflow-hidden">
                  <div className="h-full transition-all duration-700" style={{ width: `${Math.round((nbCollegiens/totalEspace)*100)}%`, backgroundColor: COLLEGIENS_COLOR }} />
                  <div className="h-full transition-all duration-700" style={{ width: `${Math.round((nbLyceens/totalEspace)*100)}%`, backgroundColor: LYCEENS_COLOR }} />
                </div>
              )}
            </div>
          </div>

          {/* Row 2 — Age + Secteur */}
          <div className="grid grid-cols-2 gap-5">
            {/* Par âge — couleurs cohérentes : Collège #1B3870, Lycée #6B1A6E, Autre amber */}
            {(() => {
              const ages = Array.from({ length: 15 }, (_, i) => i + 11);
              const maxAge = Math.max(...ages.map(a => parAge[String(a)] || 0), 1);

              function ageStyle(a: number, count: number, intensity: number) {
                if (count === 0) return {
                  bg: '#F9FAFB', border: '#E5E7EB',
                  textCount: '#D1D5DB', textAge: '#D1D5DB',
                };
                const isCollege = a >= 11 && a <= 14; // #1B3870
                const isLycee   = a >= 15 && a <= 18; // #6B1A6E
                if (isCollege) {
                  const bg     = intensity > 0.66 ? '#1B3870' : intensity > 0.33 ? '#4A6B9A' : '#D6E0F0';
                  const border = intensity > 0.66 ? '#1B3870' : intensity > 0.33 ? '#4A6B9A' : '#B8CDED';
                  const dark   = intensity > 0.33;
                  return { bg, border, textCount: dark ? '#fff' : '#1B3870', textAge: dark ? 'rgba(255,255,255,0.7)' : '#4A6B9A' };
                }
                if (isLycee) {
                  const bg     = intensity > 0.66 ? '#6B1A6E' : intensity > 0.33 ? '#9B4A9E' : '#EDD9EF';
                  const border = intensity > 0.66 ? '#6B1A6E' : intensity > 0.33 ? '#9B4A9E' : '#D9A8DC';
                  const dark   = intensity > 0.33;
                  return { bg, border, textCount: dark ? '#fff' : '#6B1A6E', textAge: dark ? 'rgba(255,255,255,0.7)' : '#9B4A9E' };
                }
                // 19+ → amber
                const bg     = intensity > 0.66 ? '#D97706' : intensity > 0.33 ? '#F59E0B' : '#FEF3C7';
                const border = intensity > 0.66 ? '#D97706' : intensity > 0.33 ? '#F59E0B' : '#FDE68A';
                const dark   = intensity > 0.33;
                return { bg, border, textCount: dark ? '#fff' : '#92400E', textAge: dark ? 'rgba(255,255,255,0.7)' : '#B45309' };
              }

              return (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                  <div className="text-sm font-bold text-gray-700 mb-3">Par âge</div>
                  {/* Légende */}
                  <div className="flex items-center gap-4 mb-3 text-[10px] font-semibold">
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded" style={{ backgroundColor: COLLEGIENS_COLOR }} />
                      <span style={{ color: COLLEGIENS_COLOR }}>11-14 ans — Collège</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded" style={{ backgroundColor: LYCEENS_COLOR }} />
                      <span style={{ color: LYCEENS_COLOR }}>15-18 ans — Lycée</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded bg-amber-400" />
                      <span className="text-amber-600">19+ ans</span>
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {ages.map(a => {
                      const count = parAge[String(a)] || 0;
                      const intensity = maxAge > 0 ? count / maxAge : 0;
                      const s = ageStyle(a, count, intensity);
                      return (
                        <div
                          key={a}
                          className="rounded-lg border flex flex-col items-center justify-center py-2 transition-all duration-500"
                          style={{ backgroundColor: s.bg, borderColor: s.border }}
                        >
                          <span className="text-base font-extrabold leading-none" style={{ color: s.textCount }}>{count}</span>
                          <span className="text-[10px] font-semibold mt-0.5" style={{ color: s.textAge }}>{a} ans</span>
                        </div>
                      );
                    })}
                  </div>
                  {(parAge['<11'] > 0 || parAge['>25'] > 0) && (
                    <div className="mt-3 pt-3 border-t border-gray-100 flex gap-4 text-xs text-gray-400">
                      {parAge['<11'] > 0 && <span>&lt;11 ans : <strong className="text-gray-600">{parAge['<11']}</strong></span>}
                      {parAge['>25'] > 0 && <span>&gt;25 ans : <strong className="text-gray-600">{parAge['>25']}</strong></span>}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Par secteur */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h3 className="font-bold text-gray-700 mb-4 text-sm">Par secteur</h3>
              <div className="space-y-3">
                {Object.entries(parSecteur).sort(([,a],[,b]) => b - a).map(([secteur, count], i) => {
                  const maxSecteur = Math.max(...Object.values(parSecteur), 1);
                  return <BarH key={secteur} label={secteur} value={count} max={maxSecteur} color={secteurColors[i % secteurColors.length]} />;
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Section 3 — Fréquentation journalière (double barre Collégiens / Lycéens) */}
        <div>
          <h2 className="text-lg font-bold text-gray-800 mb-4">Fréquentation journalière</h2>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-5 mb-4">
              <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: COLLEGIENS_COLOR }}>
                <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: COLLEGIENS_COLOR }} /> Collégiens
              </div>
              <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: LYCEENS_COLOR }}>
                <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: LYCEENS_COLOR }} /> Lycéens
              </div>
            </div>
            <div className="space-y-3">
              {jourOrder.map(jour => {
                const col  = parJourCollegiens[jour] || 0;
                const lyc  = parJourLyceens[jour] || 0;
                const total = parJour[jour] || (col + lyc);
                const barPct  = maxJour > 0 ? (total / maxJour) * 100 : 0;
                const colPct  = total > 0 ? (col / total) * 100 : 0;
                const lycPct  = total > 0 ? (lyc / total) * 100 : 0;
                return (
                  <div key={jour} className="flex items-center gap-3">
                    <span className="text-xs text-gray-600 w-8 shrink-0 font-medium">{jour}</span>
                    <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden relative">
                      <div className="absolute inset-y-0 left-0 flex rounded-full overflow-hidden transition-all duration-700" style={{ width: `${barPct}%` }}>
                        <div className="h-full" style={{ width: `${colPct}%`, backgroundColor: COLLEGIENS_COLOR }} />
                        <div className="h-full" style={{ width: `${lycPct}%`, backgroundColor: LYCEENS_COLOR }} />
                      </div>
                    </div>
                    <div className="flex items-center gap-1 w-28 shrink-0 justify-end">
                      {col > 0 && <span className="text-[11px] font-bold px-1.5 py-0.5 rounded" style={{ color: COLLEGIENS_COLOR, backgroundColor: '#EEF2FA' }}>{col}</span>}
                      {lyc > 0 && <span className="text-[11px] font-bold px-1.5 py-0.5 rounded" style={{ color: LYCEENS_COLOR, backgroundColor: '#F5F0F5' }}>{lyc}</span>}
                      <span className="text-xs font-semibold text-gray-500 ml-1">{total}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Section 4 — Fréquentation mensuelle */}
        <div>
          <h2 className="text-lg font-bold text-gray-800 mb-4">Fréquentation mensuelle</h2>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="space-y-3">
              {parMois.map(m => (
                <BarH key={m.mois} label={m.label} value={m.count} max={maxMois} color="bg-[#1B3870]" />
              ))}
              {parMois.length === 0 && <p className="text-xs text-gray-400 text-center py-4">Aucune donnée</p>}
            </div>
          </div>
        </div>

        {/* Section 5 — Équité d'accès */}
        <div>
          <h2 className="text-lg font-bold text-gray-800 mb-4">Équité d'accès</h2>
          <div className="grid grid-cols-2 gap-5">
            {/* À encourager */}
            <div className="bg-white rounded-xl border border-amber-100 shadow-sm p-5">
              <h3 className="font-bold text-amber-700 mb-1 text-sm">À encourager — Priorité équité</h3>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-700">
                Ces jeunes ont participé au moins de sorties. Privilégiez-les lors des prochaines inscriptions pour garantir l'équité d'accès.
              </div>
              {jeunePeuActifs.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">Aucune donnée de sortie disponible</p>
              ) : (
                <div className="space-y-3">
                  {jeunePeuActifs.map((j, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-amber-400 flex items-center justify-center text-white text-xs font-bold shrink-0">
                        {j.prenom.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-800 truncate">{j.prenom} {j.nom.toUpperCase()}</span>
                          <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full shrink-0">Prioritaire ⭐</span>
                        </div>
                        <div className="mt-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-amber-400 transition-all duration-700" style={{ width: `${maxLowScore > 0 ? Math.round((j.score / maxLowScore) * 100) : 4}%` }} />
                        </div>
                      </div>
                      <span className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full shrink-0">{j.score} sortie{j.score !== 1 ? 's' : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Refus par mois */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h3 className="font-bold text-gray-700 mb-1 text-sm">Refus par mois</h3>
              <p className="text-xs text-gray-400 mb-4">Nombre de jeunes en liste d'attente sur les sorties, par mois</p>
              {refusParMois.length === 0 ? (
                <div className="py-8 text-center">
                  <div className="text-3xl mb-2">🎉</div>
                  <p className="text-xs text-gray-400">Aucun refus enregistré — toutes les demandes ont été acceptées</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {refusParMois.map(m => (
                    <BarH key={m.mois} label={m.label} value={m.count} max={maxRefus} color="bg-rose-400" />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ══ MODULE CAF — Collégiens uniquement ══ */}
      <div className="p-8 border-t border-gray-100">
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-xl shrink-0">📋</div>
            <div>
              <h2 className="text-lg font-extrabold text-gray-900">Déclaration CAF — Heures d'accueil</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Collégiens uniquement · Pointages avec heure d'arrivée ET de départ renseignées
              </p>
            </div>
          </div>
          {/* Bouton export Excel — admin seulement */}
          {isAdmin && (
            <button
              onClick={exportCAFExcel}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 transition-colors shadow-sm shrink-0"
            >
              <span>📥</span> Exporter Excel + Archiver
            </button>
          )}
        </div>

        {cafStats.pointagesAvecDuree === 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-6 text-center text-sm text-amber-700">
            ⚠️ Aucun pointage Collégiens avec heure de départ renseignée. Saisissez les heures de départ dans <strong>Présences → Accueil libre</strong> pour activer les calculs CAF.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-6">
            {/* Mensuel */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-50 flex items-center gap-2">
                <span className="text-sm font-bold text-gray-800">📅 Bilan mensuel</span>
              </div>
              <div className="p-4 space-y-3">
                {cafStats.parMoisCAF.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4">Aucune donnée</p>
                ) : cafStats.parMoisCAF.map(m => {
                  const maxMin = Math.max(...cafStats.parMoisCAF.map(x => x.minutes));
                  return (
                    <div key={m.mois} className="flex items-center gap-3">
                      <span className="text-xs text-gray-600 w-10 shrink-0 font-semibold">{m.label}</span>
                      <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-blue-500 transition-all duration-700" style={{ width: `${maxMin > 0 ? Math.round((m.minutes / maxMin) * 100) : 0}%` }} />
                      </div>
                      <span className="text-xs font-bold text-blue-700 w-12 text-right">{m.heures}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Hebdomadaire */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-50 flex items-center gap-2">
                <span className="text-sm font-bold text-gray-800">📆 Bilan hebdomadaire (8 dernières semaines)</span>
              </div>
              <div className="p-4 space-y-3">
                {cafStats.parSemaineTop.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4">Aucune donnée</p>
                ) : cafStats.parSemaineTop.map(s => {
                  const maxMin = Math.max(...cafStats.parSemaineTop.map(x => x.minutes));
                  return (
                    <div key={s.sem} className="flex items-center gap-3">
                      <span className="text-xs text-gray-600 w-16 shrink-0 font-semibold">{s.sem}</span>
                      <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-indigo-500 transition-all duration-700" style={{ width: `${maxMin > 0 ? Math.round((s.minutes / maxMin) * 100) : 0}%` }} />
                      </div>
                      <span className="text-xs font-bold text-indigo-700 w-12 text-right">{s.heures}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {/* Archives CAF */}
        {archivesCaf.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-bold text-gray-700 mb-3">📁 Exports archivés</h3>
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Date d'export</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Exporté par</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Total heures</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">Télécharger</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {archivesCaf.map(a => (
                    <tr key={a.filename} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-2.5 text-xs text-gray-700">
                        {new Date(a.exportedAt).toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' })}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">{a.exportedBy}</td>
                      <td className="px-4 py-2.5 text-xs font-bold text-blue-700">{a.totalHeures}</td>
                      <td className="px-4 py-2.5 text-right">
                        <a
                          href={`/api/caf/export?archive=${encodeURIComponent(a.filename)}`}
                          className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 hover:underline"
                        >
                          ⬇ .xlsx
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
