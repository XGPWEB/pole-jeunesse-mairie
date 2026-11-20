import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import pool from '@/lib/db';
import { type JWTPayload } from '@/lib/auth';
import { GET, POST, DELETE } from '@/app/api/pointages/route';
import { PATCH as notifPatch, DELETE as notifDelete } from '@/app/api/notifications/route';
import { resetDb, cookieFor, jsonRequest } from './helpers';
import {
  seedActivite, seedCompte, seedEspace, seedJeune, seedNotification, seedPointage,
} from './securite-helpers';

afterAll(async () => { await pool.end(); });

/** Deux communes, chacune avec son espace, son jeune, son activité, son pointage. */
interface Commune {
  tenantId: string;
  admin: JWTPayload;
  animateur: JWTPayload;
  cookie: string;
  espaceId: string;
  jeuneId: string;
  activiteId: string;
}
async function commune(tenantId: string): Promise<Commune> {
  const admin = await seedCompte({ role: 'admin', tenantId });
  const animateur = await seedCompte({ role: 'animateur', tenantId, espaceAssigne: 'Collégiens' });
  const espaceId = await seedEspace(tenantId);
  return {
    tenantId, admin, animateur,
    cookie: await cookieFor(animateur),
    espaceId,
    jeuneId: await seedJeune(tenantId, espaceId),
    activiteId: await seedActivite(tenantId, espaceId),
  };
}

let A: Commune;
let B: Commune;
const JOUR = '2026-10-06';

beforeEach(async () => {
  await resetDb();
  A = await commune('nogent');
  B = await commune('vincennes');
});

const tousLesPointages = async () =>
  (await pool.query('SELECT id, jeune_id, activite_id, espace_id, statut, type, tenant_id FROM pointages ORDER BY id')).rows;
const poster = (cookie: string, body: unknown) =>
  POST(jsonRequest('http://localhost/api/pointages', { method: 'POST', cookie, body }));
const supprimer = (cookie: string, query: string) =>
  DELETE(jsonRequest(`http://localhost/api/pointages?${query}`, { method: 'DELETE', cookie }));

