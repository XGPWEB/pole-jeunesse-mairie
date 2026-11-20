export const dynamic = 'force-dynamic';
import { getTenantId } from '@/lib/auth';
import { getSession } from '@/lib/session';
import { sqlEvenementPasse } from '@/lib/actualites';
import { query, queryOne } from '@/lib/db';
import DashboardAnimateurClient from './DashboardAnimateurClient';
import PageHeader from '@/components/PageHeader';
import { computeDashboardAlerts } from '@/lib/dashboardAlerts';
import { todayLocal } from '@/lib/dates';

function espaceIdFromLabel(label: string): string {
  const map: Record<string, string> = {
    'Collégiens': 'collegiens', 'Lycéens': 'lyceens', 'PIJ': 'pij', 'CLAS': 'clas',
  };
  return map[label] ?? label.toLowerCase();
}

export default async function DashboardAnimateurPage() {
  const session = await getSession();
  const tenant_id = await getTenantId();
  const espace   = session?.espaceAssigne ?? 'Tous';
  const espaceId = espaceIdFromLabel(espace);
  const today    = todayLocal();

  const mesJeunesCountRow = espace === 'Tous'
    ? await queryOne<{ count: string }>('SELECT COUNT(*) AS count FROM jeunes WHERE tenant_id = $1', [tenant_id])
    : await queryOne<{ count: string }>('SELECT COUNT(*) AS count FROM jeunes WHERE tenant_id = $1 AND espace_id = $2', [tenant_id, espaceId]);

  const [themeRow, notifRows, activites, allSorties, allEvts, animateurs, inscriptions, actualites, prefsRows] = await Promise.all([
    queryOne<any>(`SELECT data FROM theme WHERE id = $1`, [tenant_id]),
    query<any>(`
      SELECT id, type, titre, message, cible, urgent,
             envoye_par AS "envoyePar", envoye_at AS "envoyeAt",
             lu_par AS "luPar", dismissed_par AS "dismissedPar",
             dest_animateur_id AS "destAnimateurId",
             sortie_id AS "sortieId", sortie_url AS "sortieUrl",
             demandeur_id AS "demandeurId", demandeur_nom AS "demandeurNom",
             expediteur_id AS "expediteurId", expediteur_nom AS "expediteurNom",
             expediteur_username AS "expediteurUsername", expediteur_espace AS "expediteurEspace",
             from_animateur_id AS "fromAnimateurId", from_animateur_username AS "fromAnimateurUsername",
             from_animateur_prenom AS "fromAnimateurPrenom", from_animateur_nom AS "fromAnimateurNom",
             from_animateur_email AS "fromAnimateurEmail"
      FROM notifications
      WHERE tenant_id = $3
        AND (
          (type IN ('modif-sortie','modif-accordee') AND dest_animateur_id = $1)
          OR ((type IS NULL OR type NOT IN ('modif-sortie','modif-accordee','reset-request','message-animateur'))
              AND (cible = 'Tous' OR cible = $2 OR dest_animateur_id = $1))
        )
        AND NOT ($1 = ANY(COALESCE(dismissed_par, '{}')))
      ORDER BY envoye_at DESC LIMIT 100
    `, [session?.id ?? '', espace, tenant_id]),
    query<any>(`SELECT id, titre, espace_id AS "espaceId", date::text AS date,
                heure_debut AS "heureDebut", places_disponibles AS "placesDisponibles", statut
                FROM activites WHERE tenant_id = $1 ORDER BY date ASC`, [tenant_id]),
    query<any>(`SELECT s.id, s.titre, s.date::text AS date, s.statut, s.espace_id AS "espaceId",
                s.heure_depart AS "heureDepart", s.lieu_destination AS "lieuDestination",
                COALESCE(sp.confirmed_count, 0)::int AS "participantsCount",
                COALESCE(sp.waitlist_count, 0)::int AS "participantsAttenteCount",
                s.capacite
                FROM sorties s
                LEFT JOIN (
                  SELECT sortie_id,
                    COUNT(*) FILTER (WHERE en_attente = false) AS confirmed_count,
                    COUNT(*) FILTER (WHERE en_attente = true)  AS waitlist_count
                  FROM sorties_participants
                  GROUP BY sortie_id
                ) sp ON sp.sortie_id = s.id
                WHERE s.tenant_id = $1 ORDER BY s.date ASC`, [tenant_id]),
    query<any>(`SELECT id, titre, date::text AS date, heure_debut AS "heureDebut", espaces FROM evenements WHERE tenant_id = $1 ORDER BY date ASC`, [tenant_id]),
    query<any>('SELECT id, nom, prenom, date_naissance::text AS "dateNaissance" FROM animateurs WHERE tenant_id = $1', [tenant_id]),
    query<any>('SELECT id, activite_id AS "activiteId", statut FROM inscriptions WHERE tenant_id = $1', [tenant_id]),
    query<any>(`SELECT id, titre, contenu, date::text AS date, categorie, auteur, epingle, espace_id AS "espaceId" FROM actualites WHERE tenant_id = $1 AND NOT ${sqlEvenementPasse(2)} ORDER BY date DESC`, [tenant_id, todayLocal()]),
    query<any>(`SELECT actualite_id AS "actualiteId", dismissed, favorite FROM actualites_prefs WHERE animateur_id = $1`, [session?.id ?? '']),
  ]);

  const dashboardConfig = themeRow?.data?.dashboardAnimateur ?? null;

  const notifs = notifRows;
  const nonLues = notifs.filter((n: any) => !(n.luPar ?? []).includes(session?.id ?? ''));

  const { birthdays } = computeDashboardAlerts(animateurs, new Date());

  const mesJeunesCount = Number(mesJeunesCountRow?.count ?? 0);

  const prochActivites = activites
    .filter((a: any) => a.date >= today && (espace === 'Tous' || a.espaceId === espaceId))
    .map((a: any) => ({ id: a.id, titre: a.titre, date: a.date, heureDebut: a.heureDebut, espaceId: a.espaceId, _type: 'activite' as const }));

  const prochSorties = allSorties
    .filter((s: any) => s.date >= today && s.statut !== 'annulee' && (espace === 'Tous' || s.espaceId === 'Tous' || s.espaceId === espace || s.espaceId === espaceId))
    .map((s: any) => ({ id: s.id, titre: s.titre, date: s.date, heureDepart: s.heureDepart, lieuDestination: s.lieuDestination, _type: 'sortie' as const }));

  const prochaines = [...prochActivites, ...prochSorties]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

  const prochEvts = allEvts
    .filter((e: any) => e.date >= today && (e.espaces?.includes('Tous') || e.espaces?.includes(espace) || e.espaces?.includes(espaceId)))
    .sort((a: any, b: any) => a.date.localeCompare(b.date))
    .slice(0, 5);

  const activitesToday = activites.filter((a: any) => a.date === today && (espace === 'Tous' || a.espaceId === espaceId));

  const activitesAVenir = activites.filter((a: any) => a.date >= today && (espace === 'Tous' || a.espaceId === espaceId));
  const sortiesAVenir   = allSorties.filter((s: any) => s.date >= today && s.statut !== 'annulee' && (espace === 'Tous' || s.espaceId === 'Tous' || s.espaceId === espace || s.espaceId === espaceId));

  const activitesCompletes   = activitesAVenir.filter((a: any) => a.statut === 'complet');
  const activitesPeuDePlaces = activitesAVenir.filter((a: any) => a.placesDisponibles > 0 && a.placesDisponibles <= 3);
  const sortiesCompletes     = sortiesAVenir.filter((s: any) => s.capacite > 0 && s.participantsCount >= s.capacite);
  const sortiesEnAttente     = sortiesAVenir.filter((s: any) => s.participantsAttenteCount > 0);

  const activiteIdsEspace = new Set(activitesAVenir.map((a: any) => a.id));
  const inscriptionsEnAttente = inscriptions.filter((i: any) =>
    i.statut === 'en-attente' && activiteIdsEspace.has(i.activiteId)
  );

  const listeAttenteParActivite = activitesAVenir
    .map((a: any) => ({
      id: a.id, titre: a.titre,
      attente: inscriptions.filter((i: any) => i.activiteId === a.id && i.statut === 'liste-attente').length,
    }))
    .filter((a: any) => a.attente > 0);

  const totalListeAttente = listeAttenteParActivite.reduce((s: number, a: any) => s + a.attente, 0)
    + sortiesEnAttente.reduce((s: number, sv: any) => s + sv.participantsAttenteCount, 0);

  const pointsAttention = {
    activitesCompletes,
    activitesPeuDePlaces,
    sortiesCompletes,
    sortiesEnAttente,
    inscriptionsEnAttente,
    listeAttenteParActivite,
    totalListeAttente,
  };

  const allActualites = actualites
    .filter((a: any) => a.date >= today)
    .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const myPrefs = {
    dismissed: prefsRows.filter((r: any) => r.dismissed).map((r: any) => r.actualiteId),
    favorites: prefsRows.filter((r: any) => r.favorite).map((r: any) => r.actualiteId),
  };

  return (
    <div>
      <PageHeader
        titre={`Bonjour ${session?.prenom ?? ''} 👋`}
        sousTitre={`${espace} — ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
      />
      <div className="p-8 space-y-8">
        <DashboardAnimateurClient
          notifications={notifs}
          prochaines={prochaines}
          evenements={prochEvts}
          sessionId={session?.id ?? ''}
          dashboardConfig={dashboardConfig ?? undefined}
          birthdays={birthdays}
          actualites={allActualites}
          actualitesPrefs={myPrefs}
          pointsAttention={pointsAttention}
          mesJeunesCount={mesJeunesCount}
          activitesTodayCount={activitesToday.length}
        />
      </div>
    </div>
  );
}
