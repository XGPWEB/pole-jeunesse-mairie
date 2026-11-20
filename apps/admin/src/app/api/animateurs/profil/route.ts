import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { logAudit } from '@/lib/audit';
import { erreurPolitiqueMotDePasse } from '@/lib/password';
import {
  FENETRE_15_MIN_MS, REAUTH_MAX_TENTATIVES, cleReauth, consommerTentative, reinitialiserTentatives,
} from '@/lib/rate-limit';
import { SQL_REVOQUER_SESSIONS } from '@/lib/revocation';

export async function GET(request: NextRequest) {
  const session = await requireAuth(request);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  try {
    const row = await queryOne(`
      SELECT id, nom, prenom, email, espace_assigne AS "espaceAssigne",
             poste, unite, date_embauche::text AS "dateEmbauche",
             type_contrat AS "typeContrat", username, statut, role,
             photo_url AS "photoUrl", created_at AS "createdAt",
             last_login AS "lastLogin"
      FROM animateurs WHERE id = $1
    `, [session.id]);

    if (!row) return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    return NextResponse.json({ animateur: row });
  } catch (err) {
    console.error('[api/animateurs/profil]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await requireAuth(request);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  try {
    const body = await request.json();
    const { nom, prenom, email, telephone, poste, photoUrl, newPassword, currentPassword } = body;

    if (email !== undefined && (typeof email !== 'string' || email.length > 254
      || (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))) {
      return NextResponse.json({ error: 'Adresse e-mail invalide.' }, { status: 400 });
    }
    const compte = await queryOne<{ email: string | null; password_hash: string | null }>(
      'SELECT email, password_hash FROM animateurs WHERE id = $1', [session.id],
    );
    if (!compte) return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
    const emailChanging = email !== undefined && email !== (compte.email ?? '');
    const passwordChanging = newPassword !== undefined && newPassword !== '';

    // L'adresse donne désormais accès à la récupération de TOUS les comptes.
    // Une session seule ne doit pas permettre de détourner cette récupération.
    if (passwordChanging || emailChanging) {
      // Limite par compte : sans elle, une session volée disposerait ici d'un
      // oracle illimité pour deviner le mot de passe actuel.
      const cle = cleReauth(session.id);
      if (!await consommerTentative(cle, REAUTH_MAX_TENTATIVES, FENETRE_15_MIN_MS)) {
        return NextResponse.json({ error: 'Trop de tentatives. Réessayez dans 15 minutes.' }, { status: 429 });
      }
      const passwordValid = typeof currentPassword === 'string' && currentPassword && compte.password_hash
        ? await bcrypt.compare(currentPassword, compte.password_hash)
        : false;

      if (!currentPassword || !passwordValid) {
        return NextResponse.json({ error: 'Mot de passe actuel incorrect.' }, { status: 400 });
      }
      await reinitialiserTentatives(cle);
      if (passwordChanging) {
        const erreurPolitique = erreurPolitiqueMotDePasse(newPassword);
        if (erreurPolitique) {
          return NextResponse.json({ error: erreurPolitique }, { status: 400 });
        }
      }
    }

    const setClauses: string[] = [];
    const params: any[] = [session.id];

    if (nom       !== undefined) { params.push(nom);      setClauses.push(`nom = $${params.length}`); }
    if (prenom    !== undefined) { params.push(prenom);   setClauses.push(`prenom = $${params.length}`); }
    if (email     !== undefined) { params.push(email);    setClauses.push(`email = $${params.length}`); }
    if (poste     !== undefined) { params.push(poste);    setClauses.push(`poste = $${params.length}`); }
    if (telephone !== undefined) { params.push(telephone); setClauses.push(`telephone = $${params.length}`); }
    if (photoUrl  !== undefined) { params.push(photoUrl); setClauses.push(`photo_url = $${params.length}`); }

    if (passwordChanging) {
      const hash = await bcrypt.hash(newPassword, 10);
      params.push(hash);
      setClauses.push(`password_hash = $${params.length}`);
      // Révocation dans le MÊME UPDATE que le changement de hash : toutes les
      // sessions existantes (y compris celle-ci, et les jetons mobiles) sont
      // invalidées de façon durable — voir lib/revocation.ts. Faite dans une
      // seconde requête, elle pouvait ne pas avoir lieu si la première
      // réussissait et la seconde échouait.
    }
    if (passwordChanging || emailChanging) setClauses.push(SQL_REVOQUER_SESSIONS);

    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 });
    }

    const row = await queryOne(`
      UPDATE animateurs SET ${setClauses.join(', ')}
      WHERE id = $1
      RETURNING id, nom, prenom, email, espace_assigne AS "espaceAssigne",
                poste, username, statut, role, photo_url AS "photoUrl"
    `, params);

    await logAudit({
      action: passwordChanging ? 'PASSWORD_CHANGED' : 'PROFIL_UPDATED',
      animateurId: session.id,
      animateurUsername: session.username,
      tenant_id: session.tenant_id,
    });

    return NextResponse.json({ success: true, animateur: row, sessionRevoked: passwordChanging || emailChanging });
  } catch (err) {
    console.error('[api/animateurs/profil]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
