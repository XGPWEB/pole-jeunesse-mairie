/**
 * Fiche de terrain d'un jeune : contacts familiaux, autorisations et
 * observations (GET /api/jeunes/[id]/fiche).
 *
 * Module pur. Ces données sont sensibles : elles ne sont jamais écrites dans
 * un stockage persistant (ni AsyncStorage, ni SecureStore) ; elles ne vivent
 * qu'en mémoire, le temps d'affichage de la fiche.
 *
 * La normalisation est stricte sur ce qui engage une décision de terrain :
 * une autorisation qui n'est pas un booléen explicite invalide toute la
 * réponse — on n'affiche jamais « autorisé » ni « non autorisé » par défaut.
 */
import { ApiClient, ApiError, estApiError } from './api';
import { versDateCivile } from './dates';

export interface ContactFiche {
  nom: string;
  lien: string;
  telephone: string;
}

export interface AutorisationsFiche {
  sortie: boolean;
  photo: boolean;
  soinsBenins: boolean;
}

export interface FicheJeune {
  id: string;
  nom: string;
  prenom: string;
  /** Date civile AAAA-MM-JJ, ou '' si absente ou illisible. */
  dateNaissance: string;
  espaceId: string;
  secteur: string;
  contacts: ContactFiche[];
  autorisations: AutorisationsFiche;
  observations: string;
}

const MESSAGE_INVALIDE = 'Fiche inattendue du serveur.';

export const MESSAGE_FICHE_INTROUVABLE =
  "Cette fiche est introuvable : le jeune a peut-être été retiré, ou n'est pas accessible avec votre compte.";

function invalide(): ApiError {
  return new ApiError('invalid_response', MESSAGE_INVALIDE);
}

function objet(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function txt(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function dateCivileOuVide(v: unknown): string {
  if (typeof v !== 'string' || !v) return '';
  try {
    return versDateCivile(v);
  } catch {
    return '';
  }
}

function booleenStrict(v: unknown): boolean {
  if (typeof v !== 'boolean') throw invalide();
  return v;
}

/**
 * Valide et normalise la réponse du serveur pour le jeune `idAttendu`.
 * Lève une ApiError `invalid_response` si la forme n'est pas celle attendue ou
 * si la fiche reçue n'est pas celle du jeune demandé.
 * Seuls les champs connus sont repris : tout champ supplémentaire est ignoré.
 */
export function normaliserFicheJeune(brut: unknown, idAttendu: string): FicheJeune {
  const f = objet(brut);
  if (!f) throw invalide();
  if (typeof f.id !== 'string' || f.id === '' || f.id !== idAttendu) throw invalide();

  const autorisations = objet(f.autorisations);
  if (!autorisations) throw invalide();
  if (!Array.isArray(f.contacts)) throw invalide();

  const contacts: ContactFiche[] = [];
  for (const ligne of f.contacts) {
    const c = objet(ligne);
    if (!c) throw invalide();
    const contact: ContactFiche = { nom: txt(c.nom), lien: txt(c.lien), telephone: txt(c.telephone) };
    // Une ligne entièrement vide n'apporte rien à l'écran.
    if (contact.nom || contact.lien || contact.telephone) contacts.push(contact);
  }

  return {
    id: f.id,
    nom: txt(f.nom),
    prenom: txt(f.prenom),
    dateNaissance: dateCivileOuVide(f.dateNaissance),
    espaceId: txt(f.espaceId),
    secteur: txt(f.secteur),
    contacts,
    autorisations: {
      sortie: booleenStrict(autorisations.sortie),
      photo: booleenStrict(autorisations.photo),
      soinsBenins: booleenStrict(autorisations.soinsBenins),
    },
    observations: txt(f.observations),
  };
}

/**
 * GET /api/jeunes/[id]/fiche — fiche détaillée d'UN jeune.
 * 401 : traité par le client API (session purgée). 404 : message explicite.
 * Aucun repli : toute erreur est levée, jamais de fiche partielle ou fictive.
 */
export async function chargerFicheJeune(api: ApiClient, jeuneId: string): Promise<FicheJeune> {
  if (!jeuneId) throw new ApiError('not_found', MESSAGE_FICHE_INTROUVABLE, 404);
  let corps: unknown;
  try {
    corps = await api.request(`/api/jeunes/${encodeURIComponent(jeuneId)}/fiche`);
  } catch (e) {
    if (estApiError(e) && e.kind === 'not_found') {
      throw new ApiError('not_found', MESSAGE_FICHE_INTROUVABLE, 404, e.code);
    }
    throw e;
  }
  return normaliserFicheJeune(corps, jeuneId);
}

/** Numéro composable pour un lien `tel:` ; null s'il n'est pas exploitable. */
export function lienTelephone(telephone: string): string | null {
  const brut = telephone.trim();
  if (!/^\+?[\d\s().-]+$/.test(brut)) return null;
  const chiffres = brut.replace(/[^\d]/g, '');
  if (chiffres.length < 4 || chiffres.length > 15) return null;
  return `tel:${brut.startsWith('+') ? '+' : ''}${chiffres}`;
}
