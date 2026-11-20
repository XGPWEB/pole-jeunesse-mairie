'use client';

import { useState, useTransition, useRef } from 'react';
import { getAge } from '@/lib/dates';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supprimerJeune } from './actions';
import EspaceBadge from '@/components/EspaceBadge';

const ESPACES = [
  { value: '', label: 'Tous les espaces' },
  { value: 'collegiens', label: 'Collégiens' },
  { value: 'lyceens', label: 'Lycéens' },
  { value: 'pij', label: 'PIJ' },
  { value: 'clas', label: 'CLAS' },
];

export default function JeunesClient({ jeunes, basePath = '/admin/jeunes', accentColor = '#6B1A6E', initialEspace = '' }: { jeunes: any[]; basePath?: string; accentColor?: string; initialEspace?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState('');
  const [espaceFilter, setEspaceFilter] = useState(initialEspace);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Import CSV
  const [showImport, setShowImport] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; errors: any[]; message: string } | null>(null);
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) { setImportError('Sélectionnez un fichier CSV.'); return; }
    setImportLoading(true);
    setImportError('');
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/jeunes/import', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) { setImportError(data.error ?? 'Erreur import'); return; }
      setImportResult(data);
      if (data.imported > 0) router.refresh();
    } catch {
      setImportError('Erreur de connexion au serveur.');
    } finally {
      setImportLoading(false);
    }
  }

  // ── Filtrage ──────────────────────────────────────────────────────────────
  const filtered = jeunes.filter(j => {
    const matchSearch = !search || [j.nom, j.prenom, j.etablissement, j.classe]
      .join(' ').toLowerCase().includes(search.toLowerCase());
    const matchEspace = !espaceFilter || j.espaceId === espaceFilter;
    return matchSearch && matchEspace;
  });

  // ── Suppression ───────────────────────────────────────────────────────────
  function handleDelete(id: string) {
    setDeleteError(null);
    startTransition(async () => {
      const result = await supprimerJeune(id);
      if (result.success) {
        setConfirmDelete(null);
        router.refresh();
      } else {
        setDeleteError(result.error ?? 'Erreur lors de la suppression');
        setConfirmDelete(null);
      }
    });
  }

  return (
    <>
      {/* Recherche & filtres */}
      <div className="flex gap-3 mb-6">
        <input
          type="text"
          placeholder="🔍  Nom, établissement, classe…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-purple-600"
        />
        <select
          value={espaceFilter}
          onChange={e => setEspaceFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-600 focus:outline-none focus:border-purple-600"
        >
          {ESPACES.map(e => (
            <option key={e.value} value={e.value}>{e.label}</option>
          ))}
        </select>
        <button
          onClick={() => { setShowImport(true); setImportResult(null); setImportError(''); }}
          className="px-4 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 font-semibold hover:bg-gray-50 flex items-center gap-2 shrink-0"
        >
          📥 Importer CSV
        </button>
      </div>

      {deleteError && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
          ⚠️ {deleteError}
        </div>
      )}

      {/* Tableau */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <div className="text-4xl mb-3">🔍</div>
            <p className="font-medium">Aucun jeune trouvé</p>
            {(search || espaceFilter) && (
              <button onClick={() => { setSearch(''); setEspaceFilter(''); }}
                className="mt-2 text-purple-800 text-sm underline">
                Réinitialiser les filtres
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Jeune</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Espace</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Âge / Classe</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Établissement</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Contact famille</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Autorisations</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(j => {
                const age = getAge(j.dateNaissance);
                const contact = j.contacts?.[0];
                return (
                  <tr key={j.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-purple-100 flex items-center justify-center text-sm font-bold text-purple-800 shrink-0">
                          {j.prenom?.[0]}{j.nom?.[0]}
                        </div>
                        <div>
                          <div className="font-semibold text-gray-800">{j.prenom} {j.nom}</div>
                          <div className="text-xs text-gray-400">Né(e) le {new Date(j.dateNaissance).toLocaleDateString('fr-FR')}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5"><EspaceBadge espaceId={j.espaceId} /></td>
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-gray-700">{age} ans</div>
                      <div className="text-xs text-gray-400">{j.classe}</div>
                    </td>
                    <td className="px-5 py-3.5 text-gray-600 text-xs">{j.etablissement}</td>
                    <td className="px-5 py-3.5">
                      {contact && (
                        <div>
                          <div className="font-medium text-gray-700 text-xs">{contact.nom}</div>
                          <div className="text-xs text-gray-400">{contact.telephone}</div>
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex gap-1">
                        <span title="Sorties" className={`text-base ${j.autorisationSortie ? 'opacity-100' : 'opacity-20'}`}>🚶</span>
                        <span title="Photos" className={`text-base ${j.autorisationPhoto ? 'opacity-100' : 'opacity-20'}`}>📷</span>
                        <span title="Fiche sanitaire" className={`text-base ${j.autorisationSoinsBenins ? 'opacity-100' : 'opacity-20'}`}>📋</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex gap-1">
                        <Link href={`${basePath}/${j.id}`}
                          className="p-1.5 rounded-lg hover:bg-purple-50 text-gray-400 hover:text-purple-800 transition-colors"
                          title="Voir la fiche">👁</Link>
                        <Link href={`${basePath}/${j.id}/modifier`}
                          className="p-1.5 rounded-lg hover:bg-purple-50 text-gray-400 hover:text-purple-800 transition-colors"
                          title="Modifier">✏️</Link>
                        <button
                          onClick={() => setConfirmDelete(j.id)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                          title="Supprimer">🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal import CSV */}
      {showImport && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-800">📥 Importer des jeunes par CSV</h2>
              <button onClick={() => setShowImport(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-6 py-5 space-y-5">
              {!importResult ? (
                <>
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-700">
                    <p className="font-semibold mb-2">Format CSV attendu :</p>
                    <code className="block text-xs bg-white border border-blue-100 rounded p-2 font-mono whitespace-pre-wrap">
{`nom,prenom,dateNaissance,sexe,espace,etablissement,classe
Dupont,Jean,2011-03-15,M,collegiens,Collège Victor Hugo,5A
Martin,Sophie,2012-07-22,F,Espace Lycéens,Lycée Hector Berlioz,2nde`}
                    </code>
                    <p className="mt-2 text-xs">• Colonnes obligatoires : <strong>nom</strong>, <strong>prenom</strong></p>
                    <p className="text-xs">• Colonne <strong>espace</strong> (ou <strong>espaceId</strong>) : l&apos;identifiant ou le nom exact d&apos;un espace de votre structure, tel qu&apos;affiché dans la page Espaces</p>
                    <p className="text-xs">• Date : format AAAA-MM-JJ, jour existant et non futur</p>
                    <p className="text-xs">• Séparateur : virgule ou point-virgule</p>
                  </div>

                  {importError && (
                    <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">⚠️ {importError}</div>
                  )}

                  <form onSubmit={handleImport} className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Fichier CSV</label>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,text/csv"
                        required
                        className="block w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-purple-50 file:text-purple-700 file:font-semibold hover:file:bg-purple-100"
                      />
                    </div>
                    <div className="flex gap-3">
                      <button type="button" onClick={() => setShowImport(false)}
                        className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50">
                        Annuler
                      </button>
                      <button type="submit" disabled={importLoading}
                        className="flex-1 bg-[#6B1A6E] text-white py-2.5 rounded-xl text-sm font-bold hover:bg-[#5a1460] disabled:opacity-50 flex items-center justify-center gap-2">
                        {importLoading ? <><span className="animate-spin">⟳</span>Import en cours...</> : '📥 Importer'}
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <div className="space-y-4">
                  <div className={`px-4 py-3 rounded-xl text-sm font-semibold ${importResult.imported > 0 ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                    {importResult.imported > 0 ? '✅' : '⚠️'} {importResult.message}
                  </div>

                  {importResult.errors.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-gray-700">Lignes ignorées ({importResult.errors.length})</p>
                      <div className="max-h-48 overflow-y-auto space-y-1.5">
                        {importResult.errors.map((err: any, i: number) => (
                          <div key={i} className="text-xs bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                            <span className="font-bold text-red-600">Ligne {err.line} :</span>
                            <span className="text-red-700 ml-1">{err.message}</span>
                            {err.data && <div className="text-red-400 mt-0.5 font-mono">{err.data}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button onClick={() => { setImportResult(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                      className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50">
                      Importer un autre fichier
                    </button>
                    <button onClick={() => setShowImport(false)}
                      className="flex-1 bg-[#6B1A6E] text-white py-2.5 rounded-xl text-sm font-bold hover:bg-[#5a1460]">
                      Fermer
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmation suppression */}
      {confirmDelete && (() => {
        const j = jeunes.find(x => x.id === confirmDelete);
        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4">
              <div className="text-center mb-6">
                <div className="text-5xl mb-4">🗑</div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">
                  Supprimer la fiche de {j?.prenom} {j?.nom} ?
                </h3>
                <p className="text-sm text-gray-500">
                  Cette action est irréversible. Toutes les données de ce jeune seront supprimées définitivement.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="flex-1 border border-gray-200 text-gray-600 px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-colors"
                >
                  Annuler
                </button>
                <button
                  onClick={() => handleDelete(confirmDelete)}
                  disabled={isPending}
                  className="flex-1 bg-red-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {isPending ? 'Suppression…' : 'Oui, supprimer'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
