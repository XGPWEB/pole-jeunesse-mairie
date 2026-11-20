import { describe, it, expect, afterEach, afterAll } from 'vitest';
import pool from '@/lib/db';
import { GET } from '@/app/api/health/route';

/**
 * /api/health annonce l'identité de la version installée. scripts/deploy-release.sh
 * s'en sert pour vérifier qu'une bascule a réellement eu lieu (revue du
 * 2026-10-07, R1) : sans cet identifiant, deux versions construites depuis le
 * même commit seraient indiscernables.
 */
describe('GET /api/health', () => {
  afterEach(() => { delete process.env.PJ_RELEASE_ID; });
  afterAll(async () => { await pool.end(); });

  it('annonce état, base, version, commit et l\'identifiant de release fixé par la configuration', async () => {
    process.env.PJ_RELEASE_ID = '2.1.8-abc1234-20261007-180000';
    const res = await GET();
    expect(res.status).toBe(200);
    const corps = await res.json();
    expect(corps).toMatchObject({ status: 'ok', db: 'ok', release: '2.1.8-abc1234-20261007-180000' });
    expect(typeof corps.version).toBe('string');
    expect(typeof corps.commit).toBe('string');
  });

  it('hors production (aucun identifiant configuré) : release vaut null, le reste est inchangé', async () => {
    const corps = await (await GET()).json();
    expect(corps).toMatchObject({ status: 'ok', db: 'ok', release: null });
    process.env.PJ_RELEASE_ID = '';
    expect((await (await GET()).json()).release).toBeNull();
  });

  it('n\'expose rien d\'autre : pas de variable d\'environnement, pas de chemin', async () => {
    process.env.PJ_RELEASE_ID = 'x';
    expect(Object.keys(await (await GET()).json()).sort()).toEqual(['commit', 'db', 'latency_ms', 'release', 'status', 'timestamp', 'version']);
  });
});
