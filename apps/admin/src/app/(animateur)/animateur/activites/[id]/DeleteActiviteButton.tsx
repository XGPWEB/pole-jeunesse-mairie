'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supprimerActivite } from '@/app/activites/actions';

export default function DeleteActiviteButton({ activiteId }: { activiteId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showConfirm, setShowConfirm] = useState(false);

  function handleDelete() {
    startTransition(async () => {
      const result = await supprimerActivite(activiteId);
      if (result.success) {
        router.push('/animateur/activites');
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        onClick={() => setShowConfirm(true)}
        className="border border-red-300 text-red-500 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-50 transition-colors"
      >
        Supprimer
      </button>

      {showConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Supprimer cette activité ?</h3>
            <p className="text-sm text-gray-500 mb-6">
              Cette action est irréversible. L&apos;activité sera définitivement supprimée.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-semibold hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isPending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Suppression...
                  </>
                ) : 'Supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
