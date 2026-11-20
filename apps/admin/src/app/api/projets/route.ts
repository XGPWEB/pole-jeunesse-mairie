import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAuth } from '@/lib/auth';
import { query, queryOne, emptyToNull } from '@/lib/db';
import pool from '@/lib/db';

const SELECT = `
  SELECT p.id, p.titre, p.animateur_id AS "animateurId", p.animateur_nom AS "animateurNom",
         p.espace_id AS "espaceId", p.statut, p.date_depot::text AS "dateDepot", p.duree, p.lieu,
         p.objectifs_synthetiques AS "objectifsSynthetiques", p.public_cible AS "publicCible",
         p.constat, p.objectifs, p.resultats_attendus AS "resultatsAttendus",
         p.deroulement, p.moyens_humains AS "moyensHumains", p.moyens_materiels AS "moyensMateriels",
         p.partenaires, p.modes_communication AS "modesCommunication",
         p.retro_planning AS "retroPlanning", p.outils_evaluation AS "outilsEvaluation",
         p.created_at AS "createdAt", p.updated_at AS "updatedAt",
         COALESCE(
           json_agg(json_build_object('designation', pb.designation, 'cout', pb.cout) ORDER BY pb.id)
           FILTER (WHERE pb.id IS NOT NULL), '[]'
         ) AS budget
  FROM projets p
  LEFT JOIN projets_budget pb ON pb.projet_id = p.id
`;

