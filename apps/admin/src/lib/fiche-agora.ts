/**
 * Pièce jointe « fiche AGORA » d'un jeune : validation à l'enregistrement et
 * règles de restitution (audit du 2026-10-07, constat A1).
 *
 * Le formulaire ne propose que PDF, PNG, JPEG et WEBP, mais ce contrôle vit
 * dans le navigateur : une requête fabriquée pouvait enregistrer du
 * `text/html`, que la route de lecture resservait tel quel, en `inline`, sur
 * l'origine du site — donc avec la session de la personne qui l'ouvrait.
 *
 * Règle unique, appliquée à l'écriture ET à la lecture :
 *   - le type est établi d'après le CONTENU décodé (signature du fichier),
 *     jamais d'après le type annoncé par le client ;
 *   - seuls quatre formats inertes sont acceptés ; HTML, SVG (qui peut porter
 *     du script) et tout le reste sont refusés ;
 *   - la taille est bornée sur le contenu décodé.
 *
 * Ce module ne dépend ni de la base ni de Next : il est testé unitairement.
 */

export const TAILLE_MAX_FICHE_AGORA = 5 * 1024 * 1024;

export const TYPES_FICHE_AGORA = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const;
export type TypeFicheAgora = (typeof TYPES_FICHE_AGORA)[number];

const MESSAGE_FORMAT = 'Fiche AGORA : format accepté PDF, PNG, JPEG ou WEBP.';
const MESSAGE_TAILLE = 'Fiche AGORA : fichier trop lourd (5 Mo maximum).';
const MESSAGE_ILLISIBLE = 'Fiche AGORA : fichier illisible.';

/** `data:<type>;base64,<contenu>` strict : ni paramètre (charset…), ni espace, ni retour à la ligne. */
const DATA_URI = /^data:([a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*);base64,([A-Za-z0-9+/]*={0,2})$/i;

/** Longueur base64 au-delà de laquelle le contenu décodé dépasse forcément la limite. */
const LONGUEUR_BASE64_MAX = Math.ceil(TAILLE_MAX_FICHE_AGORA / 3) * 4;

const commencePar = (octets: Buffer, signature: number[], position = 0): boolean =>
  octets.length >= position + signature.length && signature.every((o, i) => octets[position + i] === o);

/**
 * Type réel d'un contenu, d'après sa signature. `null` si ce n'est aucun des
 * quatre formats acceptés.
 *
 * PDF : la spécification demande `%PDF-` en tête, mais les lecteurs acceptent
 * quelques octets parasites avant (scanners, exports anciens). On tolère donc
 * la signature dans les 1024 premiers octets. Sans risque ici : la pièce est
 * alors servie comme `application/pdf` avec `nosniff`, jamais comme du HTML.
 */
export function detecterTypeFicheAgora(octets: Buffer): TypeFicheAgora | null {
  if (commencePar(octets, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (commencePar(octets, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (commencePar(octets, [0x52, 0x49, 0x46, 0x46]) && commencePar(octets, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (octets.subarray(0, 1024).includes('%PDF-', 0, 'latin1')) return 'application/pdf';
  return null;
}

export type AnalyseFicheAgora =
  | { ok: true; type: TypeFicheAgora; octets: Buffer; dataUri: string }
  | { ok: false; erreur: string };

/**
 * Analyse une pièce reçue (ou relue en base) sous forme de data URI.
 * En cas de succès, `dataUri` est la forme à stocker : même contenu, type
 * RÉEL — un JPEG annoncé comme PNG est enregistré comme JPEG.
 */
export function analyserFicheAgora(valeur: unknown): AnalyseFicheAgora {
  if (typeof valeur !== 'string' || valeur === '') return { ok: false, erreur: MESSAGE_ILLISIBLE };
  // Borne avant toute expression régulière ou décodage : pas de travail sur un envoi démesuré.
  if (valeur.length > LONGUEUR_BASE64_MAX + 200) return { ok: false, erreur: MESSAGE_TAILLE };
  const m = DATA_URI.exec(valeur);
  if (!m) return { ok: false, erreur: MESSAGE_ILLISIBLE };
  const base64 = m[2];
  if (base64.length === 0 || base64.length % 4 !== 0) return { ok: false, erreur: MESSAGE_ILLISIBLE };
  const octets = Buffer.from(base64, 'base64');
  if (octets.length === 0) return { ok: false, erreur: MESSAGE_ILLISIBLE };
  if (octets.length > TAILLE_MAX_FICHE_AGORA) return { ok: false, erreur: MESSAGE_TAILLE };
  const type = detecterTypeFicheAgora(octets);
  if (!type) return { ok: false, erreur: MESSAGE_FORMAT };
  return { ok: true, type, octets, dataUri: `data:${type};base64,${base64}` };
}

/**
 * Nom de fichier conservé pour l'impression et le téléchargement : sans
 * chemin, sans caractère de contrôle, de longueur bornée.
 */
export function nettoyerNomFicheAgora(nom: unknown): string | null {
  if (typeof nom !== 'string') return null;
  const propre = nom
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .split(/[\\/]/).pop()!
    .trim()
    .slice(0, 200);
  return propre || null;
}

export interface RestitutionFicheAgora {
  octets: Buffer;
  type: string;
  disposition: 'inline' | 'attachment';
  /** En-têtes de sécurité à poser sur la réponse, en plus du type et du nom de fichier. */
  enTetes: Record<string, string>;
}

/**
 * Décide comment resservir une pièce DÉJÀ en base.
 *
 * Les pièces enregistrées avant ce contrôle n'ont jamais été vérifiées. Une
 * pièce conforme est affichée dans le navigateur avec son type réel. Toute
 * autre (HTML, SVG, type inconnu) n'est ni supprimée ni affichée : elle est
 * proposée en TÉLÉCHARGEMENT, comme un fichier binaire opaque et sous bac à
 * sable, de sorte qu'elle ne puisse plus s'exécuter sur l'origine du site.
 * `null` si la valeur stockée n'est pas décodable du tout.
 *
 * La politique de sécurité de contenu est posée ici et non par la règle
 * globale de next.config.js, qui exclut cette route.
 */
export function preparerRestitutionFicheAgora(valeurStockee: string): RestitutionFicheAgora | null {
  const analyse = analyserFicheAgora(valeurStockee);
  if (analyse.ok) {
    return {
      octets: analyse.octets,
      type: analyse.type,
      disposition: 'inline',
      // PDF et images sont inertes : pas de bac à sable, qui empêcherait le
      // lecteur PDF du navigateur de s'afficher.
      enTetes: { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "frame-ancestors 'none'" },
    };
  }
  // Non conforme : on tente seulement d'en extraire les octets, sans rien croire du type annoncé.
  const m = /^data:[^,]*;base64,([A-Za-z0-9+/=\s]*)$/i.exec(valeurStockee);
  if (!m) return null;
  const octets = Buffer.from(m[1], 'base64');
  if (octets.length === 0) return null;
  return {
    octets,
    type: 'application/octet-stream',
    disposition: 'attachment',
    enTetes: {
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'none'",
    },
  };
}
