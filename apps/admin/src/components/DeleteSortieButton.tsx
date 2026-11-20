'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Bouton de suppression d'une fiche sortie (liste admin).
 * Confirmation en modale, puis DELETE /api/sorties et rafraîchissement de la
 * liste. La suppression est réservée à l'admin / au créateur côté serveur.
 */
export default function DeleteSortieButton({ sortieId, titre }: { sortieId: string; titre: string }) {
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/sorties?id=${sortieId}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) {
        setConfirm(false);
        router.refresh();
      } else {
        alert(data.error ?? 'Erreur lors de la suppression.');
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setConfirm(true)}
        title="Supprimer la fiche sortie"
        className="px-3 py-1.5 text-sm bg-red-50 text-red-600 font-medium rounded-lg hover:bg-red-100"
      >
        🗑️
      </button>

      {confirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-7 text-center">
            <div className="text-4xl mb-3">🗑️</div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">Supprimer cette fiche sortie ?</h3>
            <p className="text-sm text-gray-500 mb-6">
              « {titre} » et ses participants seront <strong>définitivement</strong> supprimés. Action irréversible.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirm(false)}
                className="flex-1 py-2.5 border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-50">
                Annuler
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 disabled:opacity-50">
                {deleting ? '⟳ Suppression…' : '🗑️ Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
