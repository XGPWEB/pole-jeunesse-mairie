import { getTenantId } from '@/lib/auth';
import { query } from '@/lib/db';
import PresencesClient from '@/app/presences/PresencesClient';

export const dynamic = 'force-dynamic';

// Espaces visibles par tous les animateurs dans la section Présences
const PRESENCES_ESPACES = ['collegiens', 'lyceens'];

export default async function AnimateurPresencesPage() {
  const tenant_id = await getTenantId();
  const [allPointages, allActivites, allJeunes] = await Promise.all([
    query<any>(`
      SELECT id, jeune_id AS "jeuneId", espace_id AS "espaceId", date::text AS date,
             heure_arrivee AS "heureArrivee", heure_sortie AS "heureSortie", animateur,
             type, activite_id AS "activiteId", manuel, source, statut,
             prenom_manuel AS "prenomManuel", nom_manuel AS "nomManuel"
      FROM pointages WHERE tenant_id = $1 AND espace_id IN ('collegiens','lyceens')
      ORDER BY date DESC, created_at DESC
    `, [tenant_id]),
    query<any>(`SELECT id, titre, espace_id AS "espaceId", places_total AS "placesTotal", date::text AS date FROM activites WHERE tenant_id = $1 AND espace_id IN ('collegiens','lyceens') ORDER BY date DESC`, [tenant_id]),
    query<any>(`SELECT id, nom, prenom, espace_id AS "espaceId" FROM jeunes WHERE tenant_id = $1 AND espace_id IN ('collegiens','lyceens')`, [tenant_id]),
  ]);

  // ── Accueil libre ──────────────────────────────────────────────────────────
  const pointagesLibre    = allPointages.filter((p: any) => p.type === 'accueil-libre');
  const pointagesActivite = allPointages.filter((p: any) => p.type === 'activite' || p.source === 'web');

  const journalierByDate: Record<string, { date: string; total: number; manuel: number; espaces: Record<string, number> }> = {};
  pointagesLibre.forEach((p: any) => {
    if (!journalierByDate[p.date]) journalierByDate[p.date] = { date: p.date, total: 0, manuel: 0, espaces: {} };
    journalierByDate[p.date].total++;
    if (p.manuel) journalierByDate[p.date].manuel++;
    const eid = p.espaceId ?? 'inconnu';
    journalierByDate[p.date].espaces[eid] = (journalierByDate[p.date].espaces[eid] || 0) + 1;
  });
  const journalierList = Object.values(journalierByDate).sort((a, b) => b.date.localeCompare(a.date));

  // ── Par activité ───────────────────────────────────────────────────────────
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

  const activitesList = allActivites.map((a: any) => ({
    ...a,
    presences: activiteById[a.id] || { activiteId: a.id, total: 0, present: 0, absent: 0, excuse: 0, manuel: 0 },
  }));

  // ── Stats globales ─────────────────────────────────────────────────────────
  const totalJournalier = pointagesLibre.length;
  const totalActivite   = pointagesActivite.length;
  const totalManuel     = allPointages.filter((p: any) => p.manuel).length;

  // ── Jeunes ─────────────────────────────────────────────────────────────────
  const jeunesLight = allJeunes.map((j: any) => ({
    id:       j.id,
    nom:      j.nom,
    prenom:   j.prenom,
    espaceId: j.espaceId,
  }));

  // ── Pointages bruts accueil libre ──────────────────────────────────────────
  const pointagesLibreRaw = pointagesLibre.map((p: any) => ({
    id:           p.id,
    jeuneId:      p.jeuneId ?? null,
    espaceId:     p.espaceId,
    date:         p.date,
    heureArrivee: p.heureArrivee,
    heureSortie:  p.heureSortie,
    animateur:    p.animateur,
    manuel:       p.manuel,
    source:       p.source ?? 'animateur',
    prenomManuel: p.prenomManuel ?? null,
    nomManuel:    p.nomManuel ?? null,
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
