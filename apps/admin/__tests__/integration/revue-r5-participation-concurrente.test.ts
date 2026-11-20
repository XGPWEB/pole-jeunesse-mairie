import { vi, describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import type { Client } from 'pg';

// Next 16 : cookies() est asynchrone. La garde réelle de @/lib/auth s'exécute.
const session = vi.hoisted(() => ({ nom: '', valeur: '' }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nom: string) => (nom === session.nom && session.valeur ? { name: nom, value: session.valeur } : undefined),
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import pool from '@/lib/db';
import { supprimerJeune } from '@/app/jeunes/actions';
import { POST as POST_PARTICIPANT } from '@/app/api/sorties/participants/route';
import { resetDb, seedAnimateur, cookieFor, jsonRequest } from './helpers';
import {
  seedEspace, seedJeune, seedActivite, seedInscription, seedSortie, seedParticipant,
  connexionConcurrente, observer, decouperCookie,
} from './integrite-helpers';

/**
 * Revue du 2026-10-06, R5 — fenêtre de concurrence entre l'AJOUT d'un jeune à
 * une sortie et la SUPPRESSION de ce même jeune.
 *
 * L'ajout vérifiait l'existence du jeune avant sa transaction ; la table
 * sorties_participants n'ayant pas de clé étrangère vers jeunes, une
 * suppression intercalée laissait une participation vers un jeune disparu.
 *
 * Tests DÉTERMINISTES : une troisième connexion (« régisseur ») tient un
 * verrou de ligne qui immobilise l'un des deux acteurs à un point connu ; on
 * CONSTATE dans pg_stat_activity que cet acteur attend ce verrou précis avant
 * de laisser l'autre agir, puis on relâche. Aucune temporisation ne décide de
 * l'entrelacement : seule l'attente de la CONDITION est bornée (échec net si
 * elle n'arrive jamais).
 */
type Session = Awaited<ReturnType<typeof seedAnimateur>>;

let animateur: Session;
let cookie: string;
let regisseur: Client;
let observateur: Client;

const ajouter = (sortieId: string, jeuneId: string) =>
  POST_PARTICIPANT(jsonRequest('http://localhost/api/sorties/participants', {
    method: 'POST', cookie, body: { sortieId, jeuneId },
  }));

const participants = async (sortieId: string) =>
  (await pool.query<{ jeune_id: string; en_attente: boolean }>(
    'SELECT jeune_id, en_attente FROM sorties_participants WHERE sortie_id = $1 ORDER BY ordre', [sortieId],
  )).rows;

const orphelines = async () =>
  (await pool.query(
    `SELECT sp.sortie_id, sp.jeune_id FROM sorties_participants sp
      WHERE NOT EXISTS (SELECT 1 FROM jeunes j WHERE j.id = sp.jeune_id)`,
  )).rows;

/**
 * Attend qu'une connexion de l'application soit bloquée sur un verrou de
 * LIGNE de la table donnée, tenu par le régisseur. Condition explicite lue
 * dans le catalogue ; renvoie false si elle n'est pas atteinte.
 */
async function attendreBlocageSur(table: 'sorties' | 'activites', pidBloquant: number, timeoutMs = 5000): Promise<boolean> {
  const debut = Date.now();
  while (Date.now() - debut < timeoutMs) {
    const { rows } = await observateur.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM pg_stat_activity a
        WHERE a.datname = current_database()
          AND a.wait_event_type = 'Lock'
          AND $1 = ANY (pg_blocking_pids(a.pid))
          AND a.query ~* ('from\\s+' || $2 || '\\M[\\s\\S]*for\\s+update')`,
      [pidBloquant, table],
    );
    if (rows[0].n > 0) return true;
    await new Promise(resolve => setImmediate(resolve));
  }
  return false;
}

async function pidDe(client: Client): Promise<number> {
  return (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
}

beforeAll(async () => {
  regisseur = await connexionConcurrente();
  observateur = await connexionConcurrente();
});

afterAll(async () => {
  await regisseur.end();
  await observateur.end();
  await pool.end();
});

beforeEach(async () => {
  await resetDb();
  animateur = await seedAnimateur({ tenantId: 'commune-a', role: 'admin' });
  cookie = await cookieFor(animateur);
  const { nom, valeur } = decouperCookie(cookie);
  session.nom = nom; session.valeur = valeur;
});

afterEach(async () => {
  // Un test en échec ne doit pas laisser le régisseur en transaction.
  await regisseur.query('ROLLBACK').catch(() => {});
});

describe('R5 — ajout à une sortie et suppression du même jeune, en concurrence', () => {
  it('suppression validée AVANT l\'ajout : ajout refusé (404), aucune participation orpheline', async () => {
    const espace = await seedEspace('commune-a');
    const jeune = await seedJeune('commune-a', espace);
    const sortie = await seedSortie({ tenantId: 'commune-a', capacite: 5 });

    // Le régisseur tient la sortie : l'ajout s'immobilise sur ce verrou.
    await regisseur.query('BEGIN');
    await regisseur.query('SELECT 1 FROM sorties WHERE id = $1 FOR UPDATE', [sortie]);

    const ajout = observer(ajouter(sortie, jeune));
    expect(await attendreBlocageSur('sorties', await pidDe(regisseur))).toBe(true);
    expect(ajout.termine()).toBe(false);

    // Pendant que l'ajout attend, le jeune est supprimé et la suppression VALIDÉE.
    expect(await supprimerJeune(jeune)).toEqual({ success: true });
    expect((await pool.query('SELECT 1 FROM jeunes WHERE id = $1', [jeune])).rowCount).toBe(0);
    expect(ajout.termine()).toBe(false);

    // On libère l'ajout : il doit constater la disparition et ne rien insérer.
    await regisseur.query('COMMIT');
    const res = await ajout.promesse;
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Jeune introuvable' });

    expect(await participants(sortie)).toEqual([]);
    expect(await orphelines()).toEqual([]);
  });

  it('ajout validé AVANT la suppression : retrait pris en compte, premier en attente promu, capacité respectée', async () => {
    const espace = await seedEspace('commune-a');
    const jeune = await seedJeune('commune-a', espace);
    const suivant = await seedJeune('commune-a', espace);
    const sortie = await seedSortie({ tenantId: 'commune-a', capacite: 1 });
    // Le jeune est inscrit à une activité : la suppression commence par
    // verrouiller cette activité, APRÈS avoir lu la liste de ses sorties
    // (vide à cet instant).
    const activite = await seedActivite({ tenantId: 'commune-a', espaceId: espace, placesTotal: 5 });
    await seedInscription(activite, jeune, { tenantId: 'commune-a' });

    await regisseur.query('BEGIN');
    await regisseur.query('SELECT 1 FROM activites WHERE id = $1 FOR UPDATE', [activite]);

    const suppression = observer(supprimerJeune(jeune));
    expect(await attendreBlocageSur('activites', await pidDe(regisseur))).toBe(true);
    expect(suppression.termine()).toBe(false);

    // Pendant que la suppression attend : le jeune est ajouté à la sortie
    // (confirmé, il prend l'unique place), puis un second jeune (en attente).
    // Les deux ajouts sont VALIDÉS avant que la suppression ne reprenne.
    const ajoutJeune = await ajouter(sortie, jeune);
    expect(await ajoutJeune.json()).toMatchObject({ success: true, statut: 'confirmee' });
    const ajoutSuivant = await ajouter(sortie, suivant);
    expect(await ajoutSuivant.json()).toMatchObject({ success: true, statut: 'liste-attente' });
    expect(await participants(sortie)).toEqual([
      { jeune_id: jeune, en_attente: false },
      { jeune_id: suivant, en_attente: true },
    ]);
    expect(suppression.termine()).toBe(false);

    await regisseur.query('COMMIT');
    expect(await suppression.promesse).toEqual({ success: true });

    // La participation ajoutée entre-temps a été retirée AVEC promotion.
    expect((await pool.query('SELECT 1 FROM jeunes WHERE id = $1', [jeune])).rowCount).toBe(0);
    expect(await participants(sortie)).toEqual([{ jeune_id: suivant, en_attente: false }]);
    expect(await orphelines()).toEqual([]);
    const { rows } = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM sorties_participants WHERE sortie_id = $1 AND NOT en_attente`, [sortie],
    );
    expect(rows[0].n).toBeLessThanOrEqual(1);
  });

  it('ajout en cours (non validé) pendant la suppression : la suppression attend, puis retire la participation', async () => {
    const espace = await seedEspace('commune-a');
    const jeune = await seedJeune('commune-a', espace);
    const sortie = await seedSortie({ tenantId: 'commune-a', capacite: 3 });

    // Le régisseur joue un ajout EN COURS : mêmes verrous que la route
    // (sortie puis jeune), participation insérée mais non validée.
    await regisseur.query('BEGIN');
    await regisseur.query('SELECT 1 FROM sorties WHERE id = $1 FOR UPDATE', [sortie]);
    await regisseur.query('SELECT 1 FROM jeunes WHERE id = $1 FOR KEY SHARE', [jeune]);
    await regisseur.query('INSERT INTO sorties_participants (sortie_id, jeune_id, en_attente) VALUES ($1, $2, FALSE)', [sortie, jeune]);

    const suppression = observer(supprimerJeune(jeune));
    // La suppression ne peut pas passer : la fiche est tenue par l'ajout.
    const debut = Date.now();
    let bloquee = false;
    const pid = await pidDe(regisseur);
    while (!bloquee && Date.now() - debut < 5000) {
      const { rows } = await observateur.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM pg_stat_activity a
          WHERE a.datname = current_database() AND a.wait_event_type = 'Lock' AND $1 = ANY (pg_blocking_pids(a.pid))`,
        [pid],
      );
      bloquee = rows[0].n > 0;
      if (!bloquee) await new Promise(resolve => setImmediate(resolve));
    }
    expect(bloquee).toBe(true);
    expect(suppression.termine()).toBe(false);

    await regisseur.query('COMMIT');
    expect(await suppression.promesse).toEqual({ success: true });
    expect(await participants(sortie)).toEqual([]);
    expect(await orphelines()).toEqual([]);
  });

  it('jeune d\'une autre commune : refus 404 dans la transaction, rien d\'inséré', async () => {
    const espaceB = await seedEspace('commune-b');
    const jeuneB = await seedJeune('commune-b', espaceB);
    const sortie = await seedSortie({ tenantId: 'commune-a', capacite: 5 });
    const res = await ajouter(sortie, jeuneB);
    expect(res.status).toBe(404);
    expect(await participants(sortie)).toEqual([]);
  });
});

describe('R5 — la base refuse une participation sans jeune (clé étrangère)', () => {
  it('INSERT direct vers un jeune inexistant : violation de clé étrangère (23503)', async () => {
    const sortie = await seedSortie({ tenantId: 'commune-a', capacite: 5 });
    await expect(
      pool.query('INSERT INTO sorties_participants (sortie_id, jeune_id, en_attente) VALUES ($1, $2, FALSE)', [sortie, 'jeune-inexistant']),
    ).rejects.toMatchObject({ code: '23503', constraint: 'fk_sorties_participants_jeune' });
    expect(await participants(sortie)).toEqual([]);
  });

  it('DELETE direct d\'un jeune qui participe encore : refusé (RESTRICT), pas de suppression silencieuse sans promotion', async () => {
    const espace = await seedEspace('commune-a');
    const jeune = await seedJeune('commune-a', espace);
    const sortie = await seedSortie({ tenantId: 'commune-a', capacite: 5 });
    await seedParticipant(sortie, jeune, false);

    await expect(pool.query('DELETE FROM jeunes WHERE id = $1', [jeune]))
      .rejects.toMatchObject({ code: '23503', constraint: 'fk_sorties_participants_jeune' });
    expect(await participants(sortie)).toEqual([{ jeune_id: jeune, en_attente: false }]);
    expect((await pool.query('SELECT 1 FROM jeunes WHERE id = $1', [jeune])).rowCount).toBe(1);
  });
});
