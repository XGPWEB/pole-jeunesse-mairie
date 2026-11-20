'use client';

import { useState, useEffect, useCallback } from 'react';

type TabId = 'identite' | 'couleurs' | 'typographie' | 'contact' | 'reseaux' | 'footer';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'identite',     label: 'Identité',       icon: '🏷️' },
  { id: 'couleurs',     label: 'Couleurs',        icon: '🎨' },
  { id: 'typographie',  label: 'Typographie',     icon: '✍️' },
  { id: 'contact',      label: 'Contact',         icon: '📞' },
  { id: 'reseaux',      label: 'Réseaux sociaux', icon: '🌐' },
  { id: 'footer',       label: 'Pied de page',    icon: '📄' },
];

const FONT_OPTIONS = ['Inter', 'Poppins', 'Roboto', 'Montserrat', 'Open Sans'];
const SIZE_OPTIONS = ['14px', '15px', '16px', '18px'];

const DEFAULT_THEME = {
  identiteWeb: {
    nomPlateforme: 'Pôle Jeunesse',
    sousTitre: '',
    logo: null as string | null,
    favicon: null as string | null,
    siteWeb: '',
  },
  couleurs: {
    primaire: '#6B1A6E',
    secondaire: '#1B3870',
    accent: '#8DC63F',
    fond: '#f5f3ff',
    texte: '#1e1b4b',
  },
  typographie: {
    famille: 'Inter',
    tailleBase: '16px',
  },
  contact: {
    email: '',
    telephone: '',
    adresse: '',
  },
  reseaux: {
    facebook: '',
    instagram: '',
    twitter: '',
  },
  footerText: '',
};

type Theme = typeof DEFAULT_THEME;

