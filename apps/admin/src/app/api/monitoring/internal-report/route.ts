import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual, createHash } from 'crypto';
import { logMonitoringEvent } from '@/lib/monitoring';

export const dynamic = 'force-dynamic';

function secretsEgaux(recu: string | null, attendu: string): boolean {
  if (!recu) return false;
  // Comparaison en temps constant sur des empreintes de même longueur.
  const a = createHash('sha256').update(recu).digest();
  const b = createHash('sha256').update(attendu).digest();
  return timingSafeEqual(a, b);
}

/**
 * Réservé aux scripts d'exploitation du serveur (sauvegarde, contrôle de la
 * copie NAS…) : un cron shell n'a pas de session, d'où un secret partagé
 * (`INTERNAL_MONITORING_SECRET`, en-tête `X-Internal-Secret`).
 *
 * 404 tant que le secret n'est pas configuré : la route n'existe pas pour
 * l'extérieur tant qu'elle n'est pas réellement activée.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.INTERNAL_MONITORING_SECRET?.trim();
  if (!secret || secret.length < 32) return new NextResponse(null, { status: 404 });
  if (!secretsEgaux(request.headers.get('x-internal-secret'), secret)) {
    return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });
  }
  const corps: unknown = await request.json().catch(() => null);
  const c = (typeof corps === 'object' && corps !== null ? corps : {}) as Record<string, unknown>;
  if (typeof c.type !== 'string' || !c.type.trim()) {
    return NextResponse.json({ error: 'type requis.' }, { status: 400 });
  }
  const evenement = await logMonitoringEvent({
    source: 'exploitation',
    type: c.type,
    message: typeof c.message === 'string' && c.message.trim() ? c.message : '(sans message)',
    detail: typeof c.detail === 'string' ? c.detail : null,
  });
  return NextResponse.json({ ok: evenement !== null }, { status: evenement ? 200 : 503 });
}
