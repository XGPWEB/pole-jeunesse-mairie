import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { todayLocal, toLocalDateStr } from '@/lib/dates';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX = require('xlsx');

// Archive JSON files are kept on disk (static exports, not source data).
//
// Rangées par tenant (caf-archives/<tenantId>/...) : une archive contient des
// données d'heures d'accueil qui appartiennent à une seule structure, et le
// nom de fichier seul (caf-bilan-<date>-<timestamp>.json) ne permettait pas de
// vérifier le tenant du demandeur — n'importe quel utilisateur authentifié
// pouvait télécharger l'archive d'un autre tenant en devinant/énumérant son
// nom. Changement cassant assumé : les archives déjà générées avant ce
// correctif vivent à la racine de ARCHIVES_DIR (hors sous-dossier tenant) et
// ne sont plus atteignables via `?archive=` — un nouvel export régénère une
// archive correctement cloisonnée.
const ARCHIVES_DIR = path.join(process.cwd(), 'src/data/caf-archives');

function tenantArchivesDir(tenantId: string): string {
  return path.join(ARCHIVES_DIR, tenantId);
}

function parseMin(t: string): number {
  if (!t || !t.includes(':')) return 0;
  const [h, m] = t.split(':').map(Number);
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

function getISOWeek(dateStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const date = new Date(y, mo - 1, d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 4 - (date.getDay() || 7));
  const yr = date.getFullYear();
  const w = Math.ceil((((date.getTime() - new Date(yr, 0, 1).getTime()) / 86400000) + 1) / 7);
  return `${yr}-Sem${String(w).padStart(2, '0')}`;
}

function minToHHMM(min: number): string {
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

function minToDecimal(min: number): number {
  return Math.round((min / 60) * 100) / 100;
}

const MOIS_LABELS: Record<string, string> = {
  '2025-10': 'Octobre 2025',   '2025-11': 'Novembre 2025', '2025-12': 'Décembre 2025',
  '2026-01': 'Janvier 2026',   '2026-02': 'Février 2026',  '2026-03': 'Mars 2026',
  '2026-04': 'Avril 2026',     '2026-05': 'Mai 2026',      '2026-06': 'Juin 2026',
  '2026-07': 'Juillet 2026',   '2026-08': 'Août 2026',     '2026-09': 'Septembre 2026',
};

function buildExcel(archiveData: any): Buffer {
  const wb = XLSX.utils.book_new();
  // ⚠️ Ne pas dériver la date d'export via `.split('T')[0]` sur l'ISO string : ça renvoie
  // l'heure UTC et donne la mauvaise date entre minuit et 2-3h heure de Paris (voir lib/dates.ts).
  const exportDate = toLocalDateStr(new Date(archiveData.exportedAt));

  const resumeRows = [
    ['Déclaration CAF — Heures d\'accueil Collégiens'],
    [''],
    ['Date d\'export', exportDate],
    ['Exporté par', archiveData.exportedBy],
    ['Espace', 'Collégiens'],
    [''],
    ['Total heures d\'accueil', archiveData.totalHeures],
    ['Total heures (décimal)', minToDecimal(archiveData.totalMinutes)],
    ['Pointages avec durée', archiveData.pointagesAvecDuree],
  ];
  const wsResume = XLSX.utils.aoa_to_sheet(resumeRows);
  wsResume['!cols'] = [{ width: 32 }, { width: 22 }];
  XLSX.utils.book_append_sheet(wb, wsResume, 'Résumé');

  const mensuelRows: any[][] = [
    ['Mois', 'Heures', 'Heures décimal', 'Minutes'],
    ...archiveData.parMois.map((m: any) => [m.label, m.heures, minToDecimal(m.minutes), m.minutes]),
    [''],
    ['TOTAL', archiveData.totalHeures, minToDecimal(archiveData.totalMinutes), archiveData.totalMinutes],
  ];
  const wsMensuel = XLSX.utils.aoa_to_sheet(mensuelRows);
  wsMensuel['!cols'] = [{ width: 22 }, { width: 14 }, { width: 18 }, { width: 12 }];
  XLSX.utils.book_append_sheet(wb, wsMensuel, 'Bilan mensuel');

  const hebdoRows: any[][] = [
    ['Semaine', 'Heures', 'Heures décimal', 'Minutes'],
    ...archiveData.parSemaine.map((s: any) => [s.sem, s.heures, minToDecimal(s.minutes), s.minutes]),
  ];
  const wsHebdo = XLSX.utils.aoa_to_sheet(hebdoRows);
  wsHebdo['!cols'] = [{ width: 15 }, { width: 14 }, { width: 18 }, { width: 12 }];
  XLSX.utils.book_append_sheet(wb, wsHebdo, 'Bilan hebdomadaire');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export async function GET(request: NextRequest) {
  const session = await requireAuth(request);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { tenant_id } = session;

  const { searchParams } = new URL(request.url);
  const archiveFilename = searchParams.get('archive');

  // Re-download d'une archive existante — cantonnée au sous-dossier du tenant
  // courant : le nom de fichier seul ne prouve pas l'appartenance à ce tenant.
  if (archiveFilename) {
    const safeName = path.basename(archiveFilename);
    const tenantDir = path.resolve(tenantArchivesDir(tenant_id));
    const archivePath = path.join(tenantDir, safeName);
    if (archivePath !== tenantDir && !archivePath.startsWith(`${tenantDir}${path.sep}`)) {
      return NextResponse.json({ error: 'Nom de fichier invalide' }, { status: 400 });
    }
    if (!fs.existsSync(archivePath)) {
      return NextResponse.json({ error: 'Archive introuvable' }, { status: 404 });
    }
    const archiveData = JSON.parse(fs.readFileSync(archivePath, 'utf-8'));
    const buffer = buildExcel(archiveData);
    const xlsxName = archiveFilename.replace('.json', '.xlsx');
    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${xlsxName}"`,
      },
    });
  }

  // Nouvel export : lire les pointages depuis la DB
  const pointages = await query(`
    SELECT date::text AS date,
           heure_arrivee AS "heureArrivee",
           heure_sortie AS "heureSortie"
    FROM pointages
    WHERE tenant_id = $1
      AND espace_id = 'collegiens'
      AND heure_arrivee IS NOT NULL
      AND heure_sortie IS NOT NULL
  `, [tenant_id]);

  const cafParMois: Record<string, number> = {};
  const cafParSemaine: Record<string, number> = {};
  let totalMinutes = 0;
  let pointagesAvecDuree = 0;

  for (const p of pointages) {
    const duree = parseMin((p as any).heureSortie) - parseMin((p as any).heureArrivee);
    if (duree <= 0) continue;
    totalMinutes += duree;
    pointagesAvecDuree++;
    const mois = ((p as any).date as string).substring(0, 7);
    cafParMois[mois] = (cafParMois[mois] || 0) + duree;
    const sem = getISOWeek((p as any).date);
    cafParSemaine[sem] = (cafParSemaine[sem] || 0) + duree;
  }

  const exportDate = todayLocal();
  const archiveData = {
    exportedAt: new Date().toISOString(),
    exportedBy: `${session.prenom ?? ''} ${session.nom ?? ''}`.trim(),
    espace: 'Collégiens',
    totalMinutes,
    pointagesAvecDuree,
    totalHeures: minToHHMM(totalMinutes),
    parMois: Object.entries(cafParMois)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mois, min]) => ({ mois, label: MOIS_LABELS[mois] || mois, minutes: min, heures: minToHHMM(min) })),
    parSemaine: Object.entries(cafParSemaine)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sem, min]) => ({ sem, minutes: min, heures: minToHHMM(min) })),
  };

  const tenantDir = tenantArchivesDir(tenant_id);
  if (!fs.existsSync(tenantDir)) fs.mkdirSync(tenantDir, { recursive: true });
  const archiveFilenameNew = `caf-bilan-${exportDate}-${randomUUID()}.json`;
  fs.writeFileSync(path.join(tenantDir, archiveFilenameNew), JSON.stringify(archiveData, null, 2));

  const buffer = buildExcel(archiveData);
  const xlsxName = `CAF-bilan-collegiens-${exportDate}.xlsx`;

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${xlsxName}"`,
    },
  });
}