describe('pointages — cloisonnement entre communes (constat 7)', () => {
  it('B ne peut pas supprimer un pointage de A par son id : 404, la ligne existe toujours', async () => {
    const id = await seedPointage({ tenantId: A.tenantId, jeuneId: A.jeuneId });
    const avant = await tousLesPointages();
    const res = await supprimer(B.cookie, `id=${id}`);
    expect(res.status).toBe(404);
    expect(await tousLesPointages()).toEqual(avant);
  });

  it('un pointage web de B avec les identifiants de A n’efface PAS le pointage de A et ne crée aucune référence croisée', async () => {
    const pointageA = await seedPointage({
      tenantId: A.tenantId, jeuneId: A.jeuneId, activiteId: A.activiteId, type: 'activite', statut: 'present', date: JOUR,
    });
    const avant = await tousLesPointages();

    // Exactement la requête qui, avant correction, supprimait la ligne de A
    // (DELETE sans tenant) puis insérait une ligne « de B » pointant sur le jeune de A.
    const res = await poster(B.cookie, [{ jeuneId: A.jeuneId, activiteId: A.activiteId, date: JOUR, statut: 'absent' }]);
    expect(res.status).toBe(400);

    const apres = await tousLesPointages();
    expect(apres).toEqual(avant);
    expect(apres.map(p => p.id)).toEqual([pointageA]);
  });

  it.each([
    ['jeune d’une autre commune', (a: Commune, b: Commune) => ({ jeuneId: a.jeuneId, activiteId: b.activiteId, date: JOUR, statut: 'present' })],
    ['activité d’une autre commune', (a: Commune, b: Commune) => ({ jeuneId: b.jeuneId, activiteId: a.activiteId, date: JOUR, statut: 'present' })],
    ['espace d’une autre commune', (a: Commune, b: Commune) => ({ jeuneId: b.jeuneId, espaceId: a.espaceId, date: JOUR, type: 'accueil-libre', heureArrivee: '14:00' })],
    ['jeune inexistant', (_a: Commune, b: Commune) => ({ jeuneId: 'j-inconnu', espaceId: b.espaceId, date: JOUR, type: 'accueil-libre' })],
  ])('référence refusée avant écriture : %s', async (_nom, entree) => {
    const res = await poster(B.cookie, [entree(A, B)]);
    expect(res.status).toBe(400);
    expect(await tousLesPointages()).toHaveLength(0);
    // Le message ne distingue pas « inexistant » de « appartient à une autre commune ».
    expect((await res.json()).error).toMatch(/introuvable/);
  });

  it('transaction : une entrée invalide en fin de lot annule TOUT le lot, y compris les remplacements', async () => {
    const existant = await seedPointage({
      tenantId: B.tenantId, jeuneId: B.jeuneId, activiteId: B.activiteId, type: 'activite', statut: 'present', date: JOUR,
    });
    const autreJeune = await seedJeune(B.tenantId, B.espaceId);
    const res = await poster(B.cookie, [
      // 1re entrée valide : remplacerait `existant` (DELETE puis INSERT).
      { jeuneId: B.jeuneId, activiteId: B.activiteId, date: JOUR, statut: 'absent' },
      { jeuneId: autreJeune, activiteId: B.activiteId, date: JOUR, statut: 'present' },
      // Dernière entrée : jeune de A.
      { jeuneId: A.jeuneId, activiteId: B.activiteId, date: JOUR, statut: 'present' },
    ]);
    expect(res.status).toBe(400);
    const apres = await tousLesPointages();
    expect(apres.map(p => [p.id, p.statut])).toEqual([[existant, 'present']]);
  });

  it('le remplacement d’un pointage web reste limité au tenant de la session', async () => {
    const res1 = await poster(B.cookie, [{ jeuneId: B.jeuneId, activiteId: B.activiteId, date: JOUR, statut: 'present' }]);
    const res2 = await poster(B.cookie, [{ jeuneId: B.jeuneId, activiteId: B.activiteId, date: JOUR, statut: 'absent' }]);
    expect([res1.status, res2.status]).toEqual([200, 200]);
    const lignes = await tousLesPointages();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ statut: 'absent', tenant_id: B.tenantId, espace_id: B.espaceId, type: 'activite' });
  });

  it('défense en profondeur : la BASE refuse une référence croisée même sans passer par la route', async () => {
    await expect(pool.query(
      `INSERT INTO pointages (id, jeune_id, date, type, tenant_id) VALUES ('pt-x', $1, $2, 'accueil-libre', $3)`,
      [A.jeuneId, JOUR, B.tenantId],
    )).rejects.toMatchObject({ code: '23503', constraint: 'fk_pointages_jeune_tenant' });
    await expect(pool.query(
      `INSERT INTO pointages (id, jeune_id, activite_id, date, type, tenant_id) VALUES ('pt-y', $1, $2, $3, 'activite', $4)`,
      [B.jeuneId, A.activiteId, JOUR, B.tenantId],
    )).rejects.toMatchObject({ code: '23503', constraint: 'fk_pointages_activite_tenant' });
    // Les saisies manuelles (sans jeune) et l'accueil libre (sans activité) restent possibles.
    await pool.query(
      `INSERT INTO pointages (id, date, type, prenom_manuel, tenant_id) VALUES ('pt-z', $1, 'accueil-libre', 'Léo', $2)`,
      [JOUR, B.tenantId],
    );
  });
});

