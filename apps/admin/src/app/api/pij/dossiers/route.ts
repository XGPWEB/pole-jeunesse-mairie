import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { ERREUR_SAISIE_PIJ, peutSaisirPij, validerDossier, type DossierPij } from '@/lib/pij';
import { insererDossier, parametresDossier } from '@/lib/pij-db';

/**
 * Dossiers suivis par le PIJ : feuilles « Permis de conduire », « Chantiers
 * jeunes », « Bourses » et « BAFA » du tableur, distinguées par `type`.
 *
 * Lecture : toute l'équipe. Écriture : admins et informateurs PIJ uniquement.
 */

// NUMERIC est renvoyé en chaîne par node-postgres : ::float8 pour des nombres.
const SELECT = `
  SELECT id, type, nom, prenom,
         date_naissance::text       AS "dateNaissance",
         telephone,
         date_ref::text             AS "dateRef",
         objet, horaire,
         prochain_rdv               AS "prochainRdv",
         remarques, organisme,
         montant::float8            AS montant,
         heures_a_realiser::float8  AS "heuresARealiser",
         heures_realisees::float8   AS "heuresRealisees",
         missions, etat,
         created_at::date::text     AS "creeLe"
  FROM pij_dossiers
`;

export async function GET(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  try {
    const dossiers = await query<DossierPij>(
      `${SELECT} WHERE tenant_id = $1 ORDER BY date_ref DESC NULLS LAST, created_at DESC`,
      [session.tenant_id],
    );
    return NextResponse.json({ dossiers, peutSaisir: peutSaisirPij(session) });
  } catch (err) {
    console.error('[api/pij/dossiers GET]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (!peutSaisirPij(session)) return NextResponse.json({ error: ERREUR_SAISIE_PIJ }, { status: 403 });
  try {
    const validation = validerDossier(await req.json());
    if (!validation.ok) return NextResponse.json({ error: validation.erreur }, { status: 400 });

    const id = await insererDossier(validation.valeurs, session.tenant_id, session.id);

    const dossier = await queryOne<DossierPij>(`${SELECT} WHERE id = $1 AND tenant_id = $2`, [id, session.tenant_id]);
    return NextResponse.json({ success: true, dossier });
  } catch (err) {
    console.error('[api/pij/dossiers POST]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

/** Le type d'un dossier ne change pas : il est relu en base, pas dans le corps. */
export async function PUT(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (!peutSaisirPij(session)) return NextResponse.json({ error: ERREUR_SAISIE_PIJ }, { status: 403 });
  try {
    const corps = await req.json();
    const id = corps?.id;
    if (typeof id !== 'string' || id === '') return NextResponse.json({ error: 'id requis' }, { status: 400 });

    const existant = await queryOne<{ type: string }>(
      'SELECT type FROM pij_dossiers WHERE id = $1 AND tenant_id = $2',
      [id, session.tenant_id],
    );
    if (!existant) return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 });

    const validation = validerDossier({ ...corps, type: existant.type });
    if (!validation.ok) return NextResponse.json({ error: validation.erreur }, { status: 400 });

    const dossier = await queryOne<DossierPij>(`
      WITH maj AS (
        UPDATE pij_dossiers SET
          nom = $3, prenom = $4, date_naissance = $5, telephone = $6, date_ref = $7, objet = $8,
          horaire = $9, prochain_rdv = $10, remarques = $11, organisme = $12, montant = $13,
          heures_a_realiser = $14,
          -- Permis : ces deux colonnes sont tenues par le journal des missions
          -- (/api/pij/missions), jamais par le formulaire du dossier.
          heures_realisees = CASE WHEN type = 'permis' THEN heures_realisees ELSE $15 END,
          missions = CASE WHEN type = 'permis' THEN missions ELSE $16 END,
          etat = $17,
          updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
        RETURNING *
      )
      ${SELECT.replace('FROM pij_dossiers', 'FROM maj')}
    `, [id, session.tenant_id, ...parametresDossier(validation.valeurs)]);
    if (!dossier) return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 });
    return NextResponse.json({ success: true, dossier });
  } catch (err) {
    console.error('[api/pij/dossiers PUT]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (!peutSaisirPij(session)) return NextResponse.json({ error: ERREUR_SAISIE_PIJ }, { status: 403 });
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });
    const supprime = await queryOne(
      'DELETE FROM pij_dossiers WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [id, session.tenant_id],
    );
    if (!supprime) return NextResponse.json({ error: 'Dossier introuvable' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/pij/dossiers DELETE]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
