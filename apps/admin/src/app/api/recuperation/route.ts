import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAuth } from '@/lib/auth';
import type { PoolClient } from 'pg';
import { query, queryOne, emptyToNull } from '@/lib/db';
import pool from '@/lib/db';
import {
  soldeRecup, soldesParAnimateur,
  verrouillerSoldeRecup, soldeApresOperation, effetSurSolde,
} from '@/lib/recuperation';

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

interface DemandeVerrouillee {
  id: string;
  animateurId: string;
  date: string;
  heures: number;
  sens: 'credit' | 'debit';
  motif: string | null;
  statut: 'pending' | 'approved' | 'rejected';
  congeId: string | null;
}

/**
 * Charge une demande pour la modifier, dans l'ordre de verrouillage commun à
 * toutes les opérations sur le solde :
 *   1. lecture simple (sans verrou) pour connaître l'animateur concerné ;
 *   2. verrou consultatif (tenant, animateur) — voir verrouillerSoldeRecup ;
 *   3. relecture de la demande FOR UPDATE : c'est CET état, lu sous verrou,
 *      qui fait foi (la demande a pu être traitée ou supprimée entre 1 et 2).
 * Toujours « verrou animateur puis ligne » : un ordre unique évite les
 * interblocages entre validation, correction et suppression.
 */
async function chargerDemandeSousVerrou(
  client: PoolClient,
  id: string,
  tenantId: string,
): Promise<DemandeVerrouillee | null> {
  const pre = await client.query<{ animateurId: string }>(
    'SELECT animateur_id AS "animateurId" FROM demandes_recup WHERE id = $1 AND tenant_id = $2',
    [id, tenantId],
  );
  if (pre.rows.length === 0) return null;

  await verrouillerSoldeRecup(client, tenantId, pre.rows[0].animateurId);

  const res = await client.query<DemandeVerrouillee>(
    `SELECT id, animateur_id AS "animateurId", date::text AS date, heures::float AS heures,
            sens, motif, statut, conge_id AS "congeId"
     FROM demandes_recup
     WHERE id = $1 AND tenant_id = $2
     FOR UPDATE`,
    [id, tenantId],
  );
  return res.rows[0] ?? null;
}

/** Réponse 409 commune quand une opération ferait passer le solde sous zéro. */
function refusSoldeNegatif(operation: string, soldeAvant: number, soldeApres: number) {
  return NextResponse.json(
    {
      error:
        `${operation} impossible : le solde de récupération passerait de ${soldeAvant}h à ${soldeApres}h. ` +
        'Un solde ne peut pas devenir négatif.',
    },
    { status: 409 },
  );
}

const SELECT = `
  SELECT d.id,
         d.animateur_id AS "animateurId",
         a.prenom || ' ' || a.nom AS "animateurNom",
         d.date::text AS date,
         d.heures::float AS heures,
         d.sens, d.motif, d.statut,
         d.valide_par AS "validePar",
         d.valide_at  AS "valideAt",
         d.created_at AS "createdAt"
  FROM demandes_recup d
  JOIN animateurs a ON a.id = d.animateur_id
`;

/**
 * GET — un animateur voit SES demandes + son solde ; un admin voit tout,
 * plus les soldes de chacun.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { tenant_id } = session;
  try {
    if (session.role === 'admin') {
      const [demandes, soldes] = await Promise.all([
        query(`${SELECT} WHERE d.tenant_id = $1 ORDER BY d.created_at DESC`, [tenant_id]),
        soldesParAnimateur(tenant_id),
      ]);
      return NextResponse.json({ demandes, soldes });
    }
    const [demandes, solde] = await Promise.all([
      query(`${SELECT} WHERE d.tenant_id = $1 AND d.animateur_id = $2 ORDER BY d.created_at DESC`, [tenant_id, session.id]),
      soldeRecup(session.id, tenant_id),
    ]);
    return NextResponse.json({ demandes, solde });
  } catch (err) {
    console.error('[api/recuperation GET]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

/**
 * POST — un animateur crée une demande :
 *   sens 'credit' = déclaration d'heures effectuées
 *   sens 'debit'  = pose de récupération (piochée dans le solde)
 * Statut initial 'pending'. Un admin peut aussi déclarer pour lui-même.
 */
