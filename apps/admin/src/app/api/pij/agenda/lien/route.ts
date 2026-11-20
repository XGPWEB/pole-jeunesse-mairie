import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { requireAuth } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { ERREUR_SAISIE_PIJ, peutSaisirPij } from '@/lib/pij';
import { empreinteJeton } from '@/lib/pij-db';

/**
 * Lien d'abonnement PERSONNEL à l'agenda PIJ (Outlook, LE HUB) — réservé aux
 * comptes qui saisissent au PIJ.
 *
 * Le jeton n'est renvoyé qu'à sa création : la base n'en garde que
 * l'empreinte. Le perdre impose d'en créer un nouveau, ce qui invalide
 * l'ancien (un seul lien par compte).
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (!peutSaisirPij(session)) return NextResponse.json({ error: ERREUR_SAISIE_PIJ }, { status: 403 });
  try {
    const lien = await queryOne<{ creeLe: string }>(
      'SELECT created_at AS "creeLe" FROM pij_agenda_liens WHERE animateur_id = $1 AND tenant_id = $2',
      [session.id, session.tenant_id],
    );
    return NextResponse.json({ actif: !!lien, creeLe: lien?.creeLe ?? null });
  } catch (err) {
    console.error('[api/pij/agenda/lien GET]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

/** Crée le lien, ou le remplace : l'ancien cesse aussitôt de fonctionner. */
export async function POST(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (!peutSaisirPij(session)) return NextResponse.json({ error: ERREUR_SAISIE_PIJ }, { status: 403 });
  try {
    const jeton = randomBytes(32).toString('base64url');
    await query(`
      INSERT INTO pij_agenda_liens (animateur_id, tenant_id, jeton_hash)
      VALUES ($1, $2, $3)
      ON CONFLICT (animateur_id) DO UPDATE SET
        jeton_hash = EXCLUDED.jeton_hash, tenant_id = EXCLUDED.tenant_id, created_at = NOW()
    `, [session.id, session.tenant_id, empreinteJeton(jeton)]);
    return NextResponse.json({ success: true, jeton });
  } catch (err) {
    console.error('[api/pij/agenda/lien POST]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  try {
    await query('DELETE FROM pij_agenda_liens WHERE animateur_id = $1', [session.id]);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/pij/agenda/lien DELETE]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
