'use client';

import { useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import { todayLocal } from '@/lib/dates';

/* ── Types ─────────────────────────────────────────────────────────── */
export interface Espace {
  id: string; nom: string; description: string; trancheAge: string;
  adresse: string; horaires: string; animateurRef: string;
  couleur: string; icon: string; capacite: number;
  telephone: string; email: string; statut: string;
}
interface Jeune { id: string; nom: string; prenom: string; espaceId: string; dateNaissance: string; sexe?: string; }
interface Activite { id: string; titre: string; espaceId: string; date: string; heureDebut: string; heureFin: string; animateur: string; statut: string; placesTotal: number; placesDisponibles: number; }
interface Pointage { id: string; espaceId: string; date: string; }
interface Animateur { id: string; nom: string; prenom: string; espaceAssigne: string; statut: string; }
interface Sortie { id: string; espaceId: string; }

/* ── Mapping noms courts (DB stocke 'Collégiens', pas 'collegiens') ── */
const SHORT_NAMES: Record<string, string> = {
  collegiens: 'Collégiens', lyceens: 'Lycéens', pij: 'PIJ', clas: 'CLAS',
};

/* ── Helpers ───────────────────────────────────────────────────────── */
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
function getAge(d: string) {
  const b = new Date(d), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() - b.getMonth() < 0 || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a;
}
function getIcon(e: Espace): string {
  if (e.icon && e.icon.trim() && Array.from(e.icon.trim()).length <= 2) return e.icon.trim();
  const fallback: Record<string, string> = { collegiens: '🏫', lyceens: '📚', pij: 'ℹ️', clas: '✏️' };
  return fallback[e.id] ?? '🏠';
}

const ICON_OPTIONS = ['🏠','🏫','📚','ℹ️','✏️','🎭','🎨','🎓','⚽','🎮','🎵','📖','🔬','🌱','💻','🌟','🎯','🏃','🏆','🎪','🎲','🏀','⚡','🌈','🎋'];

const EMPTY_FORM = (): Partial<Espace> => ({ nom: '', description: '', trancheAge: '', adresse: '', horaires: '', animateurRef: '', couleur: '#6B1A6E', icon: '🏠', capacite: 0, telephone: '', email: '', statut: 'actif' });

/* ── ModalFields — défini HORS du composant parent pour éviter les remontages React ── */
function ModalFields({ f, setF }: { f: Partial<Espace>; setF: (v: Partial<Espace>) => void }) {
  const inp = 'w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#6B1A6E] focus:ring-1 focus:ring-[#6B1A6E]/20';
  return (
    <div className="space-y-5">
      {/* Nom + Statut */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Nom de l&apos;espace *</label>
          <input type="text" value={f.nom || ''} onChange={e => setF({ ...f, nom: e.target.value })} className={inp} placeholder="Ex : Espace Collégiens" />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Statut</label>
          <select value={f.statut || 'actif'} onChange={e => setF({ ...f, statut: e.target.value })}
            className={inp + ' cursor-pointer'}>
            <option value="actif">Actif</option>
            <option value="inactif">Inactif</option>
            <option value="archive">Archivé</option>
          </select>
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Description</label>
        <textarea value={f.description || ''} onChange={e => setF({ ...f, description: e.target.value })} rows={3} className={inp + ' resize-none'} />
      </div>

      {/* Tranche âge + Capacité */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Tranche d&apos;âge</label>
          <input type="text" value={f.trancheAge || ''} onChange={e => setF({ ...f, trancheAge: e.target.value })} className={inp} placeholder="Ex : 10–14 ans" />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Capacité maximale</label>
          <input type="number" min={0} value={f.capacite ?? 0} onChange={e => setF({ ...f, capacite: parseInt(e.target.value) || 0 })} className={inp} />
        </div>
      </div>

      {/* Adresse */}
      <div>
        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Adresse</label>
        <input type="text" value={f.adresse || ''} onChange={e => setF({ ...f, adresse: e.target.value })} className={inp} placeholder="122 rue de Coulmiers, 94130 Nogent-sur-Marne" />
      </div>

      {/* Horaires */}
      <div>
        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
          Horaires <span className="text-gray-300 normal-case font-normal">(séparer plusieurs plages par |)</span>
        </label>
        <input type="text" value={f.horaires || ''} onChange={e => setF({ ...f, horaires: e.target.value })} className={inp} placeholder="Lun/Mar : 15h30–19h | Mer/Sam : 13h30–19h" />
      </div>

      {/* Téléphone + Email */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Téléphone</label>
          <input type="tel" value={f.telephone || ''} onChange={e => setF({ ...f, telephone: e.target.value })} className={inp} placeholder="01 XX XX XX XX" />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Email</label>
          <input type="email" value={f.email || ''} onChange={e => setF({ ...f, email: e.target.value })} className={inp} placeholder="contact@espace.fr" />
        </div>
      </div>

      {/* Animateur référent */}
      <div>
        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Animateur(s) référent(s)</label>
        <input type="text" value={f.animateurRef || ''} onChange={e => setF({ ...f, animateurRef: e.target.value })} className={inp} placeholder="Prénom NOM & Prénom NOM" />
      </div>

      {/* Couleur + Icône */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Couleur</label>
          <div className="flex items-center gap-3">
            <input type="color" value={f.couleur || '#6B1A6E'} onChange={e => setF({ ...f, couleur: e.target.value })}
              className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5" />
            <input type="text" value={f.couleur || ''} onChange={e => setF({ ...f, couleur: e.target.value })}
              className={inp + ' font-mono'} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Icône</label>
          <div className="flex flex-wrap gap-1.5 mt-1 max-h-20 overflow-y-auto">
            {ICON_OPTIONS.map(ic => (
              <button key={ic} type="button"
                onClick={() => setF({ ...f, icon: ic })}
                className={`w-8 h-8 rounded-md text-lg flex items-center justify-center transition-all ${f.icon === ic ? 'ring-2 ring-[#6B1A6E] bg-purple-50' : 'hover:bg-gray-100'}`}
              >
                {ic}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Component ─────────────────────────────────────────────────────── */
export default function EspacesAdminClient({
  initialEspaces, jeunes, activites, pointages, animateurs, sorties,
}: {
  initialEspaces: Espace[]; jeunes: Jeune[]; activites: Activite[];
  pointages: Pointage[]; animateurs: Animateur[]; sorties: Sortie[];
}) {
  const [espaces, setEspaces] = useState<Espace[]>(initialEspaces);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /* ── Edit modal ── */
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Espace>>({});
  const [saving, setSaving] = useState(false);

  /* ── Create modal ── */
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<Partial<Espace>>(EMPTY_FORM());
  const [creating, setCreating] = useState(false);

  /* ── Delete confirm ── */
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  /* ── Toast ── */
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function showToast(msg: string, ok = true) {
    clearTimeout(toastTimer.current);
    setToast({ msg, ok });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }

  /* ── Handlers ── */
  function openEdit(e: Espace) { setForm({ ...e }); setEditId(e.id); }
  function closeEdit() { setEditId(null); setForm({}); }

  async function handleSave() {
    if (!editId) return;
    setSaving(true);
    try {
      const res = await fetch('/api/espaces', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await res.json();
      if (data.success) {
        setEspaces(prev => prev.map(e => e.id === editId ? { ...e, ...form } as Espace : e));
        showToast('Espace mis à jour ✅');
        closeEdit();
      } else { showToast(data.error || 'Erreur', false); }
    } catch { showToast('Erreur réseau', false); }
    setSaving(false);
  }

  async function handleCreate() {
    if (!createForm.nom?.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/espaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(createForm) });
      const data = await res.json();
      if (data.success && data.espace) {
        setEspaces(prev => [...prev, data.espace as Espace]);
        showToast(`Espace "${data.espace.nom}" créé ✅`);
        setCreateOpen(false);
        setCreateForm(EMPTY_FORM());
      } else { showToast(data.error || 'Erreur', false); }
    } catch { showToast('Erreur réseau', false); }
    setCreating(false);
  }

  async function handleDelete() {
    if (!deleteId) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const res = await fetch(`/api/espaces/${deleteId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setEspaces(prev => prev.filter(e => e.id !== deleteId));
        if (selectedId === deleteId) setSelectedId(null);
        showToast('Espace supprimé');
        setDeleteId(null);
      } else { setDeleteError(data.error || 'Erreur'); }
    } catch { setDeleteError('Erreur réseau'); }
    setDeleting(false);
  }

  /* ── Stats ── */
  const stats = useMemo(() => {
    const today = todayLocal();
    return Object.fromEntries(espaces.map(e => {
      const shortName = SHORT_NAMES[e.id] ?? '';
      const ej = jeunes.filter(j => j.espaceId === e.id);
      const ea = activites.filter(a => a.espaceId === e.id);
      const ep = pointages.filter(p => p.espaceId === e.id);
      const eS = sorties.filter(s => s.espaceId === e.id || s.espaceId === shortName);
      /* Animateurs : seuls les directement assignés à l'espace (pas ceux en 'Tous') */
      const eAnim = animateurs.filter(a =>
        a.statut === 'actif' && (a.espaceAssigne === e.id || a.espaceAssigne === shortName)
      );
      const avenir = ea.filter(a => a.date >= today).sort((a, b) => a.date.localeCompare(b.date));
      const parSexe: Record<string, number> = { M: 0, F: 0 };
      ej.forEach(j => { if (j.sexe === 'M') parSexe.M++; else if (j.sexe === 'F') parSexe.F++; });
      const ages = ej.map(j => getAge(j.dateNaissance)).filter(a => a > 0 && a < 30);
      const ageMoyen = ages.length ? Math.round(ages.reduce((s, a) => s + a, 0) / ages.length * 10) / 10 : 0;
      return [e.id, { jeunes: ej, activites: ea, animateurs: eAnim, presences: ep.length, sorties: eS, activitesAvenir: avenir, parSexe, ageMoyen }];
    }));
  }, [espaces, jeunes, activites, pointages, animateurs, sorties]);

  const totals = useMemo(() => ({
    jeunes: jeunes.length,
    activites: activites.length,
    capacite: espaces.reduce((s, e) => s + e.capacite, 0),
    actifs: espaces.filter(e => e.statut !== 'inactif').length,
  }), [jeunes, activites, espaces]);

  const selected = selectedId ? espaces.find(e => e.id === selectedId) : null;
  const selStats = selectedId ? stats[selectedId] : null;

  /* ── Render ── */
  return (
    <div className="p-8 space-y-8">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 border shadow-lg rounded-xl px-5 py-3 text-sm font-semibold animate-in fade-in ${
          toast.ok ? 'bg-white border-gray-200 text-gray-800' : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* ── Header + Bouton Créer ── */}
      <div className="flex items-center justify-between">
        <div />
        <button
          onClick={() => { setCreateForm(EMPTY_FORM()); setCreateOpen(true); }}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#6B1A6E] text-white rounded-xl text-sm font-semibold hover:bg-[#551558] transition-colors shadow-sm"
        >
          + Nouvel espace
        </button>
      </div>

      {/* ── KPI Globaux ── */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Espaces actifs', value: totals.actifs, icon: '🏠', color: '#6B1A6E' },
          { label: 'Jeunes inscrits', value: totals.jeunes, icon: '👥', color: '#4A90D9' },
          { label: 'Activités totales', value: totals.activites, icon: '🎯', color: '#8B5CF6' },
          { label: 'Capacité globale', value: totals.capacite, icon: '📊', color: '#27AE60' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg" style={{ backgroundColor: kpi.color + '15' }}>
                {kpi.icon}
              </div>
              <div>
                <div className="text-2xl font-extrabold text-gray-900">{kpi.value}</div>
                <div className="text-xs text-gray-400 font-medium">{kpi.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Grille des espaces ── */}
      <div className="grid grid-cols-2 gap-6">
        {espaces.map(e => {
          const s = stats[e.id];
          const taux = e.capacite > 0 ? Math.round((s.jeunes.length / e.capacite) * 100) : 0;
          const isSelected = selectedId === e.id;
          const isInactif = e.statut === 'inactif' || e.statut === 'archive';

          return (
            <div
              key={e.id}
              className={`bg-white rounded-xl border-2 shadow-sm overflow-hidden cursor-pointer transition-all hover:shadow-md ${isSelected ? '' : 'border-gray-100'} ${isInactif ? 'opacity-60' : ''}`}
              style={isSelected ? { borderColor: e.couleur } : undefined}
              onClick={() => setSelectedId(isSelected ? null : e.id)}
            >
              <div className="h-2" style={{ backgroundColor: e.couleur }} />
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ backgroundColor: e.couleur + '18' }}>
                      {getIcon(e)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-extrabold text-gray-900">{e.nom}</h3>
                        {isInactif && (
                          <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-semibold uppercase">
                            {e.statut}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 font-medium">{e.trancheAge}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={ev => { ev.stopPropagation(); openEdit(e); }}
                      className="p-2 rounded-lg hover:bg-gray-50 text-gray-400 hover:text-[#6B1A6E] transition-colors"
                      title="Modifier"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={ev => { ev.stopPropagation(); setDeleteError(''); setDeleteId(e.id); }}
                      className="p-2 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors"
                      title="Supprimer"
                    >
                      🗑️
                    </button>
                  </div>
                </div>

                <p className="text-sm text-gray-500 mb-4 line-clamp-2">{e.description}</p>

                <div className="grid grid-cols-5 gap-1.5 mb-4">
                  {[
                    { v: s.jeunes.length,    l: 'Jeunes',     c: e.couleur, href: `/admin/jeunes?espace=${e.id}` },
                    { v: s.activites.length, l: 'Activités',  c: e.couleur, href: `/admin/activites?espace=${e.id}` },
                    { v: s.presences,        l: 'Présences',  c: e.couleur, href: `/admin/presences?espace=${e.id}` },
                    { v: s.sorties.length,   l: 'Sorties',    c: e.couleur, href: `/admin/sorties?espace=${e.id}` },
                    { v: s.animateurs.length,l: 'Animateurs', c: e.couleur, href: `/admin/animateurs?espace=${encodeURIComponent(SHORT_NAMES[e.id] ?? e.nom)}` },
                  ].map(k => (
                    <Link
                      key={k.l} href={k.href}
                      onClick={ev => ev.stopPropagation()}
                      className="text-center p-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                    >
                      <div className="text-base font-extrabold" style={{ color: k.c }}>{k.v}</div>
                      <div className="text-[9px] text-gray-400 font-medium leading-tight">{k.l}</div>
                    </Link>
                  ))}
                </div>

                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Taux d'occupation</span>
                    <span className="font-semibold" style={{ color: taux > 90 ? '#EF4444' : taux > 70 ? '#F59E0B' : e.couleur }}>
                      {s.jeunes.length}/{e.capacite} — {taux}%
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{
                      width: `${Math.min(taux, 100)}%`,
                      backgroundColor: taux > 90 ? '#EF4444' : taux > 70 ? '#F59E0B' : e.couleur,
                    }} />
                  </div>
                </div>

                {/* Contact + Animateurs */}
                <div className="mt-4 pt-3 border-t border-gray-100 space-y-1">
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <span>👤</span>
                    <span className="font-medium text-gray-700 truncate">{e.animateurRef || '—'}</span>
                  </div>
                  {(e.telephone || e.email) && (
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      {e.telephone && <span>📞 {e.telephone}</span>}
                      {e.email && <span>✉️ {e.email}</span>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Placeholder vide si 0 espaces */}
        {espaces.length === 0 && (
          <div className="col-span-2 text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">🏠</div>
            <p className="text-sm">Aucun espace. Créez votre premier espace ci-dessus.</p>
          </div>
        )}
      </div>

      {/* ── Détail espace sélectionné ── */}
      {selected && selStats && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="h-1.5" style={{ backgroundColor: selected.couleur }} />
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl" style={{ backgroundColor: selected.couleur + '18' }}>
                  {getIcon(selected)}
                </div>
                <div>
                  <h2 className="text-xl font-extrabold text-gray-900">{selected.nom}</h2>
                  <p className="text-sm text-gray-400">{selected.trancheAge} · {selected.adresse}</p>
                </div>
              </div>
              <button onClick={() => setSelectedId(null)} className="p-2 rounded-lg hover:bg-gray-50 text-gray-400 hover:text-gray-600">✕</button>
            </div>

            <div className="grid grid-cols-3 gap-6">
              {/* Col 1 — Infos */}
              <div className="space-y-5">
                <div>
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Informations</h4>
                  <div className="space-y-2 text-sm">
                    {selected.adresse && (
                      <div className="flex items-start gap-2 text-gray-600"><span className="shrink-0">📍</span><span>{selected.adresse}</span></div>
                    )}
                    {selected.horaires && (
                      <div className="flex items-start gap-2 text-gray-600">
                        <span className="shrink-0">🕐</span>
                        <span className="leading-relaxed">{selected.horaires.split('|').map((h, i) => <span key={i} className="block">{h.trim()}</span>)}</span>
                      </div>
                    )}
                    {selected.telephone && (
                      <div className="flex items-center gap-2 text-gray-600"><span className="shrink-0">📞</span><span>{selected.telephone}</span></div>
                    )}
                    {selected.email && (
                      <div className="flex items-center gap-2 text-gray-600"><span className="shrink-0">✉️</span><a href={`mailto:${selected.email}`} className="hover:underline">{selected.email}</a></div>
                    )}
                    <div className="flex items-center gap-2 text-gray-600"><span className="shrink-0">📊</span><span>Capacité : <strong>{selected.capacite}</strong> places</span></div>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Répartition</h4>
                  <div className="flex items-center gap-3">
                    {['M', 'F'].map(s => (
                      <div key={s} className="flex-1">
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span>{s === 'M' ? '♂ Garçons' : '♀ Filles'}</span>
                          <span>{selStats.parSexe[s]}</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${s === 'M' ? 'bg-blue-400' : 'bg-pink-400'}`}
                            style={{ width: `${selStats.jeunes.length ? selStats.parSexe[s] / selStats.jeunes.length * 100 : 0}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  {selStats.ageMoyen > 0 && <p className="text-xs text-gray-400 mt-2">Âge moyen : <strong className="text-gray-600">{selStats.ageMoyen} ans</strong></p>}
                </div>

                <div>
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Animateurs ({selStats.animateurs.length})</h4>
                  <div className="space-y-1.5">
                    {selStats.animateurs.map(a => (
                      <div key={a.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50">
                        <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">
                          {a.prenom[0]}{a.nom[0]}
                        </div>
                        <span className="text-sm font-medium text-gray-700">{a.prenom} {a.nom}</span>
                        {a.espaceAssigne === 'Tous' && (
                          <span className="ml-auto text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full font-medium">Tous</span>
                        )}
                      </div>
                    ))}
                    {selStats.animateurs.length === 0 && <p className="text-xs text-gray-400 italic">Aucun animateur assigné</p>}
                  </div>
                </div>
              </div>

              {/* Col 2 — Jeunes */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Jeunes inscrits ({selStats.jeunes.length})</h4>
                  <Link href="/admin/jeunes" className="text-xs font-semibold hover:underline" style={{ color: selected.couleur }}>Voir tous →</Link>
                </div>
                <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
                  {selStats.jeunes.slice(0, 20).map(j => (
                    <Link key={j.id} href={`/admin/jeunes/${j.id}`}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: selected.couleur }}>
                          {j.prenom[0]}{j.nom[0]}
                        </div>
                        <span className="text-sm font-medium text-gray-700">{j.prenom} {j.nom}</span>
                        <span className="text-[10px] text-gray-400">{getAge(j.dateNaissance)} ans</span>
                      </div>
                    </Link>
                  ))}
                  {selStats.jeunes.length === 0 && <p className="text-xs text-gray-400 italic py-4 text-center">Aucun jeune inscrit</p>}
                  {selStats.jeunes.length > 20 && <p className="text-xs text-gray-400 text-center py-2">… et {selStats.jeunes.length - 20} de plus</p>}
                </div>
              </div>

              {/* Col 3 — Activités à venir */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Prochaines activités ({selStats.activitesAvenir.length})</h4>
                  <Link href="/admin/activites" className="text-xs font-semibold hover:underline" style={{ color: selected.couleur }}>Voir toutes →</Link>
                </div>
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {selStats.activitesAvenir.slice(0, 8).map(a => (
                    <Link key={a.id} href={`/admin/activites/${a.id}`}
                      className="block p-3 rounded-lg border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-semibold text-gray-800">{a.titre}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{fmtDate(a.date)} · {a.heureDebut}–{a.heureFin}</p>
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          a.statut === 'ouvert' ? 'bg-green-100 text-green-700' :
                          a.statut === 'complet' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'
                        }`}>{a.statut === 'ouvert' ? 'Ouvert' : a.statut === 'complet' ? 'Complet' : a.statut}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.round(((a.placesTotal - a.placesDisponibles) / Math.max(a.placesTotal, 1)) * 100)}%`, backgroundColor: selected.couleur }} />
                        </div>
                        <span className="text-[10px] text-gray-400">{a.placesDisponibles}/{a.placesTotal}</span>
                      </div>
                    </Link>
                  ))}
                  {selStats.activitesAvenir.length === 0 && (
                    <div className="text-center py-8"><span className="text-3xl">📅</span><p className="text-xs text-gray-400 mt-2">Aucune activité à venir</p></div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Édition ── */}
      {editId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={closeEdit}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto" onClick={ev => ev.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-extrabold text-gray-900">Modifier l'espace</h3>
              <button onClick={closeEdit} className="p-2 rounded-lg hover:bg-gray-50 text-gray-400">✕</button>
            </div>
            <div className="p-6">
              <ModalFields f={form} setF={setForm} />
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
              <button onClick={closeEdit} className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm font-semibold hover:bg-gray-50">Annuler</button>
              <button onClick={handleSave} disabled={saving}
                className="px-5 py-2.5 bg-[#6B1A6E] text-white rounded-lg text-sm font-semibold hover:bg-[#551558] disabled:opacity-50 flex items-center gap-2">
                {saving ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Enregistrement…</> : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Création ── */}
      {createOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setCreateOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto" onClick={ev => ev.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-extrabold text-gray-900">Nouvel espace</h3>
              <button onClick={() => setCreateOpen(false)} className="p-2 rounded-lg hover:bg-gray-50 text-gray-400">✕</button>
            </div>
            <div className="p-6">
              <ModalFields f={createForm} setF={setCreateForm} />
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setCreateOpen(false)} className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm font-semibold hover:bg-gray-50">Annuler</button>
              <button onClick={handleCreate} disabled={creating || !createForm.nom?.trim()}
                className="px-5 py-2.5 bg-[#6B1A6E] text-white rounded-lg text-sm font-semibold hover:bg-[#551558] disabled:opacity-50 flex items-center gap-2">
                {creating ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Création…</> : "Créer l'espace"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Suppression ── */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => { setDeleteId(null); setDeleteError(''); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4" onClick={ev => ev.stopPropagation()}>
            <div className="p-6">
              <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center text-2xl mx-auto mb-4">🗑️</div>
              <h3 className="text-lg font-extrabold text-gray-900 text-center mb-2">Supprimer l'espace ?</h3>
              <p className="text-sm text-gray-500 text-center mb-4">
                <strong>{espaces.find(e => e.id === deleteId)?.nom}</strong>
                {' '}sera définitivement supprimé. Cette action est irréversible.
              </p>
              {deleteError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-4">{deleteError}</div>
              )}
              <div className="flex gap-3">
                <button onClick={() => { setDeleteId(null); setDeleteError(''); }}
                  className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm font-semibold hover:bg-gray-50">
                  Annuler
                </button>
                <button onClick={handleDelete} disabled={deleting || !!deleteError}
                  className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2">
                  {deleting ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Suppression…</> : 'Confirmer la suppression'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
