import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAuth } from '@/lib/auth';
import { emptyToNull } from '@/lib/db';
import pool from '@/lib/db';
import { analyserFicheAgora, nettoyerNomFicheAgora } from '@/lib/fiche-agora';

async function getSortieWithParticipants(client: any, sortieId: string, tenantId: string) {
  const row = await client.query(`
    SELECT s.id, s.titre, s.date::text AS date, s.heure_depart AS "heureDepart", s.heure_retour AS "heureRetour",
           s.lieu_depart AS "lieuDepart", s.lieu_destination AS "lieuDestination",
           s.transport, s.itineraire, s.nb_encadrants AS "nbEncadrants",
           s.autre_encadrant AS "autreEncadrant", s.capacite, s.observations,
           s.animateur_id AS "animateurId", s.animateur_nom AS "animateurNom",
           s.espace_id AS "espaceId", s.statut, s.editeurs, s.historique,
           (s.bon_commande IS NOT NULL) AS "hasBonCommande",
           s.bon_commande_nom AS "bonCommandeNom",
           s.created_at AS "createdAt", s.updated_at AS "updatedAt"
    FROM sorties s WHERE s.id = $1 AND s.tenant_id = $2
  `, [sortieId, tenantId]);
  if (!row.rows[0]) return null;
  const s = row.rows[0];

  const parts = await client.query(
    `SELECT jeune_id AS "jeuneId", en_attente AS "enAttente" FROM sorties_participants WHERE sortie_id = $1 ORDER BY ordre`,
    [sortieId],
  );
  s.participants = parts.rows.filter((p: any) => !p.enAttente).map((p: any) => p.jeuneId);
  s.participantsAttente = parts.rows.filter((p: any) => p.enAttente).map((p: any) => p.jeuneId);
  return s;
}

