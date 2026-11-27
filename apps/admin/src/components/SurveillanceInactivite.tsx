'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

// ─── Fermeture de session après 10 minutes d'inactivité ──────────────────────
//
// Le serveur fait foi : le jeton de session expire 10 minutes après sa
// dernière prolongation (lib/auth.ts). Ce composant :
//   1. prolonge la session (POST /api/session/activite) sur une VRAIE action
//      de l'utilisateur — au plus une fois toutes les 30 s. Les
//      rafraîchissements automatiques des pages (badges, présences, tableau de
//      bord) ne passent pas par ici et ne gardent donc pas la session ouverte ;
//   2. prévient une minute avant la fermeture ;
//   3. renvoie vers l'écran de connexion quand le délai est écoulé.
//
// La dernière activité est partagée entre les onglets (localStorage) : une
// action dans un onglet garde aussi les autres ouverts, puisque le cookie de
// session est commun.

const INACTIVITE_MS = 10 * 60 * 1000;
const AVERTISSEMENT_MS = 60 * 1000;
const PROLONGATION_MIN_MS = 30 * 1000;
const CLE_PARTAGEE = 'pj_derniere_activite';
const EVENEMENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'] as const;

/** Pages sans session : rien à surveiller. */
const SANS_SESSION = ['/login', '/reinitialisation'];

function lirePartagee(): number {
  try { return Number(window.localStorage.getItem(CLE_PARTAGEE)) || 0; } catch { return 0; }
}
function ecrirePartagee(t: number): void {
  try { window.localStorage.setItem(CLE_PARTAGEE, String(t)); } catch { /* stockage indisponible */ }
}

export default function SurveillanceInactivite() {
  const pathname = usePathname();
  const actif = !SANS_SESSION.some((p) => pathname === p || pathname?.startsWith(`${p}/`));
  const [restantMs, setRestantMs] = useState<number | null>(null);
  const derniereActivite = useRef(0);
  const derniereProlongation = useRef(0);

  useEffect(() => {
    if (!actif) return;
    let ferme = false;

    const fermer = () => {
      if (ferme) return;
      ferme = true;
      window.location.href = '/login?motif=inactivite';
    };

    const prolonger = async () => {
      derniereProlongation.current = Date.now();
      try {
        const res = await fetch('/api/session/activite', { method: 'POST', credentials: 'same-origin' });
        if (res.status === 401) fermer();
      } catch { /* réseau coupé : le délai continue de courir */ }
    };

    const surActivite = () => {
      const maintenant = Date.now();
      derniereActivite.current = maintenant;
      ecrirePartagee(maintenant);
      setRestantMs(null);
      if (maintenant - derniereProlongation.current >= PROLONGATION_MIN_MS) void prolonger();
    };

    // Ouvrir ou recharger une page est une action de l'utilisateur.
    surActivite();

    const minuteur = window.setInterval(() => {
      const derniere = Math.max(derniereActivite.current, lirePartagee());
      const restant = INACTIVITE_MS - (Date.now() - derniere);
      if (restant <= 0) fermer();
      else setRestantMs(restant <= AVERTISSEMENT_MS ? restant : null);
    }, 5_000);

    for (const e of EVENEMENTS) window.addEventListener(e, surActivite, { passive: true });
    return () => {
      window.clearInterval(minuteur);
      for (const e of EVENEMENTS) window.removeEventListener(e, surActivite);
    };
  }, [actif]);

  if (!actif || restantMs === null) return null;
  const secondes = Math.max(1, Math.ceil(restantMs / 1000));
  return (
    <div role="alert" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] max-w-md w-[calc(100%-2rem)] bg-amber-50 border border-amber-300 text-amber-900 rounded-xl shadow-lg px-4 py-3 text-sm flex items-center gap-3">
      <span aria-hidden="true">⏳</span>
      <span className="flex-1">Sans action de votre part, la session se fermera dans {secondes} s.</span>
      <button type="button" className="font-semibold text-amber-900 underline">Rester connecté</button>
    </div>
  );
}
