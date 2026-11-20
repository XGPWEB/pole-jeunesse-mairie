/**
 * Appels typés au backend. Module pur : reçoit le client API en paramètre.
 * Chaque fonction valide la forme de la réponse et lève une ApiError sinon.
 */
import { ApiClient, ApiError, estApiError } from './api';
import { versDateCivile } from './dates';
import { normaliserPointages, PointageServeur, StatutPointage } from './pointages';
import { analyserReponseLogin, Session } from './session';

function tableau(brut: unknown, quoi: string): Record<string, unknown>[] {
  if (!Array.isArray(brut)) {
    throw new ApiError('invalid_response', `Liste ${quoi} inattendue du serveur.`);
  }
  return brut.filter((l): l is Record<string, unknown> => typeof l === 'object' && l !== null);
}

function txt(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function dateCivileOuVide(v: unknown): string {
  if (typeof v !== 'string' || !v) return '';
  try {
    return versDateCivile(v);
  } catch {
    return '';
  }
}

// ─── Authentification ────────────────────────────────────────────────────────

export interface Identifiants {
  username: string;
  password: string;
  totpCode?: string;
}

/** POST /api/auth/mobile/login — route publique, aucun cookie. */
export async function connecter(api: ApiClient, identifiants: Identifiants): Promise<Session> {
  const body: Record<string, string> = {
    username: identifiants.username.trim(),
    password: identifiants.password,
  };
  if (identifiants.totpCode) body.totpCode = identifiants.totpCode.trim();
  const corps = await api.request('/api/auth/mobile/login', { method: 'POST', body, auth: false });
  return analyserReponseLogin(corps);
}

export interface ProfilServeur {
  id: string;
  username: string;
  role: string;
  /** Attributs actuels en base, s'ils sont renvoyés par le serveur. */
  nom?: string;
  prenom?: string;
  espaceAssigne?: string;
  tenantId?: string;
}

/** GET /api/animateurs/me — valide la session côté serveur. */
export async function validerSession(api: ApiClient): Promise<ProfilServeur> {
  const corps = await api.request('/api/animateurs/me');
  if (typeof corps !== 'object' || corps === null) {
    throw new ApiError('invalid_response', 'Profil inattendu du serveur.');
  }
  const p = corps as Record<string, unknown>;
  if (!txt(p.id) || !txt(p.username) || !txt(p.role)) {
    throw new ApiError('invalid_response', 'Profil inattendu du serveur.');
  }
  const profil: ProfilServeur = { id: txt(p.id), username: txt(p.username), role: txt(p.role) };
  if (typeof p.nom === 'string') profil.nom = p.nom;
  if (typeof p.prenom === 'string') profil.prenom = p.prenom;
  if (typeof p.espaceAssigne === 'string') profil.espaceAssigne = p.espaceAssigne;
  if (txt(p.tenantId)) profil.tenantId = txt(p.tenantId);
  return profil;
}

/** POST /api/auth/logout — révoque la session côté serveur. */
export async function deconnecterServeur(api: ApiClient): Promise<void> {
  await api.request('/api/auth/logout', { method: 'POST' });
}

/** POST /api/auth/forgot-password — réponse volontairement générique. */
export async function demanderReinitialisation(api: ApiClient, username: string): Promise<void> {
  await api.request('/api/auth/forgot-password', {
    method: 'POST',
    body: { username: username.trim() },
    auth: false,
  });
}

/** GET /api/health — route publique, sert au test de connexion. */
export async function testerServeur(api: ApiClient): Promise<void> {
  await api.request('/api/health', { auth: false, timeoutMs: 5000 });
}

// ─── Données de référence ────────────────────────────────────────────────────

export interface JeuneResume {
  id: string;
  nom: string;
  prenom: string;
  dateNaissance: string;
  espaceId: string;
  secteur: string;
}

/** GET /api/jeunes */
export async function listerJeunes(api: ApiClient): Promise<JeuneResume[]> {
  return tableau(await api.request('/api/jeunes'), 'des jeunes')
    .filter((l) => txt(l.id))
    .map((l) => ({
      id: txt(l.id),
      nom: txt(l.nom),
      prenom: txt(l.prenom),
      dateNaissance: dateCivileOuVide(l.dateNaissance),
      espaceId: txt(l.espaceId),
      secteur: txt(l.secteur),
    }));
}

export interface ActiviteResume {
  id: string;
  titre: string;
  espaceId: string;
  date: string;
  heureDebut: string;
  heureFin: string;
}

/** GET /api/activites */
export async function listerActivites(api: ApiClient): Promise<ActiviteResume[]> {
  return tableau(await api.request('/api/activites'), 'des activités')
    .filter((l) => txt(l.id))
    .map((l) => ({
      id: txt(l.id),
      titre: txt(l.titre),
      espaceId: txt(l.espaceId),
      date: dateCivileOuVide(l.date),
      heureDebut: txt(l.heureDebut),
      heureFin: txt(l.heureFin),
    }));
}

export interface ActualiteServeur {
  id: string;
  titre: string;
  contenu: string;
  date: string;
  categorie: string;
  auteur: string;
  epingle: boolean;
  espaceId: string | null;
}

function lireActualite(l: Record<string, unknown>): ActualiteServeur {
  return {
    id: txt(l.id),
    titre: txt(l.titre),
    contenu: txt(l.contenu),
    date: dateCivileOuVide(l.date),
    categorie: txt(l.categorie),
    auteur: txt(l.auteur),
    epingle: l.epingle === true,
    espaceId: txt(l.espaceId) || null,
  };
}

/** GET /api/actualites */
export async function listerActualites(api: ApiClient): Promise<ActualiteServeur[]> {
  return tableau(await api.request('/api/actualites'), 'des actualités')
    .filter((l) => txt(l.id))
    .map(lireActualite);
}

export interface NouvelleActualite {
  titre: string;
  contenu: string;
  categorie: string;
  espaceId: string | null;
  epingle: boolean;
  auteur: string;
}

/** POST /api/actualites — rôle admin exigé par le serveur (403 sinon). */
export async function publierActualite(api: ApiClient, actualite: NouvelleActualite): Promise<ActualiteServeur> {
  const corps = await api.request('/api/actualites', { method: 'POST', body: actualite });
  const cree = typeof corps === 'object' && corps !== null ? (corps as Record<string, unknown>).actualite : null;
  if (typeof cree !== 'object' || cree === null || !txt((cree as Record<string, unknown>).id)) {
    throw new ApiError('invalid_response', "Le serveur n'a pas confirmé la publication.");
  }
  return lireActualite(cree as Record<string, unknown>);
}

/** POST /api/messages-admin — message d'un animateur à l'administration. */
export async function envoyerMessageAdmin(
  api: ApiClient,
  message: { objet: string; message: string },
): Promise<void> {
  const corps = await api.request('/api/messages-admin', {
    method: 'POST',
    body: { objet: message.objet.trim(), message: message.message.trim() },
  });
  if (typeof corps !== 'object' || corps === null || (corps as Record<string, unknown>).success !== true) {
    throw new ApiError('invalid_response', "Le serveur n'a pas confirmé l'envoi du message.");
  }
}

// ─── Fiche détaillée d'un jeune ──────────────────────────────────────────────

/**
 * GET /api/jeunes/[id]/fiche — contacts familiaux, autorisations, observations.
 * Normalisation et règles de non-persistance : voir `lib/ficheJeune.ts`.
 */
export { chargerFicheJeune } from './ficheJeune';
export type { FicheJeune, ContactFiche, AutorisationsFiche } from './ficheJeune';

// ─── Pointages ───────────────────────────────────────────────────────────────

/** GET /api/pointages?date=&activiteId= */
export async function chargerPointages(
  api: ApiClient,
  filtre: { date?: string; activiteId?: string },
): Promise<PointageServeur[]> {
  return normaliserPointages(
    await api.request('/api/pointages', { query: { date: filtre.date, activiteId: filtre.activiteId } }),
  );
}

/** GET /api/presences?jeuneId= — historique de pointage d'un jeune. */
export async function historiqueJeune(api: ApiClient, jeuneId: string): Promise<PointageServeur[]> {
  return normaliserPointages(await api.request('/api/presences', { query: { jeuneId } }));
}

/** Arrivée (accueil libre ou activité) : enregistrée comme présence. */
export interface EntreeArrivee {
  jeuneId: string | null;
  espaceId: string;
  date: string;
  heureArrivee: string;
  heureSortie?: string;
  type: 'accueil-libre' | 'activite';
  activiteId: string | null;
  manuel: boolean;
  animateur: string;
  prenomManuel?: string;
  nomManuel?: string;
}

/** Statut de présence d'un jeune inscrit à une activité. */
export interface EntreeStatutActivite {
  jeuneId: string;
  activiteId: string;
  espaceId: string;
  date: string;
  statut: StatutPointage;
}

/** POST /api/pointages — lève une ApiError si le serveur ne confirme pas. */
export async function creerPointages(
  api: ApiClient,
  entrees: (EntreeArrivee | EntreeStatutActivite)[],
): Promise<void> {
  if (entrees.length === 0) return;
  await api.request('/api/pointages', { method: 'POST', body: entrees });
}

/**
 * DELETE /api/pointages?id=<id> — supprime exactement ce pointage.
 * Seul le paramètre `id` est envoyé : jamais jeuneId/date.
 * Rend false si le serveur indique que le pointage n'existait déjà plus.
 */
export async function supprimerPointage(api: ApiClient, id: string): Promise<boolean> {
  try {
    const corps = await api.request('/api/pointages', { method: 'DELETE', query: { id } });
    if (typeof corps === 'object' && corps !== null && (corps as Record<string, unknown>).deleted === 0) {
      return false;
    }
    return true;
  } catch (e) {
    if (estApiError(e) && e.kind === 'not_found') return false;
    throw e;
  }
}
