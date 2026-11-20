'use server';

import bcrypt from 'bcryptjs';
import {
  envoyerIdentifiants as _envoyerIdentifiants,
  envoyerReinitialisationMdp as _envoyerReinitialisationMdp,
} from './emailService';
import { requireActionAdmin, type JWTPayload } from '@/lib/auth';
import { queryOne } from '@/lib/db';
import { aAccesComplet, rubriquesEffectives } from '@/lib/rubriques';
import {
  FENETRE_15_MIN_MS, REAUTH_MAX_TENTATIVES, cleReauth, consommerTentative, rembourserTentative,
} from '@/lib/rate-limit';

/**
 * Envoi d'identifiants par courriel depuis la gestion des comptes.
 *
 * Une server action s'appelle avec n'importe quels arguments : auparavant le
 * destinataire, l'objet et le texte d'introduction (inséré tel quel dans le
 * HTML) venaient du navigateur. Un admin ayant la rubrique Animateurs pouvait
 * donc faire partir, depuis l'adresse de la structure, un courriel HTML
 * arbitraire vers n'importe quelle adresse.
 *
 * Désormais :
 *  - le destinataire est l'adresse de la fiche du compte désigné par son
 *    identifiant, dans la commune de l'auteur ; l'adresse transmise est ignorée ;
 *  - mêmes protections que /api/auth/reset-password : pas le compte qui gère
 *    les droits (sauf soi-même), pas un compte ayant des rubriques que
 *    l'auteur n'a pas ;
 *  - le mot de passe envoyé doit être celui réellement enregistré : on ne
 *    peut plus transmettre un mot de passe qui ne fonctionne pas, ni se
 *    servir de ce champ pour un autre contenu ;
 *  - l'objet et le texte sont traités comme du texte, échappés ici.
 *
 * La comparaison avec le hash enregistré répond « juste » ou « faux » : elle
 * est donc limitée comme toute preuve du mot de passe d'un compte, sur le
 * compteur de CE compte (cleReauth, 5 essais par 15 minutes), partagé avec Mon
 * profil, la double authentification et la fiche du titulaire. Une réussite
 * rend son essai sans effacer les échecs (retour de revue du 20 octobre).
 */

const REFUS = 'Accès refusé — rôle admin requis';
const LONGUEUR_MAX_INTRO = 2000;
const LONGUEUR_MAX_OBJET = 200;

interface Destinataire {
  id: string;
  prenom: string;
  username: string;
  email: string | null;
  role: string;
  rubriques: string[] | null;
  gere_droits: boolean;
  password_hash: string | null;
}

async function destinataireAutorise(
  admin: JWTPayload,
  username: unknown,
  password: unknown,
): Promise<{ ok: true; compte: Destinataire & { email: string } } | { ok: false; error: string }> {
  if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) {
    return { ok: false, error: 'Données manquantes.' };
  }
  const compte = await queryOne<Destinataire>(
    `SELECT id, prenom, username, email, role, rubriques, gere_droits, password_hash
       FROM animateurs WHERE username = $1 AND tenant_id = $2`,
    [username, admin.tenant_id],
  );
  if (!compte) return { ok: false, error: 'Compte introuvable.' };
  const ouvertes = rubriquesEffectives(admin);
  if ((compte.gere_droits && compte.id !== admin.id)
    || (!aAccesComplet(admin) && [...rubriquesEffectives(compte)].some(id => !ouvertes.has(id)))) {
    return { ok: false, error: 'Gestion de ce compte non autorisée.' };
  }
  const email = compte.email?.trim();
  if (!email) return { ok: false, error: 'Aucune adresse e-mail sur la fiche de ce compte.' };
  if (!compte.password_hash) {
    return { ok: false, error: 'Ce mot de passe n’est pas celui du compte : enregistrez-le avant de l’envoyer.' };
  }
  const cle = cleReauth(compte.id);
  if (!await consommerTentative(cle, REAUTH_MAX_TENTATIVES, FENETRE_15_MIN_MS)) {
    return { ok: false, error: 'Trop de tentatives sur ce compte. Réessayez dans 15 minutes.' };
  }
  if (!await bcrypt.compare(password, compte.password_hash)) {
    return { ok: false, error: 'Ce mot de passe n’est pas celui du compte : enregistrez-le avant de l’envoyer.' };
  }
  await rembourserTentative(cle);
  return { ok: true, compte: { ...compte, email } };
}

function echapperHtml(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Texte d'introduction → HTML sûr. Les écrans envoient soit du texte brut,
 * soit un texte déjà échappé avec des <br/> : les deux formes sont ramenées
 * au texte, puis échappées ici.
 */
function introEnHtml(intro: unknown): string | undefined {
  if (typeof intro !== 'string' || !intro.trim()) return undefined;
  const texte = intro
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .slice(0, LONGUEUR_MAX_INTRO);
  return echapperHtml(texte).replace(/\r?\n/g, '<br/>');
}

function objetPropre(objet: unknown): string | undefined {
  if (typeof objet !== 'string') return undefined;
  const propre = objet.replace(/[\r\n]+/g, ' ').trim().slice(0, LONGUEUR_MAX_OBJET);
  return propre || undefined;
}

export async function envoyerIdentifiants(data: {
  prenom: string; nom: string; email: string;
  username: string; password: string; espaceAssigne: string;
  subject?: string; introText?: string;
}): Promise<{ success: boolean; error?: string }> {
  const admin = await requireActionAdmin('animateurs');
  if (!admin) return { success: false, error: REFUS };
  const cible = await destinataireAutorise(admin, data?.username, data?.password);
  if (!cible.ok) return { success: false, error: cible.error };
  return _envoyerIdentifiants({
    prenom: cible.compte.prenom,
    nom: '',
    email: cible.compte.email,
    username: cible.compte.username,
    password: data.password,
    espaceAssigne: '',
    subject: objetPropre(data.subject),
    introText: introEnHtml(data.introText),
  });
}

export async function envoyerReinitialisationMdp(data: {
  prenom: string; nom: string; email: string;
  username: string; password: string;
}): Promise<{ success: boolean; error?: string }> {
  const admin = await requireActionAdmin('animateurs');
  if (!admin) return { success: false, error: REFUS };
  const cible = await destinataireAutorise(admin, data?.username, data?.password);
  if (!cible.ok) return { success: false, error: cible.error };
  return _envoyerReinitialisationMdp({
    prenom: cible.compte.prenom,
    nom: '',
    email: cible.compte.email,
    username: cible.compte.username,
    password: data.password,
  });
}
