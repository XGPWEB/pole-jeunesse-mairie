import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAuth } from '@/lib/auth';
import type { PoolClient } from 'pg';
import { query, queryOne, emptyToNull } from '@/lib/db';
import pool from '@/lib/db';
import { maskCongesForViewer } from '@/lib/conges';

const TYPES_VALIDES = ['conge', 'recuperation', 'maladie', 'formation'];

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Message unique pour les congés pilotés par une demande de récupération.
 *
 * Un tel congé n'est que le REFLET au planning d'un débit approuvé. Le
 * modifier ou le supprimer ici désynchronisait les deux : la suppression
 * laissait le débit approuvé (heures consommées, plus d'absence au planning,
 * `conge_id` remis à NULL par la clé étrangère), la modification déplaçait
 * l'absence sans déplacer la demande.
 *
 * Choix : refuser (409) et renvoyer vers l'écran Récupération, dont le PUT et
 * le DELETE maintiennent déjà demande et congé ensemble dans une transaction.
 * C'est l'option la moins intrusive — aucune seconde implémentation de la
 * logique de solde ici, et l'interface n'offrait déjà pas ces actions sur les
 * congés de source « recup ».
 */
const ERREUR_CONGE_RECUP =
  'Ce congé provient d’une récupération validée : modifiez ou supprimez la demande ' +
  'depuis l’onglet Récupération, le planning sera mis à jour automatiquement.';

interface CongeVerrouille {
  dateDebut: string;
  dateFin: string;
  lieARecup: boolean;
}

/**
 * Charge un congé FOR UPDATE et indique s'il est lié à une demande de
 * récupération. Le critère est le LIEN réel (`demandes_recup.conge_id`), pas
 * la seule colonne `source` : un congé de source « recup » dont la demande
 * n'existe plus est un orphelin sans débit associé, qu'un admin doit pouvoir
 * nettoyer.
 */
async function chargerCongeSousVerrou(
  client: PoolClient,
  id: string,
  tenantId: string,
): Promise<CongeVerrouille | null> {
  const res = await client.query<CongeVerrouille>(
    `SELECT c.date_debut::text AS "dateDebut",
            c.date_fin::text   AS "dateFin",
            EXISTS (
              SELECT 1 FROM demandes_recup d
              WHERE d.conge_id = c.id AND d.tenant_id = c.tenant_id
            ) AS "lieARecup"
     FROM conges c
     WHERE c.id = $1 AND c.tenant_id = $2
     FOR UPDATE OF c`,
    [id, tenantId],
  );
  return res.rows[0] ?? null;
}

const SELECT = `
  SELECT c.id,
         c.animateur_id AS "animateurId",
         a.prenom || ' ' || a.nom AS "animateurNom",
         c.date_debut::text AS "dateDebut",
         c.date_fin::text   AS "dateFin",
         c.type, c.motif, c.source,
         c.created_by AS "createdBy",
         c.created_at AS "createdAt"
  FROM conges c
  JOIN animateurs a ON a.id = c.animateur_id
`;

