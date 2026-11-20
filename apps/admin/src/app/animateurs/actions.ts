'use server';

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import pool, { emptyToNull } from '@/lib/db';
import { ecrireAuditDansTransaction } from '@/lib/audit';
import { getTenantId, requireActionAdmin, roleEffectif, type JWTPayload } from '@/lib/auth';
import { SQL_REVOQUER_SESSIONS } from '@/lib/revocation';
import { erreurPolitiqueMotDePasse } from '@/lib/password';
import {
  FENETRE_15_MIN_MS, REAUTH_MAX_TENTATIVES, cleReauth, consommerTentative, reinitialiserTentatives,
} from '@/lib/rate-limit';
import {
  aAccesComplet, memesRubriques, normaliserRubriques, rubriquesDuRole, rubriquesEffectives,
  type TitulaireRubriques,
} from '@/lib/rubriques';

interface AnimateurCreateData {
  nom: string;
  prenom: string;
  email: string;
  espaceAssigne: string;
  poste?: string | null;
  unite?: string | null;
  dateEmbauche?: string | null;
  dateFinContrat?: string | null;
  typeContrat?: string | null;
  role?: string;
  password?: string | null;
  photoUrl?: string | null;
  telephone?: string | null;
  dateNaissance?: string | null;
  adresse?: string | null;
  /** Rubriques du menu cochées ; absent ou null = tout ce que l'auteur peut accorder. */
  rubriques?: string[] | null;
}

interface AnimateurUpdateData {
  nom?: string;
  prenom?: string;
  email?: string;
  espaceAssigne?: string;
  poste?: string | null;
  unite?: string | null;
  typeContrat?: string | null;
  dateEmbauche?: string | null;
  dateFinContrat?: string | null;
  statut?: string;
  role?: string;
  photoUrl?: string | null;
  passwordResetRequested?: boolean;
  password?: string;
  rubriques?: string[] | null;
  /**
   * Mot de passe actuel de l'auteur, exigé quand il change l'adresse ou le mot
   * de passe de SA PROPRE fiche (même règle que Mon profil). Jamais écrit.
   */
  motDePasseActuel?: string;
  [key: string]: unknown;
}

function generateUsername(prenom: string, nom: string): string {
  const clean = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  return `${clean(prenom)}.${clean(nom)}`;
}

/**
 * Gestion des comptes : admin ayant la rubrique « Animateurs ».
 *
 * Droits (rôle et rubriques du menu, lib/rubriques.ts) : seul le compte marqué
 * `gere_droits` (celui de Xavier) les règle. Les autres admins créent des
 * animateurs dont le menu est borné par le leur et modifient les fiches, sans toucher au rôle ni
 * aux rubriques, et ne touchent pas au compte qui gère les droits.
 *
 * Règles communes :
 *  - on n'accorde que des rubriques qu'on a soi-même ; seul un admin à accès
 *    complet peut créer un accès complet ;
 *  - on ne modifie ni ne supprime un compte qui a des rubriques qu'on n'a pas ;
 *  - on ne change ni son propre rôle, ni son statut, ni ses rubriques, et on
 *    ne supprime pas son propre compte : personne ne s'enferme dehors. Comme
 *    seul un admin complet peut modifier un admin complet, il en reste
 *    toujours au moins un.
 */
const REFUS_GESTION = 'Accès refusé — gestion des comptes non autorisée';
const REFUS_DEPASSE = 'Ce compte a des accès que vous n’avez pas : seul un administrateur qui les a peut le modifier.';
const REFUS_DROITS = 'Seul le compte qui gère les droits peut choisir le rôle et les rubriques d’un compte.';
const REFUS_PROTEGE = 'Ce compte gère les droits : lui seul peut modifier sa fiche.';
const REFUS_SOI_MEME = 'Vous ne pouvez pas modifier votre propre rôle, statut ou accès au menu : demandez-le à un autre administrateur.';
const REFUS_REAUTH = 'Mot de passe actuel incorrect : il est demandé pour changer votre propre adresse e-mail ou votre mot de passe.';

