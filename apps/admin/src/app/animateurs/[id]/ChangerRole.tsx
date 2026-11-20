'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { modifierAnimateur } from '../actions';
import type { Editeur } from '../ChoixRubriques';

/**
 * Passage animateur ↔ administrateur, dans « Gestion du compte ». Réservé au
 * compte qui gère les droits. Le compte reçoit le menu complet de son nouveau
 * rôle ; ses accès se règlent ensuite dans « Accès au menu ».
 */
export default function ChangerRole({ animateurId, prenom, role, editeur }: {
  animateurId: string; prenom: string; role: string; editeur: Editeur;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [erreur, setErreur] = useState('');
  if (!editeur.gereDroits || animateurId === editeur.id) return null;

  const estAdmin = role === 'admin';
  const cible = estAdmin ? 'animateur' : 'admin';

  async function changer() {
    const question = estAdmin
      ? `Repasser ${prenom} animateur ? Il retrouvera le menu animateur complet et perdra l’accès à l’administration.`
      : `Passer ${prenom} administrateur ? Il aura le menu admin complet ; vous pourrez ensuite limiter ses accès.`;
    if (!confirm(question)) return;
    setSaving(true);
    setErreur('');
    const res = await modifierAnimateur(animateurId, { role: cible, rubriques: null });
    setSaving(false);
    if (res.success) startTransition(() => router.refresh());
    else setErreur(res.error ?? 'Erreur lors du changement de rôle');
  }

  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Rôle</p>
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-700">{estAdmin ? 'Administrateur' : 'Animateur'}</span>
        <button
          type="button"
          onClick={changer}
          disabled={saving}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:border-[#6B1A6E] hover:text-[#6B1A6E] disabled:opacity-50"
        >
          {saving ? 'Changement…' : estAdmin ? 'Repasser animateur' : 'Passer administrateur'}
        </button>
      </div>
      {erreur && <p className="text-xs text-red-600 mt-1">{erreur}</p>}
    </div>
  );
}
