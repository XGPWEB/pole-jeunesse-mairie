import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query } from '@/lib/db';
import { origineAutorisee } from '@/lib/adresse';

const CORS = {
  'Access-Control-Allow-Origin': origineAutorisee(),
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ESPACE_LABELS: Record<string, string> = {
  collegiens: 'Espace Collégiens',
  lyceens: 'Espace Lycéens',
  pij: 'PIJ — Point Information Jeunesse',
  clas: 'CLAS — Accompagnement Scolaire',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function escapeCSV(val: any): string {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function calcDuree(arrivee?: string, sortie?: string): string {
  if (!arrivee || !sortie) return '';
  const [ha, ma] = arrivee.split(':').map(Number);
  const [hs, ms] = sortie.split(':').map(Number);
  const total = (hs * 60 + ms) - (ha * 60 + ma);
  if (total <= 0) return '';
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h${m.toString().padStart(2, '0')}`;
}

export async function GET(request: NextRequest) {
  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401, headers: CORS });
  }
  const { tenant_id } = user;
  try {
    const { searchParams } = new URL(request.url);
    const debut  = searchParams.get('debut');
    const fin    = searchParams.get('fin');
    const espace = searchParams.get('espace');

    const params: any[] = [tenant_id];
    let where = 'WHERE p.tenant_id = $1';
    if (debut)  { params.push(debut);  where += ` AND p.date >= $${params.length}`; }
    if (fin)    { params.push(fin);    where += ` AND p.date <= $${params.length}`; }
    if (espace) { params.push(espace); where += ` AND p.espace_id = $${params.length}`; }

    const pointages = await query(`
      SELECT p.id, p.jeune_id AS "jeuneId", p.espace_id AS "espaceId", p.date::text AS date,
             p.heure_arrivee AS "heureArrivee", p.heure_sortie AS "heureSortie",
             p.type, p.animateur, p.manuel,
             p.prenom_manuel AS "prenomManuel", p.nom_manuel AS "nomManuel",
             j.nom AS "jeuneNom", j.prenom AS "jeunePrenom",
             j.date_naissance::text AS "dateNaissance"
      FROM pointages p
      LEFT JOIN jeunes j ON j.id = p.jeune_id
      ${where}
      ORDER BY j.nom, j.prenom, p.date
    `, params);

    // Regrouper par jeune
    const parJeune: Record<string, { nom: string; prenom: string; dateNaissance: string; passages: any[]; totalMinutes: number }> = {};

    for (const p of pointages) {
      const key = (p as any).jeuneId ?? `manuel-${(p as any).prenomManuel}-${(p as any).nomManuel}`;
      if (!parJeune[key]) {
        parJeune[key] = {
          nom: (p as any).jeuneNom ?? (p as any).nomManuel ?? 'INCONNU',
          prenom: (p as any).jeunePrenom ?? (p as any).prenomManuel ?? '',
          dateNaissance: (p as any).dateNaissance ?? '',
          passages: [],
          totalMinutes: 0,
        };
      }
      parJeune[key].passages.push(p);

      if ((p as any).heureArrivee && (p as any).heureSortie) {
        const [ha, ma] = (p as any).heureArrivee.split(':').map(Number);
        const [hs, ms] = (p as any).heureSortie.split(':').map(Number);
        const duree = (hs * 60 + ms) - (ha * 60 + ma);
        if (duree > 0) parJeune[key].totalMinutes += duree;
      }
    }

    const header = [
      'NOM', 'PRENOM', 'DATE_NAISSANCE', 'ESPACE',
      'DATE', 'HEURE_ARRIVEE', 'HEURE_SORTIE', 'DUREE',
      'TYPE', 'ANIMATEUR', 'AJOUT_MANUEL', 'TOTAL_HEURES_PERIODE',
    ].join(',');

    const rows: string[] = [header];

    for (const { nom, prenom, dateNaissance, passages, totalMinutes } of Object.values(parJeune)) {
      const totalH = Math.floor(totalMinutes / 60);
      const totalM = totalMinutes % 60;
      const totalStr = totalMinutes > 0 ? `${totalH}h${totalM.toString().padStart(2, '0')}` : '';

      passages.forEach((p: any, idx) => {
        rows.push([
          escapeCSV(nom.toUpperCase()),
          escapeCSV(prenom),
          escapeCSV(dateNaissance),
          escapeCSV(ESPACE_LABELS[p.espaceId] ?? p.espaceId),
          escapeCSV(p.date),
          escapeCSV(p.heureArrivee ?? ''),
          escapeCSV(p.heureSortie ?? ''),
          escapeCSV(calcDuree(p.heureArrivee, p.heureSortie)),
          escapeCSV(p.type === 'activite' ? 'Activité' : 'Accueil libre'),
          escapeCSV(p.animateur ?? ''),
          escapeCSV(p.manuel ? 'Oui' : 'Non'),
          idx === 0 ? escapeCSV(totalStr) : '',
        ].join(','));
      });
    }

    const csv = rows.join('\r\n');
    const filename = `export-caf-${debut ?? 'debut'}-${fin ?? 'fin'}.csv`;

    return new NextResponse(csv, {
      headers: {
        ...CORS,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error('[api/export/caf]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500, headers: CORS });
  }
}
