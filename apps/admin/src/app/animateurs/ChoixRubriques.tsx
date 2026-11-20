'use client';
import { famillesReglables, rubriquesDuRole, type RoleRubriques } from '@/lib/rubriques';
import { Icone } from '@/components/MenuLateral';

/** Ce que l'auteur de la modification peut accorder. */
export interface Editeur {
  id: string;
  /** Rubriques ouvertes à l'auteur (il ne peut accorder que celles-ci). */
  rubriques: string[];
  /** Compte qui règle les droits (animateurs.gere_droits) : seul lui coche les rubriques. */
  gereDroits: boolean;
}

/** Rubriques cochées au départ pour un nouveau compte : tout ce que l'auteur peut accorder. */
export function rubriquesParDefaut(role: RoleRubriques, editeur: Editeur): string[] {
  const accordables = new Set(editeur.rubriques);
  return rubriquesDuRole(role).filter(id => accordables.has(id));
}

/** « Menu complet » ou « 4 rubriques sur 11 », pour la liste de l'équipe. */
export function resumeAcces(role: RoleRubriques, rubriques: string[] | null): string {
  const duRole = rubriquesDuRole(role);
  if (rubriques == null) return 'Menu complet';
  const ouvertes = duRole.filter(id => rubriques.includes(id)).length;
  return ouvertes === duRole.length ? 'Menu complet' : `${ouvertes} rubrique${ouvertes > 1 ? 's' : ''} sur ${duRole.length}`;
}

/** Une ligne d'explication sous chaque rubrique. */
const DESCRIPTIONS: Record<string, string> = {
  jeunes: 'Consulter et modifier les fiches des jeunes',
  inscriptions: 'Valider les inscriptions aux activités',
  presences: 'Pointer les jeunes à l’accueil',
  pij: 'Accueils, dossiers et agenda du PIJ',
  activites: 'Programmer les activités et leurs inscrits',
  evenements: 'Calendrier des événements',
  sorties: 'Fiches sortie et fiches sanitaires',
  projets: 'Espace projet',
  animateurs: 'Créer et modifier les comptes de l’équipe',
  conges: 'Demandes de congés et récupération',
  vehicules: 'Réserver le véhicule',
  statistiques: 'Chiffres et export CAF',
  frequentation: 'Fréquentation des espaces',
  actualites: 'Publier les actualités',
  notifications: 'Envoyer des notifications',
  espaces: 'Régler les espaces de la structure',
  apparence: 'Couleurs, logo et menu',
  rgpd: 'Données personnelles',
  parametres: 'Réglages de la structure',
  monitoring: 'Journal des erreurs',
};

/** Profils types proposés en un clic. */
type Profil = { nom: string; rubriques: string[] | 'tout' };
const PROFILS: Record<RoleRubriques, Profil[]> = {
  animateur: [
    { nom: 'Animateur collège / lycée', rubriques: ['jeunes', 'presences', 'activites', 'evenements', 'sorties', 'projets', 'conges', 'vehicules'] },
    { nom: 'Informateur PIJ', rubriques: ['jeunes', 'pij', 'conges', 'vehicules'] },
    { nom: 'Tout le menu', rubriques: 'tout' },
  ],
  admin: [{ nom: 'Tout le menu', rubriques: 'tout' }],
};

/** Couleur du menu de chaque rôle (reprise des menus latéraux). */
const COULEUR: Record<RoleRubriques, string> = { animateur: '#1B3870', admin: '#6B1A6E' };

interface Props {
  /** Rôle du compte : il fixe la liste des rubriques proposées. */
  role: RoleRubriques;
  rubriques: string[];
  editeur: Editeur;
  onRubriques: (rubriques: string[]) => void;
  /** Prénom affiché au-dessus de l'aperçu (« Ce que verra Léa »). */
  prenom?: string;
  /** Lecture seule (son propre compte, ou compte qui a plus d'accès que l'auteur). */
  verrouille?: boolean;
}

/**
 * Accès au menu d'un compte : un interrupteur par rubrique de son rôle, des
 * profils types, et l'aperçu du menu que verra la personne. Le tableau de
 * bord n'est pas réglable : il reste toujours accessible.
 */
