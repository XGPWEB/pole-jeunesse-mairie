'use client';

import { useState, useCallback } from 'react';

// ── DEFAULTS ─────────────────────────────────────────────────────────────────
const DEFAULT_NAV_ANIMATEUR = [
  { id: 'dashboard',    label: 'Tableau de bord',     icon: '⊞',  visible: true },
  { id: 'jeunes',       label: 'Fiches Jeunes',        icon: '👥', visible: true },
  { id: 'activites',    label: 'Activités',            icon: '✅', visible: true },
  { id: 'presences',    label: 'Présences',            icon: '📋', visible: true },
  { id: 'statistiques', label: 'Statistiques',         icon: '📊', visible: true },
  { id: 'evenements',   label: 'Événements',           icon: '📅', visible: true },
  { id: 'vehicules',    label: 'Réservation Véhicule', icon: '🚐', visible: true },
  { id: 'projets',      label: 'Espace Projet',        icon: '📁', visible: true },
  { id: 'sorties',      label: 'Fiche Sortie',         icon: '🗺️', visible: true },
  { id: 'profil',       label: 'Mon profil',           icon: '⚙️', visible: true },
];

// ── TYPES ────────────────────────────────────────────────────────────────────
type NavItem = { id: string; label: string; icon: string; visible: boolean };

type Theme = {
  couleurs:    { primaire: string; navy: string; green: string; cyan: string; background: string; texte: string };
  identiteWeb: { nomPlateforme: string; sousTitre: string };
  interfaceWeb: { rayonBordure: string; densiteCartes: string; ombresCartes: boolean; animationsActives: boolean; sidebarCompact: boolean };
  dashboardAdmin: { messageAccueil: string; afficherStatsJeunes: boolean; afficherStatsActivites: boolean; afficherStatsPresences: boolean; afficherNotifications: boolean; afficherProchaines: boolean; afficherEvenements: boolean; afficherPointsAttention: boolean };
  dashboardAnimateur: { messageAccueil: string; afficherNotifications: boolean; afficherProchaines: boolean; afficherEvenements: boolean; liensRapides: Array<{ label: string; url: string; icon: string }> };
  navigationAnimateur: { items: NavItem[] };
  // legacy fields kept for compat
  identite: any; espaces: any; header: any; accueil: any; navigation: any; notifications: any; typographie: any; interface: any;
};

type Section = 'couleurs' | 'identite' | 'miseEnPage' | 'dashboardAdmin' | 'dashboardAnimateur' | 'navigationAnimateur';
type PreviewMode = 'admin' | 'animateur';

// ── CONSTANTS ────────────────────────────────────────────────────────────────
const SECTIONS: { id: Section; label: string; icon: string; desc: string }[] = [
  { id: 'couleurs',           label: 'Couleurs',              icon: '🎨', desc: 'Palette et thème des interfaces' },
  { id: 'identite',           label: 'Identité',              icon: '🏷️', desc: 'Nom, sous-titre dans les sidebars' },
  { id: 'miseEnPage',         label: 'Mise en page',          icon: '🖥️', desc: 'Rayon, densité, ombres, animations' },
  { id: 'dashboardAdmin',     label: 'Dashboard Admin',       icon: '🛡️', desc: 'Sections visibles côté admin' },
  { id: 'dashboardAnimateur', label: 'Dashboard Animateur',   icon: '📊', desc: 'Message, widgets et liens rapides' },
  { id: 'navigationAnimateur',label: 'Navigation Animateur',  icon: '📍', desc: 'Masquer ou renommer les entrées menu' },
];

const PALETTE_PRESETS = [
  { name: 'Nogent (défaut)', primaire: '#6B1A6E', navy: '#1B3870', green: '#8DC63F', cyan: '#29B5E8' },
  { name: 'Bleu océan',      primaire: '#1565C0', navy: '#0D47A1', green: '#26A69A', cyan: '#00BCD4' },
  { name: 'Vert nature',     primaire: '#2E7D32', navy: '#1B5E20', green: '#66BB6A', cyan: '#26C6DA' },
  { name: 'Orange vif',      primaire: '#E65100', navy: '#BF360C', green: '#F9A825', cyan: '#039BE5' },
  { name: 'Gris pro',        primaire: '#37474F', navy: '#263238', green: '#78909C', cyan: '#4DD0E1' },
  { name: 'Rouge passion',   primaire: '#B71C1C', navy: '#880E4F', green: '#43A047', cyan: '#0288D1' },
];

const RAYON_OPTIONS = [
  { value: 'none',   label: 'Carré',        preview: '0px' },
  { value: 'small',  label: 'Léger',        preview: '6px' },
  { value: 'medium', label: 'Arrondi',      preview: '12px' },
  { value: 'large',  label: 'Très arrondi', preview: '20px' },
];

