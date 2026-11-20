/**
 * Instances uniques de l'application : gestionnaire de session et client API.
 * Tous les écrans passent par `api` — aucun `fetch` direct vers le backend.
 */
import { API_URL_CONFIGUREE } from '@/constants/api';
import { creerApiClient, resoudreBaseUrl } from './api';
import { GestionnaireSession } from './session';
import { creerStockageSession } from './stockageSession';

export const baseApi = resoudreBaseUrl(API_URL_CONFIGUREE, !__DEV__);

export const session = new GestionnaireSession(creerStockageSession());

export const api = creerApiClient({
  base: baseApi,
  fetchImpl: (url, init) => fetch(url, init),
  getToken: () => session.jetonCourant(),
  // 401 : purge immédiate. L'AuthProvider, abonné au gestionnaire, repasse en
  // « non connecté » et l'écran de connexion affiche le message d'expiration.
  onUnauthorized: () => session.fermer('expiree'),
});
