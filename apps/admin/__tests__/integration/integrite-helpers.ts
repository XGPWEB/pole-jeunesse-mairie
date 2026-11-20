import { randomUUID } from 'crypto';
import { Client, type PoolClient } from 'pg';
import pool from '@/lib/db';

/**
 * Jeux de données des tests d'intégrité (audit du 2026-10-06).
 *
 * Complète helpers.ts (resetDb, seedTenant, seedAnimateur, cookieFor,
 * jsonRequest) sans le modifier. Chaque seed écrit directement en base et
 * renvoie l'identifiant créé.
 */

export async function seedEspace(tenantId = 'nogent', id = `esp-${randomUUID()}`): Promise<string> {
  await pool.query(
    `INSERT INTO espaces (id, nom, tenant_id) VALUES ($1, $2, $3)`,
    [id, `Espace ${id}`, tenantId],
  );
  return id;
}

export async function seedJeune(tenantId = 'nogent', espaceId: string | null = null): Promise<string> {
  const id = `j-${randomUUID()}`;
  await pool.query(
    `INSERT INTO jeunes (id, nom, prenom, espace_id, tenant_id) VALUES ($1, 'DURAND', 'Camille', $2, $3)`,
    [id, espaceId, tenantId],
  );
  return id;
}

export async function seedActivite(
  opts: { tenantId?: string; espaceId?: string | null; placesTotal?: number; titre?: string } = {},
): Promise<string> {
  const id = `act-${randomUUID()}`;
  const places = opts.placesTotal ?? 10;
  await pool.query(
    `INSERT INTO activites (id, titre, espace_id, date, heure_debut, heure_fin, places_total, places_disponibles, statut, tenant_id)
     VALUES ($1, $2, $3, '2026-11-04', '14:00', '16:00', $4, $4, 'ouvert', $5)`,
    [id, opts.titre ?? 'Atelier cuisine', opts.espaceId ?? null, places, opts.tenantId ?? 'nogent'],
  );
  return id;
}

export async function seedInscription(
  activiteId: string,
  jeuneId: string | null,
  opts: { tenantId?: string; statut?: string; dateInscription?: string } = {},
): Promise<string> {
  const id = `ins-${randomUUID()}`;
  await pool.query(
    `INSERT INTO inscriptions (id, jeune_id, jeune_nom, jeune_prenom, activite_id, statut, date_inscription, tenant_id)
     VALUES ($1, $2, 'DURAND', 'Camille', $3, $4, COALESCE($5::timestamptz, NOW()), $6)`,
    [id, jeuneId, activiteId, opts.statut ?? 'confirmee', opts.dateInscription ?? null, opts.tenantId ?? 'nogent'],
  );
  return id;
}

export async function seedPointage(activiteId: string, jeuneId: string, tenantId = 'nogent'): Promise<string> {
  const id = `ptg-${randomUUID()}`;
  await pool.query(
    `INSERT INTO pointages (id, jeune_id, date, type, activite_id, statut, tenant_id)
     VALUES ($1, $2, '2026-11-04', 'activite', $3, 'present', $4)`,
    [id, jeuneId, activiteId, tenantId],
  );
  return id;
}

export async function seedSortie(
  opts: { tenantId?: string; capacite?: number; animateurId?: string | null } = {},
): Promise<string> {
  const id = `sortie-${randomUUID()}`;
  await pool.query(
    `INSERT INTO sorties (id, titre, date, capacite, animateur_id, tenant_id)
     VALUES ($1, 'Sortie accrobranche', '2026-11-10', $2, $3, $4)`,
    [id, opts.capacite ?? 0, opts.animateurId ?? null, opts.tenantId ?? 'nogent'],
  );
  return id;
}

export async function seedParticipant(sortieId: string, jeuneId: string, enAttente = false): Promise<void> {
  await pool.query(
    `INSERT INTO sorties_participants (sortie_id, jeune_id, en_attente) VALUES ($1, $2, $3)`,
    [sortieId, jeuneId, enAttente],
  );
}

export async function seedRecup(
  animateurId: string,
  opts: {
    tenantId?: string; sens?: 'credit' | 'debit'; heures?: number;
    statut?: 'pending' | 'approved' | 'rejected'; date?: string; congeId?: string | null;
  } = {},
): Promise<string> {
  const id = `recup-${randomUUID()}`;
  await pool.query(
    `INSERT INTO demandes_recup (id, animateur_id, date, heures, sens, motif, statut, conge_id, tenant_id)
     VALUES ($1, $2, $3, $4, $5, 'Renfort soirée', $6, $7, $8)`,
    [
      id, animateurId, opts.date ?? '2026-10-20', opts.heures ?? 8, opts.sens ?? 'credit',
      opts.statut ?? 'approved', opts.congeId ?? null, opts.tenantId ?? 'nogent',
    ],
  );
  return id;
}