const DENSITE_OPTIONS = [
  { value: 'compact',      label: 'Compact',      desc: 'Espacement réduit' },
  { value: 'comfortable',  label: 'Confortable',  desc: 'Espacement standard' },
  { value: 'spacious',     label: 'Spacieux',     desc: 'Grands espaces' },
];

// ── SHARED UI ────────────────────────────────────────────────────────────────
function ColorPicker({ label, desc, value, onChange }: { label: string; desc?: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="w-44 shrink-0">
        <div className="text-sm text-gray-700 font-medium">{label}</div>
        {desc && <div className="text-xs text-gray-400">{desc}</div>}
      </div>
      <div className="flex items-center gap-2 flex-1">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
          className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5 shrink-0" />
        <input type="text" value={value.toUpperCase()}
          onChange={(e) => { const v = e.target.value; if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) onChange(v); }}
          className="flex-1 text-sm font-mono border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-purple-300" />
        <div className="w-8 h-8 rounded-lg border border-gray-200 shrink-0 shadow-sm" style={{ backgroundColor: value }} />
      </div>
    </div>
  );
}

function Toggle({ label, desc, value, onChange }: { label: string; desc?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
      <div>
        <div className="text-sm font-medium text-gray-800">{label}</div>
        {desc && <div className="text-xs text-gray-400 mt-0.5">{desc}</div>}
      </div>
      <button onClick={() => onChange(!value)}
        className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ml-4 ${value ? 'bg-[#6B1A6E]' : 'bg-gray-300'}`}>
        <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

// ── WEB PREVIEW ──────────────────────────────────────────────────────────────
function WebDashboardPreview({ theme, mode }: { theme: Theme; mode: PreviewMode }) {
  const sidebarBg   = mode === 'admin' ? theme.couleurs.primaire : theme.couleurs.navy;
  const sidebarText = mode === 'admin' ? theme.couleurs.navy     : theme.couleurs.primaire;
  const triBar1     = mode === 'admin' ? theme.couleurs.navy     : theme.couleurs.primaire;
  const d           = theme.dashboardAnimateur;
  const dAdmin      = theme.dashboardAdmin;
  const id          = theme.identiteWeb;

  const br = { none: '0px', small: '6px', medium: '12px', large: '20px' }[theme.interfaceWeb?.rayonBordure ?? 'medium'] ?? '12px';
  const compact = theme.interfaceWeb?.sidebarCompact;
  const shadow = theme.interfaceWeb?.ombresCartes ? '0 1px 3px rgba(0,0,0,0.08)' : 'none';

  const adminNav = [
    { label: 'Tableau de bord', icon: '⊞', active: true },
    { label: 'Statistiques',    icon: '📊' },
    { label: 'Fiches Jeunes',   icon: '👥' },
    { label: 'Activités',       icon: '✅' },
    { label: 'Animateurs',      icon: '🛡️' },
    { label: 'Notifications',   icon: '🔔' },
  ];
  const animNav = theme.navigationAnimateur?.items?.filter(i => i.visible !== false) ?? DEFAULT_NAV_ANIMATEUR.filter(i => i.visible);

  const nav = mode === 'admin' ? adminNav : animNav.map(i => ({ label: i.label, icon: i.icon, active: i.id === 'dashboard' }));

  const adminStats = [
    dAdmin?.afficherStatsJeunes     !== false && { label: 'Jeunes', val: '47', icon: '👥' },
    dAdmin?.afficherStatsActivites  !== false && { label: 'Activités', val: '12', icon: '✅' },
    dAdmin?.afficherStatsPresences  !== false && { label: 'Présences', val: '89%', icon: '📋' },
    { label: 'Notifications', val: '3', icon: '🔔' },
  ].filter(Boolean) as { label: string; val: string; icon: string }[];

  const animStats = [
    { label: 'Jeunes', val: '6', icon: '👥' },
    { label: "Aujourd'hui", val: '1', icon: '📅' },
    { label: 'À venir', val: '5', icon: '🗓️' },
    { label: 'Notifs', val: '0', icon: '🔔' },
  ];

  const stats = mode === 'admin' ? adminStats : animStats;

  return (
    <div className="flex rounded-2xl overflow-hidden border border-gray-200 bg-white" style={{ width: '100%', height: 420, boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
      {/* Sidebar */}
      <div className="flex flex-col shrink-0 overflow-hidden" style={{ width: compact ? 52 : 160, backgroundColor: sidebarBg, transition: 'width 0.3s' }}>
        {/* Logo */}
        <div className="px-3 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <img src="/logo-pj.png" alt="" className="shrink-0 rounded-lg object-contain bg-white/10 p-0.5" style={{ width: 28, height: 28 }} />
            {!compact && (
              <div className="min-w-0">
                <div className="text-white/60 text-[7px] font-medium uppercase tracking-wider truncate">{id?.sousTitre || 'Mairie de Nogent'}</div>
                <div className="text-white font-bold text-[8px] leading-tight truncate">
                  <span style={{ color: '#A8D8EA' }}>{(id?.nomPlateforme || 'Pôle Jeunesse').split(' ')[0]?.toUpperCase()}</span>{' '}
                  {(id?.nomPlateforme || 'Pôle Jeunesse').split(' ').slice(1).join(' ').toUpperCase()}
                </div>
              </div>
            )}
          </div>
          <div className="flex mt-2 rounded-full overflow-hidden" style={{ height: 3 }}>
            <div style={{ flex: 3, backgroundColor: triBar1 }} />
            <div style={{ flex: 1, backgroundColor: theme.couleurs.green }} />
            <div style={{ flex: 1, backgroundColor: theme.couleurs.cyan }} />
          </div>
        </div>
        {!compact && (
          <div className="px-3 py-2">
            <span className={`inline-flex text-[7px] font-semibold px-2 py-1 rounded-full border truncate ${mode === 'admin' ? 'text-yellow-300 border-yellow-400/30 bg-yellow-400/20' : 'text-[#A8D8EA] border-white/20 bg-white/10'}`}>
              {mode === 'admin' ? '👑 Super Admin' : '🎯 Espace Animateur'}
            </span>
          </div>
        )}
        {/* Nav */}
        <nav className="flex-1 px-2 pb-2 space-y-0.5 overflow-hidden">
          {nav.slice(0, 7).map((item, i) => (
            <div key={i} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[7px] font-medium ${(item as any).active ? 'bg-white' : 'text-white/70'}`}
              style={(item as any).active ? { color: sidebarBg } : undefined}>
              <span>{item.icon}</span>
              {!compact && <span className="truncate">{item.label}</span>}
            </div>
          ))}
        </nav>
        <div className="px-3 py-2 border-t border-white/10">
          <div className="flex gap-1 items-center">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: theme.couleurs.green }} />
            {!compact && <span className="text-white/40 text-[6px]">v2.0</span>}
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col bg-gray-50 overflow-hidden">
        {/* Topbar */}
        <div className="px-5 py-2.5 bg-white border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <div className="text-[10px] font-bold text-gray-800">
              {mode === 'admin' ? 'Tableau de bord' : 'Bonjour Animateur 👋'}
            </div>
            <div className="text-[8px] text-gray-400">
              {mode === 'admin' ? 'Vue globale — administration' : 'dimanche 5 avril 2026'}
            </div>
          </div>
          <span className="text-[8px] text-gray-400">☀️ 12°C</span>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col px-4 pt-3 pb-3 gap-3">
          {/* Message d'accueil */}
          {mode === 'admin' && dAdmin?.messageAccueil && (
            <div className="px-4 py-2 rounded-xl text-[8px] font-semibold text-white" style={{ backgroundColor: sidebarBg, borderRadius: br }}>
              {dAdmin.messageAccueil}
            </div>
          )}
          {mode === 'animateur' && d?.messageAccueil && (
            <div className="px-4 py-2 rounded-xl text-[8px] font-semibold text-white" style={{ backgroundColor: theme.couleurs.navy, borderRadius: br }}>
              {d.messageAccueil}
            </div>
          )}

          {/* Stats */}
          <div className="grid gap-2 shrink-0" style={{ gridTemplateColumns: `repeat(${stats.length}, 1fr)` }}>
            {stats.map((s) => (
              <div key={s.label} className="bg-white p-2.5 text-center" style={{ borderRadius: br, boxShadow: shadow }}>
                <div className="text-base leading-none">{s.icon}</div>
                <div className="text-sm font-bold text-gray-800 mt-0.5">{s.val}</div>
                <div className="text-[7px] text-gray-400 mt-0.5 leading-tight">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Sections */}
          <div className="flex gap-3 flex-1 overflow-hidden min-h-0">
            {(mode === 'admin' ? dAdmin?.afficherNotifications !== false : d?.afficherNotifications !== false) && (
              <div className="flex-1 bg-white overflow-hidden" style={{ borderRadius: br, boxShadow: shadow }}>
                <div className="px-3 py-2 border-b border-gray-50">
                  <div className="text-[8px] font-bold text-gray-700">🔔 Notifications</div>
                </div>
                <div className="p-2 space-y-1.5">
                  {['Bienvenue sur la nouvelle interface', 'Réunion d\'équipe vendredi 9h'].map((n, i) => (
                    <div key={i} className="text-[7px] text-gray-500 bg-gray-50 rounded-lg px-2 py-1.5">{n}</div>
                  ))}
                </div>
              </div>
            )}
            {(mode === 'admin' ? dAdmin?.afficherProchaines !== false : d?.afficherProchaines !== false) && (
              <div className="flex-1 bg-white overflow-hidden" style={{ borderRadius: br, boxShadow: shadow }}>
                <div className="px-3 py-2 border-b border-gray-50">
                  <div className="text-[8px] font-bold text-gray-700">📅 Prochaines activités</div>
                </div>
                <div className="p-2 space-y-1.5">
                  {['Sortie Cinéma — Bercy Village · 13:30', 'Tournoi FIFA 2026 · 16:00', 'Cinéma UGC Créteil · 10 avr.'].map((a, i) => (
                    <div key={i} className="text-[7px] text-gray-500 bg-gray-50 rounded-lg px-2 py-1.5">{a}</div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Liens rapides animateur */}
          {mode === 'animateur' && (d?.liensRapides?.length ?? 0) > 0 && (
            <div className="flex gap-2 flex-wrap shrink-0">
              {d.liensRapides.map((l, i) => (
                <span key={i} className="text-[7px] px-2 py-1 bg-white border border-gray-200 font-medium text-gray-700" style={{ borderRadius: br }}>{l.icon} {l.label}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── SECTION: COULEURS ─────────────────────────────────────────────────────────
function SectionCouleurs({ theme, update }: { theme: Theme; update: (p: string, v: any) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Palettes prédéfinies</div>
        <div className="grid grid-cols-2 gap-2">
          {PALETTE_PRESETS.map((p) => (
            <button key={p.name}
              onClick={() => { update('couleurs.primaire', p.primaire); update('couleurs.navy', p.navy); update('couleurs.green', p.green); update('couleurs.cyan', p.cyan); }}
              className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-gray-200 hover:border-[#6B1A6E] bg-white hover:bg-purple-50 transition-all text-left">
              <div className="flex gap-0.5">
                {[p.primaire, p.navy, p.green, p.cyan].map((c, i) => (
                  <div key={i} className="w-4 h-4 rounded-full border border-white shadow-sm" style={{ backgroundColor: c }} />
                ))}
              </div>
              <span className="text-xs text-gray-600 font-medium">{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      <hr className="border-gray-100" />

      <div className="space-y-1">
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Sidebars</div>
        <ColorPicker label="Admin (violet)" desc="Sidebar Super Admin" value={theme.couleurs.primaire} onChange={(v) => update('couleurs.primaire', v)} />
        <ColorPicker label="Animateur (bleu)" desc="Sidebar Espace Animateur" value={theme.couleurs.navy} onChange={(v) => update('couleurs.navy', v)} />
      </div>

      <div className="space-y-1">
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Barre tricolore & accents</div>
        <ColorPicker label="Vert" value={theme.couleurs.green} onChange={(v) => update('couleurs.green', v)} />
        <ColorPicker label="Cyan" value={theme.couleurs.cyan} onChange={(v) => update('couleurs.cyan', v)} />
      </div>

      {/* Swatches */}
      <div>
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Aperçu barre tricolore</div>
        <div className="flex gap-3 mb-3">
          {[
            { key: 'primaire', label: 'Admin' },
            { key: 'navy',     label: 'Animateur' },
            { key: 'green',    label: 'Vert' },
            { key: 'cyan',     label: 'Cyan' },
          ].map(({ key, label }) => (
            <div key={key} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full h-8 rounded-lg shadow-sm" style={{ backgroundColor: (theme.couleurs as any)[key] }} />
              <span className="text-[9px] text-gray-400">{label}</span>
            </div>
          ))}
        </div>
        <div className="flex rounded-full overflow-hidden h-2.5 shadow-sm">
          <div style={{ flex: 3, backgroundColor: theme.couleurs.navy }} />
          <div style={{ flex: 1, backgroundColor: theme.couleurs.green }} />
          <div style={{ flex: 1, backgroundColor: theme.couleurs.cyan }} />
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5 text-center">Barre sous le logo (sidebar animateur)</p>
      </div>
    </div>
  );
}

// ── SECTION: IDENTITÉ ────────────────────────────────────────────────────────
function SectionIdentite({ theme, update }: { theme: Theme; update: (p: string, v: any) => void }) {
  const id = theme.identiteWeb ?? { nomPlateforme: 'Pôle Jeunesse', sousTitre: 'Mairie de Nogent' };
  return (
    <div className="space-y-5">
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
        <strong>ℹ️ Sidebars admin & animateur</strong> — Ces textes apparaissent en haut de chaque barre latérale, sous le logo.
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-semibold text-gray-700">Nom de la plateforme</label>
        <input type="text" value={id.nomPlateforme ?? 'Pôle Jeunesse'}
          onChange={e => update('identiteWeb.nomPlateforme', e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
          placeholder="Pôle Jeunesse" />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-semibold text-gray-700">Sous-titre (ville / service)</label>
        <input type="text" value={id.sousTitre ?? 'Mairie de Nogent'}
          onChange={e => update('identiteWeb.sousTitre', e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
          placeholder="Mairie de Nogent" />
      </div>

      {/* Live preview sidebar header */}
      <div>
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Aperçu en-tête sidebar</div>
        <div className="flex gap-3">
          {[
            { bg: theme.couleurs.primaire, bar1: theme.couleurs.navy,    label: 'Admin' },
            { bg: theme.couleurs.navy,     bar1: theme.couleurs.primaire, label: 'Animateur' },
          ].map(({ bg, bar1, label }) => (
            <div key={label} className="flex-1 rounded-xl overflow-hidden border border-gray-100">
              <div className="px-3 py-3" style={{ backgroundColor: bg }}>
                <div className="flex items-center gap-2 mb-2">
                  <img src="/logo-pj.png" alt="" className="w-8 h-8 rounded-lg object-contain bg-white/10 p-0.5" />
                  <div>
                    <div className="text-white/60 text-[8px] font-medium uppercase tracking-wider">{id.sousTitre || 'Mairie de Nogent'}</div>
                    <div className="text-white font-bold text-[9px] leading-tight">
                      <span style={{ color: '#A8D8EA' }}>{(id.nomPlateforme || 'Pôle Jeunesse').split(' ')[0]?.toUpperCase()}</span>{' '}
                      {(id.nomPlateforme || 'Pôle Jeunesse').split(' ').slice(1).join(' ').toUpperCase()}
                    </div>
                  </div>
                </div>
                <div className="flex rounded-full overflow-hidden h-1">
                  <div style={{ flex: 3, backgroundColor: bar1 }} />
                  <div style={{ flex: 1, backgroundColor: theme.couleurs.green }} />
                  <div style={{ flex: 1, backgroundColor: theme.couleurs.cyan }} />
                </div>
              </div>
              <div className="px-2 py-1.5 bg-white text-center text-[9px] text-gray-400">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── SECTION: MISE EN PAGE ─────────────────────────────────────────────────────
function SectionMiseEnPage({ theme, update }: { theme: Theme; update: (p: string, v: any) => void }) {
  const iw = theme.interfaceWeb ?? { rayonBordure: 'medium', densiteCartes: 'comfortable', ombresCartes: true, animationsActives: true, sidebarCompact: false };
  return (
    <div className="space-y-6">
      {/* Rayon bordure */}
      <div>
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Rayon des cartes & éléments</div>
        <div className="grid grid-cols-2 gap-2">
          {RAYON_OPTIONS.map((opt) => (
            <button key={opt.value}
              onClick={() => update('interfaceWeb.rayonBordure', opt.value)}
              className={`flex items-center gap-3 px-3 py-3 rounded-xl border transition-all ${iw.rayonBordure === opt.value ? 'border-[#6B1A6E] bg-purple-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
              <div className="w-8 h-8 bg-gray-200 shrink-0" style={{ borderRadius: opt.preview }} />
              <div className="text-left">
                <div className={`text-sm font-semibold ${iw.rayonBordure === opt.value ? 'text-[#6B1A6E]' : 'text-gray-700'}`}>{opt.label}</div>
                <div className="text-xs text-gray-400">{opt.preview}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <hr className="border-gray-100" />

      {/* Densité */}
      <div>
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Densité des cartes</div>
        <div className="space-y-2">
          {DENSITE_OPTIONS.map((opt) => (
            <button key={opt.value}
              onClick={() => update('interfaceWeb.densiteCartes', opt.value)}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${iw.densiteCartes === opt.value ? 'border-[#6B1A6E] bg-purple-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
              <div className="text-left">
                <div className={`text-sm font-semibold ${iw.densiteCartes === opt.value ? 'text-[#6B1A6E]' : 'text-gray-700'}`}>{opt.label}</div>
                <div className="text-xs text-gray-400">{opt.desc}</div>
              </div>
              <div className={`w-4 h-4 rounded-full border-2 shrink-0 ${iw.densiteCartes === opt.value ? 'border-[#6B1A6E] bg-[#6B1A6E]' : 'border-gray-300'}`} />
            </button>
          ))}
        </div>
      </div>

      <hr className="border-gray-100" />

      {/* Toggles */}
      <div>
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Options d'affichage</div>
        <Toggle label="Ombres sur les cartes" desc="Effet de profondeur sur les blocs" value={iw.ombresCartes ?? true} onChange={(v) => update('interfaceWeb.ombresCartes', v)} />
        <Toggle label="Animations" desc="Transitions et effets de survol" value={iw.animationsActives ?? true} onChange={(v) => update('interfaceWeb.animationsActives', v)} />
        <Toggle label="Sidebar compacte" desc="Icônes seules, sans texte dans la sidebar animateur" value={iw.sidebarCompact ?? false} onChange={(v) => update('interfaceWeb.sidebarCompact', v)} />
      </div>
    </div>
  );
}

// ── SECTION: DASHBOARD ADMIN ─────────────────────────────────────────────────
function SectionDashboardAdmin({ theme, update }: { theme: Theme; update: (p: string, v: any) => void }) {
  const d = theme.dashboardAdmin ?? {
    messageAccueil: '', afficherStatsJeunes: true, afficherStatsActivites: true,
    afficherStatsPresences: true, afficherNotifications: true, afficherProchaines: true,
    afficherEvenements: true, afficherPointsAttention: true,
  };
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-bold text-gray-700 mb-1">Message d&apos;accueil admin</h3>
        <p className="text-xs text-gray-400 mb-2">Bannière affichée en haut du dashboard admin. Laisser vide pour masquer.</p>
        <input type="text" value={d.messageAccueil ?? ''}
          onChange={e => update('dashboardAdmin.messageAccueil', e.target.value)}
          placeholder="Ex : Bonne journée à toute l'équipe ! 🎉"
          className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
      </div>

      <div>
        <h3 className="text-sm font-bold text-gray-700 mb-1">Cartes statistiques</h3>
        <p className="text-xs text-gray-400 mb-3">Choisissez quelles métriques apparaissent en haut du dashboard.</p>
        <div className="space-y-0">
          <Toggle label="👥 Jeunes inscrits"  value={d.afficherStatsJeunes    ?? true} onChange={(v) => update('dashboardAdmin.afficherStatsJeunes', v)} />
          <Toggle label="✅ Activités & sorties" value={d.afficherStatsActivites ?? true} onChange={(v) => update('dashboardAdmin.afficherStatsActivites', v)} />
          <Toggle label="📋 Taux de présence" value={d.afficherStatsPresences  ?? true} onChange={(v) => update('dashboardAdmin.afficherStatsPresences', v)} />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold text-gray-700 mb-3">Sections du dashboard</h3>
        <div className="space-y-0">
          <Toggle label="🔔 Notifications admin"        desc="Demandes de réinitialisation et alertes"      value={d.afficherNotifications    ?? true} onChange={(v) => update('dashboardAdmin.afficherNotifications', v)} />
          <Toggle label="📅 Prochaines activités"       desc="Liste des activités et sorties à venir"       value={d.afficherProchaines       ?? true} onChange={(v) => update('dashboardAdmin.afficherProchaines', v)} />
          <Toggle label="🎉 Événements à venir"         desc="Calendrier des événements"                    value={d.afficherEvenements       ?? true} onChange={(v) => update('dashboardAdmin.afficherEvenements', v)} />
          <Toggle label="⚠️ Points d'attention"         desc="Alertes capacité, liste d'attente, etc."      value={d.afficherPointsAttention  ?? true} onChange={(v) => update('dashboardAdmin.afficherPointsAttention', v)} />
        </div>
      </div>
    </div>
  );
}

// ── SECTION: DASHBOARD ANIMATEUR ─────────────────────────────────────────────
function SectionDashboardAnimateur({ theme, update }: { theme: Theme; update: (p: string, v: any) => void }) {
  const d = theme.dashboardAnimateur;
  const [newLink, setNewLink] = useState({ label: '', url: '', icon: '🔗' });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-bold text-gray-700 mb-1">Message d&apos;accueil animateur</h3>
        <p className="text-xs text-gray-400 mb-2">Bannière bleue en haut du dashboard. Laisser vide pour masquer.</p>
        <input type="text" value={d.messageAccueil}
          onChange={e => update('dashboardAnimateur.messageAccueil', e.target.value)}
          placeholder="Ex : Bonjour l'équipe ! Bonne journée 👋"
          className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
      </div>

      <div>
        <h3 className="text-sm font-bold text-gray-700 mb-3">Sections visibles</h3>
        <div className="space-y-0">
          <Toggle label="🔔 Notifications"                  desc="Messages de l'administration"              value={d.afficherNotifications} onChange={(v) => update('dashboardAnimateur.afficherNotifications', v)} />
          <Toggle label="📅 Prochaines activités & sorties" desc="Planning des 7 prochains jours"            value={d.afficherProchaines}    onChange={(v) => update('dashboardAnimateur.afficherProchaines', v)} />
          <Toggle label="🎉 Événements à venir"             desc="Calendrier des événements"                 value={d.afficherEvenements}    onChange={(v) => update('dashboardAnimateur.afficherEvenements', v)} />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold text-gray-700 mb-1">Liens rapides</h3>
        <p className="text-xs text-gray-400 mb-3">Boutons de raccourci affichés sur le dashboard animateur.</p>
        <div className="space-y-2 mb-3">
          {d.liensRapides.map((lien, i) => (
            <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
              <span className="text-lg">{lien.icon}</span>
              <span className="text-sm font-medium flex-1">{lien.label}</span>
              <span className="text-xs text-gray-400 truncate max-w-[100px]">{lien.url}</span>
              <button onClick={() => { const arr = [...d.liensRapides]; arr.splice(i, 1); update('dashboardAnimateur.liensRapides', arr); }}
                className="text-red-400 hover:text-red-600 font-bold px-1">×</button>
            </div>
          ))}
          {d.liensRapides.length === 0 && <p className="text-xs text-gray-400 italic">Aucun lien rapide configuré.</p>}
        </div>
        <div className="flex gap-2">
          <input value={newLink.icon} onChange={e => setNewLink(p => ({ ...p, icon: e.target.value }))}
            className="w-12 px-2 py-2 border border-gray-200 rounded-lg text-sm text-center" placeholder="🔗" />
          <input value={newLink.label} onChange={e => setNewLink(p => ({ ...p, label: e.target.value }))}
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Nom du lien" />
          <input value={newLink.url} onChange={e => setNewLink(p => ({ ...p, url: e.target.value }))}
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="https://..." />
          <button
            onClick={() => { if (!newLink.label || !newLink.url) return; update('dashboardAnimateur.liensRapides', [...d.liensRapides, newLink]); setNewLink({ label: '', url: '', icon: '🔗' }); }}
            className="px-3 py-2 bg-[#6B1A6E] text-white text-sm font-bold rounded-lg hover:bg-[#551558]">+</button>
        </div>
      </div>
    </div>
  );
}

// ── SECTION: NAVIGATION ANIMATEUR ────────────────────────────────────────────
function SectionNavigation({ theme, update }: { theme: Theme; update: (p: string, v: any) => void }) {
  const items: NavItem[] = theme.navigationAnimateur?.items?.length
    ? theme.navigationAnimateur.items
    : DEFAULT_NAV_ANIMATEUR;

  function toggleVisible(id: string) {
    const updated = items.map(i => i.id === id ? { ...i, visible: !i.visible } : i);
    update('navigationAnimateur.items', updated);
  }

  function updateLabel(id: string, label: string) {
    const updated = items.map(i => i.id === id ? { ...i, label } : i);
    update('navigationAnimateur.items', updated);
  }

  const visible = items.filter(i => i.visible !== false).length;

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-700">
        <strong>📍 Navigation Espace Animateur</strong> — Masquez les rubriques inutilisées ou renommez-les. Au moins 1 élément doit rester visible.
      </div>

      <div className="text-xs text-gray-400 font-medium">{visible} / {items.length} éléments visibles</div>

      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${item.visible !== false ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
            {/* Visibility toggle */}
            <button
              onClick={() => { if (item.visible !== false || visible < items.length) toggleVisible(item.id); }}
              className={`w-9 h-5 rounded-full transition-colors shrink-0 ${item.visible !== false ? 'bg-[#6B1A6E]' : 'bg-gray-300'}`}>
              <div className={`w-3.5 h-3.5 bg-white rounded-full shadow transition-transform mx-auto-NO ${item.visible !== false ? 'translate-x-4' : 'translate-x-0.5'} relative`}
                style={{ transform: item.visible !== false ? 'translateX(18px)' : 'translateX(2px)' }} />
            </button>
            {/* Icon */}
            <span className="text-lg w-6 text-center">{item.icon}</span>
            {/* Label edit */}
            <input
              value={item.label}
              onChange={e => updateLabel(item.id, e.target.value)}
              disabled={item.visible === false}
              className="flex-1 text-sm font-medium text-gray-700 bg-transparent border-0 focus:outline-none focus:border-b-2 focus:border-[#6B1A6E] pb-0.5 disabled:text-gray-400"
            />
            {item.visible === false && <span className="text-xs text-gray-400 shrink-0">masqué</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── DEEP SETTER ───────────────────────────────────────────────────────────────
function setDeep(obj: any, path: string, value: any): any {
  const keys = path.split('.');
  const result = { ...obj };
  let current = result;
  for (let i = 0; i < keys.length - 1; i++) {
    current[keys[i]] = Array.isArray(current[keys[i]]) ? [...current[keys[i]]] : { ...current[keys[i]] };
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
  return result;
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
const DEFAULT_THEME_EXTRAS = {
  identiteWeb:   { nomPlateforme: 'Pôle Jeunesse', sousTitre: 'Mairie de Nogent' },
  interfaceWeb:  { rayonBordure: 'medium', densiteCartes: 'comfortable', ombresCartes: true, animationsActives: true, sidebarCompact: false },
  dashboardAdmin: { messageAccueil: '', afficherStatsJeunes: true, afficherStatsActivites: true, afficherStatsPresences: true, afficherNotifications: true, afficherProchaines: true, afficherEvenements: true, afficherPointsAttention: true },
  dashboardAnimateur: { messageAccueil: '', afficherNotifications: true, afficherProchaines: true, afficherEvenements: true, liensRapides: [] },
  navigationAnimateur: { items: DEFAULT_NAV_ANIMATEUR },
};

export default function ApparenceClient({ initialTheme }: { initialTheme: Theme }) {
  const [theme, setTheme] = useState<Theme>({ ...DEFAULT_THEME_EXTRAS, ...initialTheme });
  const [activeSection, setActiveSection] = useState<Section>('couleurs');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('animateur');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [saveError, setSaveError] = useState('');

  const update = useCallback((path: string, value: any) => {
    setTheme((prev) => setDeep(prev, path, value));
    setHasChanges(true);
    setSaved(false);
    setSaveError('');
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch('/api/theme', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(theme),
      });
      const data = await res.json();
      if (data.success) {
        setSaved(true);
        setHasChanges(false);
        setTimeout(() => setSaved(false), 4000);
      } else {
        setSaveError(data.error ?? 'Erreur lors de la sauvegarde');
      }
    } catch (e: any) {
      setSaveError('Erreur réseau');
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setTheme({ ...DEFAULT_THEME_EXTRAS, ...initialTheme });
    setHasChanges(false);
    setSaved(false);
    setSaveError('');
  }

  function handleExport() {
    const blob = new Blob([JSON.stringify(theme, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'theme-pole-jeunesse.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-8 py-4 bg-white border-b border-gray-100 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Apparence</h1>
          <p className="text-sm text-gray-500 mt-0.5">Personnalisez l'interface admin et animateur en temps réel</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport}
            className="text-sm text-gray-500 hover:text-[#6B1A6E] font-medium px-4 py-2 rounded-lg hover:bg-purple-50 border border-gray-200 transition-colors flex items-center gap-1.5">
            ⬇ Exporter JSON
          </button>
          {hasChanges && (
            <button onClick={handleReset}
              className="text-sm text-gray-500 hover:text-gray-700 font-medium px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors">
              Annuler
            </button>
          )}
          <button onClick={handleSave} disabled={!hasChanges || saving}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all ${
              saving ? 'bg-purple-300 text-white cursor-wait' :
              saved  ? 'bg-green-500 text-white' :
              hasChanges ? 'bg-[#6B1A6E] text-white hover:bg-[#5a1560] shadow-sm' :
              'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}>
            {saving ? '⏳ Sauvegarde...' : saved ? '✓ Enregistré !' : hasChanges ? '💾 Enregistrer' : 'Aucun changement'}
          </button>
        </div>
      </div>
      {saveError && (
        <div className="px-8 py-2 bg-red-50 border-b border-red-100 text-xs text-red-600 font-medium">
          ❌ {saveError}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left: nav + panel */}
        <div className="w-[340px] shrink-0 border-r border-gray-100 flex flex-col overflow-hidden bg-white">
          {/* Sections nav */}
          <div className="px-3 pt-3 pb-2 space-y-0.5 border-b border-gray-100 shrink-0">
            {SECTIONS.map((s) => (
              <button key={s.id} onClick={() => setActiveSection(s.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ${activeSection === s.id ? 'bg-purple-50 text-[#6B1A6E]' : 'text-gray-600 hover:bg-gray-50'}`}>
                <span className="text-base w-6 text-center">{s.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-semibold ${activeSection === s.id ? 'text-[#6B1A6E]' : 'text-gray-700'}`}>{s.label}</div>
                  <div className="text-xs text-gray-400 truncate">{s.desc}</div>
                </div>
                {activeSection === s.id && <div className="w-1.5 h-1.5 rounded-full bg-[#6B1A6E] shrink-0" />}
              </button>
            ))}
          </div>
          {/* Panel */}
          <div className="flex-1 overflow-y-auto p-5">
            {activeSection === 'couleurs'            && <SectionCouleurs            theme={theme} update={update} />}
            {activeSection === 'identite'            && <SectionIdentite            theme={theme} update={update} />}
            {activeSection === 'miseEnPage'          && <SectionMiseEnPage          theme={theme} update={update} />}
            {activeSection === 'dashboardAdmin'      && <SectionDashboardAdmin      theme={theme} update={update} />}
            {activeSection === 'dashboardAnimateur'  && <SectionDashboardAnimateur  theme={theme} update={update} />}
            {activeSection === 'navigationAnimateur' && <SectionNavigation          theme={theme} update={update} />}
          </div>
        </div>

        {/* Right: web preview */}
        <div className="flex-1 flex flex-col items-center justify-center gap-4 overflow-auto py-8 px-8 bg-gradient-to-br from-gray-100 to-gray-200">
          {/* Mode tabs */}
          <div className="flex gap-1 bg-white rounded-xl p-1 shadow-sm border border-gray-100 shrink-0">
            {([
              { id: 'admin',    label: '🛡️ Dashboard Admin' },
              { id: 'animateur',label: '🎯 Dashboard Animateur' },
            ] as { id: PreviewMode; label: string }[]).map((tab) => (
              <button key={tab.id} onClick={() => setPreviewMode(tab.id)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${previewMode === tab.id ? 'bg-[#6B1A6E] text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Mockup */}
          <div className="w-full max-w-3xl">
            <WebDashboardPreview theme={theme} mode={previewMode} />
          </div>

          {/* Hint */}
          <div className="text-xs text-gray-400 text-center">
            Aperçu en temps réel — les changements s'appliquent après sauvegarde
          </div>

          {hasChanges && !saving && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 shrink-0">
              <span className="text-amber-500">⚠️</span>
              <span className="text-xs text-amber-700 font-medium">Modifications non enregistrées</span>
              <button onClick={handleSave} className="ml-2 text-xs font-bold text-[#6B1A6E] hover:underline">Sauvegarder maintenant →</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
