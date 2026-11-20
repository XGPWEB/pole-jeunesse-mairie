'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { modifierAnimateur } from '../actions';
import ChoixRubriques, { type Editeur } from '../ChoixRubriques';
import { rubriquesEffectives, type RoleRubriques } from '@/lib/rubriques';

interface Props {
  animateurId: string;
  prenom: string;
  role: string;
  /** Valeur en base : null = accès complet au menu du rôle. */
  rubriques: string[] | null;
  editeur: Editeur;
}

/**
 * Carte « Accès au menu » de la fiche d'un compte. Le rôle n'y est pas
 * choisi : il se change à part, dans « Gestion du compte » (ChangerRole).
 */
export default function AccesCompte({ animateurId, prenom, role: roleEnBase, rubriques: rubriquesInitiales, editeur }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const role: RoleRubriques = roleEnBase === 'admin' ? 'admin' : 'animateur';
  const depart = [...rubriquesEffectives({ role, rubriques: rubriquesInitiales })];
  const [rubriques, setRubriques] = useState<string[]>(depart);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  const soiMeme = animateurId === editeur.id;
  const accordables = new Set(editeur.rubriques);
  const depasse = depart.some(id => !accordables.has(id));
  const verrouille = !editeur.gereDroits || soiMeme || depasse;
  const modifie = rubriques.length !== depart.length || rubriques.some(id => !depart.includes(id));

  async function enregistrer() {
    setSaving(true);
    setMessage(null);
    const res = await modifierAnimateur(animateurId, { rubriques });
    setSaving(false);
    if (res.success) {
      setMessage({ ok: true, texte: `Accès enregistrés. ${prenom} devra se reconnecter pour voir son nouveau menu.` });
      startTransition(() => router.refresh());
    } else {
      setMessage({ ok: false, texte: res.error ?? 'Erreur lors de l’enregistrement' });
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
        <h2 className="font-bold text-gray-800 text-base">Accès au menu</h2>
      </div>
      <div className="p-6 space-y-4">
        {!editeur.gereDroits && (
          <p className="text-xs bg-gray-50 border border-gray-200 text-gray-600 rounded-lg px-3 py-2">
            Seul le compte qui gère les droits peut changer les accès de ce compte.
          </p>
        )}
        {editeur.gereDroits && soiMeme && (
          <p className="text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2">
            C’est votre propre compte : vous ne pouvez pas modifier vos accès.
          </p>
        )}
        {editeur.gereDroits && !soiMeme && depasse && (
          <p className="text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2">
            Ce compte a des rubriques que vous n’avez pas : seul un administrateur qui les a peut modifier ses accès.
          </p>
        )}
        <ChoixRubriques
          role={role}
          rubriques={rubriques}
          editeur={editeur}
          prenom={prenom}
          onRubriques={r => { setRubriques(r); setMessage(null); }}
          verrouille={verrouille}
        />
        {!verrouille && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={enregistrer}
              disabled={saving || !modifie}
              className="px-4 py-2 rounded-lg bg-[#6B1A6E] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Enregistrement…' : 'Enregistrer les accès'}
            </button>
            {message && <p className={`text-sm ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.texte}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
