import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import pool, { queryOne } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { normaliserUsername } from '@/lib/login';
import {
  RESET_TTL_MINUTES, creerJetonReinitialisation, lienReinitialisation, supprimerJeton,
} from '@/lib/password-reset';
import { FENETRE_15_MIN_MS, consommerTentative, ipClient } from '@/lib/rate-limit';

const MAX_ATTEMPTS = 3;

/**
 * Réponse unique, quel que soit le cas (compte inconnu, suspendu, admin,
 * animateur, échec d'envoi) : cette route est anonyme et ne doit rien révéler
 * sur l'existence d'un identifiant ni sur le rôle du compte.
 */
function reponseGenerique() {
  return NextResponse.json({
    success: true,
    message: 'Si cet identifiant existe, la demande a été prise en compte.',
  });
}

interface CompteDemande {
  id: string;
  nom: string;
  prenom: string;
  email: string | null;
  username: string;
  role: string | null;
  tenant_id: string | null;
}

/**
 * Demande de réinitialisation — ANONYME.
 *
 * Cette route ne modifie JAMAIS un mot de passe. L'ancienne version écrasait
 * immédiatement le hash d'un compte admin sur simple présentation de son
 * identifiant : n'importe qui pouvait verrouiller l'administrateur dehors, et
 * un échec SMTP rendait le nouveau mot de passe irrécupérable.
 *
 *  - Compte avec une adresse sur SA fiche (admin, superadmin ou animateur) →
 *    lien à usage unique (30 min) envoyé à cette adresse ; le mot de passe ne
 *    change que lorsque ce lien est utilisé.
 *  - Compte sans adresse → notification « reset-request » aux admins DE SA
 *    STRUCTURE, qui renseignent l'adresse puis déclenchent l'envoi du lien
 *    (/api/auth/reset-password). Superadmin sans adresse : aucun lien et
 *    aucune notification (voir plus bas), seulement une erreur journalisée et
 *    une trace d'audit.
 */