/** Le compte `cible` a-t-il une rubrique que l'auteur n'a pas ? */
function depasse(auteur: JWTPayload, cible: TitulaireRubriques): boolean {
  if (aAccesComplet(auteur)) return false;
  const ouvertes = rubriquesEffectives(auteur);
  return [...rubriquesEffectives(cible)].some(id => !ouvertes.has(id));
}

/**
 * Valeur de `animateurs.rubriques` à écrire pour un compte de rôle `role`.
 * `null` en base = accès complet : réservé à un auteur lui-même complet qui
 * coche tout. Un auteur limité écrit toujours une liste explicite.
 */
function rubriquesAStocker(
  auteur: JWTPayload, role: string, demandees: unknown,
): { valeur: string[] | null } | { erreur: string } {
  if (demandees != null && (!Array.isArray(demandees) || demandees.some(x => typeof x !== 'string'))) {
    return { erreur: 'Rubriques invalides' };
  }
  const duRole = rubriquesDuRole(roleEffectif(role));
  const complet = aAccesComplet(auteur);
  const ouvertes = rubriquesEffectives(auteur);
  const liste = demandees == null
    ? duRole.filter(id => complet || ouvertes.has(id))
    : normaliserRubriques(role, demandees as string[])!;
  if (!complet && liste.some(id => !ouvertes.has(id))) {
    return { erreur: 'Vous ne pouvez pas accorder une rubrique que vous n’avez pas vous-même.' };
  }
  return { valeur: complet && liste.length === duRole.length ? null : liste };
}

const REVALIDATE_PATHS = [
  '/admin/animateurs', '/admin/administrateurs', '/animateurs', '/dashboard', '/animateur/dashboard',
  '/statistiques', '/animateur/statistiques', '/admin/espaces',
];

