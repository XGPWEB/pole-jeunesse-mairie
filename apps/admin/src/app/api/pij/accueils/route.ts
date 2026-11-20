import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { ERREUR_SAISIE_PIJ, peutSaisirPij, validerAccueil, type AccueilPij } from '@/lib/pij';
import { insererAccueil, parametresAccueil } from '@/lib/pij-db';

/**
 * Registre d'accueil du PIJ (feuille « Accueil » du tableur).
 *
 * Lecture : toute l'équipe. Écriture : admins et informateurs PIJ uniquement
 * (`peutSaisirPij`), contrôlé ici et non dans l'écran seul.
 */

const SELECT = `
  SELECT id,
         date_visite::text    AS "dateVisite",
         nom, prenom,
         date_naissance::text AS "dateNaissance",
         sexe, adresse,
         code_postal          AS "codePostal",
         commune, quartier, email, telephone,
         objets,
         objet_precision      AS "objetPrecision",
         prochain_rdv         AS "prochainRdv",
         remarques, orientations, suivi, etat
  FROM pij_accueils
`;

export async function GET(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  try {
    const accueils = await query<AccueilPij>(
      `${SELECT} WHERE tenant_id = $1 ORDER BY date_visite DESC, created_at DESC`,
      [session.tenant_id],
    );
    return NextResponse.json({ accueils, peutSaisir: peutSaisirPij(session) });
  } catch (err) {
    console.error('[api/pij/accueils GET]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (!peutSaisirPij(session)) return NextResponse.json({ error: ERREUR_SAISIE_PIJ }, { status: 403 });
  try {
    const validation = validerAccueil(await req.json());
    if (!validation.ok) return NextResponse.json({ error: validation.erreur }, { status: 400 });

    const id = await insererAccueil(validation.valeurs, session.tenant_id, session.id);

    const accueil = await queryOne<AccueilPij>(`${SELECT} WHERE id = $1 AND tenant_id = $2`, [id, session.tenant_id]);
    return NextResponse.json({ success: true, accueil });
  } catch (err) {
    console.error('[api/pij/accueils POST]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (!peutSaisirPij(session)) return NextResponse.json({ error: ERREUR_SAISIE_PIJ }, { status: 403 });
  try {
    const corps = await req.json();
    const id = corps?.id;
    if (typeof id !== 'string' || id === '') return NextResponse.json({ error: 'id requis' }, { status: 400 });
    const validation = validerAccueil(corps);
    if (!validation.ok) return NextResponse.json({ error: validation.erreur }, { status: 400 });

    const accueil = await queryOne<AccueilPij>(`
      WITH maj AS (
        UPDATE pij_accueils SET
          date_visite = $3, nom = $4, prenom = $5, date_naissance = $6, sexe = $7, adresse = $8,
          code_postal = $9, commune = $10, quartier = $11, email = $12, telephone = $13,
          objets = $14, objet_precision = $15, prochain_rdv = $16, remarques = $17,
          orientations = $18, suivi = $19, etat = $20, updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
        RETURNING *
      )
      ${SELECT.replace('FROM pij_accueils', 'FROM maj')}
    `, [id, session.tenant_id, ...parametresAccueil(validation.valeurs)]);
    if (!accueil) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 });
    return NextResponse.json({ success: true, accueil });
  } catch (err) {
    console.error('[api/pij/accueils PUT]', err);
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
      'DELETE FROM pij_accueils WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [id, session.tenant_id],
    );
    if (!supprime) return NextResponse.json({ error: 'Fiche introuvable' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/pij/accueils DELETE]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
