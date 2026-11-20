'use client';
import { useState } from 'react';
import { todayLocal } from '@/lib/dates';
import { estCategorieEvenement, estEvenementPasse } from '@/lib/actualites';

interface Actualite {
  id: string;
  titre: string;
  contenu: string;
  categorie: string;
  espaceId?: string | null;
  date: string;
  epingle: boolean;
  auteur: string;
}

const CATEGORIES = [
  { value: 'Info', label: 'Info', color: 'bg-blue-100 text-blue-700' },
  { value: 'Evenement', label: 'Événement', color: 'bg-amber-100 text-amber-700' },
  { value: 'Urgence', label: 'Urgence', color: 'bg-red-100 text-red-700' },
  { value: 'Divers', label: 'Divers', color: 'bg-gray-100 text-gray-600' },
  // Legacy categories from existing data
  { value: 'annonce', label: 'Annonce', color: 'bg-purple-100 text-purple-700' },
  { value: 'evenement', label: 'Événement', color: 'bg-amber-100 text-amber-700' },
  { value: 'atelier', label: 'Atelier', color: 'bg-green-100 text-green-700' },
  { value: 'sortie', label: 'Sortie', color: 'bg-indigo-100 text-indigo-700' },
];

const NEW_CATEGORIES = CATEGORIES.slice(0, 4);

