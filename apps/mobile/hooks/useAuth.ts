import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { estApiError, messageErreur } from '@/lib/api';
import { api, session } from '@/lib/client';
import { connecter, deconnecterServeur, validerSession } from '@/lib/services';
import { Session } from '@/lib/session';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnimateurUser {
  id: string;
  username: string;
  nom: string;
  prenom: string;
  role: string;
  /** Espace assigné tel que renvoyé par le serveur (libellé ou identifiant). */
  espace: string;
  tenantId: string;
}

/**
 * - chargement  : restauration de la session en cours au démarrage ;
 * - connecte    : session validée par le serveur ;
 * - deconnecte  : aucune session ;
 * - non-verifie : une session est stockée mais le serveur n'a pas pu la
 *                 confirmer (réseau) — l'accès reste fermé jusqu'à vérification.
 */
export type StatutAuth = 'chargement' | 'connecte' | 'deconnecte' | 'non-verifie';

export type ResultatLogin =
  | { success: true }
  | { success: false; error: string; totpRequis: boolean };

interface AuthContextValue {
  statut: StatutAuth;
  isAuthenticated: boolean;
  animateur: AnimateurUser | null;
  /** Message à afficher sur l'écran de connexion (session expirée, réseau…). */
  messageSession: string | null;
  login(username: string, password: string, totpCode?: string): Promise<ResultatLogin>;
  logout(): Promise<void>;
  reessayerRestauration(): Promise<void>;
  effacerMessageSession(): void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Ancienne session locale (sans jeton serveur) : supprimée au démarrage. */
const ANCIENNE_CLE_SESSION = '@pj_auth_session';

const MESSAGE_EXPIREE = 'Votre session a expiré. Veuillez vous reconnecter.';

function versAnimateur(s: Session): AnimateurUser {
  return {
    id: s.user.id,
    username: s.user.username,
    nom: s.user.nom,
    prenom: s.user.prenom,
    role: s.user.role,
    espace: s.user.espaceAssigne,
    tenantId: s.user.tenantId,
  };
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [statut, setStatut] = useState<StatutAuth>('chargement');
  const [animateur, setAnimateur] = useState<AnimateurUser | null>(null);
  const [messageSession, setMessageSession] = useState<string | null>(null);

  // Source de vérité : le gestionnaire de session. Une purge déclenchée par un
  // 401 n'importe où dans l'application arrive ici.
  useEffect(() => {
    return session.abonner((courante, motif) => {
      if (courante) {
        setAnimateur(versAnimateur(courante));
        setStatut('connecte');
        setMessageSession(null);
      } else {
        setAnimateur(null);
        setStatut('deconnecte');
        setMessageSession(motif === 'expiree' ? MESSAGE_EXPIREE : null);
      }
    });
  }, []);

  const restaurer = useCallback(async () => {
    setStatut('chargement');
    const stockee = await session.restaurer();
    if (!stockee) {
      setAnimateur(null);
      setStatut('deconnecte');
      return;
    }
    try {
      const profil = await validerSession(api);
      // Les attributs confirmés par le serveur (rôle, espace…) remplacent ceux
      // mémorisés à la connexion : une rétrogradation est prise en compte.
      // La notification du gestionnaire fait passer l'état à « connecte ».
      const { id: _id, ...attributs } = profil;
      await session.mettreAJourUtilisateur(attributs);
    } catch (e) {
      // 401 : la session a déjà été purgée par le client API (abonnement ci-dessus).
      if (estApiError(e) && e.kind === 'unauthorized') return;
      setAnimateur(null);
      setStatut('non-verifie');
      setMessageSession(`Impossible de vérifier votre session. ${messageErreur(e)}`);
    }
  }, []);

  useEffect(() => {
    AsyncStorage.removeItem(ANCIENNE_CLE_SESSION).catch(() => undefined);
    restaurer();
  }, [restaurer]);

  const login = useCallback(
    async (username: string, password: string, totpCode?: string): Promise<ResultatLogin> => {
      try {
        const ouverte = await connecter(api, { username, password, totpCode });
        await session.ouvrir(ouverte);
        return { success: true };
      } catch (e) {
        const code = estApiError(e) ? e.code : null;
        if (code === 'TOTP_REQUIRED') {
          return {
            success: false,
            totpRequis: true,
            error: "Saisissez le code à 6 chiffres de votre application d'authentification.",
          };
        }
        if (code === 'TOTP_INVALID') {
          return { success: false, totpRequis: true, error: 'Code de vérification incorrect ou expiré.' };
        }
        if (code === 'INVALID_CREDENTIALS') {
          return { success: false, totpRequis: false, error: 'Identifiant ou mot de passe incorrect.' };
        }
        return { success: false, totpRequis: false, error: messageErreur(e) };
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    // Révocation serveur d'abord (elle a besoin du jeton), purge locale dans
    // tous les cas : la déconnexion locale ne dépend pas du réseau.
    try {
      if (session.jetonCourant()) await deconnecterServeur(api);
    } catch {
      // Purge locale ci-dessous ; un 401 a déjà purgé la session.
    }
    await session.fermer('deconnexion');
  }, []);

  const effacerMessageSession = useCallback(() => setMessageSession(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      statut,
      isAuthenticated: statut === 'connecte',
      animateur,
      messageSession,
      login,
      logout,
      reessayerRestauration: restaurer,
      effacerMessageSession,
    }),
    [statut, animateur, messageSession, login, logout, restaurer, effacerMessageSession],
  );

  return React.createElement(AuthContext.Provider, { value }, children);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