export async function GET(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { tenant_id } = session;

  try {
    const client = await pool.connect();
    try {
      const rows = await client.query(`
        SELECT s.id, s.titre, s.date::text AS date, s.heure_depart AS "heureDepart", s.heure_retour AS "heureRetour",
               s.lieu_depart AS "lieuDepart", s.lieu_destination AS "lieuDestination",
               s.transport, s.itineraire, s.nb_encadrants AS "nbEncadrants",
               s.autre_encadrant AS "autreEncadrant", s.capacite, s.observations,
               s.animateur_id AS "animateurId", s.animateur_nom AS "animateurNom",
               s.espace_id AS "espaceId", s.statut, s.editeurs, s.historique,
               (s.bon_commande IS NOT NULL) AS "hasBonCommande",
               s.bon_commande_nom AS "bonCommandeNom",
               s.created_at AS "createdAt", s.updated_at AS "updatedAt"
        FROM sorties s WHERE s.tenant_id = $1 ORDER BY s.date DESC
      `, [tenant_id]);

      const partsAll = await client.query(
        `SELECT sp.sortie_id AS "sortieId", sp.jeune_id AS "jeuneId", sp.en_attente AS "enAttente" FROM sorties_participants sp JOIN sorties s ON s.id = sp.sortie_id WHERE s.tenant_id = $1 ORDER BY sp.ordre`,
        [tenant_id],
      );
      const partsByS: Record<string, { confirmed: string[]; waiting: string[] }> = {};
      for (const p of partsAll.rows) {
        if (!partsByS[p.sortieId]) partsByS[p.sortieId] = { confirmed: [], waiting: [] };
        if (p.enAttente) partsByS[p.sortieId].waiting.push(p.jeuneId);
        else partsByS[p.sortieId].confirmed.push(p.jeuneId);
      }

      const sorties = rows.rows.map((s: any) => ({
        ...s,
        participants: partsByS[s.id]?.confirmed ?? [],
        participantsAttente: partsByS[s.id]?.waiting ?? [],
      }));

      return NextResponse.json({ sorties });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[api/sorties]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { tenant_id } = session;

  try {
    const body = await req.json();
    if (body.bonCommande != null && body.bonCommande !== '') {
      const piece = analyserFicheAgora(body.bonCommande);
      if (!piece.ok) {
        return NextResponse.json({ error: piece.erreur.replace('Fiche AGORA', 'Bon de commande') }, { status: 400 });
      }
      body.bonCommande = piece.dataUri;
    }
    if ('bonCommandeNom' in body) body.bonCommandeNom = nettoyerNomFicheAgora(body.bonCommandeNom);
    const auteurNom = `${session.prenom ?? ''} ${session.nom ?? ''}`.trim() || session.username;

    // Capacité et encadrants : entiers positifs ou nuls (0 = capacité
    // illimitée). Une valeur négative fausserait les comparaisons de quota ;
    // la base la refuse par contrainte CHECK, autant répondre clairement.
    for (const [champ, valeur] of [['capacité', emptyToNull(body.capacite)], ['nombre d’encadrants', emptyToNull(body.nbEncadrants)]] as const) {
      if (valeur !== null && !(Number.isInteger(Number(valeur)) && Number(valeur) >= 0)) {
        return NextResponse.json({ error: `Valeur invalide pour « ${champ} » : entier positif ou nul attendu.` }, { status: 400 });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (body.id) {
        // Mise à jour
        // Lecture FOR UPDATE par la connexion DE LA TRANSACTION : auparavant ce
        // contrôle passait par le pool (hors transaction), et l'historique lu
        // puis réécrit pouvait perdre l'entrée d'une modification concurrente.
        // Le verrou sérialise aussi ce changement de capacité avec les ajouts
        // et retraits de participants, qui verrouillent la même ligne.
        const existingRes = await client.query<{
          animateur_id: string | null; editeurs: string[] | null; capacite: number | null;
          historique: Record<string, unknown>[] | null;
        }>(
          'SELECT animateur_id, editeurs, capacite, historique FROM sorties WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
          [body.id, tenant_id],
        );
        const e = existingRes.rows[0];
        if (!e) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'Sortie introuvable' }, { status: 404 });
        }
        const isCreator = e.animateur_id === session.id;
        const isEditeur = (e.editeurs ?? []).includes(session.id);
        if (!isCreator && !isEditeur && session.role !== 'admin') {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
        }

        // Réduire la capacité sous le nombre de participants déjà confirmés
        // créerait un surbooking silencieux (personne n'est rétrogradé en
        // liste d'attente). On refuse : il faut d'abord retirer des inscrits.
        // 0 = capacité illimitée, donc jamais bloquant.
        const nouvelleCapacite = emptyToNull(body.capacite);
        if (nouvelleCapacite !== null) {
          const cap = Number(nouvelleCapacite);
          const ancienne = e.capacite ?? 0;
          if (Number.isFinite(cap) && cap > 0 && (ancienne === 0 || cap < ancienne)) {
            const c = await client.query<{ n: number }>(
              'SELECT COUNT(*)::int AS n FROM sorties_participants WHERE sortie_id = $1 AND en_attente = FALSE',
              [body.id],
            );
            if (c.rows[0].n > cap) {
              await client.query('ROLLBACK');
              return NextResponse.json(
                { error: `Capacité insuffisante : ${c.rows[0].n} participants sont déjà confirmés. Retirez des inscrits avant de réduire la capacité à ${cap}.` },
                { status: 409 },
              );
            }
          }
        }

        const historique = e.historique ?? [];
        historique.push({ auteurId: session.id, auteurNom, date: new Date().toISOString(), action: 'modification' });

        await client.query(`
          UPDATE sorties SET
            titre           = COALESCE($2, titre),
            date            = COALESCE($3, date),
            heure_depart    = $4,
            heure_retour    = $5,
            lieu_depart     = $6,
            lieu_destination = $7,
            transport       = $8,
            itineraire      = $9,
            nb_encadrants   = COALESCE($10, nb_encadrants),
            autre_encadrant = $11,
            capacite        = COALESCE($12, capacite),
            observations    = $13,
            statut          = COALESCE($14, statut),
            historique      = $15,
            updated_at      = NOW()
          WHERE id = $1 AND tenant_id = $16
        `, [
          body.id, body.titre ?? null, emptyToNull(body.date),
          body.heureDepart ?? null, body.heureRetour ?? null,
          body.lieuDepart ?? null, body.lieuDestination ?? null,
          body.transport ?? null, body.itineraire ?? null,
          emptyToNull(body.nbEncadrants), body.autreEncadrant ?? null,
          nouvelleCapacite, body.observations ?? null,
          body.statut ?? null, JSON.stringify(historique),
          tenant_id,
        ]);

        // Bon de commande : mis à jour SEULEMENT si la clé est présente dans le
        // corps (nouveau fichier ou retrait explicite). Sinon, le formulaire ne
        // renvoyant pas le base64 existant, on effacerait le fichier à chaque
        // simple modification de la sortie.
        if ('bonCommande' in body) {
          await client.query(
            'UPDATE sorties SET bon_commande = $2, bon_commande_nom = $3 WHERE id = $1 AND tenant_id = $4',
            [body.id, body.bonCommande || null, body.bonCommande ? (body.bonCommandeNom ?? null) : null, tenant_id],
          );
        }

        await client.query('COMMIT');
        const sortie = await getSortieWithParticipants(pool, body.id, tenant_id);
        return NextResponse.json({ success: true, sortie });
      }

      // Création
      const id = `sortie-${randomUUID()}`;
      const historique = [{ auteurId: session.id, auteurNom, date: new Date().toISOString(), action: 'creation' }];

      await client.query(`
        INSERT INTO sorties
          (id, titre, date, heure_depart, heure_retour, lieu_depart, lieu_destination,
           transport, itineraire, nb_encadrants, autre_encadrant, capacite, observations,
           animateur_id, animateur_nom, espace_id, statut, historique, tenant_id,
           bon_commande, bon_commande_nom)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      `, [
        id, body.titre, emptyToNull(body.date),
        body.heureDepart ?? null, body.heureRetour ?? null,
        body.lieuDepart ?? null, body.lieuDestination ?? null,
        body.transport ?? null, body.itineraire ?? null,
        emptyToNull(body.nbEncadrants) ?? 0, body.autreEncadrant ?? null,
        emptyToNull(body.capacite) ?? 0, body.observations ?? null,
        session.id, auteurNom, session.espaceAssigne,
        body.statut ?? 'planifiee', JSON.stringify(historique),
        tenant_id,
        body.bonCommande || null, body.bonCommande ? (body.bonCommandeNom ?? null) : null,
      ]);

      await client.query('COMMIT');
      const sortie = await getSortieWithParticipants(pool, id, tenant_id);
      return NextResponse.json({ success: true, sortie });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[api/sorties]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'ID requis' }, { status: 400 });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const s = await client.query(
        `SELECT animateur_id FROM sorties WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, session.tenant_id],
      );

      if (!s.rows[0]) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Sortie introuvable' }, { status: 404 });
      }

      if (session.role !== 'admin' && s.rows[0].animateur_id !== session.id) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
      }

      await client.query(
        `DELETE FROM sorties WHERE id = $1 AND tenant_id = $2`,
        [id, session.tenant_id],
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/sorties]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
