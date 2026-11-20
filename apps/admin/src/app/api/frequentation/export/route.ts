import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX = require('xlsx');

const MOIS_LABELS: Record<number, string> = {
  0: 'Janvier', 1: 'Février', 2: 'Mars', 3: 'Avril', 4: 'Mai', 5: 'Juin',
  6: 'Juillet', 7: 'Août', 8: 'Septembre', 9: 'Octobre', 10: 'Novembre', 11: 'Décembre',
};
const JOUR_LABELS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

type EspaceKey = 'collegiens' | 'lyceens' | 'pij' | 'clas';
const ESPACE_KEYS: EspaceKey[] = ['collegiens', 'lyceens', 'pij', 'clas'];

interface DayCounts { collegiens: number; lyceens: number; pij: number; clas: number; }
function emptyDayCounts(): DayCounts { return { collegiens: 0, lyceens: 0, pij: 0, clas: 0 }; }
function totalOf(c: DayCounts): number { return c.collegiens + c.lyceens + c.pij + c.clas; }

export async function GET(request: NextRequest) {
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }
  const { tenant_id } = user;

  const anneeParam = request.nextUrl.searchParams.get('annee');
  const annee = anneeParam ? parseInt(anneeParam, 10) : new Date().getFullYear();
  if (isNaN(annee) || annee < 2000 || annee > 2100) {
    return NextResponse.json({ error: 'Paramètre annee invalide' }, { status: 400 });
  }
  const debut = `${annee}-01-01`;
  const fin   = `${annee}-12-31`;

  // Récupérer pointages avec espace résolu (via jeune ou activité en fallback)
  const presences = await query(`
    SELECT
      p.date::text AS date,
      COALESCE(
        CASE WHEN p.espace_id IN ('collegiens','lyceens','pij','clas') THEN p.espace_id END,
        CASE WHEN j.espace_id IN ('collegiens','lyceens','pij','clas') THEN j.espace_id END,
        CASE WHEN a.espace_id IN ('collegiens','lyceens','pij','clas') THEN a.espace_id END
      ) AS espace_id
    FROM pointages p
    LEFT JOIN jeunes j ON j.id = p.jeune_id
    LEFT JOIN activites a ON a.id = p.activite_id
    WHERE p.tenant_id = $1
      AND p.date >= $2 AND p.date <= $3
      AND p.statut IS NOT NULL AND p.statut NOT IN ('absent', 'excuse', '')
  `, [tenant_id, debut, fin]);

  // Grouper par mois → date → espace
  const byMonth = new Map<number, Map<string, DayCounts>>();
  for (const p of presences) {
    const espace = (p as any).espace_id as EspaceKey | null;
    if (!espace) continue;
    const dateStr = (p as any).date as string;
    const [, month0] = dateStr.split('-').map(Number);
    const month = month0 - 1;

    if (!byMonth.has(month)) byMonth.set(month, new Map());
    const monthMap = byMonth.get(month)!;
    if (!monthMap.has(dateStr)) monthMap.set(dateStr, emptyDayCounts());
    monthMap.get(dateStr)![espace]++;
  }

  const wb = XLSX.utils.book_new();
  const bilanRows: { mois: string; collegiens: number; lyceens: number; pij: number; clas: number; total: number; jours: number; moyenne: number }[] = [];
  const sortedMonths = Array.from(byMonth.keys()).sort((a, b) => a - b);

  for (const month of sortedMonths) {
    const monthMap = byMonth.get(month)!;
    const sheetName = `${MOIS_LABELS[month]} ${annee}`;
    const dates = Array.from(monthMap.keys()).sort();
    const rows: (string | number)[][] = [['Date', 'Jour', 'Collégiens', 'Lycéens', 'PIJ', 'CLAS', 'Total']];

    const weekAccum = emptyDayCounts();
    const monthAccum = emptyDayCounts();
    const boldRows: number[] = [];

    for (const dateStr of dates) {
      const [_yr, _mo, _dd] = dateStr.split('-').map(Number);
      const _d = new Date(_yr, _mo - 1, _dd);
      const dayOfWeek = _d.getDay();
      const counts = monthMap.get(dateStr)!;
      const t = totalOf(counts);
      const dd = String(_dd).padStart(2, '0');
      const mm = String(_mo).padStart(2, '0');

      rows.push([`${dd}/${mm}/${annee}`, JOUR_LABELS[dayOfWeek], counts.collegiens, counts.lyceens, counts.pij, counts.clas, t]);

      for (const k of ESPACE_KEYS) { weekAccum[k] += counts[k]; monthAccum[k] += counts[k]; }

      if (dayOfWeek === 6) {
        const wt = totalOf(weekAccum);
        rows.push(['Sous-total semaine', '', weekAccum.collegiens, weekAccum.lyceens, weekAccum.pij, weekAccum.clas, wt]);
        boldRows.push(rows.length - 1);
        for (const k of ESPACE_KEYS) weekAccum[k] = 0;
      }
    }

    if (totalOf(weekAccum) > 0) {
      rows.push(['Sous-total semaine', '', weekAccum.collegiens, weekAccum.lyceens, weekAccum.pij, weekAccum.clas, totalOf(weekAccum)]);
      boldRows.push(rows.length - 1);
    }

    const mt = totalOf(monthAccum);
    rows.push([`Total ${MOIS_LABELS[month]}`, '', monthAccum.collegiens, monthAccum.lyceens, monthAccum.pij, monthAccum.clas, mt]);
    boldRows.push(rows.length - 1);

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 }];

    for (const rowIdx of boldRows) {
      for (let c = 0; c < 7; c++) {
        const cellRef = XLSX.utils.encode_cell({ r: rowIdx, c });
        if (ws[cellRef]) ws[cellRef].s = { font: { bold: true }, fill: { fgColor: { rgb: 'D9E2F3' } } };
      }
    }
    for (let c = 0; c < 7; c++) {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c });
      if (ws[cellRef]) ws[cellRef].s = { font: { bold: true }, fill: { fgColor: { rgb: '4472C4' } }, color: { rgb: 'FFFFFF' } };
    }

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    bilanRows.push({
      mois: `${MOIS_LABELS[month]} ${annee}`,
      collegiens: monthAccum.collegiens, lyceens: monthAccum.lyceens,
      pij: monthAccum.pij, clas: monthAccum.clas, total: mt,
      jours: dates.length,
      moyenne: dates.length > 0 ? Math.round((mt / dates.length) * 100) / 100 : 0,
    });
  }

  const bilanData: (string | number)[][] = [['Mois', 'Collégiens', 'Lycéens', 'PIJ', 'CLAS', 'Total', "Jours d'ouverture", 'Moyenne/jour']];
  let totalCollegiens = 0, totalLyceens = 0, totalPij = 0, totalClas = 0, totalTotal = 0, totalJours = 0;

  for (const row of bilanRows) {
    bilanData.push([row.mois, row.collegiens, row.lyceens, row.pij, row.clas, row.total, row.jours, row.moyenne]);
    totalCollegiens += row.collegiens; totalLyceens += row.lyceens;
    totalPij += row.pij; totalClas += row.clas;
    totalTotal += row.total; totalJours += row.jours;
  }

  const moyenneAnnuelle = totalJours > 0 ? Math.round((totalTotal / totalJours) * 100) / 100 : 0;
  bilanData.push(['TOTAL', totalCollegiens, totalLyceens, totalPij, totalClas, totalTotal, totalJours, moyenneAnnuelle]);

  const wsBilan = XLSX.utils.aoa_to_sheet(bilanData);
  wsBilan['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 18 }, { wch: 14 }];

  for (let c = 0; c < 8; c++) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c });
    if (wsBilan[cellRef]) wsBilan[cellRef].s = { font: { bold: true }, fill: { fgColor: { rgb: '4472C4' } }, color: { rgb: 'FFFFFF' } };
  }
  const totalRowIdx = bilanData.length - 1;
  for (let c = 0; c < 8; c++) {
    const cellRef = XLSX.utils.encode_cell({ r: totalRowIdx, c });
    if (wsBilan[cellRef]) wsBilan[cellRef].s = { font: { bold: true }, fill: { fgColor: { rgb: 'D9E2F3' } } };
  }

  XLSX.utils.book_append_sheet(wb, wsBilan, 'Bilan Annuel');
  const buf: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(buf as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="frequentation-${annee}.xlsx"`,
    },
  });
}
