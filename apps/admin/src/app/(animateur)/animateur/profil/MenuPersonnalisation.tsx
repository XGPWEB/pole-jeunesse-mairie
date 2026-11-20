'use client';
import { useState } from 'react';
import { FAMILLES_ANIMATEUR, Icone } from '@/components/MenuLateral';

// Mêmes entrées, dans le même ordre, que le menu latéral (familles).
const NAV_ITEMS: { id: string; label: string; famille: string | null }[] = [
  ...FAMILLES_ANIMATEUR.flatMap(f => f.entrees.map(e => ({ id: e.id, label: e.label, famille: f.titre }))),
  { id: 'profil', label: 'Mon profil', famille: null },
];
const LABELS = Object.fromEntries(NAV_ITEMS.map(i => [i.id, i]));
const TOUJOURS_VISIBLE = new Set(['dashboard', 'profil']);

interface Pref { id: string; visible: boolean }

/** Liste dans l'ordre du menu ; seules les entrées masquées viennent des préférences. */
function initialListe(prefs: Pref[] | null): Pref[] {
  const masquees = new Set((prefs ?? []).filter(p => p.visible === false).map(p => p.id));
  return NAV_ITEMS.map(i => ({ id: i.id, visible: !masquees.has(i.id) }));
}

/** `rubriques` : rubriques ouvertes au compte ; les autres ne sont pas proposées. */
export default function MenuPersonnalisation({ navPrefs, rubriques }: { navPrefs: Pref[] | null; rubriques: string[] }) {
  const ouvertes = new Set(rubriques);
  const [liste, setListe] = useState<Pref[]>(() => initialListe(navPrefs));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  function toggle(id: string) {
    if (TOUJOURS_VISIBLE.has(id)) return;
    setListe(l => l.map(p => (p.id === id ? { ...p, visible: !p.visible } : p)));
    setMessage('');
  }

  async function enregistrer() {
    setSaving(true); setMessage('');
    try {
      const res = await fetch('/api/animateurs/nav-prefs', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: liste }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage('✅ Menu enregistré — actualisation…');
        // Rechargement complet : le sidebar est dans le layout, un simple
        // router.refresh() ne le met pas toujours à jour de façon fiable.
        window.location.reload();
      } else {
        setMessage(data.error ?? 'Erreur.');
        setSaving(false);
      }
    } catch { setMessage('Erreur de connexion.'); }
    finally { setSaving(false); }
  }

  async function reinitialiser() {
    if (!confirm('Rétablir le menu par défaut ?')) return;
    setSaving(true); setMessage('');
    try {
      await fetch('/api/animateurs/nav-prefs', { method: 'DELETE' });
      setMessage('✅ Menu réinitialisé — actualisation…');
      window.location.reload();
    } finally { setSaving(false); }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <h3 className="font-bold text-gray-800 mb-1">🧩 Personnaliser mon menu</h3>
      <p className="text-sm text-gray-500 mb-4">
        Masque les entrées dont tu ne te sers pas. Elles restent rangées par familles, dans l&apos;ordre du menu.
        « Tableau de bord » et « Mon profil » restent toujours visibles.
      </p>

      <div className="divide-y divide-gray-50 border border-gray-100 rounded-xl overflow-hidden">
        {liste.filter(p => TOUJOURS_VISIBLE.has(p.id) || ouvertes.has(p.id)).map(p => {
          const item = LABELS[p.id];
          if (!item) return null;
          return (
            <div key={p.id} className={`flex items-center gap-3 px-3 py-2.5 ${p.visible ? '' : 'bg-gray-50'}`}>
              <span className="w-6 flex justify-center text-gray-500"><Icone nom={p.id} /></span>
              <span className={`flex-1 text-sm font-medium ${p.visible ? 'text-gray-800' : 'text-gray-400 line-through'}`}>
                {item.label}
              </span>
              {TOUJOURS_VISIBLE.has(p.id) ? (
                <span className="text-[11px] text-gray-300">toujours affiché</span>
              ) : (
                <button onClick={() => toggle(p.id)}
                  className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${p.visible ? 'bg-green-50 text-green-600 hover:bg-green-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  {p.visible ? 'Visible' : 'Masqué'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {message && <p className="mt-3 text-sm text-gray-600">{message}</p>}

      <div className="flex gap-3 mt-4">
        <button onClick={enregistrer} disabled={saving}
          className="flex-1 py-2.5 bg-[#1B3870] text-white font-bold rounded-xl hover:bg-[#162d5e] disabled:opacity-40">
          {saving ? 'Enregistrement…' : 'Enregistrer mon menu'}
        </button>
        <button onClick={reinitialiser} disabled={saving}
          className="px-5 py-2.5 bg-gray-100 text-gray-600 font-medium rounded-xl hover:bg-gray-200 disabled:opacity-40">
          Réinitialiser
        </button>
      </div>
    </div>
  );
}