export async function POST(request: NextRequest) {
  try {
    // Rate-limit par IP — table login_attempts avec un préfixe dédié.
    if (!await consommerTentative(`fp:${ipClient(request)}`, MAX_ATTEMPTS, FENETRE_15_MIN_MS)) {
      return NextResponse.json(
        { success: false, error: 'Trop de demandes. Réessayez dans 15 minutes.' },
        { status: 429 },
      );
    }

    const body: unknown = await request.json().catch(() => null);
    const username = (body as { username?: unknown } | null)?.username;
    if (typeof username !== 'string' || !username.trim()) return reponseGenerique();

    const compte = await queryOne<CompteDemande>(
      `SELECT id, nom, prenom, email, username, role, tenant_id
         FROM animateurs
        WHERE username = $1 AND statut = 'actif'`,
      [normaliserUsername(username)],
    );
    if (!compte || !compte.tenant_id) return reponseGenerique();
    const tenantId = compte.tenant_id;

    // Le lien ne part QUE vers l'adresse inscrite sur la fiche du compte.
    // Aucun repli sur MAIL_ADMIN : cette adresse est unique pour toute
    // l'instance, si bien qu'une demande anonyme visant l'admin sans adresse
    // d'une autre commune remettait à son destinataire un lien permettant de
    // choisir le mot de passe de ce compte (prise de contrôle entre communes).
    // Un compte sans adresse (admin compris) passe donc par une demande
    // visible des seuls admins de SA structure.
    const destinataire = compte.email?.trim() || null;

    // Le superadmin (tenant « system ») n'a pas d'admin de structure : sans
    // adresse, une notification partirait vers le tenant « system », qui n'en
    // a aucun, et la demande se perdrait sans bruit.
    if (compte.role === 'superadmin' && !destinataire) {
      // Personne ne peut traiter une notification pour ce compte : on ne crée
      // pas de demande morte, on le signale dans les journaux et l'audit.
      console.error('[api/auth/forgot-password] compte superadmin sans adresse de récupération : aucun lien émis. Renseigner l’adresse de sa fiche.');
      await logAudit({
        action: 'PASSWORD_RESET_REQUESTED',
        animateurId: compte.id,
        animateurUsername: compte.username,
        tenant_id: tenantId,
        details: { envoye: false, motif: 'sans_adresse' },
      });
      return reponseGenerique();
    }
    if (compte.role === 'admin' && !destinataire) {
      console.error('[api/auth/forgot-password] compte admin sans adresse de récupération : aucun lien émis, demande transmise aux admins de sa structure.');
    }

    // Tout compte qui a une adresse sur sa fiche reçoit le lien directement :
    // le lien ne donne la main qu'au titulaire de cette boîte.
    if (destinataire) {

      // Un lien vient d'être émis : on n'en renvoie pas un autre tout de suite.
      // Chaque émission neutralise le lien précédent — sans cette temporisation,
      // un tiers pourrait, en répétant la demande, invalider le lien du
      // titulaire avant qu'il ait eu le temps de l'ouvrir (et inonder sa boîte).
      const recent = await queryOne<{ id: string }>(
        `SELECT id FROM password_reset_tokens
          WHERE animateur_id = $1 AND used_at IS NULL AND expires_at > NOW()
            AND created_at > NOW() - INTERVAL '2 minutes'
          LIMIT 1`,
        [compte.id],
      );
      if (recent) return reponseGenerique();

      const jeton = await creerJetonReinitialisation({
        animateurId: compte.id,
        tenantId,
        ttlMinutes: RESET_TTL_MINUTES,
        creePar: null,
      });
      // Adresse relue sous le verrou de l'émission : si elle a changé depuis la
      // lecture ci-dessus, l'ancienne boîte ne reçoit pas de lien valide.
      if (!jeton.email) {
        await supprimerJeton(jeton.id);
        return reponseGenerique();
      }
      const { envoyerLienReinitialisation } = await import('@/app/animateurs/emailService');
      const envoi = await envoyerLienReinitialisation({
        prenom: compte.prenom,
        email: jeton.email,
        username: compte.username,
        lien: lienReinitialisation(jeton.jeton),
        expireMinutes: RESET_TTL_MINUTES,
      });
      // Lien non remis : on ne laisse pas traîner un jeton valide en base.
      if (!envoi.success) await supprimerJeton(jeton.id);

      await logAudit({
        action: 'PASSWORD_RESET_REQUESTED',
        animateurId: compte.id,
        animateurUsername: compte.username,
        tenant_id: tenantId,
        details: { envoye: envoi.success },
      });
      return reponseGenerique();
    }

    // Compte sans adresse → notification pour les admins de SA structure.
    // Le tenant est écrit explicitement : la colonne a 'nogent' pour valeur par
    // défaut, si bien que les demandes des autres communes arrivaient chez les
    // admins de Nogent (avec nom et courriel du demandeur) et jamais chez les
    // leurs.
    // Une seule demande en attente par compte : la route est anonyme, on ne
    // laisse pas un tiers inonder le tableau de bord des admins.
    await pool.query(`
      INSERT INTO notifications
        (id, type, titre, message, cible, urgent, envoye_par,
         from_animateur_id, from_animateur_username, from_animateur_prenom,
         from_animateur_nom, from_animateur_email, tenant_id)
      SELECT $1::text,'reset-request',$2::text,$3::text,'admin',FALSE,$4::text,
             $5::text,$6::text,$7::text,$8::text,$9::text,$10::varchar
       WHERE NOT EXISTS (
         SELECT 1 FROM notifications
          WHERE type = 'reset-request' AND from_animateur_id = $5::text AND tenant_id = $10::varchar
       )
    `, [
      `notif-${randomUUID()}`,
      `🔑 Demande de réinitialisation — ${compte.prenom} ${compte.nom}`,
      `${compte.role === 'admin' ? "L'administrateur" : "L'animateur"} ${compte.prenom} ${compte.nom} (${compte.username}) a demandé la réinitialisation de son mot de passe.`,
      compte.username,
      compte.id,
      compte.username,
      compte.prenom,
      compte.nom,
      compte.email ?? '',
      tenantId,
    ]);

    return reponseGenerique();
  } catch (err) {
    // Même en cas d'erreur interne la réponse reste générique : une erreur qui
    // ne surviendrait que pour les comptes existants serait un oracle.
    console.error('[api/auth/forgot-password]', err);
    return reponseGenerique();
  }
}
