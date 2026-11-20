'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DeleteProjetButton({ projetId, redirectTo }: { projetId: string; redirectTo: string }) {
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    setDeleting(true);
    try {
      const res  = await fetch(`/api/projets?id=${projetId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) router.push(redirectTo);
    } finally {
      setDeleting(false);
      setConfirm(false);
    }
  }

  if (confirm) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-7 text-center">
          <div className="text-4xl mb-3">🗑️</div>
          <h3 className="text-lg font-bold text-gray-800 mb-2">Supprimer ce projet ?</h3>
          <p className="text-sm text-gray-500 mb-6">
            Cette action est <strong>irréversible</strong>. Le projet et toutes ses données seront définitivement supprimés.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setConfirm(false)}
              className="flex-1 py-2.5 border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-50 transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex-1 py-2.5 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {deleting ? '⟳ Suppression...' : '🗑️ Supprimer'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirm(true)}
      className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 text-red-600 font-semibold rounded-xl hover:bg-red-100 transition-colors text-sm"
    >
      🗑️ Supprimer
    </button>
  );
}
