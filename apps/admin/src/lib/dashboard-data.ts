import { query, queryOne } from '@/lib/db';
import { sqlEvenementPasse } from '@/lib/actualites';

/**
 * Données du tableau de bord d'administration.
 *
 * La page chargeait auparavant les tables activités, sorties, inscriptions et
 * actualités EN ENTIER pour n'en afficher que les compteurs et les éléments à
 * venir — et ce à chaque rafraîchissement automatique (toutes les 10 s par
 * onglet ouvert). Le tri est désormais fait par PostgreSQL : seules les lignes
 * affichées quittent la base, et le coût ne grandit plus avec l'historique.
 */

export interface ActiviteAVenir {
  id: string;
  titre: string;
  espaceId: string | null;
  date: string;
  heureDebut: string | null;
  heureFin: string | null;
  animateur: string | null;
  placesTotal: number;
  placesDisponibles: number;
  statut: string | null;
  /** Inscriptions en liste d'attente sur cette activité. */
  attente: number;
}

export interface SortieAVenir {
  id: string;
  titre: string;
  date: string;
  statut: string | null;
  espaceId: string | null;
  heureDepart: string | null;
  lieuDestination: string | null;
  animateurNom: string | null;
  capacite: number;
  participantsCount: number;
  participantsAttenteCount: number;
}

export interface CompteursTableauDeBord {
  jeunes: number;
  nouveauxJeunesCeMois: number;
  activites: number;
  sorties: number;
  actualites: number;
  inscriptionsEnAttente: number;
  pointagesPresents: number;
  pointagesTotal: number;
  /**
   * Personnes distinctes connues du PIJ : reçues à l'accueil, suivies dans un
   * dossier, ou ayant une fiche jeune rattachée à l'espace PIJ. Le PIJ tient
   * son propre registre (module PIJ) et ne crée pas de fiche jeune : sans ce
   * compteur, sa carte du tableau de bord restait à zéro.
   */
  jeunesPij: number;
}

/**
 * @param today  date du jour 'YYYY-MM-DD' (fuseau de la structure, voir lib/dates.ts)
 * @param depuis borne basse 'YYYY-MM-DD' du fil d'actualités
 */
export async function chargerTableauDeBord(tenant_id: string, today: string, depuis: string) {
  const [activitesAVenir, sortiesAVenir, compteursBruts, jeunesParEspace, actualitesFeed, espaces, evenements, animateurs] = await Promise.all([
    query<ActiviteAVenir>(`SELECT a.id, a.titre, a.espace_id AS "espaceId", a.date::text AS date,
                a.heure_debut AS "heureDebut", a.heure_fin AS "heureFin", a.animateur,
                a.places_total AS "placesTotal", a.places_disponibles AS "placesDisponibles", a.statut,
                (SELECT COUNT(*) FROM inscriptions i
                  WHERE i.activite_id = a.id AND i.tenant_id = a.tenant_id AND i.statut = 'liste-attente')::int AS attente
                FROM activites a WHERE a.tenant_id = $1 AND a.date >= $2 ORDER BY a.date ASC`, [tenant_id, today]),
    query<SortieAVenir>(`SELECT s.id, s.titre, s.date::text AS date, s.statut, s.espace_id AS "espaceId",
                s.heure_depart AS "heureDepart", s.lieu_destination AS "lieuDestination", s.animateur_nom AS "animateurNom",
                s.capacite,
                (SELECT COUNT(*) FILTER (WHERE sp.en_attente = false) FROM sorties_participants sp WHERE sp.sortie_id = s.id)::int AS "participantsCount",
                (SELECT COUNT(*) FILTER (WHERE sp.en_attente = true)  FROM sorties_participants sp WHERE sp.sortie_id = s.id)::int AS "participantsAttenteCount"
                FROM sorties s
                WHERE s.tenant_id = $1 AND s.date >= $2 AND s.statut IS DISTINCT FROM 'annulee' ORDER BY s.date ASC`, [tenant_id, today]),
    queryOne<Record<keyof CompteursTableauDeBord, number>>(`SELECT
                (SELECT COUNT(*) FROM jeunes WHERE tenant_id = $1)::int AS jeunes,
                (SELECT COUNT(*) FROM jeunes WHERE tenant_id = $1 AND created_at >= date_trunc('month', now()))::int AS "nouveauxJeunesCeMois",
                (SELECT COUNT(*) FROM activites WHERE tenant_id = $1)::int AS activites,
                (SELECT COUNT(*) FROM sorties WHERE tenant_id = $1)::int AS sorties,
                -- Les événements passés sont archivés (lib/actualites.ts) : ni comptés, ni dans le fil.
                (SELECT COUNT(*) FROM actualites WHERE tenant_id = $1 AND NOT ${sqlEvenementPasse(2)})::int AS actualites,
                (SELECT COUNT(*) FROM inscriptions WHERE tenant_id = $1 AND statut = 'en-attente')::int AS "inscriptionsEnAttente",
                (SELECT COUNT(*) FROM pointages WHERE tenant_id = $1 AND statut = 'present')::int AS "pointagesPresents",
                (SELECT COUNT(*) FROM pointages WHERE tenant_id = $1)::int AS "pointagesTotal",
                -- Une personne = un nom et un prénom, sans tenir compte de la casse ni des
                -- espaces : elle peut avoir plusieurs visites et plusieurs dossiers.
                (SELECT COUNT(*) FROM (
                   SELECT lower(btrim(nom)), lower(btrim(prenom)) FROM pij_accueils WHERE tenant_id = $1
                   UNION
                   SELECT lower(btrim(nom)), lower(btrim(prenom)) FROM pij_dossiers WHERE tenant_id = $1
                   UNION
                   SELECT lower(btrim(nom)), lower(btrim(prenom)) FROM jeunes WHERE tenant_id = $1 AND espace_id = 'pij'
                 ) personnes)::int AS "jeunesPij"`, [tenant_id, today]),
    query<{ espaceId: string; count: string }>(`SELECT espace_id AS "espaceId", COUNT(*) AS count FROM jeunes WHERE tenant_id = $1 GROUP BY espace_id`, [tenant_id]),
    query<any>(`SELECT id, titre, date::text AS date, auteur, epingle, categorie FROM actualites
                WHERE tenant_id = $1 AND date >= $2 AND NOT ${sqlEvenementPasse(3)} ORDER BY date DESC LIMIT 5`, [tenant_id, depuis, today]),
    query<any>(`SELECT id, nom, tranche_age AS "trancheAge", animateur_ref AS "animateurRef",
                couleur, icon, capacite FROM espaces WHERE tenant_id = $1 ORDER BY id`, [tenant_id]),
    query<any>(`SELECT id, titre, description, date::text AS date, heure_debut AS "heureDebut",
                heure_fin AS "heureFin", lieu, espaces FROM evenements WHERE tenant_id = $1 AND date >= $2 ORDER BY date LIMIT 5`, [tenant_id, today]),
    query<any>(`SELECT id, nom, prenom, date_naissance::text AS "dateNaissance",
                date_fin_contrat::text AS "dateFinContrat"
                FROM animateurs WHERE tenant_id = $1`, [tenant_id]),
  ]);

  const compteurs: CompteursTableauDeBord = {
    jeunes: 0, nouveauxJeunesCeMois: 0, activites: 0, sorties: 0, actualites: 0,
    inscriptionsEnAttente: 0, pointagesPresents: 0, pointagesTotal: 0, jeunesPij: 0,
    ...compteursBruts,
  };

  return { activitesAVenir, sortiesAVenir, compteurs, jeunesParEspace, actualitesFeed, espaces, evenements, animateurs };
}