// ── Composant ColorField ──────────────────────────────────────────────────────
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5 shrink-0"
        />
        <input
          type="text"
          value={value.toUpperCase()}
          onChange={e => { if (/^#[0-9A-Fa-f]{0,6}$/.test(e.target.value)) onChange(e.target.value); }}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-200"
        />
        <div className="w-9 h-9 rounded-lg border border-gray-200 shadow-sm shrink-0" style={{ backgroundColor: value }} />
      </div>
    </div>
  );
}

// ── Aperçu sidebar ────────────────────────────────────────────────────────────
function SidebarPreview({ theme }: { theme: Theme }) {
  const { couleurs, identiteWeb } = theme;
  return (
    <div className="rounded-2xl overflow-hidden border border-gray-200 shadow-sm" style={{ width: 180, height: 280 }}>
      {/* Sidebar */}
      <div className="flex flex-col h-full" style={{ backgroundColor: couleurs.primaire }}>
        <div className="px-3 py-3 border-b border-white/10">
          <div className="text-white/60 text-[8px] font-medium uppercase truncate">{identiteWeb.sousTitre || 'Ma ville'}</div>
          <div className="text-white font-bold text-[10px] leading-tight truncate" style={{ color: '#A8D8EA' }}>
            {identiteWeb.nomPlateforme || 'POLE JEUNESSE'}
          </div>
          <div className="flex mt-1.5 rounded-full overflow-hidden h-1">
            <div style={{ flex: 3, backgroundColor: couleurs.secondaire }} />
            <div style={{ flex: 1, backgroundColor: couleurs.accent }} />
            <div style={{ flex: 1, backgroundColor: '#29B5E8' }} />
          </div>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {['Tableau de bord', 'Jeunes', 'Activités', 'Statistiques'].map((item, i) => (
            <div key={item} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[8px] font-medium ${i === 0 ? 'bg-white' : 'text-white/70'}`}
              style={i === 0 ? { color: couleurs.primaire } : undefined}>
              <span className="text-[10px]">{['⊞', '👥', '📅', '📊'][i]}</span>
              <span>{item}</span>
            </div>
          ))}
        </nav>
        <div className="px-3 py-2 border-t border-white/10">
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: couleurs.accent }} />
        </div>
      </div>
    </div>
  );
}

// ── Section Identité ──────────────────────────────────────────────────────────
function SectionIdentite({ theme, update }: { theme: Theme; update: (path: string, v: any) => void }) {
  const id = theme.identiteWeb;
  const [logoPreviewOk, setLogoPreviewOk] = useState(!!id.logo);

  return (
    <div className="space-y-5">
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
        Ces informations apparaissent dans la sidebar, les emails et les documents générés par la plateforme.
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Nom de la plateforme</label>
          <input value={id.nomPlateforme} onChange={e => update('identiteWeb.nomPlateforme', e.target.value)}
            placeholder="Pôle Jeunesse"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Sous-titre / Ville</label>
          <input value={id.sousTitre} onChange={e => update('identiteWeb.sousTitre', e.target.value)}
            placeholder="Nogent-sur-Marne"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">URL du logo</label>
        <div className="flex gap-3 items-start">
          <input value={id.logo ?? ''} onChange={e => { update('identiteWeb.logo', e.target.value || null); setLogoPreviewOk(false); }}
            placeholder="https://maville.fr/logo.png"
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
          {id.logo && (
            <div className="w-10 h-10 rounded-lg border border-gray-200 overflow-hidden shrink-0 bg-gray-50 flex items-center justify-center">
              <img
                src={id.logo}
                alt="Logo"
                className="w-full h-full object-contain"
                onLoad={() => setLogoPreviewOk(true)}
                onError={() => setLogoPreviewOk(false)}
              />
            </div>
          )}
        </div>
        {id.logo && !logoPreviewOk && (
          <p className="text-xs text-amber-600">Image non chargeable à cette URL</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">URL du favicon</label>
        <input value={id.favicon ?? ''} onChange={e => update('identiteWeb.favicon', e.target.value || null)}
          placeholder="https://maville.fr/favicon.ico"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">Site web officiel</label>
        <input type="url" value={id.siteWeb} onChange={e => update('identiteWeb.siteWeb', e.target.value)}
          placeholder="https://www.maville.fr"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
      </div>
    </div>
  );
}

// ── Section Couleurs ──────────────────────────────────────────────────────────
function SectionCouleurs({ theme, update }: { theme: Theme; update: (path: string, v: any) => void }) {
  const c = theme.couleurs;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4">
        <ColorField label="Couleur primaire (sidebar admin)" value={c.primaire} onChange={v => update('couleurs.primaire', v)} />
        <ColorField label="Couleur secondaire (navy)" value={c.secondaire} onChange={v => update('couleurs.secondaire', v)} />
        <ColorField label="Couleur accent (vert)" value={c.accent} onChange={v => update('couleurs.accent', v)} />
        <ColorField label="Couleur de fond" value={c.fond} onChange={v => update('couleurs.fond', v)} />
        <ColorField label="Couleur du texte" value={c.texte} onChange={v => update('couleurs.texte', v)} />
      </div>

      <hr className="border-gray-100" />

      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Aperçu sidebar en temps réel</p>
        <div className="flex justify-center">
          <SidebarPreview theme={theme} />
        </div>
      </div>
    </div>
  );
}

// ── Section Typographie ───────────────────────────────────────────────────────
function SectionTypographie({ theme, update }: { theme: Theme; update: (path: string, v: any) => void }) {
  const t = theme.typographie;
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">Police principale</label>
        <select value={t.famille} onChange={e => update('typographie.famille', e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200">
          {FONT_OPTIONS.map(f => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <p className="text-xs text-gray-500">La police s'applique à l'ensemble de l'interface.</p>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">Taille de base</label>
        <div className="grid grid-cols-4 gap-2">
          {SIZE_OPTIONS.map(size => (
            <button key={size} type="button"
              onClick={() => update('typographie.tailleBase', size)}
              className={`py-2.5 rounded-xl border text-sm font-semibold transition-all ${
                t.tailleBase === size
                  ? 'border-[#6B1A6E] bg-purple-50 text-[#6B1A6E]'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}>
              {size}
            </button>
          ))}
        </div>
      </div>

      {/* Aperçu typographie */}
      <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Aperçu</p>
        <div style={{ fontFamily: t.famille, fontSize: t.tailleBase, color: theme.couleurs.texte }}>
          <p className="font-bold text-xl mb-1">Titre principal</p>
          <p className="font-medium mb-1" style={{ fontSize: `calc(${t.tailleBase} * 1.125)` }}>Sous-titre de section</p>
          <p className="text-sm opacity-80">Texte courant — Activité du mercredi, inscription des jeunes, statistiques de présence.</p>
        </div>
      </div>
    </div>
  );
}

// ── Section Contact ───────────────────────────────────────────────────────────
function SectionContact({ theme, update }: { theme: Theme; update: (path: string, v: any) => void }) {
  const c = theme.contact;
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">Email de contact</label>
        <input type="email" value={c.email} onChange={e => update('contact.email', e.target.value)}
          placeholder="polejeunesse@maville.fr"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">Téléphone</label>
        <input type="tel" value={c.telephone} onChange={e => update('contact.telephone', e.target.value)}
          placeholder="01 XX XX XX XX"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">Adresse</label>
        <textarea value={c.adresse} onChange={e => update('contact.adresse', e.target.value)}
          rows={3}
          placeholder="1 place de la mairie&#10;94130 Nogent-sur-Marne"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-200" />
      </div>
    </div>
  );
}

// ── Section Réseaux sociaux ───────────────────────────────────────────────────
function SectionReseaux({ theme, update }: { theme: Theme; update: (path: string, v: any) => void }) {
  const r = theme.reseaux;
  return (
    <div className="space-y-4">
      {[
        { key: 'facebook',  label: 'Facebook',    placeholder: 'https://facebook.com/maville', icon: 'f' },
        { key: 'instagram', label: 'Instagram',   placeholder: 'https://instagram.com/maville', icon: '📸' },
        { key: 'twitter',   label: 'Twitter / X', placeholder: 'https://twitter.com/maville', icon: 'X' },
      ].map(({ key, label, placeholder, icon }) => (
        <div key={key} className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <span className="w-5 h-5 rounded bg-gray-100 border border-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-500">{icon}</span>
            {label}
          </label>
          <input
            type="url"
            value={(r as any)[key]}
            onChange={e => update(`reseaux.${key}`, e.target.value)}
            placeholder={placeholder}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200"
          />
        </div>
      ))}
      <p className="text-xs text-gray-400">Ces liens apparaissent dans le pied de page et dans les communications.</p>
    </div>
  );
}

