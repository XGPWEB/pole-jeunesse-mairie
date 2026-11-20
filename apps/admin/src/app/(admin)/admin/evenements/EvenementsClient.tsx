'use client';
import { useState, useEffect } from 'react';
import { todayLocal } from '@/lib/dates';

interface Evenement {
  id: string;
  titre: string;
  date: string;
  heureDebut: string;
  heureFin?: string;
  lieu: string;
  description?: string;
  espaces?: string[];
}

const ESPACES_OPTIONS = ['Tous', 'Collégiens', 'Lycéens', 'PIJ', 'CLAS'];

const EMPTY_FORM = {
  titre: '', date: '', heureDebut: '', heureFin: '', lieu: '', description: '', espaces: ['Tous'] as string[],
};

export default function EvenementsClient({ initial }: { initial: Evenement[] }) {
  const [evenements, setEvenements] = useState<Evenement[]>(initial);
  const [showForm, setShowForm]     = useState(false);
  const [editing, setEditing]       = useState<Evenement | null>(null);
  const [form, setForm]             = useState({ ...EMPTY_FORM });
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const [tab, setTab]               = useState<'avenir' | 'passes'>('avenir');

  const today = todayLocal();
  const avenir = [...evenements].filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const passes = [...evenements].filter(e => e.date < today).sort((a, b) => b.date.localeCompare(a.date));

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setError('');
    setShowForm(true);
  }

  function openEdit(e: Evenement) {
    setEditing(e);
    setForm({
      titre:       e.titre,
      date:        e.date,
      heureDebut:  e.heureDebut,
      heureFin:    e.heureFin ?? '',
      lieu:        e.lieu,
      description: e.description ?? '',
      espaces:     e.espaces ?? ['Tous'],
    });
    setError('');
    setShowForm(true);
  }

  function toggleEspace(esp: string) {
    setForm(f => {
      if (esp === 'Tous') return { ...f, espaces: ['Tous'] };
      const without = f.espaces.filter(e => e !== 'Tous');
      if (without.includes(esp)) {
        const next = without.filter(e => e !== esp);
        return { ...f, espaces: next.length === 0 ? ['Tous'] : next };
      }
      return { ...f, espaces: [...without, esp] };
    });
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setSaving(true); setError('');
    try {
      const body = editing ? { ...form, id: editing.id } : form;
      const res  = await fetch('/api/evenements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        setEvenements(data.evenements);
        setShowForm(false);
        setEditing(null);
        setForm({ ...EMPTY_FORM });
      } else {
        setError(data.error ?? 'Erreur');
      }
    } catch { setError('Erreur réseau'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Supprimer cet événement ?')) return;
    const res  = await fetch(`/api/evenements?id=${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) setEvenements(data.evenements);
  }

  const list = tab === 'avenir' ? avenir : passes;

  return (
    <div className="p-8 space-y-6">
      {/* ── Onglets + Bouton nouveau ── */}
      <div className="flex items-center justify-between">
        <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
          {(['avenir', 'passes'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${tab === t ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {t === 'avenir' ? `📅 À venir (${avenir.length})` : `🗂 Passés (${passes.length})`}
            </button>
          ))}
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#6B1A6E] text-white font-bold rounded-xl hover:bg-[#5a1560] transition-colors text-sm">
          + Nouvel événement
        </button>
      </div>

      {/* ── Formulaire création / modification ── */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-md p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-bold text-gray-800 text-base">
              {editing ? '✏️ Modifier l\'événement' : '➕ Nouvel événement'}
            </h3>
            <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">⚠️ {error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Titre */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Titre *</label>
              <input type="text" required value={form.titre}
                onChange={e => setForm(f => ({ ...f, titre: e.target.value }))}
                placeholder="Ex: Forum des associations, Tournoi sportif..."
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30" />
            </div>

            {/* Date + Heures */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Date *</label>
                <input type="date" required value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Heure début *</label>
                <input type="time" required value={form.heureDebut}
                  onChange={e => setForm(f => ({ ...f, heureDebut: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Heure fin</label>
                <input type="time" value={form.heureFin}
                  onChange={e => setForm(f => ({ ...f, heureFin: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30" />
              </div>
            </div>

            {/* Lieu */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Lieu *</label>
              <input type="text" required value={form.lieu}
                onChange={e => setForm(f => ({ ...f, lieu: e.target.value }))}
                placeholder="Ex: Salle des fêtes, 68 rue de Plaisance..."
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30" />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
              <textarea value={form.description} rows={2}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Décrivez l'événement..."
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30 resize-none" />
            </div>

            {/* Espaces */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Espaces concernés</label>
              <div className="flex flex-wrap gap-2">
                {ESPACES_OPTIONS.map(esp => {
                  const active = form.espaces.includes(esp);
                  return (
                    <button key={esp} type="button" onClick={() => toggleEspace(esp)}
                      className={`px-3 py-1.5 text-sm font-semibold rounded-lg border transition-all ${
                        active ? 'bg-[#6B1A6E] text-white border-[#6B1A6E]' : 'bg-white text-gray-600 border-gray-200 hover:border-[#6B1A6E]/40'
                      }`}>
                      {esp}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Boutons */}
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={saving}
                className="flex-1 py-3 bg-[#6B1A6E] text-white font-bold rounded-xl hover:bg-[#5a1560] transition-colors disabled:opacity-50 text-sm">
                {saving ? '⟳ Enregistrement...' : editing ? '💾 Mettre à jour' : '✅ Créer l\'événement'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="px-6 py-3 bg-gray-100 text-gray-600 font-medium rounded-xl hover:bg-gray-200 text-sm">
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Liste des événements ── */}
      {list.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-16 text-center">
          <div className="text-4xl mb-4">{tab === 'avenir' ? '📅' : '🗂'}</div>
          <p className="text-gray-500 font-medium">
            {tab === 'avenir' ? 'Aucun événement à venir' : 'Aucun événement passé'}
          </p>
          {tab === 'avenir' && (
            <button onClick={openCreate} className="mt-4 px-5 py-2 bg-[#6B1A6E] text-white text-sm font-semibold rounded-xl hover:bg-[#5a1560]">
              Créer le premier événement
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {list.map(e => {
            const isPast = e.date < today;
            return (
              <div key={e.id} className={`bg-white rounded-xl border shadow-sm p-5 flex items-start gap-4 ${isPast ? 'opacity-70 border-gray-100' : 'border-gray-100'}`}>
                {/* Date */}
                <div className={`w-14 h-14 rounded-xl flex flex-col items-center justify-center shrink-0 ${isPast ? 'bg-gray-100' : 'bg-[#6B1A6E]/10'}`}>
                  <span className={`text-lg font-extrabold leading-none ${isPast ? 'text-gray-400' : 'text-[#6B1A6E]'}`}>
                    {new Date(e.date + 'T12:00:00').getDate()}
                  </span>
                  <span className={`text-[10px] uppercase font-semibold ${isPast ? 'text-gray-400' : 'text-[#6B1A6E]/70'}`}>
                    {new Date(e.date + 'T12:00:00').toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })}
                  </span>
                </div>

                {/* Infos */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-gray-800">{e.titre}</p>
                    {e.espaces?.map(esp => (
                      <span key={esp} className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-medium">{esp}</span>
                    ))}
                  </div>
                  {e.description && (
                    <p className="text-sm text-gray-500 mt-1 line-clamp-1">{e.description}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    🕐 {e.heureDebut}{e.heureFin ? `–${e.heureFin}` : ''} &nbsp;·&nbsp; 📍 {e.lieu}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => openEdit(e)}
                    className="px-3 py-1.5 text-sm bg-[#6B1A6E]/10 text-[#6B1A6E] font-semibold rounded-lg hover:bg-[#6B1A6E]/20 transition-colors">
                    ✏️ Modifier
                  </button>
                  <button onClick={() => handleDelete(e.id)}
                    className="px-3 py-1.5 text-sm bg-red-50 text-red-500 font-semibold rounded-lg hover:bg-red-100 transition-colors">
                    🗑 Supprimer
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