/** Planning global — accessible à toute l'équipe (admins et animateurs). */
export async function GET(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  try {
    const rows = await query<any>(
      `${SELECT} WHERE c.tenant_id = $1 ORDER BY c.date_debut DESC`,
      [session.tenant_id],
    );
    // Masque le type précis et le commentaire aux animateurs (sauf leurs propres
    // congés). Donnée de santé « Maladie » et motifs non exposés à l'équipe.
    const conges = maskCongesForViewer(rows, { id: session.id, role: session.role });
    return NextResponse.json({ conges });
  } catch (err) {
    console.error('[api/conges GET]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

/** Saisie d'un congé — ADMIN uniquement. */
export async function POST(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Accès refusé — rôle admin requis' }, { status: 403 });
  }
  const { tenant_id } = session;
  try {
    const { animateurId, dateDebut, dateFin, type, motif } = await req.json();
    if (!animateurId || !dateDebut || !dateFin) {
      return NextResponse.json({ error: 'animateurId, dateDebut et dateFin requis' }, { status: 400 });
    }
    if (typeof dateDebut !== 'string' || typeof dateFin !== 'string'
        || !DATE_ISO.test(dateDebut) || !DATE_ISO.test(dateFin)) {
      return NextResponse.json({ error: 'Dates invalides (format AAAA-MM-JJ attendu).' }, { status: 400 });
    }
    if (dateFin < dateDebut) {
      return NextResponse.json({ error: 'La date de fin précède la date de début.' }, { status: 400 });
    }
    const typeFinal = TYPES_VALIDES.includes(type) ? type : 'conge';

    // L'animateur ciblé doit appartenir au tenant.
    const cible = await queryOne('SELECT id FROM animateurs WHERE id = $1 AND tenant_id = $2', [animateurId, tenant_id]);
    if (!cible) return NextResponse.json({ error: 'Animateur introuvable' }, { status: 404 });

    const id = `conge-${randomUUID()}`;
    await queryOne(`
      INSERT INTO conges (id, animateur_id, date_debut, date_fin, type, motif, source, created_by, tenant_id)
      VALUES ($1, $2, $3, $4, $5, $6, 'admin', $7, $8)
    `, [id, animateurId, dateDebut, dateFin, typeFinal, motif ?? null, session.id, tenant_id]);

    const conges = await query(`${SELECT} WHERE c.tenant_id = $1 ORDER BY c.date_debut DESC`, [tenant_id]);
    return NextResponse.json({ success: true, conges });
  } catch (err) {
    console.error('[api/conges POST]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

/**
 * Modification d'un congé — ADMIN uniquement.
 *
 * Une modification partielle (fin seule, ou début seul) est validée contre le
 * COUPLE FINAL : valeurs fournies complétées par celles déjà en base, lues
 * sous verrou. Comparer seulement quand les deux dates étaient fournies
 * laissait passer une fin antérieure au début existant.
 */
export async function PUT(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Accès refusé — rôle admin requis' }, { status: 403 });
  }
  const { tenant_id } = session;
  try {
    const { id, dateDebut, dateFin, type, motif } = await req.json();
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });
    // Un champ date vidé arrive en chaîne vide : il signifie « inchangé ».
    const debutFourni = emptyToNull(dateDebut);
    const finFournie = emptyToNull(dateFin);
    for (const d of [debutFourni, finFournie]) {
      if (d !== null && (typeof d !== 'string' || !DATE_ISO.test(d))) {
        return NextResponse.json({ error: 'Dates invalides (format AAAA-MM-JJ attendu).' }, { status: 400 });
      }
    }
    const typeFinal = type && TYPES_VALIDES.includes(type) ? type : null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const conge = await chargerCongeSousVerrou(client, id, tenant_id);
      if (!conge) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Congé introuvable' }, { status: 404 });
      }
      if (conge.lieARecup) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: ERREUR_CONGE_RECUP }, { status: 409 });
      }

      // Dates ISO : l'ordre lexicographique est l'ordre chronologique.
      const debutFinal = debutFourni ?? conge.dateDebut;
      const finFinale = finFournie ?? conge.dateFin;
      if (finFinale < debutFinal) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'La date de fin précède la date de début.' }, { status: 400 });
      }

      await client.query(`
        UPDATE conges
        SET date_debut = $2,
            date_fin   = $3,
            type       = COALESCE($4, type),
            motif      = $5
        WHERE id = $1 AND tenant_id = $6
      `, [id, debutFinal, finFinale, typeFinal, motif ?? null, tenant_id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const conges = await query(`${SELECT} WHERE c.tenant_id = $1 ORDER BY c.date_debut DESC`, [tenant_id]);
    return NextResponse.json({ success: true, conges });
  } catch (err) {
    console.error('[api/conges PUT]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

/** Suppression d'un congé — ADMIN uniquement. */
export async function DELETE(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Accès refusé — rôle admin requis' }, { status: 403 });
  }
  const { tenant_id } = session;
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const conge = await chargerCongeSousVerrou(client, id, tenant_id);
      if (!conge) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Congé introuvable' }, { status: 404 });
      }
      if (conge.lieARecup) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: ERREUR_CONGE_RECUP }, { status: 409 });
      }
      await client.query('DELETE FROM conges WHERE id = $1 AND tenant_id = $2', [id, tenant_id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const conges = await query(`${SELECT} WHERE c.tenant_id = $1 ORDER BY c.date_debut DESC`, [tenant_id]);
    return NextResponse.json({ success: true, conges });
  } catch (err) {
    console.error('[api/conges DELETE]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
