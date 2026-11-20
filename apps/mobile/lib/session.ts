/**
 * Session animateur : modèle, validation et cycle de vie.
 *
 * Module pur : le stockage est injecté (SecureStore sur natif, mémoire sur web,
 * voir `lib/client.ts`). Le jeton n'est jamais écrit ailleurs que dans ce
 * stockage, et jamais journalisé.
 */
import { ApiError } from './api';

export interface UtilisateurSession {
  id: string;
  username: string;
  nom: string;
  prenom: string;
  role: string;
  espaceAssigne: string;
  tenantId: string;
}

export interface Session {
  token: string;
  /** Horodatage ISO d'expiration fourni par le serveur. */
  expiresAt: string;
  user: UtilisateurSession;
}

export interface StockageSession {
  lire(): Promise<string | null>;
  ecrire(valeur: string): Promise<void>;
  effacer(): Promise<void>;
}

/** Pourquoi la session a pris fin — sert au message affiché à la connexion. */
export type MotifFinSession = 'deconnexion' | 'expiree';

export type EcouteurSession = (session: Session | null, motif: MotifFinSession | null) => void;

function texte(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function lireUtilisateur(brut: unknown): UtilisateurSession | null {
  if (typeof brut !== 'object' || brut === null) return null;
  const u = brut as Record<string, unknown>;
  const id = texte(u.id);
  const username = texte(u.username);
  const role = texte(u.role);
  const tenantId = texte(u.tenantId);
  if (!id || !username || !role || !tenantId) return null;
  return {
    id,
    username,
    role,
    tenantId,
    nom: typeof u.nom === 'string' ? u.nom : '',
    prenom: typeof u.prenom === 'string' ? u.prenom : '',
    espaceAssigne: typeof u.espaceAssigne === 'string' ? u.espaceAssigne : '',
  };
}

function lireSession(brut: unknown): Session | null {
  if (typeof brut !== 'object' || brut === null) return null;
  const s = brut as Record<string, unknown>;
  const token = texte(s.token);
  const expiresAt = texte(s.expiresAt);
  const user = lireUtilisateur(s.user);
  if (!token || !expiresAt || !user) return null;
  if (Number.isNaN(new Date(expiresAt).getTime())) return null;
  return { token, expiresAt, user };
}

/** Valide la réponse 200 de POST /api/auth/mobile/login. */
export function analyserReponseLogin(corps: unknown): Session {
  const session = lireSession(corps);
  if (!session) {
    throw new ApiError('invalid_response', 'Réponse de connexion inattendue du serveur.');
  }
  return session;
}

export function sessionExpiree(session: Session, maintenant: Date = new Date()): boolean {
  return new Date(session.expiresAt).getTime() <= maintenant.getTime();
}

export class GestionnaireSession {
  private courante: Session | null = null;
  private readonly ecouteurs = new Set<EcouteurSession>();

  constructor(private readonly stockage: StockageSession) {}

  jetonCourant(): string | null {
    return this.courante?.token ?? null;
  }

  sessionCourante(): Session | null {
    return this.courante;
  }

  abonner(ecouteur: EcouteurSession): () => void {
    this.ecouteurs.add(ecouteur);
    return () => {
      this.ecouteurs.delete(ecouteur);
    };
  }

  private notifier(motif: MotifFinSession | null): void {
    for (const ecouteur of this.ecouteurs) ecouteur(this.courante, motif);
  }

  /**
   * Relit la session stockée. Une session illisible ou expirée localement est
   * purgée. La validité côté serveur reste à vérifier par l'appelant.
   */
  async restaurer(maintenant: Date = new Date()): Promise<Session | null> {
    let brut: string | null = null;
    try {
      brut = await this.stockage.lire();
    } catch {
      brut = null;
    }
    if (!brut) {
      this.courante = null;
      return null;
    }
    let session: Session | null = null;
    try {
      session = lireSession(JSON.parse(brut));
    } catch {
      session = null;
    }
    if (!session || sessionExpiree(session, maintenant)) {
      await this.fermer(session ? 'expiree' : null);
      return null;
    }
    this.courante = session;
    return session;
  }

  async ouvrir(session: Session): Promise<void> {
    await this.stockage.ecrire(JSON.stringify(session));
    this.courante = session;
    this.notifier(null);
  }

  /** Met à jour les attributs utilisateur confirmés par le serveur. */
  async mettreAJourUtilisateur(partiel: Partial<UtilisateurSession>): Promise<void> {
    if (!this.courante) return;
    const suivante: Session = { ...this.courante, user: { ...this.courante.user, ...partiel } };
    await this.stockage.ecrire(JSON.stringify(suivante));
    this.courante = suivante;
    this.notifier(null);
  }

  /** Purge mémoire + stockage. La purge mémoire a lieu même si le stockage échoue. */
  async fermer(motif: MotifFinSession | null): Promise<void> {
    const avait = this.courante !== null;
    this.courante = null;
    try {
      await this.stockage.effacer();
    } catch {
      // Le jeton en mémoire est déjà oublié ; rien de plus à faire ici.
    }
    if (avait || motif) this.notifier(motif);
  }
}
