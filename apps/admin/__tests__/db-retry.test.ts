import { vi, describe, it, expect, beforeEach } from 'vitest';

/**
 * Politique de relance de lib/db.ts (constat 28 de l'audit du 2026-10-06).
 *
 * Une erreur de connexion ne dit pas si PostgreSQL a exécuté la requête.
 * Rejouer une écriture peut donc l'appliquer DEUX fois (doublon de ligne de
 * budget) ou transformer un `DELETE ... RETURNING` réussi en faux « introuvable ».
 * Ces tests verrouillent : une lecture établie est rejouée une fois, une
 * écriture jamais — quelle que soit sa forme syntaxique.
 */
type Resultat = { rows: Record<string, unknown>[] };
const { poolQuery } = vi.hoisted(() => ({
  poolQuery: vi.fn<(sql: string, params?: unknown[]) => Promise<Resultat>>(),
}));

vi.mock('pg', () => ({
  Pool: class {
    query = poolQuery;
    on() { return this; }
  },
}));

import { query, queryOne, isReadOnlyStatement, isTransientConnectionError } from '@/lib/db';

/** Erreur telle que node-postgres la produit quand la connexion tombe. */
function coupure(code = 'ECONNRESET'): Error {
  return Object.assign(new Error('Connection terminated unexpectedly'), { code });
}

