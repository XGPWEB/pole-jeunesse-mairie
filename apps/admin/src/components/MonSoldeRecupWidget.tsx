'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Demande {
  id: string;
  sens: 'credit' | 'debit';
  heures: number;
  statut: 'pending' | 'approved' | 'rejected';
}

/**
 * Widget dashboard animateur : solde de récupération + nombre de demandes en
 * attente, avec un accès direct au formulaire de déclaration/pose.
 */
export default function MonSoldeRecupWidget() {
  const [solde, setSolde] = useState<number | null>(null);
  const [pending, setPending] = useState(0);
  const [creditsEnAttente, setCreditsEnAttente] = useState(0);

  useEffect(() => {
    fetch('/api/recuperation')
      .then(r => r.json())
      .then(d => {
        const demandes: Demande[] = d.demandes ?? [];
        setSolde(d.solde ?? 0);
        setPending(demandes.filter(x => x.statut === 'pending').length);
        setCreditsEnAttente(
          demandes.filter(x => x.sens === 'credit' && x.statut === 'pending').reduce((s, x) => s + x.heures, 0),
        );
      })
      .catch(() => setSolde(0));
  }, []);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-bold text-gray-800 text-sm">⏱ Mes heures de récupération</h3>
        <Link href="/animateur/conges" className="text-xs text-[#6B1A6E] font-semibold hover:underline">Gérer →</Link>
      </div>
      <div className="p-5 flex items-center gap-5 flex-1">
        <div className="text-center">
          <p className="text-4xl font-extrabold text-[#6B1A6E]">{solde === null ? '…' : `${solde}h`}</p>
          <p className="text-xs text-gray-400 mt-1">disponibles</p>
          {creditsEnAttente > 0 && (
            <p className="text-[11px] text-amber-600 mt-1">+{creditsEnAttente}h en attente</p>
          )}
        </div>
        <div className="flex-1 space-y-2">
          {pending > 0 && (
            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
              {pending} demande{pending > 1 ? 's' : ''} en attente de validation
            </p>
          )}
          <Link href="/animateur/conges"
            className="block text-center text-sm font-semibold text-[#6B1A6E] border border-[#6B1A6E]/30 rounded-lg py-2 hover:bg-[#6B1A6E]/5">
            Déclarer / poser des heures
          </Link>
        </div>
      </div>
    </div>
  );
}
