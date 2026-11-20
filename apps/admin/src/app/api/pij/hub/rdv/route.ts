import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { query, queryOne } from '@/lib/db';
import { validerRdv } from '@/lib/pij-agenda';

export const dynamic = 'force-dynamic';

/**
 * Synchro de l'agenda PIJ avec LE HUB (l'appli des jeunes, même serveur).
 * Appelée par le serveur de LE HUB, sans session : secret partagé
 * `HUB_SYNC_SECRET` (en-tête `X-Hub-Secret`), commune `HUB_SYNC_TENANT_ID`.
 * 404 tant que l'un des deux manque : la route n'existe pas pour l'extérieur
 * tant que la synchro n'est pas activée.
 *
 * Chaque application reste maître de ses rendez-vous :
 *   GET → les rendez-vous de l'agenda (3 mois d'historique), pour que LE HUB
 *         bloque les créneaux pris ici et relise le pointage (honoré, absent)
 *         de ceux qu'il a envoyés. Ni nom complet, ni téléphone, ni notes.
 *   PUT → LE HUB crée ou met à jour l'un de SES rendez-vous (clé `hubId`).
 *         Un pointage fait ici (honoré, absent) n'est jamais écrasé par un
 *         « prévu » venu de LE HUB ; une annulation de LE HUB s'applique.
 */

function secretsEgaux(recu: string | null, attendu: string): boolean {
  if (!recu) return false;
  const a = createHash('sha256').update(recu).digest();
  const b = createHash('sha256').update(attendu).digest();
  return timingSafeEqual(a, b);
}

/** Commune de la synchro, ou une réponse d'erreur. */
function controleAcces(request: NextRequest): { tenantId: string } | NextResponse {
  const secret = process.env.HUB_SYNC_SECRET?.trim();
  const tenantId = process.env.HUB_SYNC_TENANT_ID?.trim();
  if (!secret || secret.length < 32 || !tenantId) return new NextResponse(null, { status: 404 });
  if (!secretsEgaux(request.headers.get('x-hub-secret'), secret)) {
    return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });
  }
  return { tenantId };
}

const ID_HUB = /^[A-Za-z0-9_-]{1,100}$/;

export async function GET(request: NextRequest) {
  const acces = controleAcces(request);
  if (acces instanceof NextResponse) return acces;
  try {
    const rdvs = await query(`
      SELECT id, hub_id AS "hubId", date::text AS date, heure, duree_minutes AS "dureeMinutes",
             prenom || ' ' || UPPER(LEFT(TRIM(nom), 1)) || '.' AS titre, statut
      FROM pij_rdv
      WHERE tenant_id = $1 AND date >= CURRENT_DATE - INTERVAL '3 months'
      ORDER BY date, heure
    `, [acces.tenantId]);
    return NextResponse.json({ rdvs }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[api/pij/hub/rdv GET]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const acces = controleAcces(request);
  if (acces instanceof NextResponse) return acces;
  try {
    const corps = await request.json().catch(() => null);
    const hubId = (corps as Record<string, unknown> | null)?.hubId;
    if (typeof hubId !== 'string' || !ID_HUB.test(hubId)) {
      return NextResponse.json({ error: 'hubId invalide.' }, { status: 400 });
    }
    const validation = validerRdv({ ...corps, lieu: 'PIJ', notes: null, accueilId: null });
    if (!validation.ok) return NextResponse.json({ error: validation.erreur }, { status: 400 });
    const v = validation.valeurs;

    // Les notes et le pointage saisis ici sont conservés : LE HUB n'envoie
    // jamais de notes, et son « prévu » ne défait pas un « honoré »/« absent ».
    const rdv = await queryOne(`
      INSERT INTO pij_rdv (
        id, tenant_id, created_by, hub_id,
        date, heure, duree_minutes, nom, prenom, telephone, objet, lieu, statut
      ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, 'PIJ', $11)
      ON CONFLICT (tenant_id, hub_id) WHERE hub_id IS NOT NULL DO UPDATE SET
        date = EXCLUDED.date, heure = EXCLUDED.heure, duree_minutes = EXCLUDED.duree_minutes,
        nom = EXCLUDED.nom, prenom = EXCLUDED.prenom, telephone = EXCLUDED.telephone,
        objet = EXCLUDED.objet,
        statut = CASE
          WHEN EXCLUDED.statut = 'prevu' AND pij_rdv.statut IN ('honore', 'absent') THEN pij_rdv.statut
          ELSE EXCLUDED.statut
        END,
        updated_at = NOW()
      RETURNING id, statut
    `, [
      `pij-rdv-${randomUUID()}`, acces.tenantId, hubId,
      v.date, v.heure, v.dureeMinutes, v.nom, v.prenom, v.telephone, v.objet, v.statut,
    ]);
    return NextResponse.json({ success: true, rdv });
  } catch (err) {
    console.error('[api/pij/hub/rdv PUT]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
