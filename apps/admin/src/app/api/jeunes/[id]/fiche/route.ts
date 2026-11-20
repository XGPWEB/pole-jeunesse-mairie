import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { lireFicheJeune } from '@/lib/fiche-jeune';

/**
 * GET /api/jeunes/[id]/fiche — fiche de terrain d'UN jeune (revue R4).
 *
 * Sert l'écran « Fiches de liaison » de l'application mobile : contacts
 * familiaux, autorisations et observations. La forme exacte et la liste des
 * champs volontairement exclus sont documentées dans `lib/fiche-jeune.ts`.
 *
 *  - Authentification : `requireAuth` (cookie `pj_token` ou Bearer). Rôle,
 *    commune et statut du compte sont lus en base par la garde.
 *  - Cloisonnement : commune de la session uniquement. Un identifiant d'une
 *    autre commune reçoit exactement la même réponse 404 qu'un identifiant
 *    inexistant.
 *  - Périmètre : admin et animateur de la commune, comme la fiche web
 *    (`/animateur/jeunes/[id]`), qui ne restreint pas par espace assigné.
 *  - Pas de liste : `GET /api/jeunes` reste un résumé sans ces données.
 *  - Jamais mise en cache ; aucune donnée personnelle journalisée (ni
 *    l'identifiant demandé, ni le contenu de l'erreur).
 *
 * Aucun en-tête CORS : la route est destinée à l'application native et aux
 * appels same-origin, pas à une origine web tierce.
 */
const SANS_CACHE = { 'Cache-Control': 'private, no-store' };

/** Réponse unique pour « inexistant » et « autre commune ». */
function introuvable(): NextResponse {
  return NextResponse.json({ error: 'Fiche introuvable.' }, { status: 404, headers: SANS_CACHE });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(request);
  if (!session) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401, headers: SANS_CACHE });
  }

  const { id } = await params;
  if (typeof id !== 'string' || id === '' || id.length > 200) return introuvable();

  try {
    const fiche = await lireFicheJeune(session.tenant_id, id);
    if (!fiche) return introuvable();
    return NextResponse.json(fiche, { headers: SANS_CACHE });
  } catch (err) {
    // Seule la nature de l'erreur est journalisée : ni identifiant, ni message
    // (un message PostgreSQL peut reprendre des valeurs de la requête).
    const code = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : 'inconnu';
    console.error('[api/jeunes/fiche] échec de lecture, code', code);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500, headers: SANS_CACHE });
  }
}