function getCatStyle(cat: string) {
  return CATEGORIES.find(c => c.value === cat) ?? { value: cat, label: cat, color: 'bg-gray-100 text-gray-600' };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ActualitesAdminClient({
  initialActualites,
  auteurDefault,
}: {
  initialActualites: Actualite[];
  auteurDefault: string;
}) {
  const [actualites, setActualites] = useState<Actualite[]>(initialActualites);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  // Filtre : 'all', 'archives', ou le LIBELLÉ d'une catégorie (« Evenement » et
  // « evenement », saisis à des époques différentes, ne font qu'un seul filtre).
  const [filterCat, setFilterCat] = useState<string>('all');

  // Form state
  const [titre, setTitre] = useState('');
  const [contenu, setContenu] = useState('');
  const [categorie, setCategorie] = useState('Info');
  const [datePublication, setDatePublication] = useState(todayLocal());
  const [epingle, setEpingle] = useState(false);

  function resetForm() {
    setTitre('');
    setContenu('');
    setCategorie('Info');
    setDatePublication(todayLocal());
    setEpingle(false);
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(a: Actualite) {
    setTitre(a.titre);
    setContenu(a.contenu);
    setCategorie(a.categorie);
    setDatePublication(a.date);
    setEpingle(a.epingle);
    setEditingId(a.id);
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!titre.trim() || !contenu.trim()) return;
    setLoading(true);

    try {
      if (editingId) {
        // UPDATE
        const res = await fetch('/api/actualites', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingId,
            titre: titre.trim(),
            contenu: contenu.trim(),
            categorie,
            date: datePublication,
            epingle,
          }),
        });
        const json = await res.json();
        if (json.success) {
          setActualites(prev => prev.map(a => a.id === editingId ? json.actualite : a));
          resetForm();
        }
      } else {
        // CREATE
        const res = await fetch('/api/actualites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            titre: titre.trim(),
            contenu: contenu.trim(),
            categorie,
            date: datePublication,
            epingle,
            auteur: auteurDefault,
          }),
        });
        const json = await res.json();
        if (json.success) {
          setActualites(prev => [json.actualite, ...prev]);
          resetForm();
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/actualites?id=${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        setActualites(prev => prev.filter(a => a.id !== id));
        setDeleteConfirm(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // Un événement passé est archivé d'office dès le lendemain (lib/actualites.ts) :
  // il quitte la liste courante et les tableaux de bord, sans être supprimé.
  const aujourdhui = todayLocal();
  const archives = actualites.filter(a => estEvenementPasse(a, aujourdhui));
  const courantes = actualites.filter(a => !estEvenementPasse(a, aujourdhui));

  const filtered = filterCat === 'archives' ? archives
    : filterCat === 'all' ? courantes
    : courantes.filter(a => getCatStyle(a.categorie).label === filterCat);
  const sorted = [...filtered].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Catégories présentes dans la liste courante, regroupées par libellé.
  const allCats = Array.from(new Set(courantes.map(a => getCatStyle(a.categorie).label)));

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setFilterCat('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filterCat === 'all' ? 'bg-[#6B1A6E] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Toutes ({courantes.length})
          </button>
          {allCats.map(cat => {
            const style = CATEGORIES.find(c => c.label === cat) ?? getCatStyle(cat);
            const count = courantes.filter(a => getCatStyle(a.categorie).label === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setFilterCat(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  filterCat === cat ? 'bg-[#6B1A6E] text-white' : `${style.color} hover:opacity-80`
                }`}
              >
                {style.label} ({count})
              </button>
            );
          })}
          {archives.length > 0 && (
            <button
              onClick={() => setFilterCat('archives')}
              title="Événements dont la date est passée"
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                filterCat === 'archives' ? 'bg-[#6B1A6E] text-white' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              🗄 Archives ({archives.length})
            </button>
          )}
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="bg-[#6B1A6E] text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-[#551558] transition-colors shadow-sm flex items-center gap-2"
        >
          + Nouvelle actualité
        </button>
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => resetForm()}>
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 py-5 border-b border-gray-100">
              <h2 className="text-lg font-extrabold text-gray-900">
                {editingId ? 'Modifier l\'actualité' : 'Nouvelle actualité'}
              </h2>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              {/* Titre */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Titre *</label>
                <input
                  type="text"
                  value={titre}
                  onChange={e => setTitre(e.target.value)}
                  placeholder="Titre de l'actualité..."
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30 focus:border-[#6B1A6E]"
                  required
                />
              </div>

              {/* Contenu */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Contenu *</label>
                <textarea
                  value={contenu}
                  onChange={e => setContenu(e.target.value)}
                  placeholder="Contenu de l'actualité..."
                  rows={6}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30 focus:border-[#6B1A6E] resize-y"
                  required
                />
              </div>

              {/* Row: Categorie + Date */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Catégorie</label>
                  <select
                    value={categorie}
                    onChange={e => setCategorie(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30 focus:border-[#6B1A6E] bg-white"
                  >
                    {NEW_CATEGORIES.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                    {estCategorieEvenement(categorie) ? 'Date de l’événement' : 'Date de publication'}
                  </label>
                  <input
                    type="date"
                    value={datePublication}
                    onChange={e => setDatePublication(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#6B1A6E]/30 focus:border-[#6B1A6E]"
                  />
                  {estCategorieEvenement(categorie) && (
                    <p className="text-xs text-gray-400 mt-1.5">
                      Indiquez le jour de l’événement (son dernier jour s’il en dure plusieurs) : l’actualité passe aux archives le lendemain.
                    </p>
                  )}
                </div>
              </div>

              {/* Epingle */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={epingle}
                  onChange={e => setEpingle(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-[#6B1A6E] focus:ring-[#6B1A6E]"
                />
                <span className="text-sm font-medium text-gray-700">Épingler cette actualité (affichage prioritaire)</span>
              </label>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={loading || !titre.trim() || !contenu.trim()}
                  className="px-6 py-2.5 rounded-xl text-sm font-bold bg-[#6B1A6E] text-white hover:bg-[#551558] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Enregistrement...' : editingId ? 'Enregistrer' : 'Publier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">🗑</span>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Supprimer cette actualité ?</h3>
              <p className="text-sm text-gray-500 mb-6">Cette action est irréversible. L&apos;actualité sera définitivement supprimée.</p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirm)}
                  disabled={loading}
                  className="px-5 py-2.5 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {loading ? 'Suppression...' : 'Supprimer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {sorted.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">📰</div>
          <p className="text-gray-400 font-medium">{filterCat === 'archives' ? 'Aucun événement archivé' : 'Aucune actualité pour le moment'}</p>
          {filterCat !== 'archives' && <p className="text-gray-300 text-sm mt-1">Cliquez sur « Nouvelle actualité » pour en créer une</p>}
        </div>
      ) : (
        <div className="grid gap-4">
          {filterCat === 'archives' && (
            <p className="text-sm text-gray-500">
              Événements passés, retirés des tableaux de bord. Pour en remettre un à l’affiche, modifiez sa date ou sa catégorie.
            </p>
          )}
          {sorted.map(a => {
            const cat = getCatStyle(a.categorie);
            return (
              <div
                key={a.id}
                className={`bg-white rounded-xl border shadow-sm p-5 flex gap-4 hover:shadow-md transition-shadow ${
                  a.epingle ? 'border-[#6B1A6E]/30' : 'border-gray-100'
                }`}
              >
                {a.epingle && (
                  <div className="w-1 rounded-full bg-[#6B1A6E] shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${cat.color}`}>
                      {cat.label}
                    </span>
                    {a.epingle && (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#6B1A6E]/10 text-[#6B1A6E]">
                        Épinglé
                      </span>
                    )}
                    {estEvenementPasse(a, aujourdhui) && (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">
                        Archivé
                      </span>
                    )}
                    {a.categorie === 'Urgence' && (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-500 text-white animate-pulse">
                        URGENT
                      </span>
                    )}
                  </div>
                  <h3 className="font-bold text-gray-900 mb-1">{a.titre}</h3>
                  <p className="text-sm text-gray-500 line-clamp-2">{a.contenu}</p>
                  <div className="flex items-center gap-3 mt-3 text-xs text-gray-400">
                    <span>{a.auteur}</span>
                    <span>.</span>
                    <span>{formatDate(a.date)}</span>
                  </div>
                </div>
                <div className="flex gap-1 items-start shrink-0">
                  <button
                    onClick={() => startEdit(a)}
                    className="p-2 rounded-lg hover:bg-purple-50 text-gray-400 hover:text-[#6B1A6E] transition-colors"
                    title="Modifier"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(a.id)}
                    className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                    title="Supprimer"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
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
