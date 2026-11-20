'use client';
import { useState, useEffect, useMemo } from 'react';
import { todayLocal, toLocalDateStr } from '@/lib/dates';

interface Conge {
  id: string;
  animateurId: string;
  animateurNom: string;
  dateDebut: string;
  dateFin: string;
  type: string;
  motif: string | null;
  source: string;
}
interface Demande {
  id: string;
  animateurId: string;
  animateurNom: string;
  date: string;
  heures: number;
  sens: 'credit' | 'debit';
  motif: string | null;
  statut: 'pending' | 'approved' | 'rejected';
  valideAt?: string | null;
}
interface AnimateurLite { id: string; nom: string; }

const TYPE_LABELS: Record<string, string> = {
  conge: 'Congé', recuperation: 'Récupération', maladie: 'Maladie', formation: 'Formation',
  absent: 'Absent',
};
const TYPE_COLORS: Record<string, string> = {
  conge: 'bg-blue-100 text-blue-700 border-blue-200',
  recuperation: 'bg-green-100 text-green-700 border-green-200',
  maladie: 'bg-red-100 text-red-700 border-red-200',
  formation: 'bg-purple-100 text-purple-700 border-purple-200',
  absent: 'bg-gray-100 text-gray-600 border-gray-200',
};
// Palette de couleurs distinctes attribuée par animateur, de façon stable :
// le même animateur garde toujours sa couleur (hash de son id → index).
const ANIMATEUR_PALETTE = [
  'bg-blue-100 text-blue-800 border-blue-200',
  'bg-green-100 text-green-800 border-green-200',
  'bg-amber-100 text-amber-800 border-amber-200',
  'bg-purple-100 text-purple-800 border-purple-200',
  'bg-pink-100 text-pink-800 border-pink-200',
  'bg-cyan-100 text-cyan-800 border-cyan-200',
  'bg-orange-100 text-orange-800 border-orange-200',
  'bg-teal-100 text-teal-800 border-teal-200',
  'bg-indigo-100 text-indigo-800 border-indigo-200',
  'bg-rose-100 text-rose-800 border-rose-200',
  'bg-lime-100 text-lime-800 border-lime-200',
  'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200',
];
function colorForAnimateur(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ANIMATEUR_PALETTE[h % ANIMATEUR_PALETTE.length];
}

// Abréviation du type d'absence, affichée en petit dans la capsule (admins).
const TYPE_ABBR: Record<string, string> = {
  conge: 'Congé', recuperation: 'Récup', maladie: 'Maladie', formation: 'Formation',
};

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

