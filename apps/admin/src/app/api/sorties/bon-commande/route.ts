import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { nettoyerNomFicheAgora, preparerRestitutionFicheAgora } from '@/lib/fiche-agora';

/**
 * Sert le bon de commande d'une sortie (PDF ou image) tel quel, pour que le
 * navigateur l'affiche et permette de l'imprimer via son visionneur natif.
 *
 * Le fichier est stocké en data URI base64 sur la sortie ; on le décode ici et
 * on renvoie les octets avec le bon Content-Type. Accessible à tout membre
 * authentifié du même tenant (le planning des sorties est partagé).
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { tenant_id } = session;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

    const row = await queryOne<{ bonCommande: string | null; bonCommandeNom: string | null }>(
      'SELECT bon_commande AS "bonCommande", bon_commande_nom AS "bonCommandeNom" FROM sorties WHERE id = $1 AND tenant_id = $2',
      [id, tenant_id],
    );
    if (!row || !row.bonCommande) {
      return NextResponse.json({ error: 'Aucun bon de commande pour cette sortie.' }, { status: 404 });
    }

    // Même protection que les pièces AGORA : type établi par le contenu,
    // pièces historiques actives servies en téléchargement sous bac à sable.
    const piece = preparerRestitutionFicheAgora(row.bonCommande);
    if (!piece) {
      return NextResponse.json({ error: 'Fichier illisible.' }, { status: 422 });
    }
    const nom = nettoyerNomFicheAgora(row.bonCommandeNom) || `bon-commande-${id}`;

    // Le nom peut contenir des accents / apostrophes courbes : un en-tête HTTP
    // n'accepte que de l'ASCII. On fournit une version ASCII de repli (filename)
    // ET la version UTF-8 encodée (filename*), conformément à la RFC 5987 —
    // sinon Node lève « Invalid character in header content » et l'impression
    // échoue.
    const asciiNom = nom.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
    const utf8Nom = encodeURIComponent(nom);

    return new NextResponse(new Uint8Array(piece.octets), {
      headers: {
        ...piece.enTetes,
        'Content-Type': piece.type,
        // inline : le navigateur affiche le document (et propose l'impression)
        // plutôt que de le télécharger directement.
        'Content-Disposition': `${piece.disposition}; filename="${asciiNom}"; filename*=UTF-8''${utf8Nom}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('[api/sorties/bon-commande]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
