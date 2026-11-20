import { getTenantId } from '@/lib/auth';
import { query } from '@/lib/db';
import PresencesClient from './PresencesClient';

export const dynamic = 'force-dynamic';

export default async function PresencesPage() {
  const tenant_id = await getTenantId();
  const [pointages, activitesRaw, jeunesRaw] = await Promise.all([
    query<any>(`
      SELECT id, jeune_id AS "jeuneId", espace_id AS "espaceId", date::text AS date,
             heure_arrivee AS "heureArrivee", heure_sortie AS "heureSortie", animateur,
             type, activite_id AS "activiteId", manuel, source, statut,
             prenom_manuel AS "prenomManuel", nom_manuel AS "nomManuel"
      FROM pointages WHERE tenant_id = $1 ORDER BY date DESC, created_at DESC
    `, [tenant_id]),
    query<any>(`SELECT id, titre, espace_id AS "espaceId", places_total AS "placesTotal", date::text AS date FROM activites WHERE tenant_id = $1 ORDER BY date DESC`, [tenant_id]),
    query<any>(`SELECT id, nom, prenom, espace_id AS "espaceId" FROM jeunes WHERE tenant_id = $1`, [tenant_id]),
  ]);

  // Filter by type — inclure les pointages web (source:'web') dans les activités
  const pointagesLibre    = pointages.filter((p: any) => p.type === 'accueil-libre');
  const pointagesActivite = pointages.filter((p: any) => p.type === 'activite' || p.source === 'web');

  // Group journalier by date
  const journalierByDate: Record<string, { date: string; total: number; manuel: number; espaces: Record<string, number> }> = {};
  pointagesLibre.forEach((p: any) => {
    if (!journalierByDate[p.date]) journalierByDate[p.date] = { date: p.date, total: 0, manuel: 0, espaces: {} };
    journalierByDate[p.date].total++;
    if (p.manuel) journalierByDate[p.date].manuel++;
    journalierByDate[p.date].espaces[p.espaceId] = (journalierByDate[p.date].espaces[p.espaceId] || 0) + 1;
  });
  const journalierList = Object.values(journalierByDate).sort((a, b) => b.date.localeCompare(a.date));

  // Group by activiteId
  const activiteById: Record<string, { activiteId: string; total: number; present: number; absent: number; excuse: number; manuel: number }> = {};
  pointagesActivite.forEach((p: any) => {
    const aid = p.activiteId || 'unknown';
    if (!activiteById[aid]) activiteById[aid] = { activiteId: aid, total: 0, present: 0, absent: 0, excuse: 0, manuel: 0 };
    activiteById[aid].total++;
    if (p.statut === 'present') activiteById[aid].present++;
    else if (p.statut === 'absent') activiteById[aid].absent++;
    else if (p.statut === 'excuse') activiteById[aid].excuse++;
    if (p.manuel) activiteById[aid].manuel++;
  });

  // Enrich with activite info
  const activitesList = activitesRaw.map((a: any) => ({
    ...a,
    presences: activiteById[a.id] || { activiteId: a.id, total: 0, present: 0, absent: 0, excuse: 0, manuel: 0 },
  }));

  // Stats globales
  const totalJournalier = pointagesLibre.length;
  const totalActivite = pointagesActivite.length;
  const totalManuel = pointages.filter((p: any) => p.manuel).length;

  // Jeunes (light)
  const jeunesLight = jeunesRaw.map((j: any) => ({
    id: j.id,
    nom: j.nom,
    prenom: j.prenom,
    espaceId: j.espaceId,
  }));

  // Raw pointages accueil-libre (for expanded rows)
  const pointagesLibreRaw = pointagesLibre.map((p: any) => ({
    id:            p.id,
    jeuneId:       p.jeuneId ?? null,
    espaceId:      p.espaceId,
    date:          p.date,
    heureArrivee:  p.heureArrivee,
    heureSortie:   p.heureSortie,
    animateur:     p.animateur,
    manuel:        p.manuel,
    source:        p.source ?? 'admin',
    prenomManuel:  p.prenomManuel ?? null,
    nomManuel:     p.nomManuel ?? null,
  }));

  return (
    <PresencesClient
      journalierList={journalierList}
      activitesList={activitesList}
      totalJournalier={totalJournalier}
      totalActivite={totalActivite}
      totalManuel={totalManuel}
      jeunes={jeunesLight}
      pointagesLibreRaw={pointagesLibreRaw}
    />
  );
}
