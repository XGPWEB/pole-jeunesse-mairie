'use client';
import { usePathname, useRouter } from 'next/navigation';
import NotificationBadge from './NotificationBadge';
import { APP_VERSION } from '@/lib/version';
import { FAMILLES_ANIMATEUR, Icone, LienMenu, TitreFamille, estActif, type EntreeMenu } from './MenuLateral';

interface NavConfigItem { id: string; label: string; icon: string; visible: boolean }
interface NavPref { id: string; visible: boolean }

interface Props {
  nomPlateforme?: string;
  sousTitre?: string;
  logo?: string | null;
  /** Réglage de la structure (Apparence) : libellés et entrées masquées pour tous. */
  navConfig?: NavConfigItem[];
  /** Préférences PERSONNELLES de l'animateur : entrées qu'il a masquées. Prioritaires. */
  navPrefs?: NavPref[] | null;
  /** Rubriques ouvertes au compte (droits réglés par l'admin) : les autres n'apparaissent pas. */
  rubriques: string[];
  utilisateur?: string;
}

const COULEUR = 'var(--color-animateur, #1B3870)';
const PROFIL: EntreeMenu = { id: 'profil', href: '/animateur/profil', label: 'Mon profil' };
// Jamais masquées : sans elles on ne peut plus revenir régler son menu.
const TOUJOURS_VISIBLE = new Set(['dashboard', 'profil']);
/** Libellés par défaut d'avant le rangement par familles (réglage Apparence). */
const ANCIENS_LIBELLES: Record<string, string> = {
  dashboard: 'Tableau de bord', jeunes: 'Fiches Jeunes', activites: 'Activités', presences: 'Présences',
  statistiques: 'Statistiques', frequentation: 'Fréquentation', evenements: 'Événements',
  vehicules: 'Réservation Véhicule', projets: 'Espace Projet', sorties: 'Fiche Sortie', conges: 'Congés & Récup',
};

/**
 * Menu latéral de l'espace animateur : mêmes familles que le menu admin.
 * L'ordre est fixe ; la visibilité vient du réglage de la structure, puis des
 * préférences de l'animateur (page « Mon profil »).
 */
export default function AnimateurSidebar({ nomPlateforme, sousTitre, logo, navConfig, navPrefs, rubriques, utilisateur }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  const nom = nomPlateforme || 'Pôle Jeunesse';
  const sub = sousTitre || 'Mairie de Nogent';

  const prefs = new Map((navPrefs ?? []).map(p => [p.id, p.visible !== false]));
  const config = new Map((navConfig ?? []).map(c => [c.id, c]));
  // Un libellé choisi par la structure est respecté ; s'il est resté à
  // l'ancienne valeur par défaut, le nouveau libellé court s'applique.
  const libelle = (e: EntreeMenu) => {
    const choisi = config.get(e.id)?.label?.trim();
    return choisi && choisi !== ANCIENS_LIBELLES[e.id] ? choisi : e.label;
  };
  const ouvertes = new Set(rubriques);
  const visible = (id: string) =>
    TOUJOURS_VISIBLE.has(id) || (ouvertes.has(id) && (prefs.has(id) ? prefs.get(id) === true : config.get(id)?.visible !== false));

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <aside className="w-64 flex flex-col h-full shrink-0" style={{ backgroundColor: COULEUR }}>
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <img
            src={logo ?? '/logo-pj.png'}
            alt={nom}
            className="w-11 h-11 rounded-xl object-contain bg-white/10 shrink-0"
          />
          <div>
            <div className="text-white/70 text-[10px] font-medium tracking-wider uppercase">{sub}</div>
            <div className="text-white font-bold text-sm leading-tight">
              <span className="text-[#A8D8EA]">{nom.split(' ')[0]?.toUpperCase()}</span>{' '}
              {nom.split(' ').slice(1).join(' ').toUpperCase() || ''}
            </div>
          </div>
        </div>
        <div className="flex mt-3 rounded-full overflow-hidden h-1">
          <div style={{ backgroundColor: 'var(--color-admin, #6B1A6E)' }} className="flex-[3]" />
          <div style={{ backgroundColor: 'var(--color-green, #8DC63F)' }} className="flex-1" />
          <div style={{ backgroundColor: 'var(--color-cyan, #29B5E8)' }} className="flex-1" />
        </div>
      </div>


      <nav className="flex-1 px-3 pb-3 overflow-y-auto" aria-label="Menu principal">
        {FAMILLES_ANIMATEUR.map(famille => {
          const entrees = famille.entrees.filter(e => visible(e.id));
          if (entrees.length === 0) return null;
          return (
            <div key={famille.titre ?? 'accueil'} className={famille.titre ? '' : 'pt-3'}>
              {famille.titre && <TitreFamille>{famille.titre}</TitreFamille>}
              <div className="space-y-0.5">
                {entrees.map(e => (
                  <LienMenu
                    key={e.id}
                    entree={{ ...e, label: libelle(e) }}
                    actif={estActif(pathname, e.href)}
                    couleur={COULEUR}
                    apres={e.id === 'dashboard' ? <NotificationBadge isAdmin={false} /> : undefined}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="px-3 py-3 border-t border-white/10 space-y-1">
        <LienMenu entree={{ ...PROFIL, label: utilisateur || PROFIL.label }} actif={estActif(pathname, PROFIL.href)} couleur={COULEUR} />
        <button onClick={handleLogout} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-white/75 hover:bg-white/10 hover:text-white text-sm font-medium">
          <Icone nom="deconnexion" /> Déconnexion
        </button>
        <p className="px-3 pt-1 text-[11px] text-white/40">v{APP_VERSION}</p>
      </div>
    </aside>
  );
}
