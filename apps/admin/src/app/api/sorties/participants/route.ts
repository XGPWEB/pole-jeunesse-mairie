import { NextRequest, NextResponse } from 'next/server';
import type { Pool, PoolClient } from 'pg';
import { requireAuth } from '@/lib/auth';
import pool from '@/lib/db';
// Verrou de la sortie et retrait + promotion : partagés avec la suppression
// d'un jeune (jeunes/actions.ts), qui doit produire exactement le même effet.
import { verrouillerSortie, verrouillerJeunePourParticipation, retirerParticipant } from '@/lib/sorties';

/**
 * Listes confirmés / en attente, dans l'ORDRE D'INSCRIPTION (`ordre`, numéro
 * monotone attribué à l'ajout — voir migration-integrite-2026-10.sql). La
 * liste d'attente est une file : son ordre doit être celui d'arrivée, stable
 * et identique à celui qu'utilise la promotion automatique.
 */
async function getParticipants(client: Pool | PoolClient, sortieId: string) {
  const r = await client.query<{ jeuneId: string; enAttente: boolean }>(
    'SELECT jeune_id AS "jeuneId", en_attente AS "enAttente" FROM sorties_participants WHERE sortie_id = $1 ORDER BY ordre',
    [sortieId],
  );
  return {
    participants: r.rows.filter(p => !p.enAttente).map(p => p.jeuneId),
    participantsAttente: r.rows.filter(p => p.enAttente).map(p => p.jeuneId),
  };
}

export async function POST(request: NextRequest) {
  const userPost = await requireAuth(request);
  if (!userPost) {
    return NextResponse.json({ success: false, error: 'Non autorisé' }, { status: 401 });
  }
  const { tenant_id } = userPost;
  try {
    const { sortieId, jeuneId } = await request.json();
    if (!sortieId || !jeuneId) {
      return NextResponse.json({ success: false, error: 'sortieId et jeuneId requis' }, { status: 400 });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // La sortie est verrouillée DANS la transaction : sans FOR UPDATE, deux
      // ajouts simultanés lisaient la même capacité et dépassaient tous deux le
      // quota (surbooking sans liste d'attente).
      const sortie = await verrouillerSortie(client, sortieId, tenant_id);
      if (!sortie) {
        await client.query('ROLLBACK');
        return NextResponse.json({ success: false, error: 'Sortie introuvable' }, { status: 404 });
      }

      // Le jeune est vérifié DANS la transaction, APRÈS la sortie (ordre commun
      // des verrous : sortie puis jeune, le même que supprimerJeune), et il
      // est verrouillé jusqu'au COMMIT. Auparavant cette vérification était
      // faite avant la transaction : le jeune pouvait être supprimé entre le
      // contrôle et l'INSERT, laissant une participation vers un jeune
      // disparu (place occupée par personne, fiche d'émargement incohérente).
      // Il doit aussi appartenir au tenant : sinon un identifiant extérieur
      // pouvait être rattaché à la sortie, exposant ensuite son nom, sa date
      // de naissance et ses autorisations sur la fiche d'émargement.
      if (!await verrouillerJeunePourParticipation(client, jeuneId, tenant_id)) {
        await client.query('ROLLBACK');
        return NextResponse.json({ success: false, error: 'Jeune introuvable' }, { status: 404 });
      }

      // Contrôle de doublon APRÈS le verrou (la clé primaire sortie_id+jeune_id
      // l'interdit de toute façon en base : ce test sert à renvoyer un message
      // clair plutôt qu'une erreur 500).
      const existing = await client.query(
        'SELECT jeune_id FROM sorties_participants WHERE sortie_id = $1 AND jeune_id = $2',
        [sortieId, jeuneId],
      );
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ success: false, error: 'Ce jeune est déjà inscrit à cette sortie.' });
      }

      const cap = sortie.capacite ?? 0;
      const countRes = await client.query(
        'SELECT COUNT(*) FROM sorties_participants WHERE sortie_id = $1 AND en_attente = FALSE',
        [sortieId],
      );
      const confirmed = Number(countRes.rows[0].count);
      const enAttente = cap > 0 && confirmed >= cap;
      const statut = enAttente ? 'liste-attente' : 'confirmee';

      await client.query(
        'INSERT INTO sorties_participants (sortie_id, jeune_id, en_attente) VALUES ($1, $2, $3)',
        [sortieId, jeuneId, enAttente],
      );

      await client.query('COMMIT');
      const parts = await getParticipants(pool, sortieId);
      return NextResponse.json({ success: true, statut, ...parts });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[api/sorties/participants]', err);
    return NextResponse.json({ success: false, error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const userDel = await requireAuth(request);
  if (!userDel) {
    return NextResponse.json({ success: false, error: 'Non autorisé' }, { status: 401 });
  }
  const { tenant_id: delTenantId } = userDel;
  try {
    const { sortieId, jeuneId } = await request.json();
    if (!sortieId || !jeuneId) {
      return NextResponse.json({ success: false, error: 'sortieId et jeuneId requis' }, { status: 400 });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Même verrou que l'ajout. Auparavant la sortie était lue hors
      // transaction et le participant sans verrou : deux retraits simultanés
      // du même jeune lisaient tous deux « confirmé », le second ne supprimait
      // rien mais promouvait quand même — une place libérée, deux promus.
      const sortie = await verrouillerSortie(client, sortieId, delTenantId);
      if (!sortie) {
        await client.query('ROLLBACK');
        return NextResponse.json({ success: false, error: 'Sortie introuvable' }, { status: 404 });
      }

      // Retrait décidé sur le DELETE effectif, puis promotion du premier en
      // attente si une place confirmée se libère (voir lib/sorties.ts).
      const retire = await retirerParticipant(client, sortieId, jeuneId, sortie);
      if (!retire) {
        await client.query('ROLLBACK');
        return NextResponse.json({ success: false, error: "Ce jeune n'est pas inscrit." });
      }

      await client.query('COMMIT');
      const parts = await getParticipants(pool, sortieId);
      return NextResponse.json({ success: true, ...parts });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[api/sorties/participants]', err);
    return NextResponse.json({ success: false, error: 'Erreur serveur' }, { status: 500 });
  }
}
