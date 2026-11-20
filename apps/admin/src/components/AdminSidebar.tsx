'use client';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import NotificationBadge from './NotificationBadge';
import { APP_VERSION } from '@/lib/version';
import { ADMINISTRATION, FAMILLES_ADMIN, Icone, LienMenu, TitreFamille, estActif, type EntreeMenu } from './MenuLateral';

type NavPref = { id: string; visible: boolean };

// « Tableau de bord » ne peut pas être masqué (anti-verrouillage).
const TOUJOURS_VISIBLE = new Set(['dashboard']);
const COULEUR = 'var(--color-admin, #6B1A6E)';
/**
 * Comptes administrateurs : hors rubriques, réservé au compte qui gère les
 * droits (les administrateurs ne sont pas listés avec l'équipe d'animation).
 */
const ADMINISTRATEURS: EntreeMenu = { id: 'administrateurs', href: '/admin/administrateurs', label: 'Administrateurs' };
const TOUTES = [...FAMILLES_ADMIN.flatMap(f => f.entrees), ...ADMINISTRATION, ADMINISTRATEURS];

/** Les entrées ouvertes au compte. */
const autorisees = (entrees: EntreeMenu[], ouvertes: Set<string>) =>
  entrees.filter(e => TOUJOURS_VISIBLE.has(e.id) || ouvertes.has(e.id));

interface Props {
  nomPlateforme?: string; sousTitre?: string; logo?: string | null; navPrefs?: NavPref[] | null; utilisateur?: string;
  /** Rubriques ouvertes au compte (droits réglés page Animateurs) : les autres n'apparaissent pas, même en personnalisation. */
  rubriques: string[];
  /** Compte qui gère les droits : voit Administration › Administrateurs. */
  gereDroits?: boolean;
}

/**
 * Menu latéral de l'administration : entrées rangées par familles, réglages
 * rares repliés sous « Administration ». L'ordre est fixe ; chaque admin peut
 * masquer les entrées dont il ne se sert pas (préférences `nav_prefs`, en
 * base : elles le suivent d'un appareil à l'autre). Les rubriques que le compte
 * n'a pas reçues ne sont jamais affichées.
 */