describe('pointages — contrat consommé par le mobile (constat 14)', () => {
  it('POST renvoie les pointages créés avec leur id, dans l’ordre des entrées', async () => {
    const res = await poster(B.cookie, [
      { jeuneId: B.jeuneId, espaceId: B.espaceId, date: JOUR, heureArrivee: '14:05', type: 'accueil-libre', statut: 'present' },
      { prenomManuel: 'Léo', nomManuel: 'Martin', espaceId: B.espaceId, date: JOUR, heureArrivee: '14:10', type: 'accueil-libre', manuel: true },
    ]);
    expect(res.status).toBe(200);
    const corps = await res.json();
    expect(corps.success).toBe(true);
    expect(corps.count).toBe(2);
    expect(corps.pointages).toHaveLength(2);
    expect(corps.pointages[0]).toMatchObject({
      jeuneId: B.jeuneId, activiteId: null, date: JOUR, statut: 'present', type: 'accueil-libre', espaceId: B.espaceId,
    });
    expect(corps.pointages[1]).toMatchObject({ jeuneId: null, prenomManuel: 'Léo', manuel: true, statut: null });
    for (const p of corps.pointages) expect(p.id).toMatch(/^pt-/);

    // Les ids renvoyés sont bien ceux en base, rattachés au tenant de la session.
    const enBase = await tousLesPointages();
    expect(enBase.map(p => p.id).sort()).toEqual(corps.pointages.map((p: { id: string }) => p.id).sort());
    expect(new Set(enBase.map(p => p.tenant_id))).toEqual(new Set([B.tenantId]));
  });

  it('GET ?date= renvoie id, jeuneId, activiteId, date, statut, type, espaceId — du seul tenant de la session', async () => {
    const libre = await seedPointage({ tenantId: B.tenantId, jeuneId: B.jeuneId, espaceId: B.espaceId, date: JOUR });
    const activite = await seedPointage({ tenantId: B.tenantId, jeuneId: B.jeuneId, espaceId: B.espaceId, activiteId: B.activiteId, type: 'activite', statut: 'absent', date: JOUR });
    await seedPointage({ tenantId: B.tenantId, jeuneId: B.jeuneId, date: '2026-10-05' });
    await seedPointage({ tenantId: A.tenantId, jeuneId: A.jeuneId, date: JOUR });

    const res = await GET(jsonRequest(`http://localhost/api/pointages?date=${JOUR}`, { cookie: B.cookie }));
    expect(res.status).toBe(200);
    const lignes = await res.json() as Record<string, unknown>[];
    expect(lignes.map(l => l.id).sort()).toEqual([libre, activite].sort());
    const parId = new Map(lignes.map(l => [l.id, l]));
    expect(parId.get(libre)).toMatchObject({ jeuneId: B.jeuneId, activiteId: null, date: JOUR, statut: null, type: 'accueil-libre', espaceId: B.espaceId });
    expect(parId.get(activite)).toMatchObject({ jeuneId: B.jeuneId, activiteId: B.activiteId, date: JOUR, statut: 'absent', type: 'activite' });
  });

  it('DELETE ?id= supprime EXACTEMENT ce pointage : la présence à l’activité du même jour est conservée', async () => {
    const libre = await seedPointage({ tenantId: B.tenantId, jeuneId: B.jeuneId, date: JOUR });
    const activite = await seedPointage({ tenantId: B.tenantId, jeuneId: B.jeuneId, activiteId: B.activiteId, type: 'activite', statut: 'present', date: JOUR });

    const res = await supprimer(B.cookie, `id=${libre}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, deleted: 1, id: libre });
    expect((await tousLesPointages()).map(p => p.id)).toEqual([activite]);

    // Second appel : le pointage n'existe plus.
    expect((await supprimer(B.cookie, `id=${libre}`)).status).toBe(404);
  });

  it('la forme historique ?jeuneId=&date= est refusée (400) et n’efface plus rien', async () => {
    await seedPointage({ tenantId: B.tenantId, jeuneId: B.jeuneId, date: JOUR });
    await seedPointage({ tenantId: B.tenantId, jeuneId: B.jeuneId, activiteId: B.activiteId, type: 'activite', date: JOUR });
    const res = await supprimer(B.cookie, `jeuneId=${B.jeuneId}&date=${JOUR}`);
    expect(res.status).toBe(400);
    expect(await tousLesPointages()).toHaveLength(2);
  });

  it('entrées mal formées : 400 et aucune écriture (date, statut, type)', async () => {
    const base = { jeuneId: B.jeuneId, espaceId: B.espaceId, type: 'accueil-libre' };
    for (const entree of [
      { ...base, date: '06/10/2026' },
      { ...base, date: JOUR, statut: 'en-retard' },
      { ...base, date: JOUR, type: 'autre' },
      { jeuneId: B.jeuneId, date: JOUR, statut: 'present' }, // feuille web sans activité
      'pas un objet',
    ]) {
      expect((await poster(B.cookie, [entree])).status, JSON.stringify(entree)).toBe(400);
    }
    expect(await tousLesPointages()).toHaveLength(0);
  });
});

describe('notifications — mutations filtrées par tenant et destinataire (constat 17)', () => {
  const etat = async (id: string) =>
    (await pool.query('SELECT lu_par, dismissed_par FROM notifications WHERE id = $1', [id])).rows[0];
  const patch = (cookie: string, id: string, action: string) =>
    notifPatch(jsonRequest('http://localhost/api/notifications', { method: 'PATCH', cookie, body: { id, action } }));

  it('PATCH sur une notification d’une autre commune : 404, lu_par et dismissed_par inchangés', async () => {
    const chezA = await seedNotification({ tenantId: A.tenantId, cible: 'Tous' });
    for (const cookie of [B.cookie, await cookieFor(B.admin)]) {
      expect((await patch(cookie, chezA, 'dismiss')).status).toBe(404);
      expect((await patch(cookie, chezA, 'lu')).status).toBe(404);
    }
    expect(await etat(chezA)).toEqual({ lu_par: [], dismissed_par: [] });
  });

  it('un animateur ne peut pas masquer une notification qui ne lui est pas destinée (même commune)', async () => {
    const pourAdmins = await seedNotification({ tenantId: B.tenantId, cible: 'admin', type: 'reset-request' });
    const pourAutre = await seedNotification({ tenantId: B.tenantId, cible: 'x', destAnimateurId: B.admin.id });
    expect((await patch(B.cookie, pourAdmins, 'dismiss')).status).toBe(404);
    expect((await patch(B.cookie, pourAutre, 'dismiss')).status).toBe(404);
    expect(await etat(pourAdmins)).toEqual({ lu_par: [], dismissed_par: [] });
    expect(await etat(pourAutre)).toEqual({ lu_par: [], dismissed_par: [] });
  });

  it('destinataire légitime : la mutation est appliquée une seule fois (idempotente)', async () => {
    const pourTous = await seedNotification({ tenantId: B.tenantId, cible: 'Tous' });
    const pourEspace = await seedNotification({ tenantId: B.tenantId, cible: 'Collégiens' });
    const pourMoi = await seedNotification({ tenantId: B.tenantId, cible: 'x', destAnimateurId: B.animateur.id });
    for (const id of [pourTous, pourEspace, pourMoi]) {
      expect((await patch(B.cookie, id, 'lu')).status).toBe(200);
      expect((await patch(B.cookie, id, 'lu')).status).toBe(200);
      expect((await etat(id)).lu_par).toEqual([B.animateur.id]);
    }
    // L'admin de la commune agit sur toutes celles de SA commune.
    const pourAdmins = await seedNotification({ tenantId: B.tenantId, cible: 'admin' });
    expect((await patch(await cookieFor(B.admin), pourAdmins, 'dismiss')).status).toBe(200);
    expect((await etat(pourAdmins)).dismissed_par).toEqual([B.admin.id]);
  });

  it('DELETE par l’admin d’une autre commune : la notification n’est pas supprimée', async () => {
    const chezA = await seedNotification({ tenantId: A.tenantId, cible: 'Tous' });
    const res = await notifDelete(jsonRequest(`http://localhost/api/notifications?id=${chezA}`, {
      method: 'DELETE', cookie: await cookieFor(B.admin),
    }));
    expect(res.status).toBe(200);
    expect((await pool.query('SELECT count(*)::int AS n FROM notifications WHERE id = $1', [chezA])).rows[0].n).toBe(1);
  });
});
