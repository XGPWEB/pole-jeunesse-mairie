import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAuth } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import pool from '@/lib/db';

export async function POST(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { tenant_id } = session;

  try {
    const { sortieId, message } = await req.json();
    if (!sortieId) return NextResponse.json({ error: 'sortieId requis' }, { status: 400 });

    const sortie = await queryOne(
      'SELECT id, titre, animateur_id AS "animateurId", espace_id AS "espaceId" FROM sorties WHERE id = $1 AND tenant_id = $2',
      [sortieId, tenant_id],
    );
    if (!sortie) return NextResponse.json({ error: 'Sortie introuvable' }, { status: 404 });
    const s = sortie as any;

    if (s.animateurId === session.id) {
      return NextResponse.json({ error: 'Vous êtes le créateur de cette fiche.' }, { status: 400 });
    }

    const demandeurNom = `${session.prenom ?? ''} ${session.nom ?? ''}`.trim();
    const id = `notif-${randomUUID()}`;
    const titre = `✏️ Demande de modification — ${s.titre}`;
    const msg = message?.trim()
      ? `${demandeurNom} : « ${message.trim()} »`
      : `${demandeurNom} vous demande de modifier la fiche sortie "${s.titre}".`;

    await queryOne(`
      INSERT INTO notifications
        (id, type, titre, message, cible, urgent, envoye_par,
         dest_animateur_id, sortie_id, sortie_url, demandeur_id, demandeur_nom, tenant_id)
      VALUES ($1,'modif-sortie',$2,$3,$4,FALSE,$5,$6,$7,$8,$9,$10,$11)
    `, [
      id, titre, msg,
      s.espaceId ?? 'Tous',
      session.username,
      s.animateurId,
      sortieId,
      `/animateur/sorties/${sortieId}`,
      session.id,
      demandeurNom,
      tenant_id,
    ]);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/sorties/demande-modif]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { tenant_id } = session;

  try {
    const { notifId, sortieId, demandeurId } = await req.json();
    if (!sortieId || !demandeurId) {
      return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 });
    }

    const sortie = await queryOne(
      'SELECT id, titre, animateur_id AS "animateurId" FROM sorties WHERE id = $1 AND tenant_id = $2',
      [sortieId, tenant_id],
    );
    if (!sortie) return NextResponse.json({ error: 'Sortie introuvable' }, { status: 404 });
    const s = sortie as any;

    if (session.role !== 'admin' && s.animateurId !== session.id) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
    }

    // Le demandeur vient du corps de la requête : sans ce contrôle, un
    // identifiant d'une autre structure pouvait être ajouté comme éditeur de
    // la sortie et recevoir une notification rattachée à ce tenant.
    const demandeur = await queryOne(
      'SELECT id FROM animateurs WHERE id = $1 AND tenant_id = $2',
      [demandeurId, tenant_id],
    );
    if (!demandeur) return NextResponse.json({ error: 'Demandeur introuvable' }, { status: 404 });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Ajouter l'éditeur
      await client.query(`
        UPDATE sorties
        SET editeurs = array_append(COALESCE(editeurs, '{}'), $2)
        WHERE id = $1 AND tenant_id = $3 AND NOT ($2 = ANY(COALESCE(editeurs, '{}')))
      `, [sortieId, demandeurId, tenant_id]);

      // Notifier le demandeur
      const accordeurNom = `${session.prenom ?? ''} ${session.nom ?? ''}`.trim() || session.username;
      const notifId2 = `notif-${randomUUID()}`;
      await client.query(`
        INSERT INTO notifications
          (id, type, titre, message, cible, urgent, envoye_par,
           dest_animateur_id, sortie_id, sortie_url, tenant_id)
        VALUES ($1,'modif-accordee',$2,$3,$4,FALSE,$5,$6,$7,$8,$9)
      `, [
        notifId2,
        `✅ Accès accordé — ${s.titre}`,
        `${accordeurNom} vous a accordé l'accès en modification pour la sortie "${s.titre}".`,
        demandeurId,
        session.username,
        demandeurId,
        sortieId,
        `/animateur/sorties/${sortieId}`,
        tenant_id,
      ]);

      // Dismiss la notification originale
      if (notifId) {
        await client.query(`
          UPDATE notifications
          SET dismissed_par = array_append(COALESCE(dismissed_par, '{}'), $2)
          WHERE id = $1 AND tenant_id = $3 AND NOT ($2 = ANY(COALESCE(dismissed_par, '{}')))
        `, [notifId, session.id, tenant_id]);
      }

      await client.query('COMMIT');
      return NextResponse.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[api/sorties/demande-modif]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
