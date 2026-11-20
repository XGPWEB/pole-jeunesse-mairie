import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { rubriquesEffectives, satisfaitExigence } from '@/lib/rubriques';
import pool, { queryOne } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { envoyerLienReinitialisation } from '@/app/animateurs/emailService';
import {
  RESET_TTL_ADMIN_MINUTES, creerJetonReinitialisation, lienReinitialisation, supprimerJeton,
} from '@/lib/password-reset';

interface Cible {
  id: string;
  nom: string;
  prenom: string;
  email: string | null;
  username: string;
  statut: string | null;
  role: string;
  rubriques: string[] | null;
  gere_droits: boolean;
}

/**
 * Un ADMIN déclenche la réinitialisation du mot de passe d'un compte de sa
 * structure (réponse à une notification « reset-request »).
 *
 * ATTENTION : /api/auth/ est public pour le middleware — cette route doit donc
 * faire elle-même le contrôle complet. Elle se contentait auparavant de
 * vérifier la signature du JWT et le rôle INSCRIT DANS LE JETON : un billet
 * 2FA provisoire (mot de passe seul), un jeton révoqué, celui d'un compte
 * suspendu ou d'un admin rétrogradé passaient tous.
 *
 * Elle ne change plus le mot de passe : elle émet un lien à usage unique,
 * envoyé à l'adresse de la fiche. Le hash n'est modifié que lorsque le
 * titulaire utilise ce lien (/api/auth/reset-password/confirm).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAuth(request);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Non authentifié' }, { status: 401 });
    }
    if (session.role !== 'admin' || !satisfaitExigence(session, ['animateurs'])) {
      return NextResponse.json({ success: false, error: 'Accès refusé' }, { status: 403 });
    }
    const tenantId = session.tenant_id;

    const body: unknown = await request.json().catch(() => null);
    const { animateurId, notifId } = (body ?? {}) as { animateurId?: unknown; notifId?: unknown };
    if (typeof animateurId !== 'string' || !animateurId) {
      return NextResponse.json({ success: false, error: 'animateurId requis.' }, { status: 400 });
    }

    const cible = await queryOne<Cible>(
      `SELECT id, nom, prenom, email, username, statut, role, rubriques, gere_droits
         FROM animateurs WHERE id = $1 AND tenant_id = $2`,
      [animateurId, tenantId],
    );
    if (!cible) {
      return NextResponse.json({ success: false, error: 'Animateur introuvable.' }, { status: 404 });
    }
    const ouvertes = rubriquesEffectives(session);
    if ((cible.gere_droits && cible.id !== session.id)
      || [...rubriquesEffectives(cible)].some(id => !ouvertes.has(id))) {
      return NextResponse.json({ success: false, error: 'Gestion de ce compte non autorisée.' }, { status: 403 });
    }
    if (cible.statut !== 'actif') {
      return NextResponse.json(
        { success: false, error: 'Ce compte n’est pas actif : réactivez-le avant de réinitialiser son mot de passe.' },
        { status: 409 },
      );
    }
    const email = cible.email?.trim();
    if (!email) {
      return NextResponse.json(
        {
          success: false,
          error: 'Aucune adresse e-mail sur la fiche de cet animateur. Renseignez-la, ou définissez un mot de passe depuis sa fiche.',
        },
        { status: 409 },
      );
    }

    const jeton = await creerJetonReinitialisation({
      animateurId: cible.id,
      tenantId,
      ttlMinutes: RESET_TTL_ADMIN_MINUTES,
      creePar: session.id,
    });
    // Adresse relue sous le verrou de l'émission (voir JetonEmis.email).
    if (!jeton.email) {
      await supprimerJeton(jeton.id);
      return NextResponse.json(
        { success: false, error: 'Aucune adresse e-mail sur la fiche de cet animateur.' },
        { status: 409 },
      );
    }
    const envoi = await envoyerLienReinitialisation({
      prenom: cible.prenom,
      email: jeton.email,
      username: cible.username,
      lien: lienReinitialisation(jeton.jeton),
      expireMinutes: RESET_TTL_ADMIN_MINUTES,
    });
    if (!envoi.success) {
      // Rien n'a changé pour l'animateur, et la demande reste visible : l'admin
      // peut réessayer. On ne laisse pas de jeton valide non remis en base.
      await supprimerJeton(jeton.id);
      return NextResponse.json(
        { success: false, error: 'L’e-mail n’a pas pu être envoyé. Le mot de passe n’a pas été modifié.' },
        { status: 502 },
      );
    }

    // La demande est traitée. Suppression bornée au tenant de la session, au
    // type « reset-request » ET au compte concerné : le notifId vient du client
    // et permettait auparavant de détruire n'importe quelle notification de
    // n'importe quelle structure.
    if (typeof notifId === 'string' && notifId) {
      await pool.query(
        `DELETE FROM notifications
          WHERE id = $1 AND tenant_id = $2 AND type = 'reset-request' AND from_animateur_id = $3`,
        [notifId, tenantId, cible.id],
      );
    }

    await logAudit({
      action: 'PASSWORD_RESET_LINK_SENT',
      tableName: 'animateurs',
      recordId: cible.id,
      animateurId: session.id,
      animateurUsername: session.username,
      tenant_id: tenantId,
    });

    return NextResponse.json({
      success: true,
      message: `Lien de réinitialisation envoyé par e-mail (valable ${RESET_TTL_ADMIN_MINUTES} minutes).`,
    });
  } catch (err) {
    console.error('[api/auth/reset-password]', err);
    return NextResponse.json({ success: false, error: 'Erreur serveur' }, { status: 500 });
  }
}
