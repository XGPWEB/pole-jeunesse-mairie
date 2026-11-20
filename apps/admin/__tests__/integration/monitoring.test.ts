import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';

const courriel = vi.hoisted(() => ({ alertes: [] as { type: string; message: string }[], echec: false }));
vi.mock('@/app/animateurs/emailService', () => ({
  envoyerAlerteMonitoring: vi.fn(async (e: { type: string; message: string }) => {
    if (courriel.echec) throw new Error('SMTP indisponible');
    courriel.alertes.push(e);
    return { success: true };
  }),
}));

import pool from '@/lib/db';
import { logMonitoringEvent, analyserAppelConsoleError } from '@/lib/monitoring';
import { consommerTentative } from '@/lib/rate-limit';
import { POST as report } from '@/app/api/monitoring/report/route';
import { POST as internalReport } from '@/app/api/monitoring/internal-report/route';
import { GET as eventsGet, DELETE as eventsDelete } from '@/app/api/monitoring/events/route';
import { GET as health } from '@/app/api/health/route';
import { resetDb, seedAnimateur, cookieFor, jsonRequest } from './helpers';
import { billetProvisoire } from './securite-helpers';

afterAll(async () => { await pool.end(); });

const SECRET = 'secret-interne-de-test-0123456789-abcdefghij';
let compteurIp = 0;
const ip = () => ({ 'x-real-ip': `203.0.113.${++compteurIp}` });
const evenements = async () => (await pool.query('SELECT * FROM monitoring_events ORDER BY at, id')).rows;
/** Laisse s'exécuter l'envoi d'alerte, lancé sans être attendu par le journal. */
const laisserPartirLesAlertes = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
/**
 * Attend qu'une écriture lancée en arrière-plan soit visible en base. Le quota
 * de tentatives journalise sans être attendu (import dynamique puis INSERT) :
 * quelques tours de boucle d'événements ne suffisent pas sur une machine
 * lente — le test a échoué ainsi en CI le 2026-10-07.
 */
const attendreEvenements = async (minimum: number) => {
  const limite = Date.now() + 3000;
  while ((await evenements()).length < minimum && Date.now() < limite) await new Promise(r => setTimeout(r, 20));
};

beforeEach(async () => {
  await resetDb();
  courriel.alertes.length = 0;
  courriel.echec = false;
  delete process.env.MONITORING_OWNER_TENANT;
  delete process.env.INTERNAL_MONITORING_SECRET;
});
afterEach(() => {
  delete process.env.MONITORING_OWNER_TENANT;
  delete process.env.INTERNAL_MONITORING_SECRET;
});

describe('logMonitoringEvent', () => {
  it('journalise l\'événement, champs tronqués', async () => {
    const e = await logMonitoringEvent({
      source: 'serveur', type: 'T'.repeat(300), message: 'M'.repeat(900), detail: 'D'.repeat(5000), path: '/api/x',
    });
    expect(e).not.toBeNull();
    const [ligne] = await evenements();
    expect(ligne.type).toHaveLength(201);
    expect(ligne.message).toHaveLength(501);
    expect(ligne.detail).toHaveLength(3001);
    expect(ligne.source).toBe('serveur');
    expect(ligne.path).toBe('/api/x');
  });

  it('une seule alerte par type dans la fenêtre de 30 minutes ; chaque occurrence reste journalisée', async () => {
    for (let i = 0; i < 5; i++) await logMonitoringEvent({ source: 'serveur', type: 'Erreur serveur — /api/a', message: `n°${i}` });
    await logMonitoringEvent({ source: 'serveur', type: 'Erreur serveur — /api/b', message: 'autre type' });
    await laisserPartirLesAlertes();

    expect(await evenements()).toHaveLength(6);
    expect(courriel.alertes.map(a => a.type).sort()).toEqual(['Erreur serveur — /api/a', 'Erreur serveur — /api/b']);
  });

  it('occurrences SIMULTANÉES du même type : une seule alerte (réservation atomique en base)', async () => {
    await Promise.all(Array.from({ length: 8 }, (_, i) =>
      logMonitoringEvent({ source: 'serveur', type: 'Erreur serveur — /api/rafale', message: `n°${i}` })));
    await laisserPartirLesAlertes();
    expect(await evenements()).toHaveLength(8);
    expect(courriel.alertes).toHaveLength(1);
  });

  it('une nouvelle alerte part une fois la fenêtre écoulée', async () => {
    await logMonitoringEvent({ source: 'serveur', type: 'Erreur serveur — /api/a', message: '1' });
    await pool.query(`UPDATE monitoring_alerts SET last_alert_at = NOW() - INTERVAL '31 minutes'`);
    await logMonitoringEvent({ source: 'serveur', type: 'Erreur serveur — /api/a', message: '2' });
    await laisserPartirLesAlertes();
    expect(courriel.alertes).toHaveLength(2);
  });

  it('ne lève jamais : courriel en échec ou table absente', async () => {
    courriel.echec = true;
    await expect(logMonitoringEvent({ source: 'serveur', type: 'x', message: 'y' })).resolves.not.toBeNull();
    await laisserPartirLesAlertes();

    await pool.query('ALTER TABLE monitoring_events RENAME TO monitoring_events_absente');
    try {
      await expect(logMonitoringEvent({ source: 'serveur', type: 'x', message: 'y' })).resolves.toBeNull();
    } finally {
      await pool.query('ALTER TABLE monitoring_events_absente RENAME TO monitoring_events');
    }
  });

  it('une erreur tracée par une route selon la convention devient un événement', async () => {
    const analyse = analyserAppelConsoleError(['[api/projets]', new Error('colonne absente')]);
    expect(analyse).not.toBeNull();
    await logMonitoringEvent(analyse!);
    const [ligne] = await evenements();
    expect(ligne).toMatchObject({ type: 'Erreur serveur — /api/projets', message: 'colonne absente', path: '/api/projets' });
  });
});

