'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/dashboard', label: 'Tableau de bord', icon: '⊞' },
  { href: '/statistiques', label: 'Statistiques', icon: '📊' },
  { href: '/apparence', label: 'Apparence', icon: '🎨' },
  { href: '/admin/espaces', label: 'Espaces', icon: '🏠' },
  { href: '/activites', label: 'Activités', icon: '📅' },
  { href: '/jeunes', label: 'Jeunes', icon: '👥' },
  { href: '/animateurs', label: 'Animateurs', icon: '🛡️' },
  { href: '/presences', label: 'Présences', icon: '✅' },
  { href: '/inscriptions', label: 'Inscriptions', icon: '📋' },
  { href: '/admin/actualites', label: 'Actualités', icon: '📰' },
  { href: '/communication', label: 'Communication', icon: '💬' },
  { href: '/rgpd', label: 'RGPD', icon: '🔒' },
  { href: '/parametres', label: 'Paramètres', icon: '⚙️' },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-64 bg-[#6B1A6E] flex flex-col h-full shrink-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-white text-lg">
            🏛
          </div>
          <div>
            <div className="text-white/70 text-[10px] font-medium tracking-wider uppercase">Mairie de Nogent</div>
            <div className="text-white font-bold text-sm leading-tight">
              <span className="text-[#A8D8EA]">PÔLE</span> JEUNESSE
            </div>
          </div>
        </div>
        {/* Bande tricolore Nogent */}
        <div className="flex mt-3 rounded-full overflow-hidden h-1">
          <div className="bg-[#1B3870] flex-[3]" />
          <div className="bg-[#8DC63F] flex-1" />
          <div className="bg-[#29B5E8] flex-1" />
        </div>
      </div>

      {/* Badge admin */}
      <div className="px-5 py-3">
        <span className="inline-flex items-center gap-1.5 bg-white/10 text-white/80 text-xs font-semibold px-3 py-1.5 rounded-full border border-white/20">
          🛡 Interface Administration
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 pb-4 space-y-0.5">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                active
                  ? 'bg-white text-[#6B1A6E] shadow-sm'
                  : 'text-white/75 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/10">
        <div className="text-white/50 text-xs">v1.0 — Prototype 2026</div>
        <div className="flex gap-1.5 mt-2">
          <div className="w-2 h-2 rounded-full bg-[#8DC63F] animate-pulse" />
          <span className="text-white/60 text-xs">Serveur local actif</span>
        </div>
      </div>
    </aside>
  );
}