// ── Section Footer ────────────────────────────────────────────────────────────
function SectionFooter({ theme, update }: { theme: Theme; update: (path: string, v: any) => void }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">Texte de pied de page</label>
        <textarea
          value={theme.footerText}
          onChange={e => update('footerText', e.target.value)}
          rows={3}
          placeholder={`© ${new Date().getFullYear()} Pôle Jeunesse — Tous droits réservés`}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-200"
        />
      </div>

      {theme.footerText && (
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <p className="text-xs text-gray-400 mb-1.5">Aperçu footer</p>
          <p className="text-xs text-gray-300 text-center">{theme.footerText}</p>
        </div>
      )}
    </div>
  );
}

// ── Deep setter ───────────────────────────────────────────────────────────────
function setDeep(obj: any, path: string, value: any): any {
  const keys = path.split('.');
  const result = { ...obj };
  let current = result;
  for (let i = 0; i < keys.length - 1; i++) {
    current[keys[i]] = { ...current[keys[i]] };
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
  return result;
}

// ── Composant principal ───────────────────────────────────────────────────────
export default function ApparenceWhiteLabelClient() {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [savedTheme, setSavedTheme] = useState<Theme>(DEFAULT_THEME);
  const [activeTab, setActiveTab] = useState<TabId>('identite');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    fetch('/api/theme')
      .then(r => r.json())
      .then(data => {
        if (data && typeof data === 'object') {
          const loadedTheme: Theme = {
            identiteWeb:  { ...DEFAULT_THEME.identiteWeb,  ...(data.identiteWeb  ?? {}) },
            couleurs:     { ...DEFAULT_THEME.couleurs,     ...(data.couleurs     ?? {}) },
            typographie:  { ...DEFAULT_THEME.typographie,  ...(data.typographie  ?? {}) },
            contact:      { ...DEFAULT_THEME.contact,      ...(data.contact      ?? {}) },
            reseaux:      { ...DEFAULT_THEME.reseaux,      ...(data.reseaux      ?? {}) },
            footerText:   data.footerText ?? DEFAULT_THEME.footerText,
          };
          setTheme(loadedTheme);
          setSavedTheme(loadedTheme);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const update = useCallback((path: string, value: any) => {
    setTheme(prev => setDeep(prev, path, value));
    setHasChanges(true);
    setError('');
  }, []);

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/theme', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(theme),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Erreur serveur');
      setHasChanges(false);
      setToast('Thème sauvegardé !');
      setTimeout(() => setToast(''), 4000);
    } catch (e: any) {
      setError(e.message ?? 'Erreur réseau');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#6B1A6E] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Chargement du thème...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-green-600 text-white rounded-xl px-5 py-3 shadow-lg text-sm font-semibold flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <span>✓</span> {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Personnalisation white-label</h1>
          <p className="text-sm text-gray-500 mt-0.5">Adaptez l'identité visuelle de la plateforme à votre structure</p>
        </div>
        <div className="flex items-center gap-3">
          {hasChanges && (
            <span className="text-xs text-amber-600 font-medium bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
              Modifications non enregistrées
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="bg-[#6B1A6E] text-white rounded-lg px-5 py-2.5 text-sm font-semibold hover:bg-[#5a1560] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Corps : onglets + contenu */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-gray-100 overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-3.5 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 ${
                activeTab === tab.id
                  ? 'border-[#6B1A6E] text-[#6B1A6E] bg-purple-50/50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Panel */}
        <div className="p-6 max-w-2xl">
          {activeTab === 'identite'    && <SectionIdentite    theme={theme} update={update} />}
          {activeTab === 'couleurs'    && <SectionCouleurs    theme={theme} update={update} />}
          {activeTab === 'typographie' && <SectionTypographie theme={theme} update={update} />}
          {activeTab === 'contact'     && <SectionContact     theme={theme} update={update} />}
          {activeTab === 'reseaux'     && <SectionReseaux     theme={theme} update={update} />}
          {activeTab === 'footer'      && <SectionFooter      theme={theme} update={update} />}
        </div>
      </div>

      {/* Footer sticky save */}
      {hasChanges && (
        <div className="sticky bottom-0 bg-white border-t border-gray-100 shadow-lg px-6 py-4 flex items-center justify-between -mx-0 rounded-xl">
          <span className="text-sm text-gray-600">
            Vous avez des modifications non enregistrées.
          </span>
          <div className="flex gap-3">
            <button
              onClick={() => { setTheme(savedTheme); setHasChanges(false); }}
              className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-[#6B1A6E] text-white rounded-lg px-5 py-2 text-sm font-semibold hover:bg-[#5a1560] disabled:opacity-50 transition-colors"
            >
              {saving ? 'Enregistrement...' : 'Enregistrer les modifications'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
