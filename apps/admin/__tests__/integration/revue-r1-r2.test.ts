import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';

/**
 * Contre-tests de la revue du 2026-10-06 (REVUE-CLAUDE-2026-10-06.md) :
 *  R1 — lien de reset d'un admin sans adresse envoyé à MAIL_ADMIN (global) ;
 *  R2 — deux remplacements de pointage simultanés laissant deux lignes.
 */
const courriel = vi.hoisted(() => ({ envois: [] as { email: string; lien: string }[] }));
vi.mock('@/app/animateurs/emailService', () => ({
  envoyerLienReinitialisation: vi.fn(async (data: { email: string; lien: string }) => {
    courriel.envois.push(data);
    return { success: true };
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import pool from '@/lib/db';
import { POST as forgot } from '@/app/api/auth/forgot-password/route';
import { POST as postPointages } from '@/app/api/pointages/route';
import { GET as notifGet } from '@/app/api/notifications/route';
import { resetDb, cookieFor, jsonRequest } from './helpers';
import { seedCompte, seedEspace, seedJeune, seedActivite, etatCompte } from './securite-helpers';
import { connexionConcurrente, observer, attendreBlocage } from './integrite-helpers';

afterAll(async () => { await pool.end(); });

let compteurIp = 0;
const demander = (username: string) =>
  forgot(jsonRequest('http://localhost/api/auth/forgot-password', {
    method: 'POST', headers: { 'x-real-ip': `198.51.100.${++compteurIp}` }, body: { username },
  }));

describe('R1 — reset d\'un compte admin sans adresse', () => {
  const MAIL_ADMIN_AVANT = process.env.MAIL_ADMIN;
  beforeEach(async () => {
    await resetDb();
    courriel.envois.length = 0;
    // Adresse globale de l'instance, tenue par une AUTRE commune que le compte visé.
    process.env.MAIL_ADMIN = 'admin-nogent@example.test';
  });
  afterEach(() => {
    if (MAIL_ADMIN_AVANT === undefined) delete process.env.MAIL_ADMIN;
    else process.env.MAIL_ADMIN = MAIL_ADMIN_AVANT;
  });

  it('aucun lien n\'est émis vers MAIL_ADMIN ; la demande arrive aux seuls admins de la commune du compte', async () => {
    const adminNogent = await seedCompte({ role: 'admin', tenantId: 'nogent', email: 'admin-nogent@example.test' });
    const cible = await seedCompte({ role: 'admin', tenantId: 'autre-commune', email: '' });
    const collegue = await seedCompte({ role: 'admin', tenantId: 'autre-commune', email: 'collegue@autre.test' });
    const avant = await etatCompte(cible.id);

    const res = await demander(cible.username);
    expect(res.status).toBe(200);

    expect(courriel.envois).toEqual([]);
    expect((await pool.query('SELECT 1 FROM password_reset_tokens')).rowCount).toBe(0);
    expect(await etatCompte(cible.id)).toEqual(avant);

    const { rows } = await pool.query(`SELECT tenant_id, type, from_animateur_id FROM notifications`);
    expect(rows).toEqual([{ tenant_id: 'autre-commune', type: 'reset-request', from_animateur_id: cible.id }]);

    const vues = async (admin: typeof adminNogent) => {
      const r = await notifGet(jsonRequest('http://localhost/api/notifications', { cookie: await cookieFor(admin) }));
      return (await r.json()).notifications as unknown[];
    };
    expect(await vues(adminNogent)).toHaveLength(0);
    expect(await vues(collegue)).toHaveLength(1);
  });

  it('la réponse publique est identique avec ou sans adresse sur la fiche', async () => {
    const sans = await seedCompte({ role: 'admin', tenantId: 'autre-commune', email: '' });
    const avec = await seedCompte({ role: 'admin', tenantId: 'autre-commune', email: 'avec@autre.test' });
    const [a, b, c] = await Promise.all([demander(sans.username), demander(avec.username), demander('compte.inconnu')]);
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    const corps = await Promise.all([a.json(), b.json(), c.json()]);
    expect(corps[0]).toEqual(corps[1]);
    expect(corps[0]).toEqual(corps[2]);
    // Seul le compte disposant d'une adresse reçoit un lien, et à CETTE adresse.
    expect(courriel.envois.map(e => e.email)).toEqual(['avec@autre.test']);
  });
});

describe('R2 — remplacement de pointage sous concurrence', () => {
  let cookie: string, espace: string, jeune: string, activite: string;
  const DATE = '2026-10-06';

  beforeEach(async () => {
    await resetDb();
    const animateur = await seedCompte({ role: 'animateur', tenantId: 'commune-a' });
    cookie = await cookieFor(animateur);
    espace = await seedEspace('commune-a');
    jeune = await seedJeune('commune-a', espace);
    activite = await seedActivite('commune-a', espace);
  });

  const pointer = (statut: string, jeuneId = jeune) =>
    postPointages(jsonRequest('http://localhost/api/pointages', {
      method: 'POST', cookie, body: [{ jeuneId, activiteId: activite, date: DATE, statut }],
    }));
  const lignes = async () =>
    (await pool.query(`SELECT statut FROM pointages WHERE jeune_id = $1 AND activite_id = $2 AND date = $3`, [jeune, activite, DATE])).rows;

  it('deux premières écritures simultanées laissent UNE seule ligne (répété)', async () => {
    for (let tour = 0; tour < 12; tour++) {
      await pool.query('DELETE FROM pointages');
      const [a, b] = await Promise.all([pointer('present'), pointer('absent')]);
      expect([a.status, b.status]).toEqual([200, 200]);
      const restant = await lignes();
      expect(restant, `tour ${tour}`).toHaveLength(1);
      expect(['present', 'absent']).toContain(restant[0].statut);
    }
  });

  it('déterministe : une écriture attend tant qu\'une autre transaction tient la même clé, puis remplace', async () => {
    const autre = await connexionConcurrente();
    try {
      const cle = `pointage-remplacement:${JSON.stringify(['commune-a', jeune, activite, DATE])}`;
      await autre.query('BEGIN');
      await autre.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [cle]);
      // L'autre transaction a déjà écrit SA ligne, pas encore validée.
      await autre.query(
        `INSERT INTO pointages (id, jeune_id, activite_id, espace_id, type, date, statut, source, tenant_id)
         VALUES ('pt-concurrent', $1, $2, $3, 'activite', $4, 'present', 'web', 'commune-a')`,
        [jeune, activite, espace, DATE],
      );

      const enCours = observer(pointer('absent'));
      expect(await attendreBlocage(autre)).toBe(true);
      expect(enCours.termine()).toBe(false);

      await autre.query('COMMIT');
      expect((await enCours.promesse).status).toBe(200);

      // La seconde écriture a VU la ligne validée et l'a remplacée.
      expect(await lignes()).toEqual([{ statut: 'absent' }]);
    } finally {
      await autre.query('ROLLBACK').catch(() => {});
      await autre.end();
    }
  });

  it('des lots croisés (mêmes clés, ordre inverse) aboutissent tous deux, sans interblocage ni doublon', async () => {
    const jeune2 = await seedJeune('commune-a', espace);
    const lot = (ordre: string[], statut: string) =>
      postPointages(jsonRequest('http://localhost/api/pointages', {
        method: 'POST', cookie, body: ordre.map(j => ({ jeuneId: j, activiteId: activite, date: DATE, statut })),
      }));
    for (let tour = 0; tour < 8; tour++) {
      const [a, b] = await Promise.all([lot([jeune, jeune2], 'present'), lot([jeune2, jeune], 'excuse')]);
      expect([a.status, b.status], `tour ${tour}`).toEqual([200, 200]);
      const { rows } = await pool.query(
        `SELECT jeune_id, COUNT(*)::int AS n FROM pointages WHERE activite_id = $1 GROUP BY jeune_id ORDER BY jeune_id`, [activite],
      );
      expect(rows.map(r => r.n)).toEqual([1, 1]);
    }
  });

  it('les arrivées de registre restent multiples (pas de verrou ni d\'unicité abusive)', async () => {
    const arrivee = () => postPointages(jsonRequest('http://localhost/api/pointages', {
      method: 'POST', cookie,
      body: [{ jeuneId: jeune, espaceId: espace, date: DATE, heureArrivee: '14:00', type: 'accueil-libre', activiteId: null, manuel: false }],
    }));
    const [a, b] = await Promise.all([arrivee(), arrivee()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await pool.query(`SELECT 1 FROM pointages WHERE type = 'accueil-libre'`)).rowCount).toBe(2);
  });
});
