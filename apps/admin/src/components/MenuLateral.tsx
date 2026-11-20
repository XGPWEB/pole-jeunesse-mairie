'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { EntreeMenu } from '@/lib/rubriques';

/**
 * Pièces communes aux menus latéraux (admin et animateur) : pictogrammes au
 * trait, familles titrées, lien de menu.
 *
 * Les entrées sont rangées par familles (Jeunes, Programme, Équipe, Bilans…)
 * et non plus en une seule liste : on cherche d'abord la famille, puis la page.
 * L'ordre est donc fixe ; chacun peut toujours masquer les entrées dont il ne
 * se sert pas (préférences `nav_prefs`).
 */

/** Tracés 24 × 24, dessinés au trait (stroke), sans remplissage. */
const TRACES: Record<string, ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  jeunes: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" /><path d="M18.5 14.4c2 .8 3 2.7 3 5.6" /></>,
  inscriptions: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  presences: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1" /><path d="m9 13 2 2 4-4" /></>,
  pij: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><path d="M12 7.5v.01" /></>,
  activites: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="m8 12 3 3 5-6" /></>,
  evenements: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  sorties: <><path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11Z" /><circle cx="12" cy="10" r="2.5" /></>,
  projets: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  animateurs: <path d="M12 3 5 6v5c0 4.5 2.9 8.3 7 10 4.1-1.7 7-5.5 7-10V6Z" />,
  administrateurs: <><path d="M12 3 5 6v5c0 4.5 2.9 8.3 7 10 4.1-1.7 7-5.5 7-10V6Z" /><path d="m9 12 2 2 4-4" /></>,
  conges: <><path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9Z" /><path d="M12 12v7a2 2 0 0 0 4 0" /></>,
  vehicules: <><path d="M3 16V9a2 2 0 0 1 2-2h9l5 4v5" /><path d="M9 16h6" /><circle cx="7" cy="16.5" r="2" /><circle cx="17" cy="16.5" r="2" /></>,
  statistiques: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  frequentation: <><path d="M3 3v18h18" /><path d="m7 15 4-5 3 3 5-7" /></>,
  actualites: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h6M7 12h10M7 16h10" /></>,
  notifications: <><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15Z" /><path d="M10 21h4" /></>,
  espaces: <><path d="M3 11 12 3l9 8" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>,
  apparence: <path d="M12 3s6 6.2 6 11a6 6 0 0 1-12 0c0-4.8 6-11 6-11Z" />,
  rgpd: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  parametres: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  monitoring: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  profil: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" /></>,
  administration: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" /></>,
  deconnexion: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  oeil: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  oeilBarre: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><path d="m4 4 16 16" /></>,
  reglages: <path d="M4 7h16M7 12h10M10 17h4" />,
};

export function Icone({ nom, className = 'w-[18px] h-[18px]' }: { nom: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden="true">
      {TRACES[nom] ?? TRACES.pij}
    </svg>
  );
}

export type { EntreeMenu, FamilleMenu } from '@/lib/rubriques';

export function TitreFamille({ children }: { children: ReactNode }) {
  return <p className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">{children}</p>;
}

/** Lien d'une entrée ; `couleur` est la teinte du menu, reprise sur l'entrée active. */
export function LienMenu({ entree, actif, couleur, apres }: { entree: EntreeMenu; actif: boolean; couleur: string; apres?: ReactNode }) {
  return (
    <Link
      href={entree.href}
      aria-current={actif ? 'page' : undefined}
      className={`flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-colors ${actif ? 'bg-white font-semibold shadow-sm' : 'font-medium text-white/75 hover:bg-white/10 hover:text-white'}`}
      style={actif ? { color: couleur } : undefined}
    >
      <Icone nom={entree.id} />
      <span className="flex-1 truncate">{entree.label}</span>
      {apres}
    </Link>
  );
}

export const estActif = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

// Définitions des familles : lib/rubriques.ts (lues aussi côté serveur pour les droits).
export { ADMINISTRATION, FAMILLES_ADMIN, FAMILLES_ANIMATEUR } from '@/lib/rubriques';
