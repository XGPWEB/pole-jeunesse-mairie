/**
 * État d'une saisie à enregistrer sur le serveur (présences, message…).
 *
 * Module pur. Invariants :
 *  - une confirmation n'existe qu'après une réponse positive du serveur ;
 *  - en cas d'échec, le brouillon est rendu intact et l'erreur est portée par
 *    l'état pour être affichée.
 */
import { messageErreur } from './api';

export interface EtatSaisie<B> {
  brouillon: B;
  enCours: boolean;
  erreur: string | null;
  confirmation: string | null;
}

export function saisieInitiale<B>(brouillon: B): EtatSaisie<B> {
  return { brouillon, enCours: false, erreur: null, confirmation: null };
}

/** Toute modification invalide la confirmation et l'erreur précédentes. */
export function modifierBrouillon<B>(etat: EtatSaisie<B>, brouillon: B): EtatSaisie<B> {
  return { ...etat, brouillon, erreur: null, confirmation: null };
}

export function demarrerEnvoi<B>(etat: EtatSaisie<B>): EtatSaisie<B> {
  return { ...etat, enCours: true, erreur: null, confirmation: null };
}

export interface ResultatEnvoi<B> {
  /** Ce qui reste à enregistrer après l'opération (vide si tout est passé). */
  brouillonRestant: B;
  confirmation: string;
}

/**
 * Exécute l'enregistrement et rend l'état suivant. Ne lève jamais : un échec
 * devient `erreur`, brouillon inchangé, aucune confirmation.
 */
export async function executerEnvoi<B>(
  etat: EtatSaisie<B>,
  operation: (brouillon: B) => Promise<ResultatEnvoi<B>>,
): Promise<EtatSaisie<B>> {
  try {
    const resultat = await operation(etat.brouillon);
    return {
      brouillon: resultat.brouillonRestant,
      enCours: false,
      erreur: null,
      confirmation: resultat.confirmation,
    };
  } catch (e) {
    return { brouillon: etat.brouillon, enCours: false, erreur: messageErreur(e), confirmation: null };
  }
}

// ─── Chargement d'une ressource serveur ──────────────────────────────────────

export type ResultatChargement<T> =
  | { ok: true; data: T }
  | { ok: false; data: null; erreur: string };

/**
 * Charge une ressource. En cas d'échec (401, réseau, 5xx…), `data` vaut null :
 * il n'existe aucun jeu de données de repli.
 */
export async function chargerRessource<T>(charger: () => Promise<T>): Promise<ResultatChargement<T>> {
  try {
    return { ok: true, data: await charger() };
  } catch (e) {
    return { ok: false, data: null, erreur: messageErreur(e) };
  }
}
