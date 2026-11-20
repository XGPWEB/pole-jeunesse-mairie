import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { analyserFicheAgora } from '@/lib/fiche-agora';
import { lireFicheAgora, ERREUR_FICHE_NON_RECONNUE } from '@/lib/fiches-agora-lecture';
import { extraireTextePdf } from '@/lib/pdf-texte';

/**
 * Lit une édition AGORA (« Fiche enfant » ou « Fiche santé ») et rend les
 * champs reconnus, pour pré-remplir le formulaire d'une fiche jeune.
 *
 * Rien n'est enregistré ici : ni le fichier, ni les champs. La pièce n'est
 * conservée que si la personne enregistre ensuite la fiche (actions.ts).
 * Corps : `{ fichier: "data:application/pdf;base64,…" }`, 5 Mo maximum.
 */
export async function POST(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  let fichier: unknown;
  try {
    fichier = (await req.json())?.fichier;
  } catch {
    return NextResponse.json({ error: 'Requête illisible.' }, { status: 400 });
  }

  // Même contrôle qu'à l'enregistrement : type établi d'après le contenu, taille bornée.
  const analyse = analyserFicheAgora(fichier);
  if (!analyse.ok) return NextResponse.json({ error: analyse.erreur.replace(/^Fiche AGORA : /, '') }, { status: 422 });
  if (analyse.type !== 'application/pdf') {
    return NextResponse.json({
      error: 'Une image ne peut pas être lue automatiquement : déposez le PDF édité par AGORA, ou joignez l’image dans la rubrique « Documents AGORA » et saisissez les champs.',
    }, { status: 422 });
  }

  try {
    const lecture = lireFicheAgora(await extraireTextePdf(analyse.octets));
    if (!lecture.ok) return NextResponse.json({ error: lecture.erreur }, { status: 422 });
    return NextResponse.json({ type: lecture.type, champs: lecture.champs }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // PDF corrompu, protégé ou numérisé sans calque de texte : ce n'est pas une
    // panne de l'application, on ne journalise donc rien (et surtout pas le contenu).
    return NextResponse.json({ error: ERREUR_FICHE_NON_RECONNUE }, { status: 422 });
  }
}