describe('POST /api/monitoring/report (navigateur, public)', () => {
  const envoyer = (body: unknown, headers = ip()) =>
    report(jsonRequest('http://localhost/api/monitoring/report', { method: 'POST', headers, body }));

  it('accepte un rapport valide sans session ; chaîne de requête retirée du chemin', async () => {
    const res = await envoyer({ kind: 'js_error', message: 'x is not defined', detail: 'pile…', path: '/admin/jeunes?id=secret#frag' });
    expect(res.status).toBe(200);
    const [ligne] = await evenements();
    expect(ligne).toMatchObject({
      source: 'navigateur', type: 'Erreur JavaScript — interface web', message: 'x is not defined', path: '/admin/jeunes',
    });
  });

  it('refuse un genre inconnu, un corps non objet ou trop volumineux, sans rien journaliser', async () => {
    expect((await envoyer({ kind: 'inconnu', message: 'x' })).status).toBe(400);
    expect((await envoyer({ kind: 'constructor', message: 'x' })).status).toBe(400);
    expect((await envoyer(['js_error'])).status).toBe(400);
    expect((await envoyer({ kind: 'js_error', message: 'x'.repeat(9000) })).status).toBe(413);
    expect(await evenements()).toHaveLength(0);
  });

  it('quota par adresse : 20 rapports puis 429, et le dépassement est lui-même signalé une seule fois', async () => {
    const meme = { 'x-real-ip': '203.0.113.250' };
    const statuts: number[] = [];
    for (let i = 0; i < 23; i++) statuts.push((await envoyer({ kind: 'api_error', message: `e${i}` }, meme)).status);
    expect(statuts.filter(s => s === 200)).toHaveLength(20);
    expect(statuts.filter(s => s === 429)).toHaveLength(3);
    // 20 rapports + l'événement de quota, journalisé en arrière-plan (voir attendreEvenements).
    await attendreEvenements(21);
    await laisserPartirLesAlertes();
    const lignes = await evenements();
    expect(lignes.filter(l => l.type === 'Erreur API — interface web')).toHaveLength(20);
    const quota = lignes.filter(l => l.source === 'securite');
    expect(quota).toHaveLength(1);
    expect(quota[0].type).toBe('Quota de tentatives épuisé — rapports du navigateur');
    // L'adresse IP n'est pas recopiée dans le journal.
    expect(JSON.stringify(quota[0])).not.toContain('203.0.113.250');
  });
});

describe('POST /api/monitoring/internal-report (scripts d\'exploitation)', () => {
  const envoyer = (body: unknown, secret?: string) =>
    internalReport(jsonRequest('http://localhost/api/monitoring/internal-report', {
      method: 'POST', headers: secret ? { 'x-internal-secret': secret } : {}, body,
    }));

  it('404 tant que le secret n\'est pas configuré (ou trop court)', async () => {
    expect((await envoyer({ type: 'Sauvegarde en échec' }, SECRET)).status).toBe(404);
    process.env.INTERNAL_MONITORING_SECRET = 'court';
    expect((await envoyer({ type: 'Sauvegarde en échec' }, 'court')).status).toBe(404);
    expect(await evenements()).toHaveLength(0);
  });

  it('403 sans secret ou avec un mauvais secret ; 400 sans type ; 200 avec le bon', async () => {
    process.env.INTERNAL_MONITORING_SECRET = SECRET;
    expect((await envoyer({ type: 'Sauvegarde en échec' })).status).toBe(403);
    expect((await envoyer({ type: 'Sauvegarde en échec' }, `${SECRET}x`)).status).toBe(403);
    expect((await envoyer({ message: 'sans type' }, SECRET)).status).toBe(400);
    expect(await evenements()).toHaveLength(0);

    expect((await envoyer({ type: 'Sauvegarde en échec', message: 'pg_dump a échoué' }, SECRET)).status).toBe(200);
    const [ligne] = await evenements();
    expect(ligne).toMatchObject({ source: 'exploitation', type: 'Sauvegarde en échec', message: 'pg_dump a échoué' });
  });
});

