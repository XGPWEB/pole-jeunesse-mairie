import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { peutSaisirPij } from '@/lib/pij';
import { genererIcs, type RdvPij } from '@/lib/pij-agenda';
import { SELECT_RDV, empreinteJeton } from '@/lib/pij-db';
import { aRubrique } from '@/lib/rubriques';

/**
 * Flux iCalendar de l'agenda PIJ : /api/pij/agenda/flux/<jeton>.ics
 *
 * Route PUBLIQUE (voir PUBLIC_PATHS dans src/proxy.ts) : Outlook et LE HUB
 * s'y abonnent sans cookie. Le jeton du chemin est le seul secret ; il est
 * rattaché à un compte, et le flux ne répond que tant que ce compte est actif
 * et garde le droit de saisie PIJ — un compte suspendu, supprimé ou changé
 * d'espace perd son flux sans autre action.
 *
 * Toute erreur d'accès répond 404, sans dire pourquoi.
 *
 * Le calendrier ne porte ni nom complet, ni téléphone, ni notes
 * (`titreRdvExterne`) : il est recopié sur des serveurs tiers.
 */
const INTROUVABLE = new NextResponse('Not found', { status: 404 });

export async function GET(_req: NextRequest, { params }: { params: Promise<{ jeton: string }> }) {
  try {
    const jeton = (await params).jeton.replace(/\.ics$/i, '');
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(jeton)) return INTROUVABLE.clone();

    const compte = await queryOne<{ role: string; rubriques: string[] | null; espaceAssigne: string | null; tenantId: string }>(`
      SELECT a.role, a.rubriques, a.espace_assigne AS "espaceAssigne", a.tenant_id AS "tenantId"
      FROM pij_agenda_liens l
      JOIN animateurs a ON a.id = l.animateur_id AND a.tenant_id = l.tenant_id
      WHERE l.jeton_hash = $1 AND a.statut = 'actif'
    `, [empreinteJeton(jeton)]);
    if (!compte || !peutSaisirPij(compte) || !aRubrique(compte, 'pij')) return INTROUVABLE.clone();

    // Trois mois d'historique : assez pour retrouver un rendez-vous récent,
    // sans faire grossir indéfiniment ce que l'agenda externe télécharge.
    const rdvs = await query<RdvPij>(
      `${SELECT_RDV} WHERE r.tenant_id = $1 AND r.date >= CURRENT_DATE - INTERVAL '3 months' ORDER BY r.date, r.heure`,
      [compte.tenantId],
    );
    return new NextResponse(genererIcs(rdvs), {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="rdv-pij.ics"',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('[api/pij/agenda/flux GET]', err);
    return new NextResponse('Erreur serveur', { status: 500 });
  }
}
