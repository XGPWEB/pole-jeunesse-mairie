import { NextRequest, NextResponse } from 'next/server';
import { logMonitoringEvent } from '@/lib/monitoring';
import { FENETRE_15_MIN_MS, consommerTentative, ipClient } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const LIBELLES: Record<string, string> = {
  api_error: 'Erreur API',
  js_error: 'Erreur JavaScript',
  render_error: 'Erreur de rendu',
  slow_load: 'Chargement lent',
};
const MAX_RAPPORTS_PAR_IP = 20;

const texte = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/**
 * Rapport d'erreur envoyé par le navigateur (composant MonitoringReporter).
 *
 * PUBLIC, sans session : une page qui plante peut être l'écran de connexion,
 * et un navigateur en panne n'est par définition pas en état de
 * s'authentifier. Garde-fous : types fermés, champs tronqués par
 * logMonitoringEvent, corps borné, quota par adresse IP. Le pire qu'un tiers
 * puisse faire est d'ajouter quelques faux rapports au journal — pas de lire
 * quoi que ce soit ni d'écrire sans limite.
 */
export async function POST(request: NextRequest) {
  try {
    if (!await consommerTentative(`mon:${ipClient(request)}`, MAX_RAPPORTS_PAR_IP, FENETRE_15_MIN_MS)) {
      return NextResponse.json({ error: 'Trop de rapports.' }, { status: 429 });
    }
    const brut = await request.text();
    if (brut.length > 8000) return NextResponse.json({ error: 'Rapport trop volumineux.' }, { status: 413 });
    let corps: Record<string, unknown>;
    try {
      const analyse: unknown = JSON.parse(brut);
      if (typeof analyse !== 'object' || analyse === null || Array.isArray(analyse)) throw new Error('objet attendu');
      corps = analyse as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Rapport invalide.' }, { status: 400 });
    }
    const kind = texte(corps.kind);
    if (!kind || !Object.hasOwn(LIBELLES, kind)) {
      return NextResponse.json({ error: 'Rapport invalide.' }, { status: 400 });
    }
    await logMonitoringEvent({
      source: 'navigateur',
      type: `${LIBELLES[kind]} — interface web`,
      message: texte(corps.message) ?? '(sans message)',
      detail: texte(corps.detail),
      // Chemin de page seulement : pas de chaîne de requête ni de fragment.
      path: texte(corps.path)?.split(/[?#]/)[0] ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch {
    // Jamais de 500 ici : le navigateur le signalerait à son tour, en boucle.
    return NextResponse.json({ ok: false });
  }
}