describe('journal — lecture et suppression réservées à l\'admin de la commune exploitante', () => {
  const lire = async (cookie?: string, days?: number) =>
    eventsGet(jsonRequest(`http://localhost/api/monitoring/events${days ? `?days=${days}` : ''}`, { cookie }));
  const supprimer = async (ids: unknown, cookie?: string) =>
    eventsDelete(jsonRequest('http://localhost/api/monitoring/events', { method: 'DELETE', cookie, body: { ids } }));

  it('matrice d\'accès : anonyme 401, billet provisoire 401, animateur 403, admin d\'une autre commune 403, admin exploitant 200', async () => {
    const admin = await seedAnimateur({ tenantId: 'nogent', role: 'admin' });
    const animateur = await seedAnimateur({ tenantId: 'nogent', role: 'animateur' });
    const adminAutre = await seedAnimateur({ tenantId: 'autre-commune', role: 'admin' });
    await logMonitoringEvent({ source: 'serveur', type: 'Erreur serveur — /api/a', message: 'm' });

    expect((await lire()).status).toBe(401);
    expect((await lire(`pj_token=${await billetProvisoire(admin)}`)).status).toBe(401);
    expect((await lire(await cookieFor(animateur))).status).toBe(403);
    expect((await lire(await cookieFor(adminAutre))).status).toBe(403);

    const res = await lire(await cookieFor(admin));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const corps = await res.json();
    expect(corps.items).toHaveLength(1);
    expect(corps.byType).toEqual({ 'Erreur serveur — /api/a': 1 });

    for (const c of [undefined, await cookieFor(animateur), await cookieFor(adminAutre)]) {
      expect([401, 403]).toContain((await supprimer([corps.items[0].id], c)).status);
    }
    expect(await evenements()).toHaveLength(1);
  });

  it('la commune exploitante se configure par MONITORING_OWNER_TENANT', async () => {
    const adminNogent = await seedAnimateur({ tenantId: 'nogent', role: 'admin' });
    const adminAutre = await seedAnimateur({ tenantId: 'autre-commune', role: 'admin' });
    process.env.MONITORING_OWNER_TENANT = 'autre-commune';
    expect((await lire(await cookieFor(adminNogent))).status).toBe(403);
    expect((await lire(await cookieFor(adminAutre))).status).toBe(200);
  });

  it('filtre par période, plus récent d\'abord, répartition par type', async () => {
    const admin = await seedAnimateur({ tenantId: 'nogent', role: 'admin' });
    const cookie = await cookieFor(admin);
    const inserer = (id: string, type: string, age: string) =>
      pool.query(`INSERT INTO monitoring_events (id, at, source, type, message) VALUES ($1, NOW() - $2::interval, 'serveur', $3, 'm')`, [id, age, type]);
    await inserer('e-1j', 'A', '1 day');
    await inserer('e-3j', 'A', '3 days');
    await inserer('e-20j', 'B', '20 days');
    await inserer('e-80j', 'B', '80 days');
    await inserer('e-200j', 'C', '200 days');

    const ids = async (days?: number) => ((await (await lire(cookie, days)).json()).items as { id: string }[]).map(i => i.id);
    expect(await ids()).toEqual(['e-1j', 'e-3j']);
    expect(await ids(30)).toEqual(['e-1j', 'e-3j', 'e-20j']);
    expect(await ids(90)).toEqual(['e-1j', 'e-3j', 'e-20j', 'e-80j']);
    expect((await (await lire(cookie, 90)).json()).byType).toEqual({ A: 2, B: 2 });
  });

  it('suppression : seules les entrées désignées disparaissent ; liste vide refusée', async () => {
    const admin = await seedAnimateur({ tenantId: 'nogent', role: 'admin' });
    const cookie = await cookieFor(admin);
    const a = await logMonitoringEvent({ source: 'serveur', type: 'A', message: '1' });
    const b = await logMonitoringEvent({ source: 'serveur', type: 'B', message: '2' });

    expect((await supprimer([], cookie)).status).toBe(400);
    expect((await supprimer('pas-un-tableau', cookie)).status).toBe(400);
    const res = await supprimer([a!.id, 'id-inexistant', 42], cookie);
    expect(await res.json()).toEqual({ ok: true, deleted: 1 });
    expect((await evenements()).map(e => e.id)).toEqual([b!.id]);
  });
});

describe('quota de connexion épuisé → événement de sécurité', () => {
  it('signalé une fois au franchissement du seuil, sans l\'adresse IP (IPv6 comprise)', async () => {
    const cle = '2001:db8::1234';
    const resultats: boolean[] = [];
    for (let i = 0; i < 8; i++) resultats.push(await consommerTentative(cle, 5, 15 * 60 * 1000));
    expect(resultats).toEqual([true, true, true, true, true, false, false, false]);
    await attendreEvenements(1);
    await laisserPartirLesAlertes();
    const lignes = await evenements();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ source: 'securite', type: 'Quota de tentatives épuisé — connexion' });
    expect(JSON.stringify(lignes[0])).not.toContain('2001');
  });
});

describe('/api/health', () => {
  it('expose la version du build', async () => {
    const corps = await (await health()).json();
    expect(corps.status).toBe('ok');
    expect(typeof corps.version).toBe('string');
  });
});
