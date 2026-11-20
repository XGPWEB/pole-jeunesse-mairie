'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supprimerJeune } from '@/app/jeunes/actions';

export default function JeuneActions({
  jeuneId,
  jeuneNom,
}: {
  jeuneId: string;
  jeuneNom: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showConfirm, setShowConfirm] = useState(false);

  function handleDelete() {
    startTransition(async () => {
      const result = await supprimerJeune(jeuneId);
      if (result.success) {
        setShowConfirm(false);
        router.refresh();
      } else {
        alert(result.error ?? 'Erreur lors de la suppression');
        setShowConfirm(false);
      }
    });
  }

  return (
    <>
      <div className="flex gap-1">
        <Link
          href={`/animateur/jeunes/${jeuneId}/modifier`}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:border-[#1B3870] hover:text-[#1B3870] transition-colors text-sm"
          title="Modifier"
        >
          ✏️
        </Link>
        <button
          type="button"
          onClick={() => setShowConfirm(true)}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:border-red-400 hover:text-red-500 transition-colors text-sm"
          title="Supprimer"
        >
          🗑
        </button>
      </div>

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