export async function creerAnimateur(data: AnimateurCreateData): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const admin = await requireActionAdmin('animateurs');
    if (!admin) return { success: false, error: REFUS_GESTION };
    if (data.role && !ROLES_ATTRIBUABLES.has(data.role)) {
      return { success: false, error: 'Rôle invalide' };
    }
    if (!admin.gereDroits && ((data.role && data.role !== 'animateur') || data.rubriques != null)) {
      return { success: false, error: REFUS_DROITS };
    }
    // Même sans la marque, le menu par défaut ne dépasse jamais celui de
    // l'auteur : sinon un admin limité créerait un compte de contournement.
    const rubriques = rubriquesAStocker(admin, data.role || 'animateur', data.rubriques);
    if ('erreur' in rubriques) return { success: false, error: rubriques.erreur };
    if (data.password) {
      const erreur = erreurPolitiqueMotDePasse(data.password);
      if (erreur) return { success: false, error: erreur };
    }
    const tenant_id = await getTenantId();
    const id = `anim-${randomUUID()}`;
    const username = generateUsername(data.prenom, data.nom);
    const passwordHash = data.password ? await bcrypt.hash(data.password, 10) : null;
    // Un administrateur supervise : il ne fait pas partie des effectifs (ni
    // espace, ni contrat, ni date d'embauche).
    const effectif = (data.role || 'animateur') !== 'admin';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        INSERT INTO animateurs (id, nom, prenom, email, espace_assigne, poste, unite, date_embauche, date_fin_contrat, type_contrat, username, statut, role, password_hash, photo_url, password_reset_requested, created_at, tenant_id, telephone, date_naissance, adresse, rubriques)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'actif',$12,$13,NULL,false,NOW(),$14,$15,$16,$17,$18)
      `, [
        id, data.nom, data.prenom, data.email, effectif ? data.espaceAssigne : null,
        data.poste || null, effectif ? `Espace ${data.espaceAssigne}` : null,
        effectif ? data.dateEmbauche || null : null,
        effectif ? data.dateFinContrat || null : null,
        effectif ? data.typeContrat || null : null,
        username, data.role || 'animateur', passwordHash, tenant_id,
        data.telephone || null, data.dateNaissance || null, data.adresse || null,
        rubriques.valeur,
      ]);
      await ecrireAuditDansTransaction(client, {
        action: 'ACCOUNT_CREATED', tableName: 'animateurs', recordId: id,
        animateurId: admin.id, animateurUsername: admin.username, tenant_id,
        details: { role: data.role || 'animateur', rubriques: rubriques.valeur },
      });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    REVALIDATE_PATHS.forEach(p => revalidatePath(p));
    return { success: true, id };
  } catch (e: any) {
    return { success: false, error: e?.message ?? 'Erreur inconnue' };
  }
}

/** Valeurs admises — tout le reste est refusé plutôt qu'écrit tel quel en base. */
const ROLES_ATTRIBUABLES = new Set(['admin', 'animateur']);
const STATUTS_ADMIS = new Set(['actif', 'suspendu', 'inactif']);

export async function modifierAnimateur(id: string, data: AnimateurUpdateData): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = await requireActionAdmin('animateurs');
    if (!admin) return { success: false, error: REFUS_GESTION };

    // `role` et `statut` pilotent les permissions : on n'écrit que des valeurs
    // connues (un rôle arbitraire, 'superadmin' compris, était accepté).
    if ('role' in data && (typeof data.role !== 'string' || !ROLES_ATTRIBUABLES.has(data.role))) {
      return { success: false, error: 'Rôle invalide' };
    }
    if ('statut' in data && (typeof data.statut !== 'string' || !STATUTS_ADMIS.has(data.statut))) {
      return { success: false, error: 'Statut invalide' };
    }

    const sets: string[] = [];
    const vals: any[] = [id];
    let i = 2;

    const fields: [string, string][] = [
      ['nom', 'nom'], ['prenom', 'prenom'], ['email', 'email'],
      ['espaceAssigne', 'espace_assigne'], ['poste', 'poste'], ['unite', 'unite'],
      ['typeContrat', 'type_contrat'], ['dateEmbauche', 'date_embauche'],
      ['dateFinContrat', 'date_fin_contrat'],
      ['statut', 'statut'], ['role', 'role'], ['photoUrl', 'photo_url'],
      ['passwordResetRequested', 'password_reset_requested'],
      ['telephone', 'telephone'], ['dateNaissance', 'date_naissance'], ['adresse', 'adresse'],
    ];

    // Colonnes DATE : le formulaire renvoie '' quand le champ est vide (une
    // fiche sans date d'embauche s'initialise à ''), et PostgreSQL rejette ''
    // pour le type date. Voir emptyToNull dans lib/db.ts.
    const colonnesDate = new Set(['date_embauche', 'date_fin_contrat', 'date_naissance']);

    for (const [jsKey, col] of fields) {
      if (jsKey in data) {
        sets.push(`${col}=$${i++}`);
        vals.push(colonnesDate.has(col) ? emptyToNull(data[jsKey]) : data[jsKey]);
      }
    }

    if (data.password) {
      const erreur = erreurPolitiqueMotDePasse(data.password);
      if (erreur) return { success: false, error: erreur };
      sets.push(`password_hash=$${i++}`);
      vals.push(await bcrypt.hash(data.password, 10));
    }

    // Valeur calculée dans la transaction (elle dépend du rôle actuel).
    const indexRubriques = 'rubriques' in data ? vals.length : -1;
    if ('rubriques' in data) {
      sets.push(`rubriques=$${i++}`);
      vals.push(null);
    }

    if (sets.length === 0) return { success: true };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Filtre tenant obligatoire : la liste des champs modifiables inclut `role`,
      // `statut` et le mot de passe. Sans ce filtre, l'admin d'une structure
      // pourrait prendre le contrôle du compte admin d'une autre structure.
      // La ligne est verrouillée pour comparer l'état AVANT modification.
      const avant = await client.query<{ role: string | null; statut: string | null; rubriques: string[] | null; gere_droits: boolean; email: string | null; password_hash: string | null }>(
        'SELECT role, statut, rubriques, gere_droits, email, password_hash FROM animateurs WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
        [id, admin.tenant_id],
      );
      if (avant.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Animateur introuvable' };
      }
      if (avant.rows[0].gere_droits && id !== admin.id) {
        await client.query('ROLLBACK');
        return { success: false, error: REFUS_PROTEGE };
      }
      const roleAvant = roleEffectif(avant.rows[0].role);
      const accesAvant = { role: roleAvant, rubriques: avant.rows[0].rubriques };
      if (depasse(admin, accesAvant)) {
        await client.query('ROLLBACK');
        return { success: false, error: REFUS_DEPASSE };
      }

      // Rubriques après modification : celles demandées, sinon celles en place.
      const roleApres = roleEffectif(typeof data.role === 'string' ? data.role : avant.rows[0].role);
      let rubriquesApres = avant.rows[0].rubriques;
      if (indexRubriques >= 0) {
        const calcul = rubriquesAStocker(admin, roleApres, data.rubriques);
        if ('erreur' in calcul) {
          await client.query('ROLLBACK');
          return { success: false, error: calcul.erreur };
        }
        rubriquesApres = calcul.valeur;
        vals[indexRubriques] = rubriquesApres;
      }
      const accesApres = { role: roleApres, rubriques: rubriquesApres };
      // Promotion comprise : on ne donne pas à un compte plus qu'on n'a.
      if (depasse(admin, accesApres)) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Vous ne pouvez pas accorder une rubrique que vous n’avez pas vous-même.' };
      }
      const rubriquesChange = !memesRubriques(accesAvant, accesApres);

      // Révocation des sessions du compte quand ses droits ou son secret
      // changent : rôle, statut, mot de passe. Sans elle, un admin rétrogradé
      // (ou un compte dont on vient de changer le mot de passe parce qu'il est
      // compromis) gardait un JWT valable jusqu'à 30 jours.
      // Comparaison avec l'état actuel : le formulaire renvoie toute la fiche,
      // on ne déconnecte pas l'animateur pour une simple correction postale.
      // L'e-mail de récupération, lui, est un attribut de sécurité.
      const roleChange = 'role' in data && data.role !== avant.rows[0].role;
      const statutChange = 'statut' in data && data.statut !== avant.rows[0].statut;
      if ((roleChange || rubriquesChange) && !admin.gereDroits) {
        await client.query('ROLLBACK');
        return { success: false, error: REFUS_DROITS };
      }
      if (id === admin.id && (roleChange || statutChange || rubriquesChange)) {
        await client.query('ROLLBACK');
        return { success: false, error: REFUS_SOI_MEME };
      }
      // Les rubriques sont portées par le jeton (filtrage du proxy) : le compte
      // se reconnecte pour recevoir son nouveau menu.
      const emailChange = 'email' in data && data.email !== avant.rows[0].email;
      // Sa propre adresse ou son propre mot de passe : la session seule ne
      // suffit pas, comme dans Mon profil. Sinon une session volée d'admin
      // détournait durablement la récupération du compte (lien envoyé à la
      // nouvelle adresse) ou fixait un mot de passe connu de l'intrus.
      if (id === admin.id && (emailChange || data.password)) {
        const cle = cleReauth(admin.id);
        if (!await consommerTentative(cle, REAUTH_MAX_TENTATIVES, FENETRE_15_MIN_MS)) {
          await client.query('ROLLBACK');
          return { success: false, error: 'Trop de tentatives. Réessayez dans 15 minutes.' };
        }
        const hashActuel = avant.rows[0].password_hash;
        const valide = typeof data.motDePasseActuel === 'string' && data.motDePasseActuel !== '' && hashActuel
          ? await bcrypt.compare(data.motDePasseActuel, hashActuel)
          : false;
        if (!valide) {
          await client.query('ROLLBACK');
          return { success: false, error: REFUS_REAUTH };
        }
        await reinitialiserTentatives(cle);
      }
      if (roleChange || statutChange || rubriquesChange || emailChange || data.password) {
        sets.push(SQL_REVOQUER_SESSIONS);
      }

      vals.push(admin.tenant_id);
      await client.query(
        `UPDATE animateurs SET ${sets.join(',')} WHERE id=$1 AND tenant_id=$${vals.length}`,
        vals,
      );
      await ecrireAuditDansTransaction(client, {
        action: 'ACCOUNT_UPDATED', tableName: 'animateurs', recordId: id,
        animateurId: admin.id, animateurUsername: admin.username, tenant_id: admin.tenant_id,
        // Jamais de mot de passe, hash, adresse ou pièce jointe dans la trace.
        details: {
          champs: [...fields.filter(([cle]) => cle in data).map(([cle]) => cle),
            ...('rubriques' in data ? ['rubriques'] : []), ...(data.password ? ['password'] : [])],
          roleChange, statutChange, rubriquesChange, emailChange,
        },
      });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    REVALIDATE_PATHS.forEach(p => revalidatePath(p));
    revalidatePath(`/animateurs/${id}`);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message ?? 'Erreur inconnue' };
  }
}

export async function supprimerAnimateur(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = await requireActionAdmin('animateurs');
    if (!admin) return { success: false, error: REFUS_GESTION };
    if (id === admin.id) return { success: false, error: 'Vous ne pouvez pas supprimer votre propre compte.' };

    // Transaction obligatoire : ces écritures étaient auparavant exécutées sur
    // 3 connexions distinctes du pool. Si la dernière échouait, le compte
    // restait en base alors que ses références (sorties, préférences
    // actualités) avaient déjà été modifiées/effacées — sans retour arrière
    // possible. Même pattern que supprimerJeune (jeunes/actions.ts).
    let supprime: { username: string | null; role: string | null } | null = null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Vérifie l'appartenance au tenant AVANT toute écriture, en verrouillant
      // la ligne : sans ce contrôle, un admin pouvait supprimer le compte
      // d'une autre structure.
      const cible = await client.query<{ username: string | null; role: string | null; rubriques: string[] | null; gere_droits: boolean }>(
        'SELECT id, username, role, rubriques, gere_droits FROM animateurs WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
        [id, admin.tenant_id],
      );
      if (cible.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Animateur introuvable' };
      }
      if (cible.rows[0]?.gere_droits) {
        await client.query('ROLLBACK');
        return { success: false, error: REFUS_PROTEGE };
      }
      if (depasse(admin, { role: roleEffectif(cible.rows[0]?.role), rubriques: cible.rows[0]?.rubriques ?? null })) {
        await client.query('ROLLBACK');
        return { success: false, error: REFUS_DEPASSE };
      }
      supprime = { username: cible.rows[0]?.username ?? null, role: cible.rows[0]?.role ?? null };

      // Nullify FK references before deleting
      await client.query('UPDATE sorties SET animateur_id = NULL WHERE animateur_id = $1', [id]);
      await client.query('DELETE FROM actualites_prefs WHERE animateur_id = $1', [id]);
      const result = await client.query('DELETE FROM animateurs WHERE id=$1', [id]);

      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Animateur introuvable' };
      }

      // Trace au journal d'audit DANS la transaction, avec le même client :
      // la suppression et sa trace sont validées ensemble ou annulées
      // ensemble. Écrite après le COMMIT par logAudit (qui n'échoue jamais),
      // elle pouvait manquer alors que le compte avait bel et bien disparu.
      // Sont notés l'auteur, le compte supprimé et son rôle — la ligne
      // elle-même n'existant plus, c'est ici qu'il faut le retenir.
      await ecrireAuditDansTransaction(client, {
        action: 'ANIMATEUR_SUPPRIME',
        tableName: 'animateurs',
        recordId: id,
        animateurId: admin.id,
        animateurUsername: admin.username,
        tenant_id: admin.tenant_id,
        details: { compteSupprime: supprime?.username ?? null, role: supprime?.role ?? null },
      });

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    REVALIDATE_PATHS.forEach(p => revalidatePath(p));
    return { success: true };
  } catch (e: any) {
    // Étiquette reconnue par le monitoring : une suppression annulée parce que
    // sa trace n'a pas pu être écrite doit se voir.
    console.error('[supprimerAnimateur]', e);
    return { success: false, error: e?.message ?? 'Erreur inconnue' };
  }
}

export async function changerStatut(id: string, statut: 'actif' | 'suspendu' | 'inactif'): Promise<{ success: boolean; error?: string }> {
  return modifierAnimateur(id, { statut });
}