function fmtJour(d: string) {
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function CongesRecupClient({
  isAdmin,
  currentUserId,
  animateurs,
}: {
  isAdmin: boolean;
  currentUserId: string;
  animateurs: AnimateurLite[];
}) {
  const [tab, setTab] = useState<'planning' | 'recup' | 'validations'>('planning');
  const [conges, setConges] = useState<Conge[]>([]);
  const [demandes, setDemandes] = useState<Demande[]>([]);
  const [solde, setSolde] = useState<number>(0);
  const [soldes, setSoldes] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  async function chargerTout() {
    const [rc, rr] = await Promise.all([
      fetch('/api/conges').then(r => r.json()),
      fetch('/api/recuperation').then(r => r.json()),
    ]);
    setConges(rc.conges ?? []);
    setDemandes(rr.demandes ?? []);
    setSolde(rr.solde ?? 0);
    setSoldes(rr.soldes ?? {});
    setLoading(false);
  }
  useEffect(() => { chargerTout(); }, []);

  const pendingCount = demandes.filter(d => d.statut === 'pending').length;

  if (loading) return <div className="text-center py-12 text-gray-400">Chargement…</div>;

  return (
    <div className="space-y-6">
      {/* Onglets */}
      <div className="flex gap-1 border-b border-gray-200">
        <TabBtn active={tab === 'planning'} onClick={() => setTab('planning')}>🗓 Planning Congés</TabBtn>
        <TabBtn active={tab === 'recup'} onClick={() => setTab('recup')}>
          {isAdmin ? '⏱ Récupération' : '⏱ Mes récupérations'}
        </TabBtn>
        {isAdmin && (
          <TabBtn active={tab === 'validations'} onClick={() => setTab('validations')}>
            ✅ Validations{pendingCount > 0 && (
              <span className="ml-1.5 text-xs bg-red-500 text-white rounded-full px-1.5 py-0.5">{pendingCount}</span>
            )}
          </TabBtn>
        )}
      </div>

      {tab === 'planning' && (
        <PlanningTab conges={conges} isAdmin={isAdmin} animateurs={animateurs} onChange={setConges} />
      )}
      {tab === 'recup' && (
        <RecupTab
          // L'onglet « Récupération » montre TOUJOURS le compte de l'utilisateur
          // courant — y compris pour un admin (il gère les autres via l'onglet
          // Validations). Pour un admin, l'API ne renvoie pas de solde perso
          // mais la map `soldes` : on y pioche le sien, sinon il resterait à 0.
          demandes={demandes.filter(d => d.animateurId === currentUserId)}
          solde={isAdmin ? (soldes[currentUserId] ?? 0) : solde}
          onRefresh={chargerTout}
        />
      )}
      {tab === 'validations' && isAdmin && (
        <ValidationsTab demandes={demandes} soldes={soldes} onRefresh={chargerTout} />
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2.5 text-sm font-semibold rounded-t-lg transition-colors ${
        active ? 'bg-white text-[#6B1A6E] border-b-2 border-[#6B1A6E]' : 'text-gray-500 hover:text-gray-700'
      }`}>
      {children}
    </button>
  );
}

// ── Onglet Planning ───────────────────────────────────────────────────────────
function PlanningTab({ conges, isAdmin, animateurs, onChange }: {
  conges: Conge[]; isAdmin: boolean; animateurs: AnimateurLite[]; onChange: (c: Conge[]) => void;
}) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ animateurId: '', dateDebut: '', dateFin: '', type: 'conge', motif: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [editId, setEditId] = useState<string | null>(null);
  const PAGE_SIZE = 5;

  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + monthOffset);
  const year = base.getFullYear();
  const month = base.getMonth();

  // Grille du mois, aligné sur lundi.
  const first = new Date(year, month, 1);
  const startDow = (first.getDay() + 6) % 7; // 0 = lundi
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);

  function congesForDay(dateStr: string) {
    return conges.filter(c => dateStr >= c.dateDebut && dateStr <= c.dateFin);
  }

  async function ajouter(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/conges', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        onChange(data.conges);
        setShowForm(false);
        setForm({ animateurId: '', dateDebut: '', dateFin: '', type: 'conge', motif: '' });
      } else {
        setError(data.error ?? 'Erreur lors de l’enregistrement.');
      }
    } catch { setError('Erreur de connexion.'); }
    finally { setSaving(false); }
  }

  async function supprimer(id: string) {
    if (!confirm('Supprimer ce congé ?')) return;
    const res = await fetch(`/api/conges?id=${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok && data.success) onChange(data.conges);
  }

  async function modifierConge(id: string, patch: { dateDebut: string; dateFin: string; type: string; motif: string }) {
    setSaving(true);
    try {
      const res = await fetch('/api/conges', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      const data = await res.json();
      if (res.ok && data.success) { onChange(data.conges); setEditId(null); }
      else alert(data.error ?? 'Erreur');
    } finally { setSaving(false); }
  }

  const todayStr = todayLocal();

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-gray-800">{MOIS[month]} {year}</h2>
          <div className="flex gap-2">
            <button onClick={() => setMonthOffset(m => m - 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm hover:bg-gray-50">←</button>
            <button onClick={() => setMonthOffset(0)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm hover:bg-gray-50">Aujourd&apos;hui</button>
            <button onClick={() => setMonthOffset(m => m + 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm hover:bg-gray-50">→</button>
          </div>
        </div>
        <div className="grid grid-cols-7 text-center text-xs font-semibold text-gray-400 border-b border-gray-100">
          {DAY_LABELS.map(d => <div key={d} className="py-2">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const dateStr = d ? toLocalDateStr(d) : '';
            const items = d ? congesForDay(dateStr) : [];
            const isToday = dateStr === todayStr;
            return (
              <div key={i} className={`min-h-[76px] p-1.5 border-b border-r border-gray-50 ${isToday ? 'bg-[#6B1A6E]/5' : ''}`}>
                {d && (
                  <>
                    <div className={`text-xs mb-1 ${isToday ? 'font-bold text-[#6B1A6E]' : 'text-gray-400'}`}>{d.getDate()}</div>
                    <div className="space-y-0.5">
                      {items.slice(0, 4).map(c => (
                        <div key={c.id} title={`${c.animateurNom} — ${TYPE_LABELS[c.type] ?? c.type}${c.motif ? ' (' + c.motif + ')' : ''}`}
                          className={`flex items-center gap-1 text-[10px] px-1 py-0.5 rounded border ${colorForAnimateur(c.animateurId)}`}>
                          <span className="truncate flex-1">{c.animateurNom}</span>
                          {isAdmin && TYPE_ABBR[c.type] && (
                            <span className="shrink-0 text-[8px] font-semibold opacity-60 uppercase">{TYPE_ABBR[c.type]}</span>
                          )}
                        </div>
                      ))}
                      {items.length > 4 && <div className="text-[10px] text-gray-400">+{items.length - 4}</div>}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Légende : une couleur par animateur */}
      {conges.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {Array.from(new Map(conges.map(c => [c.animateurId, c.animateurNom])).entries()).map(([id, nom]) => (
            <span key={id} className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border ${colorForAnimateur(id)}`}>
              {nom}
            </span>
          ))}
        </div>
      )}

      {isAdmin && (
        <div>
          <button onClick={() => { setShowForm(!showForm); setError(''); }}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#6B1A6E] text-white font-bold rounded-xl hover:bg-[#571558] transition-colors">
            ➕ {showForm ? 'Annuler' : 'Saisir un congé'}
          </button>

          {showForm && (
            <form onSubmit={ajouter} className="mt-4 bg-white rounded-xl border border-gray-100 shadow-sm p-6 grid grid-cols-2 gap-4">
              {error && <div className="col-span-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">⚠️ {error}</div>}
              <div className="col-span-2">
                <label className="block text-sm font-semibold text-gray-700 mb-1">Animateur *</label>
                <select required value={form.animateurId} onChange={e => setForm(f => ({ ...f, animateurId: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm">
                  <option value="">— Choisir —</option>
                  {animateurs.map(a => <option key={a.id} value={a.id}>{a.nom}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Date de début *</label>
                <input type="date" required value={form.dateDebut} onChange={e => setForm(f => ({ ...f, dateDebut: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Date de fin *</label>
                <input type="date" required value={form.dateFin} min={form.dateDebut} onChange={e => setForm(f => ({ ...f, dateFin: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Type</label>
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm">
                  {Object.entries(TYPE_LABELS).filter(([k]) => k !== 'absent').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Commentaire <span className="font-normal text-gray-400">(facultatif)</span></label>
                <input type="text" value={form.motif} onChange={e => setForm(f => ({ ...f, motif: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm" placeholder="Note libre" />
              </div>
              <div className="col-span-2">
                <button type="submit" disabled={saving}
                  className="w-full py-3 bg-[#6B1A6E] text-white font-bold rounded-xl hover:bg-[#571558] disabled:opacity-40">
                  {saving ? 'Enregistrement…' : 'Enregistrer le congé'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Liste complète (tous les congés, passés inclus) — paginée par 5 */}
      {(() => {
        const tous = [...conges].sort((a, b) => b.dateDebut.localeCompare(a.dateDebut));
        const pages = Math.max(1, Math.ceil(tous.length / PAGE_SIZE));
        const pageClamped = Math.min(page, pages - 1);
        const visibles = tous.slice(pageClamped * PAGE_SIZE, pageClamped * PAGE_SIZE + PAGE_SIZE);
        return (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 text-sm font-bold text-gray-800 flex items-center justify-between">
              <span>📋 Tous les congés {tous.length > 0 && <span className="text-gray-400 font-normal">({tous.length})</span>}</span>
            </div>
            {tous.length === 0 ? (
              <div className="px-4 py-6 text-center text-gray-400 text-sm">Aucun congé enregistré.</div>
            ) : (
              <>
                <div className="divide-y divide-gray-50">
                  {visibles.map(c => (
                    <CongeRow key={c.id} c={c} isAdmin={isAdmin} saving={saving}
                      editing={editId === c.id}
                      onEditStart={() => setEditId(c.id)} onEditCancel={() => setEditId(null)}
                      onSave={modifierConge} onDelete={supprimer} />
                  ))}
                </div>
                {pages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                    <button disabled={pageClamped === 0} onClick={() => setPage(p => Math.max(0, p - 1))}
                      className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">← Précédent</button>
                    <span className="text-xs text-gray-500">Page {pageClamped + 1} / {pages}</span>
                    <button disabled={pageClamped >= pages - 1} onClick={() => setPage(p => Math.min(pages - 1, p + 1))}
                      className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">Suivant →</button>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}

/**
 * Ligne d'un congé dans la liste complète : affichage + (admin) édition en
 * ligne et suppression. Les congés générés automatiquement par une pose de
 * récupération (source 'recup') ne sont pas éditables ici — ils se gèrent
 * depuis l'onglet Récupération pour ne pas désynchroniser le solde.
 */
function CongeRow({
  c, isAdmin, saving, editing, onEditStart, onEditCancel, onSave, onDelete,
}: {
  c: Conge;
  isAdmin: boolean;
  saving: boolean;
  editing: boolean;
  onEditStart: () => void;
  onEditCancel: () => void;
  onSave: (id: string, patch: { dateDebut: string; dateFin: string; type: string; motif: string }) => void;
  onDelete: (id: string) => void;
}) {
  const [f, setF] = useState({ dateDebut: c.dateDebut, dateFin: c.dateFin, type: c.type, motif: c.motif ?? '' });
  const modifiable = isAdmin && c.source === 'admin';

  if (editing) {
    return (
      <div className="px-4 py-3 bg-[#6B1A6E]/5 space-y-2">
        <p className="text-xs font-semibold text-gray-600">{c.animateurNom}</p>
        <div className="grid grid-cols-2 gap-2">
          <input type="date" value={f.dateDebut} onChange={e => setF(s => ({ ...s, dateDebut: e.target.value }))}
            className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm" />
          <input type="date" value={f.dateFin} min={f.dateDebut} onChange={e => setF(s => ({ ...s, dateFin: e.target.value }))}
            className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm" />
          <select value={f.type} onChange={e => setF(s => ({ ...s, type: e.target.value }))}
            className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm">
            {Object.entries(TYPE_LABELS).filter(([k]) => k !== 'absent').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input type="text" value={f.motif} onChange={e => setF(s => ({ ...s, motif: e.target.value }))}
            className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm" placeholder="Commentaire" />
        </div>
        <div className="flex gap-2">
          <button disabled={saving} onClick={() => onSave(c.id, f)}
            className="px-3 py-1.5 bg-[#6B1A6E] text-white text-sm font-semibold rounded-lg hover:bg-[#571558] disabled:opacity-40">Enregistrer</button>
          <button onClick={onEditCancel} className="px-3 py-1.5 bg-gray-100 text-gray-600 text-sm font-semibold rounded-lg hover:bg-gray-200">Annuler</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className={`text-[11px] px-2 py-0.5 rounded-full border shrink-0 ${TYPE_COLORS[c.type] ?? TYPE_COLORS.absent}`}>
        {TYPE_LABELS[c.type] ?? c.type}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 truncate">{c.animateurNom}</p>
        <p className="text-xs text-gray-500 truncate">
          {c.dateDebut === c.dateFin ? fmtJour(c.dateDebut) : `${fmtJour(c.dateDebut)} → ${fmtJour(c.dateFin)}`}
          {c.motif ? ` · ${c.motif}` : ''}
        </p>
      </div>
      {modifiable ? (
        <>
          <button onClick={onEditStart} title="Modifier" className="text-gray-400 hover:text-[#6B1A6E] text-sm">✏️</button>
          <button onClick={() => onDelete(c.id)} title="Supprimer" className="text-gray-400 hover:text-red-600 text-sm">🗑️</button>
        </>
      ) : c.source === 'recup' ? (
        <span className="text-[10px] text-gray-400 shrink-0">auto (récup)</span>
      ) : null}
    </div>
  );
}

// ── Onglet Récupération (animateur : ses demandes ; admin : les siennes) ───────
function RecupTab({ demandes, solde, onRefresh }: {
  demandes: Demande[]; solde: number; onRefresh: () => void;
}) {
  const [form, setForm] = useState({ date: '', heures: '', sens: 'credit' as 'credit' | 'debit', motif: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Heures déclarées mais pas encore validées : comptées séparément du solde,
  // qui ne reflète que les heures approuvées par un admin.
  const creditsEnAttente = demandes
    .filter(d => d.sens === 'credit' && d.statut === 'pending')
    .reduce((s, d) => s + d.heures, 0);

  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');

    // Validation explicite, avec un message qui nomme LE champ manquant.
    if (!form.date) { setError('Merci d’indiquer la date.'); return; }
    if (!form.heures || Number(form.heures) <= 0) { setError('Merci d’indiquer le nombre d’heures.'); return; }
    // L'objet est obligatoire pour une déclaration d'heures (justification) ;
    // pour une pose de récupération, il reste facultatif.
    if (form.sens === 'credit' && !form.motif.trim()) { setError('Merci d’indiquer l’objet des heures supplémentaires.'); return; }

    setSaving(true);
    try {
      const res = await fetch('/api/recuperation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, heures: Number(form.heures) }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess(form.sens === 'credit' ? 'Déclaration envoyée pour validation.' : 'Demande de récupération envoyée.');
        setForm({ date: '', heures: '', sens: form.sens, motif: '' });
        onRefresh();
      } else {
        setError(data.error ?? 'Erreur.');
      }
    } catch { setError('Erreur de connexion.'); }
    finally { setSaving(false); }
  }

  async function retirer(id: string) {
    if (!confirm('Retirer cette demande ?')) return;
    const res = await fetch(`/api/recuperation?id=${id}`, { method: 'DELETE' });
    if (res.ok) onRefresh();
  }

  return (
    <div className="space-y-4">
      {/* Solde — carte compacte */}
      <div className="flex items-center gap-4 bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="w-16 h-16 shrink-0 rounded-xl bg-gradient-to-br from-[#6B1A6E] to-[#8B2A8E] text-white flex items-center justify-center">
          <span className="text-xl font-extrabold">{solde}h</span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800">Mon solde de récupération</p>
          <p className="text-xs text-gray-400">disponibles à poser</p>
          {creditsEnAttente > 0 && (
            <p className="text-[11px] text-amber-600 mt-0.5">⏳ +{creditsEnAttente}h en attente de validation</p>
          )}
        </div>
      </div>

      <form onSubmit={envoyer} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3">
        <h3 className="text-sm font-bold text-gray-800">Nouvelle demande</h3>
        {error && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">⚠️ {error}</div>}
        {success && <div className="px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-green-700 text-xs">✅ {success}</div>}
        <div className="flex gap-2">
          <button type="button" onClick={() => setForm(f => ({ ...f, sens: 'credit' }))}
            className={`flex-1 py-2 rounded-lg border text-xs font-semibold ${form.sens === 'credit' ? 'border-[#6B1A6E] bg-[#6B1A6E] text-white' : 'border-gray-200 text-gray-600'}`}>
            ➕ Déclarer des heures
          </button>
          <button type="button" onClick={() => setForm(f => ({ ...f, sens: 'debit' }))}
            className={`flex-1 py-2 rounded-lg border text-xs font-semibold ${form.sens === 'debit' ? 'border-[#6B1A6E] bg-[#6B1A6E] text-white' : 'border-gray-200 text-gray-600'}`}>
            ➖ Poser une récupération
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Date *</label>
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Nombre d&apos;heures *</label>
            <input type="number" min="0.5" step="0.5" value={form.heures} onChange={e => setForm(f => ({ ...f, heures: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Ex : 3.5" />
          </div>
          <div className="col-span-2">
            {form.sens === 'credit' ? (
              <label className="block text-xs font-semibold text-gray-600 mb-1">Objet <span className="font-normal text-red-500">(obligatoire)</span></label>
            ) : (
              <label className="block text-xs font-semibold text-gray-600 mb-1">Commentaire <span className="font-normal text-gray-400">(facultatif)</span></label>
            )}
            <input type="text" value={form.motif} onChange={e => setForm(f => ({ ...f, motif: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
              placeholder={form.sens === 'credit' ? 'Ex : sortie prolongée, réunion du soir…' : 'Ex : rendez-vous personnel'} />
          </div>
        </div>
        <button type="submit" disabled={saving}
          className="w-full py-2.5 bg-[#6B1A6E] text-white text-sm font-bold rounded-lg hover:bg-[#571558] disabled:opacity-40">
          {saving ? 'Envoi…' : 'Envoyer pour validation'}
        </button>
      </form>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 text-sm font-bold text-gray-800">Mes demandes</div>
        {demandes.length === 0 ? (
          <div className="px-4 py-6 text-center text-gray-400 text-sm">Aucune demande.</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {demandes.map(d => <DemandeRow key={d.id} d={d} onRetirer={retirer} showNom={false} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Onglet Validations (admin) ────────────────────────────────────────────────
function ValidationsTab({ demandes, soldes, onRefresh }: {
  demandes: Demande[]; soldes: Record<string, number>; onRefresh: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const pending = demandes.filter(d => d.statut === 'pending');
  const traitees = demandes.filter(d => d.statut !== 'pending').slice(0, 20);

  const [editId, setEditId] = useState<string | null>(null);

  async function decider(id: string, decision: 'approve' | 'reject') {
    setBusy(id);
    try {
      const res = await fetch('/api/recuperation', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, decision }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error ?? 'Erreur');
      onRefresh();
    } finally { setBusy(null); }
  }

  async function supprimer(id: string) {
    if (!confirm('Supprimer définitivement cette demande de récupération ?')) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/recuperation?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) alert(data.error ?? 'Erreur');
      onRefresh();
    } finally { setBusy(null); }
  }

  async function enregistrerModif(id: string, patch: { date: string; heures: string; motif: string }) {
    setBusy(id);
    try {
      const res = await fetch('/api/recuperation', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, date: patch.date, heures: Number(patch.heures), motif: patch.motif }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error ?? 'Erreur'); return; }
      setEditId(null);
      onRefresh();
    } finally { setBusy(null); }
  }

  // Soldes par animateur (récapitulatif).
  const nomsParId = useMemo(() => {
    const m: Record<string, string> = {};
    demandes.forEach(d => { m[d.animateurId] = d.animateurNom; });
    return m;
  }, [demandes]);

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 text-sm font-bold text-gray-800">
          En attente de validation {pending.length > 0 && <span className="text-red-500">({pending.length})</span>}
        </div>
        {pending.length === 0 ? (
          <div className="px-4 py-6 text-center text-gray-400 text-sm">Aucune demande en attente.</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {pending.map(d => (
              <AdminDemandeRow key={d.id} d={d} soldeActuel={soldes[d.animateurId] ?? 0}
                busy={busy === d.id} editing={editId === d.id}
                onEditStart={() => setEditId(d.id)} onEditCancel={() => setEditId(null)}
                onSave={enregistrerModif} onDelete={supprimer} onDecider={decider} showActions />
            ))}
          </div>
        )}
      </div>

      {/* Soldes de l'équipe */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 text-sm font-bold text-gray-800">Soldes de l&apos;équipe</div>
        <div className="divide-y divide-gray-50">
          {Object.keys(soldes).length === 0 ? (
            <div className="px-6 py-6 text-center text-gray-400 text-sm">Aucun solde.</div>
          ) : (
            Object.entries(soldes).sort((a, b) => b[1] - a[1]).map(([id, s]) => (
              <div key={id} className="flex items-center justify-between px-4 py-2">
                <span className="text-sm text-gray-700">{nomsParId[id] ?? id}</span>
                <span className="text-sm font-bold text-[#6B1A6E]">{s}h</span>
              </div>
            ))
          )}
        </div>
      </div>

      {traitees.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 text-sm font-bold text-gray-800">Historique récent</div>
          <div className="divide-y divide-gray-50">
            {traitees.map(d => (
              <AdminDemandeRow key={d.id} d={d} soldeActuel={soldes[d.animateurId] ?? 0}
                busy={busy === d.id} editing={editId === d.id}
                onEditStart={() => setEditId(d.id)} onEditCancel={() => setEditId(null)}
                onSave={enregistrerModif} onDelete={supprimer} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Ligne de demande côté admin : affichage + actions (valider/refuser pour les
 * demandes en attente, modifier/supprimer pour toutes). L'édition se fait en
 * ligne, sans quitter la liste.
 */
function AdminDemandeRow({
  d, soldeActuel, busy, editing, showActions,
  onEditStart, onEditCancel, onSave, onDelete, onDecider,
}: {
  d: Demande;
  soldeActuel: number;
  busy: boolean;
  editing: boolean;
  showActions?: boolean;
  onEditStart: () => void;
  onEditCancel: () => void;
  onSave: (id: string, patch: { date: string; heures: string; motif: string }) => void;
  onDelete: (id: string) => void;
  onDecider?: (id: string, decision: 'approve' | 'reject') => void;
}) {
  const [f, setF] = useState({ date: d.date, heures: String(d.heures), motif: d.motif ?? '' });

  if (editing) {
    return (
      <div className="px-4 py-3 bg-amber-50/40 space-y-2">
        <p className="text-xs font-semibold text-gray-600">{d.animateurNom} · {d.sens === 'credit' ? 'Déclaration' : 'Pose'}</p>
        <div className="grid grid-cols-3 gap-2">
          <input type="date" value={f.date} onChange={e => setF(s => ({ ...s, date: e.target.value }))}
            className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm" />
          <input type="number" min="0.5" step="0.5" value={f.heures} onChange={e => setF(s => ({ ...s, heures: e.target.value }))}
            className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm" placeholder="Heures" />
          <input type="text" value={f.motif} onChange={e => setF(s => ({ ...s, motif: e.target.value }))}
            className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm" placeholder="Commentaire" />
        </div>
        <div className="flex gap-2">
          <button disabled={busy} onClick={() => onSave(d.id, f)}
            className="px-3 py-1.5 bg-[#6B1A6E] text-white text-sm font-semibold rounded-lg hover:bg-[#571558] disabled:opacity-40">Enregistrer</button>
          <button onClick={onEditCancel} className="px-3 py-1.5 bg-gray-100 text-gray-600 text-sm font-semibold rounded-lg hover:bg-gray-200">Annuler</button>
        </div>
      </div>
    );
  }

  const statutBadge = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-600' }[d.statut];
  const statutLabel = { pending: 'En attente', approved: 'Validée', rejected: 'Refusée' }[d.statut];

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${d.sens === 'credit' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
        {d.sens === 'credit' ? `+${d.heures}h` : `−${d.heures}h`}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 truncate">{d.animateurNom}</p>
        <p className="text-xs text-gray-500 truncate">
          {d.sens === 'credit' ? 'Déclaration' : 'Pose'} · {fmtJour(d.date)}{d.motif ? ` · ${d.motif}` : ''}
          {showActions ? ` · solde : ${soldeActuel}h` : ''}
        </p>
      </div>
      {showActions && onDecider ? (
        <>
          <button disabled={busy} onClick={() => onDecider(d.id, 'approve')}
            className="px-2.5 py-1.5 bg-green-500 text-white text-xs font-semibold rounded-lg hover:bg-green-600 disabled:opacity-40">Valider</button>
          <button disabled={busy} onClick={() => onDecider(d.id, 'reject')}
            className="px-2.5 py-1.5 bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-200 disabled:opacity-40">Refuser</button>
        </>
      ) : (
        <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${statutBadge}`}>{statutLabel}</span>
      )}
      <button onClick={onEditStart} title="Modifier" className="text-gray-400 hover:text-[#6B1A6E] text-sm">✏️</button>
      <button disabled={busy} onClick={() => onDelete(d.id)} title="Supprimer" className="text-gray-400 hover:text-red-600 text-sm disabled:opacity-40">🗑️</button>
    </div>
  );
}

function DemandeRow({ d, onRetirer, showNom }: { d: Demande; onRetirer?: (id: string) => void; showNom: boolean }) {
  const statutBadge = {
    pending: 'bg-amber-100 text-amber-700', approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-600',
  }[d.statut];
  const statutLabel = { pending: 'En attente', approved: 'Validée', rejected: 'Refusée' }[d.statut];
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${d.sens === 'credit' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
        {d.sens === 'credit' ? `+${d.heures}h` : `−${d.heures}h`}
      </span>
      <div className="flex-1">
        {showNom && <p className="text-sm font-semibold text-gray-800">{d.animateurNom}</p>}
        <p className="text-xs text-gray-500">
          {d.sens === 'credit' ? 'Déclaration' : 'Pose'} · {fmtJour(d.date)}{d.motif ? ` · ${d.motif}` : ''}
        </p>
      </div>
      <span className={`text-[11px] px-2 py-0.5 rounded-full ${statutBadge}`}>{statutLabel}</span>
      {onRetirer && d.statut === 'pending' && (
        <button onClick={() => onRetirer(d.id)} className="text-sm text-red-400 hover:text-red-600 font-medium">Retirer</button>
      )}
    </div>
  );
}
