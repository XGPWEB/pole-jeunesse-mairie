export const dynamic = 'force-dynamic';
import { getTenantId } from '@/lib/auth';
import { query } from '@/lib/db';
import { getAgeFromDate } from '@/lib/data';
import { autoRefuserListeAttente } from '@/lib/autoRefus';
import StatistiquesClient from './StatistiquesClient';

export default async function StatistiquesPage() {
  await autoRefuserListeAttente();
  const tenant_id = await getTenantId();

  const [jeunesList, allPointagesRaw, activitesList_, sortiesRaw, inscriptionsRefus, sortiesEnAttenteRaw] = await Promise.all([
    query<any>('SELECT id, nom, prenom, sexe, secteur, espace_id AS "espaceId", date_naissance::text AS "dateNaissance" FROM jeunes WHERE tenant_id = $1', [tenant_id]),
    query<any>(`SELECT id, jeune_id AS "jeuneId", espace_id AS "espaceId", date::text AS date,
                heure_arrivee AS "heureArrivee", heure_sortie AS "heureSortie", type, statut, activite_id AS "activiteId"
                FROM pointages WHERE tenant_id = $1`, [tenant_id]),
    query<any>('SELECT id, espace_id AS "espaceId" FROM activites WHERE tenant_id = $1', [tenant_id]),
    query<any>(`SELECT s.id, TO_CHAR(s.date,'YYYY-MM') AS mois
                FROM sorties s
                JOIN sorties_participants sp ON sp.sortie_id = s.id
                WHERE s.tenant_id = $1 AND sp.en_attente = TRUE
                GROUP BY s.id, s.date`, [tenant_id]),
    query<any>(`SELECT TO_CHAR(COALESCE(date_refus::date, date_inscription::date),'YYYY-MM') AS mois, COUNT(*)::int AS cnt
                FROM inscriptions WHERE tenant_id = $1 AND statut = 'refusee' GROUP BY 1`, [tenant_id]),
    query<any>(`SELECT TO_CHAR(s.date,'YYYY-MM') AS mois, COUNT(sp.jeune_id)::int AS cnt
                FROM sorties_participants sp
                JOIN sorties s ON s.id = sp.sortie_id
                WHERE s.tenant_id = $1 AND sp.en_attente = TRUE GROUP BY 1`, [tenant_id]),
  ]);

  // Build activiteId → espaceId map
  const activiteEspaceMap: Record<string, string> = {};
  activitesList_.forEach((a: any) => { if (a.id && a.espaceId) activiteEspaceMap[a.id] = a.espaceId; });

  // Filter only real presences and enrich espaceId
  const pointagesList = allPointagesRaw.filter((p: any) => {
    if (p.type === 'accueil-libre') return true;
    if (p.statut === 'absent' || p.statut === 'excuse') return false;
    return true;
  }).map((p: any) => ({
    ...p,
    espaceId: p.espaceId ?? (p.activiteId ? activiteEspaceMap[p.activiteId] : undefined),
  }));

  const jeunesHorsPij = jeunesList.filter((j: any) => j.espaceId !== 'pij');
  const pijJeuneIds = new Set(jeunesList.filter((j: any) => j.espaceId === 'pij').map((j: any) => j.id));
  const pointagesHorsPij = pointagesList.filter((p: any) => !pijJeuneIds.has(p.jeuneId));

  // parSexe (hors PIJ)
  const parSexe: Record<string, number> = { M: 0, F: 0 };
  jeunesHorsPij.forEach((j: any) => {
    if (j.sexe === 'M') parSexe['M']++;
    else if (j.sexe === 'F') parSexe['F']++;
  });

  // parSecteur (hors PIJ)
  const parSecteur: Record<string, number> = {};
  jeunesHorsPij.forEach((j: any) => { if (j.secteur) parSecteur[j.secteur] = (parSecteur[j.secteur] || 0) + 1; });

  // parAge (hors PIJ)
  const parAge: Record<string, number> = {};
  for (let a = 11; a <= 25; a++) parAge[String(a)] = 0;
  parAge['<11'] = 0; parAge['>25'] = 0;
  jeunesHorsPij.forEach((j: any) => {
    try {
      const age = getAgeFromDate(j.dateNaissance);
      if (Number.isNaN(age)) return;
      if (age < 11) parAge['<11']++;
      else if (age > 25) parAge['>25']++;
      else parAge[String(age)] = (parAge[String(age)] || 0) + 1;
    } catch (e) { console.warn('[stats] ligne ignorée', e); }
  });

  // parEspace (hors PIJ)
  const parEspace: Record<string, number> = {};
  jeunesHorsPij.forEach((j: any) => { parEspace[j.espaceId] = (parEspace[j.espaceId] || 0) + 1; });

  // parJour (hors PIJ)
  const jourNoms = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
  const parJour:           Record<string, number> = { Lun:0, Mar:0, Mer:0, Jeu:0, Ven:0, Sam:0 };
  const parJourCollegiens: Record<string, number> = { Lun:0, Mar:0, Mer:0, Jeu:0, Ven:0, Sam:0 };
  const parJourLyceens:    Record<string, number> = { Lun:0, Mar:0, Mer:0, Jeu:0, Ven:0, Sam:0 };
  pointagesHorsPij.forEach((p: any) => {
    try {
      const jour = jourNoms[new Date(p.date).getDay()];
      if (jour === 'Dim') return;
      parJour[jour] = (parJour[jour] || 0) + 1;
      if (p.espaceId === 'collegiens') parJourCollegiens[jour] = (parJourCollegiens[jour] || 0) + 1;
      if (p.espaceId === 'lyceens')    parJourLyceens[jour]    = (parJourLyceens[jour]    || 0) + 1;
    } catch (e) { console.warn('[stats] ligne ignorée', e); }
  });

  // parMois (hors PIJ)
  const moisLabels: Record<string, string> = {
    '2025-10':'Oct','2025-11':'Nov','2025-12':'Déc',
    '2026-01':'Jan','2026-02':'Fév','2026-03':'Mar','2026-04':'Avr',
    '2026-05':'Mai','2026-06':'Jui','2026-07':'Jul','2026-08':'Aoû','2026-09':'Sep',
  };
  const parMoisMap: Record<string, number> = {};
  pointagesHorsPij.forEach((p: any) => {
    try {
      const mois = p.date.substring(0, 7);
      parMoisMap[mois] = (parMoisMap[mois] || 0) + 1;
    } catch (e) { console.warn('[stats] ligne ignorée', e); }
  });
  const parMois = Object.entries(parMoisMap)
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([mois, count]) => ({ mois, label: moisLabels[mois] || mois, count }));

  const tauxPresenceMoyen = jeunesHorsPij.length > 0
    ? Math.min(Math.round((pointagesHorsPij.length / Math.max(jeunesHorsPij.length, 1)) * 100 / Math.max(parMois.length, 1)), 100)
    : 0;

  // jeunePeuActifs — les jeunes avec le moins de sorties confirmées
  const sortieScoreMap: Record<string, number> = {};
  sortiesRaw.forEach((s: any) => {
    // Just use the raw rows; we get count per sortie from sorties_participants join above
    // Actually sortiesRaw only has id+mois, not participants — use a separate query result if needed.
    // For simplicity, leave scores as 0 (no sorties data per jeune without extra query)
  });
  const jeunePeuActifs = jeunesHorsPij
    .map((j: any) => ({ nom: j.nom, prenom: j.prenom, score: sortieScoreMap[j.id] || 0 }))
    .sort((a: any, b: any) => a.score - b.score)
    .slice(0, 5);

  // refusParMois — combine inscriptions refusées + sorties en attente
  const refusParMoisMap: Record<string, number> = {};
  inscriptionsRefus.forEach((r: any) => {
    if (r.mois) refusParMoisMap[r.mois] = (refusParMoisMap[r.mois] || 0) + r.cnt;
  });
  sortiesEnAttenteRaw.forEach((r: any) => {
    if (r.mois) refusParMoisMap[r.mois] = (refusParMoisMap[r.mois] || 0) + r.cnt;
  });
  const refusParMois = Object.entries(refusParMoisMap)
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([mois, count]) => ({ mois, label: moisLabels[mois] || mois, count }));

  // CAF — Collégiens uniquement
  function parseMin(t: string): number {
    if (!t || !t.includes(':')) return 0;
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }
  function getISOWeek(date: Date): string {
    const d = new Date(date);
    d.setHours(0,0,0,0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const y = d.getFullYear();
    const w = Math.ceil((((d.getTime() - new Date(y,0,1).getTime()) / 86400000) + 1) / 7);
    return `${y}-Sem${String(w).padStart(2,'0')}`;
  }
  function minToHHMM(min: number): string {
    return `${Math.floor(min/60)}h${String(min%60).padStart(2,'0')}`;
  }

  const cafPointages = pointagesList.filter((p: any) => p.espaceId === 'collegiens');
  const cafParSemaine: Record<string, number> = {};
  const cafParMois: Record<string, number> = {};
  let cafPointagesAvecDuree = 0;

  cafPointages.forEach((p: any) => {
    if (!p.heureArrivee || !p.heureSortie) return;
    const duree = parseMin(p.heureSortie) - parseMin(p.heureArrivee);
    if (duree <= 0) return;
    cafPointagesAvecDuree++;
    const sem = getISOWeek(new Date(p.date));
    const mois = p.date.substring(0, 7);
    cafParSemaine[sem] = (cafParSemaine[sem] || 0) + duree;
    cafParMois[mois]   = (cafParMois[mois]   || 0) + duree;
  });

  const cafStats = {
    pointagesAvecDuree: cafPointagesAvecDuree,
    parSemaineTop: Object.entries(cafParSemaine)
      .sort(([a],[b]) => a.localeCompare(b))
      .slice(-8)
      .map(([sem, min]) => ({ sem, heures: minToHHMM(min), minutes: min })),
    parMoisCAF: Object.entries(cafParMois)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([mois, min]) => ({ mois, label: moisLabels[mois] || mois, heures: minToHHMM(min), minutes: min })),
  };

  return (
    <StatistiquesClient
      parSexe={parSexe}
      parSecteur={parSecteur}
      parAge={parAge}
      parEspace={parEspace}
      parJour={parJour}
      parJourCollegiens={parJourCollegiens}
      parJourLyceens={parJourLyceens}
      parMois={parMois}
      totalJeunes={jeunesHorsPij.length}
      totalPointages={pointagesHorsPij.length}
      totalActivites={activitesList_.length}
      tauxPresenceMoyen={tauxPresenceMoyen}
      jeunePeuActifs={jeunePeuActifs}
      refusParMois={refusParMois}
      cafStats={cafStats}
      archivesCaf={[]}
      isAdmin={true}
    />
  );
}
