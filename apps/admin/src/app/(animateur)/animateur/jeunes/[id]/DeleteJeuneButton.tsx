'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supprimerJeune } from '@/app/jeunes/actions';

export default function DeleteJeuneButton({
  jeuneId,
  jeuneNom,
}: {
  jeuneId: string;
  jeuneNom: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await supprimerJeune(jeuneId);
      if (result.success) {
        router.push('/animateur/jeunes');
        router.refresh();
      } else {
        setError(result.error ?? 'Erreur lors de la suppression');
        setShowConfirm(false);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowConfirm(true)}
        className="border border-red-300 text-red-600 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-50 transition-colors"
      >
        🗑 Supprimer
      </button>

      {error && (
        <div className="fixed top-4 right-4 z-50 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg shadow-lg">
          {error}
        </div>
      )}

      {showConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4">
            <div className="text-center mb-6">
              <div className="text-5xl mb-4">🗑</div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">
                Supprimer la fiche de {jeuneNom} ?
              </h3>
              <p className="text-sm text-gray-500">
                Cette action est irreversible. Toutes les donnees de ce jeune seront supprimees definitivement.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 border border-gray-200 text-gray-600 px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="flex-1 bg-red-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {isPending ? 'Suppression...' : 'Oui, supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