beforeEach(() => {
  poolQuery.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('relance automatique — lectures', () => {
  it('rejoue UNE fois une lecture après une coupure, et renvoie le résultat du second essai', async () => {
    poolQuery.mockRejectedValueOnce(coupure()).mockResolvedValueOnce({ rows: [{ id: 'a' }] });

    const rows = await query('SELECT id FROM jeunes WHERE tenant_id = $1', ['nogent']);

    expect(rows).toEqual([{ id: 'a' }]);
    expect(poolQuery).toHaveBeenCalledTimes(2);
    expect(poolQuery.mock.calls[1]).toEqual(poolQuery.mock.calls[0]);
  });

  it("ne tente pas un troisième essai si la relance échoue aussi", async () => {
    poolQuery.mockRejectedValue(coupure('EPIPE'));

    await expect(queryOne('SELECT 1')).rejects.toThrow('Connection terminated');
    expect(poolQuery).toHaveBeenCalledTimes(2);
  });

  it("ne rejoue pas une lecture sur une erreur SQL (ce n'est pas une coupure)", async () => {
    poolQuery.mockRejectedValue(Object.assign(new Error('column "x" does not exist'), { code: '42703' }));

    await expect(query('SELECT x FROM jeunes')).rejects.toThrow('does not exist');
    expect(poolQuery).toHaveBeenCalledTimes(1);
  });

  it("respecte { retry: 'never' } même pour une lecture", async () => {
    poolQuery.mockRejectedValue(coupure());

    await expect(query('SELECT 1', [], { retry: 'never' })).rejects.toThrow();
    expect(poolQuery).toHaveBeenCalledTimes(1);
  });
});

describe('relance automatique — écritures', () => {
  // Chaque forme ci-dessous est une écriture (ou a un effet de bord) : elle
  // doit être envoyée UNE fois, l'erreur de connexion remontant à l'appelant.
  const ECRITURES: [string, string][] = [
    ['INSERT simple (ligne de budget à id automatique)',
      'INSERT INTO projets_budget (projet_id, designation, cout) VALUES ($1, $2, $3)'],
    ['UPDATE', 'UPDATE conges SET motif = $2 WHERE id = $1'],
    ['DELETE ... RETURNING', 'DELETE FROM demandes_recup WHERE id = $1 RETURNING id'],
    ['requête multi-lignes indentée commençant par INSERT',
      '\n      INSERT INTO notifications (id, titre) VALUES ($1, $2)\n    '],
    ['CTE modifiante qui « ressemble » à une lecture',
      'WITH supprimes AS (DELETE FROM inscriptions WHERE id = $1 RETURNING *) SELECT * FROM supprimes'],
    ['WITH ... INSERT', 'WITH s AS (SELECT 1 AS n) INSERT INTO login_attempts (ip, reset_at) SELECT $1, NOW() FROM s'],
    ['SELECT ... FOR UPDATE (pose un verrou)', 'SELECT id FROM activites WHERE id = $1 FOR UPDATE'],
    ['SELECT ... FOR NO KEY UPDATE', 'SELECT id FROM activites WHERE id = $1 FOR NO KEY UPDATE'],
    ['SELECT ... FOR SHARE', 'SELECT id FROM activites WHERE id = $1 FOR SHARE'],
    ['SELECT ... FOR KEY SHARE', 'SELECT id FROM activites WHERE id = $1 FOR KEY SHARE'],
    ['fonction à effet de bord : nextval', "SELECT nextval('sorties_participants_ordre_seq')"],
    ['fonction à effet de bord : setval', "SELECT setval('sorties_participants_ordre_seq', 1)"],
    ['fonction à effet de bord : verrou consultatif', 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))'],
    ['fonction à effet de bord : pg_try_advisory_lock', 'SELECT pg_try_advisory_lock(42)'],
    ['fonction à effet de bord : pg_notify', "SELECT pg_notify('canal', 'x')"],
    ['fonction à effet de bord : set_config', "SELECT set_config('app.tenant', $1, false)"],
    ['SELECT ... INTO (crée une table)', 'SELECT * INTO copie FROM jeunes'],
    ['instructions multiples', 'SELECT 1; DELETE FROM jeunes'],
    ['commentaire en tête (non reconnu : on ne prend pas le risque)', '-- lecture\nSELECT 1'],
    ['TRUNCATE', 'TRUNCATE TABLE login_attempts'],
  ];

  it.each(ECRITURES)('ne rejoue pas : %s', async (_nom, sql) => {
    poolQuery.mockRejectedValue(coupure());

    await expect(queryOne(sql, ['x'])).rejects.toThrow('Connection terminated');
    expect(poolQuery).toHaveBeenCalledTimes(1);
  });

  it.each(ECRITURES)('isReadOnlyStatement est faux pour : %s', (_nom, sql) => {
    expect(isReadOnlyStatement(sql)).toBe(false);
  });

  it("rejoue une écriture uniquement sur opt-in explicite { retry: 'idempotent' }", async () => {
    poolQuery.mockRejectedValueOnce(coupure()).mockResolvedValueOnce({ rows: [] });

    await query('UPDATE animateurs SET last_login = $2 WHERE id = $1', ['a', 'x'], { retry: 'idempotent' });
    expect(poolQuery).toHaveBeenCalledTimes(2);
  });

  it('une écriture réussie du premier coup n’est évidemment envoyée qu’une fois', async () => {
    poolQuery.mockResolvedValue({ rows: [{ id: 'n' }] });

    expect(await queryOne('INSERT INTO t (id) VALUES ($1) RETURNING id', ['n'])).toEqual({ id: 'n' });
    expect(poolQuery).toHaveBeenCalledTimes(1);
  });
});

describe('isReadOnlyStatement — lectures reconnues', () => {
  it.each([
    'SELECT id FROM jeunes WHERE tenant_id = $1',
    '\n    SELECT c.id, c.date_debut::text AS "dateDebut"\n    FROM conges c JOIN animateurs a ON a.id = c.animateur_id\n  ',
    'select count(*) from inscriptions',
    'WITH r AS (SELECT id FROM activites) SELECT * FROM r',
    // Noms de colonnes qui CONTIENNENT un mot interdit sans en être un.
    'SELECT updated_at AS "updatedAt", created_at, date_inscription, offset_min FROM sorties',
    'SELECT session_invalidated_at FROM animateurs WHERE id = $1 AND statut = $2',
    'SELECT 1;',
  ])('reconnaît %s', (sql) => {
    expect(isReadOnlyStatement(sql)).toBe(true);
  });
});

describe('isTransientConnectionError', () => {
  it('reconnaît les coupures réseau, pas les erreurs SQL', () => {
    expect(isTransientConnectionError(coupure('ECONNRESET'))).toBe(true);
    expect(isTransientConnectionError(coupure('ETIMEDOUT'))).toBe(true);
    expect(isTransientConnectionError(new Error('Connection terminated'))).toBe(true);
    expect(isTransientConnectionError(Object.assign(new Error('duplicate key'), { code: '23505' }))).toBe(false);
    expect(isTransientConnectionError(null)).toBe(false);
  });
});
