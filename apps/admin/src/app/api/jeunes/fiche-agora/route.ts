import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { nettoyerNomFicheAgora, preparerRestitutionFicheAgora } from '@/lib/fiche-agora';

/**
 * Sert une édition AGORA d'un jeune (PDF ou image) pour affichage et
 * impression via le visionneur du navigateur : la « Fiche enfant » par défaut,
 * la « Fiche santé » avec `piece=sante`. Accessible aux admins ET aux
 * animateurs du même tenant.
 *
 * Seuls PDF, PNG, JPEG et WEBP sont affichés (voir lib/fiche-agora.ts).
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { tenant_id } = session;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

    const sante = searchParams.get('piece') === 'sante';

    // Noms de colonnes choisis ici parmi deux constantes, jamais d'après la requête.
    const row = await queryOne<{ ficheAgora: string | null; ficheAgoraNom: string | null }>(
      sante
        ? 'SELECT fiche_sante AS "ficheAgora", fiche_sante_nom AS "ficheAgoraNom" FROM jeunes WHERE id = $1 AND tenant_id = $2'
        : 'SELECT fiche_agora AS "ficheAgora", fiche_agora_nom AS "ficheAgoraNom" FROM jeunes WHERE id = $1 AND tenant_id = $2',
      [id, tenant_id],
    );
    if (!row || !row.ficheAgora) {
      return NextResponse.json({ error: sante ? 'Aucune fiche santé pour ce jeune.' : 'Aucune fiche AGORA pour ce jeune.' }, { status: 404 });
    }

    // Le type servi vient du CONTENU, jamais du type enregistré : une pièce
    // historique non conforme (HTML, SVG…) part en téléchargement opaque.
    const piece = preparerRestitutionFicheAgora(row.ficheAgora);
    if (!piece) {
      return NextResponse.json({ error: 'Fichier illisible.' }, { status: 422 });
    }
    const nom = nettoyerNomFicheAgora(row.ficheAgoraNom) || `${sante ? 'fiche-sante' : 'fiche-agora'}-${id}`;
    // En-tête ASCII de repli + version UTF-8 (RFC 5987) pour les noms accentués.
    const asciiNom = nom.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
    const utf8Nom = encodeURIComponent(nom);

    return new NextResponse(new Uint8Array(piece.octets), {
      headers: {
        ...piece.enTetes,
        'Content-Type': piece.type,
        'Content-Disposition': `${piece.disposition}; filename="${asciiNom}"; filename*=UTF-8''${utf8Nom}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('[api/jeunes/fiche-agora]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
