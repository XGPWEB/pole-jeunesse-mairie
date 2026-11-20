'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { todayLocal } from '@/lib/dates';

interface Conge {
  id: string;
  animateurNom: string;
  dateDebut: string;
  dateFin: string;
}

/**
 * Widget dashboard (admin & animateur) : liste des personnes en congé le jour
 * même. Se charge côté client pour ne pas alourdir les pages serveur du
 * dashboard, déjà denses.
 *
 * `href` pointe vers le planning complet, différent selon le rôle.
 */
export default function CongesJourWidget({ href }: { href: string }) {
  const [conges, setConges] = useState<Conge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/conges')
      .then(r => r.json())
      .then(d => {
        const today = todayLocal();
        const duJour = (d.conges ?? []).filter((c: Conge) => today >= c.dateDebut && today <= c.dateFin);
        setConges(duJour);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-bold text-gray-800 text-sm">🌴 En congé aujourd&apos;hui</h3>
        <Link href={href} className="text-xs text-[#6B1A6E] font-semibold hover:underline">Planning →</Link>
      </div>
      <div className="p-2">
        {loading ? (
          <div className="px-3 py-4 text-center text-gray-300 text-sm">…</div>
        ) : conges.length === 0 ? (
          <div className="px-3 py-4 text-center text-gray-400 text-sm">Toute l&apos;équipe est présente 👍</div>
        ) : (
          <div className="space-y-1">
            {conges.map(c => (
              <div key={c.id} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50">
                <span className="w-2 h-2 rounded-full bg-[#6B1A6E] shrink-0" />
                <span className="text-sm text-gray-700">{c.animateurNom}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