export async function GET(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { tenant_id } = session;

  try {
    let rows: any[];
    if (session.role === 'admin') {
      rows = await query(`${SELECT} WHERE p.tenant_id = $1 GROUP BY p.id ORDER BY p.created_at DESC`, [tenant_id]);
    } else {
      rows = await query(
        `${SELECT} WHERE p.tenant_id = $1 AND (p.animateur_id = $2 OR p.statut = 'publie') GROUP BY p.id ORDER BY p.created_at DESC`,
        [tenant_id, session.id],
      );
    }
    return NextResponse.json({ projets: rows });
  } catch (err) {
    console.error('[api/projets]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

interface LigneBudget {
  designation: string;
  cout: string | null;
}

const MAX_LIGNES_BUDGET = 200;
const MAX_LONGUEUR_CHAMP = 500;

/**
 * Valide TOUTES les lignes de budget avant la moindre écriture.
 *
 * Renvoie `null` si le corps ne contient pas de budget (le budget existant
 * est alors conservé tel quel), ou la liste normalisée des lignes à
 * enregistrer. Les lignes entièrement vides (le formulaire en affiche toujours
 * une) sont ignorées, comme le font déjà les pages d'affichage.
 *
 * Deux noms de champ sont acceptés : `budget` (contrat historique de l'API)
 * et `lignesBudget` (nom réellement envoyé par ProjetForm — voir la note sur
 * le constat 21 : le budget saisi dans le formulaire n'était jamais lu).
 */
function validerBudget(body: Record<string, unknown>): { lignes: LigneBudget[] | null } | { erreur: string } {
  const brut = body.budget !== undefined ? body.budget : body.lignesBudget;
  if (brut === undefined || brut === null) return { lignes: null };
  if (!Array.isArray(brut)) return { erreur: 'Budget invalide : une liste de lignes est attendue.' };
  if (brut.length > MAX_LIGNES_BUDGET) {
    return { erreur: `Budget invalide : ${MAX_LIGNES_BUDGET} lignes au maximum.` };
  }

  const lignes: LigneBudget[] = [];
  for (let i = 0; i < brut.length; i++) {
    const ligne: unknown = brut[i];
    const n = i + 1;
    if (typeof ligne !== 'object' || ligne === null || Array.isArray(ligne)) {
      return { erreur: `Ligne de budget n°${n} invalide.` };
    }
    const { designation, cout } = ligne as { designation?: unknown; cout?: unknown };

    if (designation !== undefined && designation !== null && typeof designation !== 'string') {
      return { erreur: `Ligne de budget n°${n} : désignation invalide.` };
    }
    if (cout !== undefined && cout !== null && typeof cout !== 'string' && typeof cout !== 'number') {
      return { erreur: `Ligne de budget n°${n} : coût invalide.` };
    }
    if (typeof cout === 'number' && !Number.isFinite(cout)) {
      return { erreur: `Ligne de budget n°${n} : coût invalide.` };
    }

    const designationFinale = (designation ?? '').trim();
    const coutFinal = cout === undefined || cout === null ? '' : String(cout).trim();
    // Le caractère nul est refusé par PostgreSQL dans une colonne TEXT.
    if (designationFinale.includes('\u0000') || coutFinal.includes('\u0000')
        || designationFinale.length > MAX_LONGUEUR_CHAMP || coutFinal.length > MAX_LONGUEUR_CHAMP) {
      return { erreur: `Ligne de budget n°${n} : contenu invalide ou trop long.` };
    }
    // Le coût est un texte libre en base (« 150 », « 150,50 »), mais s'il est
    // renseigné il doit être un montant lisible : le total du projet en dépend.
    // Espaces (séparateur de milliers) et symbole € final tolérés.
    if (coutFinal !== '' && !/^\d+(?:[.,]\d+)?€?$/.test(coutFinal.replace(/\s/g, ''))) {
      return { erreur: `Ligne de budget n°${n} : le coût « ${coutFinal} » n’est pas un montant valide.` };
    }

    if (designationFinale === '' && coutFinal === '') continue;
    lignes.push({ designation: designationFinale, cout: coutFinal === '' ? null : coutFinal });
  }
  return { lignes };
}

export async function POST(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { tenant_id } = session;

  try {
    const body = await req.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: 'Corps de requête invalide.' }, { status: 400 });
    }

    // Validation COMPLÈTE avant toute écriture : une ligne invalide en milieu
    // de liste ne doit laisser aucune trace.
    const budget = validerBudget(body);
    if ('erreur' in budget) {
      return NextResponse.json({ error: budget.erreur }, { status: 400 });
    }

    // Projet ET budget dans UNE transaction. Auparavant : UPDATE du projet,
    // DELETE de l'ancien budget, puis un INSERT par ligne, chacun validé
    // séparément — une erreur ou une coupure au milieu laissait un projet
    // modifié avec un budget perdu ou tronqué.
    const client = await pool.connect();
    let projetId: string;
    try {
      await client.query('BEGIN');

      if (body.id) {
        // Verrou + contrôle d'appartenance (tenant) et de propriété (auteur
        // ou admin) dans la transaction.
        const existing = await client.query<{ animateur_id: string | null }>(
          'SELECT animateur_id FROM projets WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
          [body.id, tenant_id],
        );
        if (existing.rows.length === 0) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'Projet introuvable' }, { status: 404 });
        }
        if (existing.rows[0].animateur_id !== session.id && session.role !== 'admin') {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
        }
        projetId = body.id;

        await client.query(`
          UPDATE projets SET
            titre                   = COALESCE($2, titre),
            statut                  = COALESCE($3, statut),
            date_depot              = $4,
            duree                   = $5,
            lieu                    = $6,
            objectifs_synthetiques  = $7,
            public_cible            = $8,
            constat                 = $9,
            objectifs               = $10,
            resultats_attendus      = $11,
            deroulement             = $12,
            moyens_humains          = $13,
            moyens_materiels        = $14,
            partenaires             = $15,
            modes_communication     = $16,
            retro_planning          = $17,
            outils_evaluation       = $18,
            updated_at              = NOW()
          WHERE id = $1 AND tenant_id = $19
        `, [
          projetId, body.titre ?? null, body.statut ?? null,
          emptyToNull(body.dateDepot), body.duree ?? null, body.lieu ?? null,
          body.objectifsSynthetiques ?? null, body.publicCible ?? null,
          body.constat ?? null, body.objectifs ?? null, body.resultatsAttendus ?? null,
          body.deroulement ?? null, body.moyensHumains ?? null, body.moyensMateriels ?? null,
          body.partenaires ?? null, body.modesCommunication ?? null,
          body.retroPlanning ?? null, body.outilsEvaluation ?? null,
          tenant_id,
        ]);

        // Remplacement du budget : le projet est verrouillé et appartient au
        // tenant, ses lignes (sans colonne tenant) sont donc les nôtres.
        if (budget.lignes !== null) {
          await client.query('DELETE FROM projets_budget WHERE projet_id = $1', [projetId]);
        }
      } else {
        projetId = `proj-${randomUUID()}`;
        const animateurNom = `${session.prenom ?? ''} ${session.nom ?? ''}`.trim();

        await client.query(`
          INSERT INTO projets
            (id, animateur_id, animateur_nom, espace_id, statut, date_depot, duree, lieu,
             objectifs_synthetiques, public_cible, constat, objectifs, resultats_attendus,
             deroulement, moyens_humains, moyens_materiels, partenaires, modes_communication,
             retro_planning, outils_evaluation, titre, tenant_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
        `, [
          projetId, session.id, animateurNom, session.espaceAssigne, body.statut ?? 'brouillon',
          emptyToNull(body.dateDepot), body.duree ?? null, body.lieu ?? null,
          body.objectifsSynthetiques ?? null, body.publicCible ?? null,
          body.constat ?? null, body.objectifs ?? null, body.resultatsAttendus ?? null,
          body.deroulement ?? null, body.moyensHumains ?? null, body.moyensMateriels ?? null,
          body.partenaires ?? null, body.modesCommunication ?? null,
          body.retroPlanning ?? null, body.outilsEvaluation ?? null,
          body.titre ?? 'Nouveau projet',
          tenant_id,
        ]);
      }

      for (const ligne of budget.lignes ?? []) {
        await client.query(
          'INSERT INTO projets_budget (projet_id, designation, cout) VALUES ($1, $2, $3)',
          [projetId, ligne.designation, ligne.cout],
        );
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const projet = await queryOne(
      `${SELECT} WHERE p.id = $1 AND p.tenant_id = $2 GROUP BY p.id`,
      [projetId, tenant_id],
    );
    return NextResponse.json({ success: true, projet });
  } catch (err) {
    console.error('[api/projets]', err);
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

    const p = await queryOne('SELECT animateur_id FROM projets WHERE id = $1 AND tenant_id = $2', [id, session.tenant_id]);
    if (!p || ((p as any).animateur_id !== session.id && session.role !== 'admin')) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
    }

    await queryOne('DELETE FROM projets WHERE id = $1 AND tenant_id = $2', [id, session.tenant_id]);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/projets]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
