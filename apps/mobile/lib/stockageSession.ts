/**
 * Stockage de la session animateur (dépend de React Native / Expo).
 *
 * - iOS / Android : expo-secure-store (Keychain / Keystore). Le jeton n'est
 *   jamais écrit dans AsyncStorage.
 * - Web : SecureStore n'existe pas. Repli explicite : la session n'est gardée
 *   qu'en mémoire, donc perdue au rechargement de la page. C'est voulu : un
 *   jeton dans localStorage/sessionStorage serait lisible par tout script de
 *   la page. La cible web sert au développement, pas à l'exploitation.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { StockageSession } from './session';

const CLE = 'pj_session';

function stockageSecurise(): StockageSession {
  const options: SecureStore.SecureStoreOptions = {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
  return {
    lire: () => SecureStore.getItemAsync(CLE, options),
    ecrire: (valeur) => SecureStore.setItemAsync(CLE, valeur, options),
    effacer: () => SecureStore.deleteItemAsync(CLE, options),
  };
}

function stockageMemoire(): StockageSession {
  let valeur: string | null = null;
  return {
    lire: async () => valeur,
    ecrire: async (v) => {
      valeur = v;
    },
    effacer: async () => {
      valeur = null;
    },
  };
}

export const SESSION_PERSISTANTE = Platform.OS !== 'web';

export function creerStockageSession(): StockageSession {
  return SESSION_PERSISTANTE ? stockageSecurise() : stockageMemoire();
}