export async function seedConge(
  animateurId: string,
  opts: { tenantId?: string; dateDebut?: string; dateFin?: string; source?: 'admin' | 'recup'; type?: string } = {},
): Promise<string> {
  const id = `conge-${randomUUID()}`;
  await pool.query(
    `INSERT INTO conges (id, animateur_id, date_debut, date_fin, type, motif, source, tenant_id)
     VALUES ($1, $2, $3, $4, $5, 'Motif initial', $6, $7)`,
    [
      id, animateurId, opts.dateDebut ?? '2026-11-10', opts.dateFin ?? '2026-11-14',
      opts.type ?? 'conge', opts.source ?? 'admin', opts.tenantId ?? 'nogent',
    ],
  );
  return id;
}

export async function seedProjet(
  animateurId: string,
  opts: { tenantId?: string; titre?: string; budget?: { designation: string; cout: string }[] } = {},
): Promise<string> {
  const id = `proj-${randomUUID()}`;
  await pool.query(
    `INSERT INTO projets (id, titre, animateur_id, statut, lieu, tenant_id) VALUES ($1, $2, $3, 'brouillon', 'MJC', $4)`,
    [id, opts.titre ?? 'Séjour été', animateurId, opts.tenantId ?? 'nogent'],
  );
  for (const l of opts.budget ?? []) {
    await pool.query(
      `INSERT INTO projets_budget (projet_id, designation, cout) VALUES ($1, $2, $3)`,
      [id, l.designation, l.cout],
    );
  }
  return id;
}

/** Solde calculé directement en base, indépendamment du code testé. */
export async function soldeEnBase(animateurId: string): Promise<number> {
  const { rows } = await pool.query<{ solde: number }>(
    `SELECT COALESCE(SUM(CASE WHEN sens = 'credit' THEN heures ELSE -heures END), 0)::float AS solde
     FROM demandes_recup WHERE animateur_id = $1 AND statut = 'approved'`,
    [animateurId],
  );
  return rows[0].solde;
}

/**
 * Photographie complète d'une ou plusieurs tables (toutes colonnes, ordre
 * stable). Sert à prouver qu'une opération refusée n'a RIEN modifié : on
 * compare l'avant et l'après à l'identique, plutôt que de vérifier un champ.
 */
export async function photographier(...tables: string[]): Promise<Record<string, unknown[]>> {
  const photo: Record<string, unknown[]> = {};
  for (const table of tables) {
    const { rows } = await pool.query<{ ligne: unknown }>(
      `SELECT to_jsonb(t) AS ligne FROM "${table}" t ORDER BY to_jsonb(t)::text`,
    );
    photo[table] = rows.map(r => r.ligne);
  }
  return photo;
}

/**
 * Connexion PostgreSQL DÉDIÉE, hors du pool de l'application : un second
 * acteur réellement concurrent, que le test pilote pas à pas (BEGIN, verrou,
 * écriture, puis COMMIT au moment choisi).
 */
export async function connexionConcurrente(): Promise<Client> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

/**
 * Observe une promesse sans l'attendre. Permet d'affirmer qu'un handler est
 * BLOQUÉ (en attente d'un verrou tenu par l'autre connexion) avant de le
 * libérer : c'est ce qui rend ces tests de concurrence déterministes, au lieu
 * de dépendre d'un entrelacement chanceux.
 */
export function observer<T>(promesse: Promise<T>): { termine: () => boolean; promesse: Promise<T> } {
  let fini = false;
  const suivie = promesse.finally(() => { fini = true; });
  // L'erreur éventuelle est remontée à qui attend `promesse` ; ce catch évite
  // seulement un « unhandled rejection » pendant la phase d'observation.
  suivie.catch(() => {});
  return { termine: () => fini, promesse: suivie };
}

export function pause(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Attend que la connexion `pid` (ou n'importe quelle connexion du pool si
 * non précisé) soit en attente d'un verrou. Plus fiable qu'une temporisation
 * fixe pour affirmer « le handler est bloqué ».
 */
export async function attendreBlocage(observateur: Client, timeoutMs = 3000): Promise<boolean> {
  const debut = Date.now();
  while (Date.now() - debut < timeoutMs) {
    const { rows } = await observateur.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
    );
    if (rows[0].n > 0) return true;
    await pause(20);
  }
  return false;
}

/** Sépare `nom=valeur` (résultat de cookieFor) pour alimenter le mock de next/headers. */
export function decouperCookie(cookie: string): { nom: string; valeur: string } {
  const i = cookie.indexOf('=');
  return { nom: cookie.slice(0, i), valeur: cookie.slice(i + 1) };
}

/**
 * Rend au pool la connexion d'un acteur concurrent en garantissant qu'elle ne
 * garde AUCUNE transaction ouverte. Si une assertion échoue avant le COMMIT
 * du scénario, un simple `release()` remettrait au pool une connexion tenant
 * encore ses verrous : tous les tests suivants (et le TRUNCATE de resetDb)
 * resteraient bloqués derrière elle.
 */
export async function libererActeur(acteur: PoolClient): Promise<void> {
  try {
    await acteur.query('ROLLBACK');
  } finally {
    acteur.release();
  }
}
