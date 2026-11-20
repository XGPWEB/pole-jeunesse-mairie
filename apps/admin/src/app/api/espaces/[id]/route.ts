import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Accès refusé — rôle admin requis' }, { status: 403 });
  }
  const { tenant_id } = session;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'ID requis' }, { status: 400 });

  // Les comptages DOIVENT être filtrés par tenant : les identifiants d'espaces
  // sont des slugs partagés (collegiens, lyceens…), donc sans ce filtre le
  // message d'erreur révélerait les effectifs d'une autre structure et
  // empêcherait de supprimer un espace pourtant vide côté tenant courant.
  const [jeunesRow, activitesRow] = await Promise.all([
    queryOne<{ count: string }>('SELECT COUNT(*)::int AS count FROM jeunes WHERE espace_id = $1 AND tenant_id = $2', [id, tenant_id]),
    queryOne<{ count: string }>('SELECT COUNT(*)::int AS count FROM activites WHERE espace_id = $1 AND tenant_id = $2', [id, tenant_id]),
  ]);

  const nbJeunes = Number(jeunesRow?.count ?? 0);
  const nbActivites = Number(activitesRow?.count ?? 0);

  if (nbJeunes > 0 || nbActivites > 0) {
    return NextResponse.json(
      {
        error: `Impossible de supprimer : ${nbJeunes} jeune(s) et ${nbActivites} activité(s) sont rattaché(s) à cet espace. Réassignez-les d'abord.`,
        nbJeunes,
        nbActivites,
      },
      { status: 409 },
    );
  }

  await query('DELETE FROM espaces WHERE id = $1 AND tenant_id = $2', [id, tenant_id]);
  return NextResponse.json({ success: true });
}