export default function AdminSidebar({ nomPlateforme, sousTitre, logo, navPrefs, utilisateur, rubriques, gereDroits }: Props) {
  const ouvertes = new Set(rubriques);
  const administration = [...(gereDroits ? [ADMINISTRATEURS] : []), ...autorisees(ADMINISTRATION, ouvertes)];
  const pathname = usePathname();
  const router = useRouter();

  const [masquees, setMasquees] = useState<Set<string>>(
    () => new Set((navPrefs ?? []).filter(p => p.visible === false && !TOUJOURS_VISIBLE.has(p.id)).map(p => p.id)),
  );
  const [personnalisation, setPersonnalisation] = useState(false);
  const dansAdministration = administration.some(e => estActif(pathname, e.href));
  const [administrationOuverte, setAdministrationOuverte] = useState(dansAdministration);

  async function persister(ids: Set<string>) {
    try {
      await fetch('/api/animateurs/nav-prefs', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: TOUTES.map(e => ({ id: e.id, visible: !ids.has(e.id) })) }),
      });
    } catch {}
  }

  function basculer(id: string) {
    if (TOUJOURS_VISIBLE.has(id)) return;
    const suivant = new Set(masquees);
    if (suivant.has(id)) suivant.delete(id); else suivant.add(id);
    setMasquees(suivant);
    persister(suivant);
  }

  async function toutAfficher() {
    setMasquees(new Set());
    try { await fetch('/api/animateurs/nav-prefs', { method: 'DELETE' }); } catch {}
  }

  const nom = nomPlateforme || 'Pôle Jeunesse';
  const sub = sousTitre || 'Mairie de Nogent';

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  /** Une entrée : lien en usage normal, ligne à œil en personnalisation. */
  function entree(e: EntreeMenu) {
    const masquee = masquees.has(e.id);
    if (personnalisation) {
      const verrouille = TOUJOURS_VISIBLE.has(e.id);
      return (
        <button
          key={e.id}
          type="button"
          onClick={() => basculer(e.id)}
          disabled={verrouille}
          aria-pressed={!masquee}
          title={verrouille ? 'Toujours affiché' : masquee ? 'Afficher cette entrée' : 'Masquer cette entrée'}
          className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm font-medium text-left transition-colors hover:bg-white/10 disabled:cursor-not-allowed ${masquee ? 'text-white/35' : 'text-white/80'}`}
        >
          <Icone nom={e.id} />
          <span className={`flex-1 truncate ${masquee ? 'line-through' : ''}`}>{e.label}</span>
          {!verrouille && <Icone nom={masquee ? 'oeilBarre' : 'oeil'} className="w-4 h-4" />}
        </button>
      );
    }
    if (masquee) return null;
    return (
      <LienMenu
        key={e.id}
        entree={e}
        actif={estActif(pathname, e.href)}
        couleur={COULEUR}
        apres={e.id === 'notifications' ? <NotificationBadge isAdmin={true} /> : undefined}
      />
    );
  }

  const administrationVisible = administration.length > 0 && (personnalisation || administration.some(e => !masquees.has(e.id)));
  const administrationDepliee = personnalisation || administrationOuverte || dansAdministration;

  return (
    <aside className="w-64 flex flex-col h-full shrink-0" style={{ backgroundColor: COULEUR }}>
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          {logo
            ? <img src={logo} alt={nom} className="w-11 h-11 rounded-xl object-contain bg-white/10 shrink-0" />
            : <img src="/logo-pj.png" alt="Pôle Jeunesse" className="w-11 h-11 rounded-xl object-contain bg-white/10 shrink-0" />
          }
          <div>
            <div className="text-white/70 text-[10px] font-medium tracking-wider uppercase">{sub}</div>
            <div className="text-white font-bold text-sm leading-tight">
              <span className="text-[#A8D8EA]">{nom.split(' ')[0]?.toUpperCase()}</span>{' '}
              {nom.split(' ').slice(1).join(' ').toUpperCase() || ''}
            </div>
          </div>
        </div>
        <div className="flex mt-3 rounded-full overflow-hidden h-1">
          <div style={{ backgroundColor: 'var(--color-animateur, #1B3870)' }} className="flex-[3]" />
          <div style={{ backgroundColor: 'var(--color-green, #8DC63F)' }} className="flex-1" />
          <div style={{ backgroundColor: 'var(--color-cyan, #29B5E8)' }} className="flex-1" />
        </div>
      </div>


      <nav className="flex-1 px-3 pb-3 overflow-y-auto" aria-label="Menu principal">
        {personnalisation && (
          <p className="px-3 pt-3 text-xs text-white/60">Cliquez sur une entrée pour la masquer ou la réafficher.</p>
        )}
        {FAMILLES_ADMIN.map(famille => {
          const lignes = autorisees(famille.entrees, ouvertes).map(entree).filter(Boolean);
          if (lignes.length === 0) return null;
          return (
            <div key={famille.titre ?? 'accueil'} className={famille.titre ? '' : 'pt-3'}>
              {famille.titre && <TitreFamille>{famille.titre}</TitreFamille>}
              <div className="space-y-0.5">{lignes}</div>
            </div>
          );
        })}

        {administrationVisible && (
          <div className="mt-3 pt-3 border-t border-white/10">
            <button
              type="button"
              onClick={() => setAdministrationOuverte(o => !o)}
              aria-expanded={administrationDepliee}
              disabled={personnalisation || dansAdministration}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-white/75 hover:bg-white/10 hover:text-white disabled:hover:bg-transparent"
            >
              <Icone nom="administration" />
              <span className="flex-1 text-left">Administration</span>
              <Icone nom="chevron" className={`w-4 h-4 transition-transform ${administrationDepliee ? 'rotate-90' : ''}`} />
            </button>
            {administrationDepliee && <div className="mt-0.5 pl-3 space-y-0.5">{administration.map(entree)}</div>}
          </div>
        )}
      </nav>

      <div className="px-3 py-3 border-t border-white/10 space-y-1">
        {personnalisation ? (
          <>
            <button onClick={() => setPersonnalisation(false)} className="w-full px-3 py-2 rounded-lg bg-white/20 text-white text-sm font-semibold hover:bg-white/30">
              Terminer
            </button>
            <button onClick={toutAfficher} className="w-full px-3 py-1.5 rounded-lg text-white/60 hover:text-white text-xs">
              Tout réafficher
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setPersonnalisation(true)} className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-white/50 hover:bg-white/10 hover:text-white text-xs font-medium">
              <Icone nom="reglages" className="w-4 h-4" /> Personnaliser le menu
            </button>
            <button onClick={handleLogout} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-white/80 hover:bg-white/10 hover:text-white text-sm font-medium text-left">
              <Icone nom="profil" />
              <span className="flex-1 min-w-0">
                {utilisateur && <span className="block truncate">{utilisateur}</span>}
                <span className={utilisateur ? 'block text-[11px] font-normal text-white/50' : ''}>Déconnexion</span>
              </span>
              <Icone nom="deconnexion" className="w-4 h-4" />
            </button>
          </>
        )}
        <p className="px-3 pt-1 text-[11px] text-white/40">v{APP_VERSION}</p>
      </div>
    </aside>
  );
}
