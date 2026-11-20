import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAuth } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { aRubrique } from '@/lib/rubriques';

const SELECT = `
  SELECT id, type, titre, message, cible, urgent,
         envoye_par AS "envoyePar",
         envoye_at AS "envoyeAt",
         lu_par AS "luPar",
         dismissed_par AS "dismissedPar",
         dest_animateur_id AS "destAnimateurId",
         sortie_id AS "sortieId",
         sortie_url AS "sortieUrl",
         demandeur_id AS "demandeurId",
         demandeur_nom AS "demandeurNom",
         expediteur_id AS "expediteurId",
         expediteur_nom AS "expediteurNom",
         expediteur_username AS "expediteurUsername",
         expediteur_espace AS "expediteurEspace",
         from_animateur_id AS "fromAnimateurId",
         from_animateur_username AS "fromAnimateurUsername",
         from_animateur_prenom AS "fromAnimateurPrenom",
         from_animateur_nom AS "fromAnimateurNom",
         from_animateur_email AS "fromAnimateurEmail"
  FROM notifications
`;

export async function GET(request: NextRequest) {
  const session = await requireAuth(request);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { tenant_id } = session;

  try {
    let rows: any[];
    if (session.role === 'admin') {
      rows = await query(`${SELECT} WHERE tenant_id = $1 AND NOT ($2 = ANY(COALESCE(dismissed_par, '{}'))) ORDER BY envoye_at DESC LIMIT 100`, [tenant_id, session.id]);
    } else {
      rows = await query(`
        ${SELECT}
        WHERE tenant_id = $1
          AND (cible = 'Tous' OR cible = $2 OR dest_animateur_id = $3)
          AND NOT ($3 = ANY(COALESCE(dismissed_par, '{}')))
        ORDER BY envoye_at DESC LIMIT 100
      `, [tenant_id, session.espaceAssigne, session.id]);
    }
    return NextResponse.json({ notifications: rows });
  } catch (err) {
    console.error('[api/notifications]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requireAuth(request);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (session.role !== 'admin' || !aRubrique(session, 'notifications')) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }
  const { tenant_id } = session;

  try {
    const { titre, message, cible, urgent, destAnimateurId, type } = await request.json();
    if (!titre || !message) {
      return NextResponse.json({ error: 'Titre et message requis' }, { status: 400 });
    }

    const id = `notif-${randomUUID()}`;
    await queryOne(`
      INSERT INTO notifications (id, type, titre, message, cible, urgent, envoye_par, dest_animateur_id, tenant_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [id, type ?? 'notification', titre, message, cible ?? 'Tous', urgent ?? false, session.username, destAnimateurId ?? null, tenant_id]);

    const rows = await query(`${SELECT} WHERE tenant_id = $1 ORDER BY envoye_at DESC LIMIT 100`, [tenant_id]);
    return NextResponse.json({ success: true, notifications: rows });
  } catch (err) {
    console.error('[api/notifications]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await requireAuth(request);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  try {
    const body: unknown = await request.json().catch(() => null);
    const { id, action } = (body ?? {}) as { id?: unknown; action?: unknown };
    if (typeof id !== 'string' || !id) {
      return NextResponse.json({ error: 'ID requis' }, { status: 400 });
    }

    // Périmètre d'écriture = périmètre de LECTURE du GET ci-dessus : même
    // tenant, et pour un animateur uniquement les notifications qui lui sont
    // destinées. Le filtre portait auparavant sur l'id seul : n'importe quel
    // compte pouvait marquer lue/masquée une notification d'une autre
    // structure, ou une notification réservée aux admins.
    const colonne = action === 'dismiss' ? 'dismissed_par' : 'lu_par';
    const estAdmin = session.role === 'admin';
    const row = await queryOne<{ id: string }>(`
      UPDATE notifications
         SET ${colonne} = CASE
               WHEN $2 = ANY(COALESCE(${colonne}, '{}')) THEN ${colonne}
               ELSE array_append(COALESCE(${colonne}, '{}'), $2)
             END
       WHERE id = $1
         AND tenant_id = $3
         AND ($4::boolean OR cible = 'Tous' OR cible = $5 OR dest_animateur_id = $2)
      RETURNING id
    `, [id, session.id, session.tenant_id, estAdmin, session.espaceAssigne]);

    if (!row) return NextResponse.json({ error: 'Notification introuvable' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/notifications]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await requireAuth(request);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }
  const { tenant_id } = session;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID requis' }, { status: 400 });

    await queryOne('DELETE FROM notifications WHERE id = $1 AND tenant_id = $2', [id, tenant_id]);
    const rows = await query(`${SELECT} WHERE tenant_id = $1 ORDER BY envoye_at DESC LIMIT 100`, [tenant_id]);
    return NextResponse.json({ success: true, notifications: rows });
  } catch (err) {
    console.error('[api/notifications]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
