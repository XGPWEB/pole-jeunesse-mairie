import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { queryOne } from '@/lib/db';

export async function POST(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { tenant_id } = session;

  try {
    const { message, objet } = await req.json();
    if (!message?.trim()) return NextResponse.json({ error: 'Message requis.' }, { status: 400 });

    const expediteurNom = `${session.prenom ?? ''} ${session.nom ?? ''}`.trim();
    const id = `notif-${crypto.randomUUID()}`;
    const titre = objet?.trim()
      ? `💬 ${expediteurNom} — ${objet.trim()}`
      : `💬 Message de ${expediteurNom}`;

    await queryOne(`
      INSERT INTO notifications
        (id, type, titre, message, cible, urgent, envoye_par,
         expediteur_id, expediteur_nom, expediteur_username, expediteur_espace, tenant_id)
      VALUES ($1, 'message-animateur', $2, $3, 'admin', FALSE, $4, $5, $6, $7, $8, $9)
    `, [id, titre, message.trim(), session.username,
        session.id, expediteurNom, session.username, session.espaceAssigne ?? '', tenant_id]);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/messages-admin]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