export default function ChoixRubriques({ role, rubriques, editeur, onRubriques, prenom, verrouille = false }: Props) {
  const cochees = new Set(rubriques);
  const accordables = new Set(editeur.rubriques);
  const familles = famillesReglables(role);
  const duRole = rubriquesDuRole(role);
  const couleur = COULEUR[role];

  function basculer(id: string) {
    if (verrouille || !accordables.has(id)) return;
    const suivant = new Set(cochees);
    if (suivant.has(id)) suivant.delete(id); else suivant.add(id);
    onRubriques(duRole.filter(r => suivant.has(r)));
  }

  const rubriquesDuProfil = (p: Profil) =>
    (p.rubriques === 'tout' ? duRole : duRole.filter(id => p.rubriques.includes(id))).filter(id => accordables.has(id));
  const profilActif = PROFILS[role].find(p => {
    const voulues = rubriquesDuProfil(p);
    return voulues.length === cochees.size && voulues.every(id => cochees.has(id));
  })?.nom;

  return (
    <div className="space-y-4">
      {!verrouille && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 mr-1">Profil type :</span>
          {PROFILS[role].map(p => (
            <button
              key={p.nom}
              type="button"
              onClick={() => onRubriques(rubriquesDuProfil(p))}
              aria-pressed={profilActif === p.nom}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${profilActif === p.nom ? 'border-[#6B1A6E] bg-purple-50 text-[#6B1A6E] font-semibold' : 'border-gray-200 text-gray-700 hover:border-gray-300'}`}
            >
              {p.nom}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_220px] gap-6">
        <div>
          {familles.map(f => (
            <div key={f.titre ?? ''} className="mb-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">{f.titre}</p>
              <div className="divide-y divide-gray-100 border-y border-gray-100">
                {f.entrees.map(e => {
                  const accordable = accordables.has(e.id);
                  const active = cochees.has(e.id);
                  return (
                    <div key={e.id} className="flex items-center gap-3 py-2">
                      <span className={`flex-1 min-w-0 ${accordable ? '' : 'opacity-50'}`}>
                        <span className="block text-sm text-gray-800">{e.label}</span>
                        {DESCRIPTIONS[e.id] && <span className="block text-xs text-gray-400">{DESCRIPTIONS[e.id]}</span>}
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={active}
                        aria-label={e.label}
                        disabled={verrouille || !accordable}
                        title={accordable ? undefined : 'Vous n’avez pas cette rubrique : vous ne pouvez pas l’accorder.'}
                        onClick={() => basculer(e.id)}
                        className="relative w-9 h-5 rounded-full shrink-0 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                        style={{ backgroundColor: active ? couleur : '#d1d5db' }}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${active ? 'left-[18px]' : 'left-0.5'}`} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Aperçu du menu tel que la personne le verra */}
        <div>
          <p className="text-xs text-gray-500 mb-1.5">{prenom ? `Ce que verra ${prenom}` : 'Aperçu du menu'}</p>
          <div className="rounded-xl p-2 sticky top-2" style={{ backgroundColor: couleur }}>
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white text-xs font-semibold" style={{ color: couleur }}>
              <Icone nom="dashboard" className="w-4 h-4" /> Tableau de bord
            </div>
            {familles.map(f => {
              const visibles = f.entrees.filter(e => cochees.has(e.id));
              if (visibles.length === 0) return null;
              return (
                <div key={f.titre ?? ''}>
                  <p className="px-2 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-white/45">{f.titre}</p>
                  {visibles.map(e => (
                    <div key={e.id} className="flex items-center gap-2 px-2 py-1 text-xs text-white/85">
                      <Icone nom={e.id} className="w-4 h-4" /> {e.label}
                    </div>
                  ))}
                </div>
              );
            })}
            {role === 'animateur' && (
              <div className="flex items-center gap-2 px-2 py-1 mt-2 pt-2 border-t border-white/20 text-xs text-white/85">
                <Icone nom="profil" className="w-4 h-4" /> Mon profil
              </div>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-2">{cochees.size} rubrique{cochees.size > 1 ? 's' : ''} sur {duRole.length}</p>
        </div>
      </div>
    </div>
  );
}