export async function POST(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { tenant_id } = session;
  try {
    const { date, heures, sens, motif } = await req.json();
    const h = Number(heures);
    if (typeof date !== 'string' || !DATE_ISO.test(date) || !Number.isFinite(h) || h <= 0) {
      return NextResponse.json({ error: 'Date et nombre d’heures (> 0) requis.' }, { status: 400 });
    }
    if (sens !== 'credit' && sens !== 'debit') {
      return NextResponse.json({ error: 'sens invalide (credit ou debit).' }, { status: 400 });
    }
    // L'objet est obligatoire pour une déclaration d'heures (crédit) : c'est la
    // justification de l'heure supplémentaire. Facultatif pour une pose.
    if (sens === 'credit' && (!motif || !String(motif).trim())) {
      return NextResponse.json({ error: 'L’objet des heures supplémentaires est obligatoire.' }, { status: 400 });
    }

    // Pour une pose, on refuse tôt si le solde est manifestement insuffisant.
    // Le contrôle FAISANT AUTORITÉ reste à la validation (le solde peut changer
    // entre la demande et la validation).
    if (sens === 'debit') {
      const solde = await soldeRecup(session.id, tenant_id);
      if (h > solde) {
        return NextResponse.json({ error: `Solde insuffisant : ${solde}h disponibles.` }, { status: 400 });
      }
    }

    const id = `recup-${randomUUID()}`;
    await queryOne(`
      INSERT INTO demandes_recup (id, animateur_id, date, heures, sens, motif, statut, tenant_id)
      VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
    `, [id, session.id, date, h, sens, motif ?? null, tenant_id]);

    const demandes = await query(
      `${SELECT} WHERE d.tenant_id = $1 AND d.animateur_id = $2 ORDER BY d.created_at DESC`,
      [tenant_id, session.id],
    );
    const solde = await soldeRecup(session.id, tenant_id);
    return NextResponse.json({ success: true, demandes, solde });
  } catch (err) {
    console.error('[api/recuperation POST]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

/**
 * PATCH — validation ou refus d'une demande. ADMIN uniquement.
 * La validation d'une POSE (debit) est TRANSACTIONNELLE : passage à 'approved'
 * + création de la ligne `conges` correspondante, atomiquement. Sans cela, un
 * échec entre les deux écritures laisserait un débit sans congé (ou l'inverse).
 *
 * Le solde est lu SOUS le verrou (tenant, animateur) : deux validations
 * simultanées de deux poses différentes du même animateur passent l'une après
 * l'autre, la seconde voyant le débit de la première.
 */
export async function PATCH(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Accès refusé — rôle admin requis' }, { status: 403 });
  }
  const { tenant_id } = session;
  try {
    const { id, decision } = await req.json();
    if (!id || (decision !== 'approve' && decision !== 'reject')) {
      return NextResponse.json({ error: 'id et decision (approve|reject) requis.' }, { status: 400 });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const dem = await chargerDemandeSousVerrou(client, id, tenant_id);
      if (!dem) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 });
      }
      if (dem.statut !== 'pending') {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Cette demande a déjà été traitée.' }, { status: 409 });
      }

      if (decision === 'reject') {
        await client.query(
          `UPDATE demandes_recup SET statut = 'rejected', valide_par = $2, valide_at = NOW()
           WHERE id = $1 AND tenant_id = $3`,
          [id, session.id, tenant_id],
        );
        await client.query('COMMIT');
      } else {
        // Contrôle FAISANT AUTORITÉ, sous verrou : le solde a pu changer depuis
        // la création de la demande.
        const soldeAvant = await soldeRecup(dem.animateurId, tenant_id, client);
        const { autorise } = soldeApresOperation(soldeAvant, effetSurSolde(dem.sens, dem.heures));
        if (!autorise) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: `Solde insuffisant : ${soldeAvant}h disponibles pour ${dem.heures}h demandées.` },
            { status: 409 },
          );
        }

        let congeId: string | null = null;
        if (dem.sens === 'debit') {
          // La pose validée s'inscrit automatiquement au planning des congés.
          congeId = `conge-${randomUUID()}`;
          await client.query(`
            INSERT INTO conges (id, animateur_id, date_debut, date_fin, type, motif, source, created_by, tenant_id)
            VALUES ($1, $2, $3, $3, 'recuperation', $4, 'recup', $5, $6)
          `, [
            congeId, dem.animateurId, dem.date,
            `Récupération ${dem.heures}h${dem.motif ? ' — ' + dem.motif : ''}`,
            session.id, tenant_id,
          ]);
        }

        await client.query(
          `UPDATE demandes_recup
           SET statut = 'approved', valide_par = $2, valide_at = NOW(), conge_id = $3
           WHERE id = $1 AND tenant_id = $4`,
          [id, session.id, congeId, tenant_id],
        );
        await client.query('COMMIT');
      }
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const demandes = await query(`${SELECT} WHERE d.tenant_id = $1 ORDER BY d.created_at DESC`, [tenant_id]);
    const soldes = await soldesParAnimateur(tenant_id);
    return NextResponse.json({ success: true, demandes, soldes });
  } catch (err) {
    console.error('[api/recuperation PATCH]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

/** DELETE — un animateur retire SA demande encore en attente. */
export async function DELETE(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { tenant_id } = session;
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

    // ── Admin : peut supprimer N'IMPORTE QUELLE demande de son tenant ──────────
    // Si la demande est une pose validée, elle a créé un congé au planning : on
    // le supprime aussi, dans la même transaction. Le solde étant calculé, il se
    // remet automatiquement à jour.
    //
    // Supprimer un CRÉDIT approuvé retire des heures du solde : si elles ont
    // déjà été consommées par une pose validée, le solde deviendrait négatif.
    // Refus (409) — il faut d'abord supprimer ou réduire la pose concernée.
    if (session.role === 'admin') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const dem = await chargerDemandeSousVerrou(client, id, tenant_id);
        if (!dem) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 });
        }

        if (dem.statut === 'approved') {
          const soldeAvant = await soldeRecup(dem.animateurId, tenant_id, client);
          const { autorise, soldeApres } = soldeApresOperation(soldeAvant, -effetSurSolde(dem.sens, dem.heures));
          if (!autorise) {
            await client.query('ROLLBACK');
            return refusSoldeNegatif('Suppression', soldeAvant, soldeApres);
          }
        }

        await client.query('DELETE FROM demandes_recup WHERE id = $1 AND tenant_id = $2', [id, tenant_id]);
        if (dem.congeId) {
          await client.query('DELETE FROM conges WHERE id = $1 AND tenant_id = $2', [dem.congeId, tenant_id]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      const demandes = await query(`${SELECT} WHERE d.tenant_id = $1 ORDER BY d.created_at DESC`, [tenant_id]);
      const soldes = await soldesParAnimateur(tenant_id);
      return NextResponse.json({ success: true, demandes, soldes });
    }

    // ── Animateur : uniquement SA demande encore en attente ────────────────────
    // (une demande déjà validée a un impact sur le solde/planning). Une demande
    // 'pending' ne compte pas dans le solde : pas de verrou de solde nécessaire,
    // et le filtre statut = 'pending' est évalué atomiquement par le DELETE.
    const deleted = await queryOne(
      `DELETE FROM demandes_recup
       WHERE id = $1 AND tenant_id = $2 AND animateur_id = $3 AND statut = 'pending'
       RETURNING id`,
      [id, tenant_id, session.id],
    );
    if (!deleted) {
      return NextResponse.json({ error: 'Demande introuvable ou déjà traitée.' }, { status: 404 });
    }

    const demandes = await query(
      `${SELECT} WHERE d.tenant_id = $1 AND d.animateur_id = $2 ORDER BY d.created_at DESC`,
      [tenant_id, session.id],
    );
    const solde = await soldeRecup(session.id, tenant_id);
    return NextResponse.json({ success: true, demandes, solde });
  } catch (err) {
    console.error('[api/recuperation DELETE]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

/**
 * PUT — modification d'une demande de récupération. ADMIN uniquement.
 * Permet de corriger date / heures / commentaire. Si la demande est une pose
 * validée liée à un congé, le congé est mis à jour en cohérence (même
 * transaction). Le solde se recalcule automatiquement.
 *
 * Corriger le volume d'une demande APPROUVÉE modifie le solde : augmenter un
 * débit ou réduire un crédit déjà consommé est refusé (409) si le solde
 * passait sous zéro. Contrôle fait sous le même verrou que la validation.
 */
export async function PUT(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Accès refusé — rôle admin requis' }, { status: 403 });
  }
  const { tenant_id } = session;
  try {
    const { id, date, heures, motif } = await req.json();
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });
    const h = heures === undefined || heures === null || heures === '' ? null : Number(heures);
    if (h !== null && (!Number.isFinite(h) || h <= 0)) {
      return NextResponse.json({ error: 'Nombre d’heures invalide.' }, { status: 400 });
    }
    // Un champ date vidé arrive en chaîne vide : il signifie « inchangé ».
    const dateFinale = emptyToNull(date);
    if (dateFinale !== null && (typeof dateFinale !== 'string' || !DATE_ISO.test(dateFinale))) {
      return NextResponse.json({ error: 'Date invalide (format AAAA-MM-JJ attendu).' }, { status: 400 });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const dem = await chargerDemandeSousVerrou(client, id, tenant_id);
      if (!dem) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 });
      }

      if (dem.statut === 'approved' && h !== null) {
        const delta = effetSurSolde(dem.sens, h) - effetSurSolde(dem.sens, dem.heures);
        const soldeAvant = await soldeRecup(dem.animateurId, tenant_id, client);
        const { autorise, soldeApres } = soldeApresOperation(soldeAvant, delta);
        if (!autorise) {
          await client.query('ROLLBACK');
          return refusSoldeNegatif('Modification', soldeAvant, soldeApres);
        }
      }

      await client.query(
        `UPDATE demandes_recup
         SET date = COALESCE($2, date), heures = COALESCE($3, heures), motif = $4
         WHERE id = $1 AND tenant_id = $5`,
        [id, dateFinale, h, motif ?? null, tenant_id],
      );

      // Congé lié (pose validée) : refléter la nouvelle date et le nouveau volume.
      if (dem.congeId) {
        const heuresFinal = h ?? dem.heures;
        await client.query(
          `UPDATE conges
           SET date_debut = COALESCE($2, date_debut),
               date_fin   = COALESCE($2, date_fin),
               motif      = $3
           WHERE id = $1 AND tenant_id = $4`,
          [dem.congeId, dateFinale, `Récupération ${heuresFinal}h${motif ? ' — ' + motif : ''}`, tenant_id],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const demandes = await query(`${SELECT} WHERE d.tenant_id = $1 ORDER BY d.created_at DESC`, [tenant_id]);
    const soldes = await soldesParAnimateur(tenant_id);
    return NextResponse.json({ success: true, demandes, soldes });
  } catch (err) {
    console.error('[api/recuperation PUT]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
