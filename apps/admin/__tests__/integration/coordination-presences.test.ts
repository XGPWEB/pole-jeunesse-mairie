import { vi, describe, it, expect, beforeEach, afterAll } from 'vitest';

// Next 16 : cookies() est asynchrone. Le mock reproduit cette forme.
const session = vi.hoisted(() => ({ nom: '', valeur: '' }));
const redirection = vi.hoisted(() => ({ vers: [] as string[] }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nom: string) => (nom === session.nom && session.valeur ? { name: nom, value: session.valeur } : undefined),
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// redirect() de Next interrompt le rendu en levant : même contrat ici.
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirection.vers.push(url);
    throw new Error(`REDIRECT:${url}`);
  },
}));

import pool from '@/lib/db';
import { ajouterPointage, modifierPointage, supprimerPointage } from '@/app/presences/actions';
import { POST as POST_PRESENCES } from '@/app/api/presences/route';
import { DELETE as DELETE_VEHICULE } from '@/app/api/vehicules/route';
import { exigerAdminPage } from '@/lib/session';
import { resetDb, seedAnimateur, cookieFor, jsonRequest } from './helpers';
import { seedEspace, seedJeune, seedActivite, seedPointage, photographier, decouperCookie } from './integrite-helpers';

/**
 * Défauts signalés par les agents hors de leur périmètre et corrigés lors de
 * la coordination (même nature que les constats 6 et 7 de l'audit 2026-10) :
 *  - presences/actions.ts : modification/suppression d'un pointage par id seul,
 *    création sans contrôle des références ;
 *  - api/presences POST : références non validées contre le tenant ;
 *  - api/vehicules DELETE : suppression finale sans filtre tenant ;
 *  - pages racine réservées à l'admin : rôle contrôlé par le seul JWT.
 */
async function agirEnTantQue(s: Awaited<ReturnType<typeof seedAnimateur>> | null) {
  if (!s) { session.nom = ''; session.valeur = ''; return; }
  const { nom, valeur } = decouperCookie(await cookieFor(s));
  session.nom = nom; session.valeur = valeur;
}

describe('coordination — pointages web et pages admin', () => {
  let adminA: Awaited<ReturnType<typeof seedAnimateur>>;
  let adminB: Awaited<ReturnType<typeof seedAnimateur>>;
  let espaceA: string, jeuneA: string, activiteA: string, pointageA: string;
  let espaceB: string, jeuneB: string;

  beforeEach(async () => {
    await resetDb();
    redirection.vers = [];
    adminA = await seedAnimateur({ tenantId: 'commune-a' });
    adminB = await seedAnimateur({ tenantId: 'commune-b' });
    espaceA = await seedEspace('commune-a');
    jeuneA = await seedJeune('commune-a', espaceA);
    activiteA = await seedActivite({ tenantId: 'commune-a', espaceId: espaceA });
    pointageA = await seedPointage(activiteA, jeuneA, 'commune-a');
    espaceB = await seedEspace('commune-b');
    jeuneB = await seedJeune('commune-b', espaceB);
  });

  afterAll(async () => { await pool.end(); });

  describe('server actions presences', () => {
    it('la commune B ne peut ni modifier ni supprimer un pointage de A', async () => {
      await agirEnTantQue(adminB);
      const avant = await photographier('pointages');

      expect(await modifierPointage(pointageA, { heureSortie: '23:59' })).toEqual({ success: false, error: 'Pointage introuvable' });
      expect(await supprimerPointage(pointageA)).toEqual({ success: false, error: 'Pointage introuvable' });

      expect(await photographier('pointages')).toEqual(avant);
    });

    it('la commune A modifie puis supprime son propre pointage', async () => {
      await agirEnTantQue(adminA);
      expect(await modifierPointage(pointageA, { heureSortie: '17:30' })).toEqual({ success: true });
      const { rows } = await pool.query('SELECT heure_sortie FROM pointages WHERE id = $1', [pointageA]);
      expect(rows[0].heure_sortie).toBe('17:30');

      expect(await supprimerPointage(pointageA)).toEqual({ success: true });
      const reste = await pool.query('SELECT 1 FROM pointages WHERE id = $1', [pointageA]);
      expect(reste.rowCount).toBe(0);
    });

    it('refuse de créer un pointage référençant un jeune, un espace ou une activité d\'une autre commune', async () => {
      await agirEnTantQue(adminB);
      const base = { date: '2026-10-06', heureArrivee: '14:00', type: 'accueil-libre' as const, manuel: false };
      const avant = await photographier('pointages');

      expect((await ajouterPointage({ ...base, jeuneId: jeuneA, espaceId: espaceB })).error).toBe('Jeune introuvable');
      expect((await ajouterPointage({ ...base, jeuneId: jeuneB, espaceId: espaceA })).error).toBe('Espace introuvable');
      expect((await ajouterPointage({ ...base, jeuneId: jeuneB, espaceId: espaceB, type: 'activite', activiteId: activiteA })).error)
        .toBe('Activité introuvable');
      expect(await photographier('pointages')).toEqual(avant);

      expect(await ajouterPointage({ ...base, jeuneId: jeuneB, espaceId: espaceB })).toEqual({ success: true });
      const cree = await pool.query(`SELECT tenant_id FROM pointages WHERE jeune_id = $1`, [jeuneB]);
      expect(cree.rows).toEqual([{ tenant_id: 'commune-b' }]);
    });

    it('sans session, aucune action n\'écrit', async () => {
      await agirEnTantQue(null);
      const avant = await photographier('pointages');
      expect((await modifierPointage(pointageA, { heureSortie: '10:00' })).success).toBe(false);
      expect((await supprimerPointage(pointageA)).success).toBe(false);
      expect(await photographier('pointages')).toEqual(avant);
    });
  });

  describe('POST /api/presences', () => {
    const entree = (surcharge: Record<string, unknown>) => ({
      espaceId: espaceB, jeuneId: jeuneB, date: '2026-10-06', heureArrivee: '14:00', ...surcharge,
    });

    it('400 et lot entièrement annulé si une entrée référence une autre commune', async () => {
      const cookie = await cookieFor(adminB);
      const avant = await photographier('pointages');

      for (const mauvaise of [{ jeuneId: jeuneA }, { espaceId: espaceA }, { activiteId: activiteA }]) {
        const res = await POST_PRESENCES(jsonRequest('/api/presences', {
          method: 'POST', cookie, body: [entree({}), entree(mauvaise)],
        }));
        expect(res.status).toBe(400);
      }
      expect(await photographier('pointages')).toEqual(avant);
    });

    it('400 sur date, type ou statut invalides', async () => {
      const cookie = await cookieFor(adminB);
      for (const mauvaise of [{ date: '06/10/2026' }, { type: 'autre' }, { statut: 'peut-etre' }]) {
        const res = await POST_PRESENCES(jsonRequest('/api/presences', { method: 'POST', cookie, body: [entree(mauvaise)] }));
        expect(res.status).toBe(400);
      }
    });

    it('enregistre une entrée valide dans le tenant de la session, statut préservé', async () => {
      const cookie = await cookieFor(adminB);
      const res = await POST_PRESENCES(jsonRequest('/api/presences', {
        method: 'POST', cookie, body: [entree({ statut: 'absent', source: 'importe-du-client' })],
      }));
      expect(res.status).toBe(200);
      const { rows } = await pool.query('SELECT tenant_id, statut, source FROM pointages WHERE jeune_id = $1', [jeuneB]);
      expect(rows).toEqual([{ tenant_id: 'commune-b', statut: 'absent', source: 'mobile' }]);
    });
  });

  describe('DELETE /api/vehicules', () => {
    it('un admin de B ne supprime pas la réservation de A', async () => {
      await pool.query(
        `INSERT INTO reservations_vehicules (id, animateur_id, tenant_id) VALUES ('res-a', $1, 'commune-a')`,
        [adminA.id],
      ).catch(async () => {
        // Colonnes obligatoires supplémentaires : on complète à partir du catalogue.
        const { rows } = await pool.query<{ column_name: string; data_type: string }>(
          `SELECT column_name, data_type FROM information_schema.columns
            WHERE table_name = 'reservations_vehicules' AND is_nullable = 'NO' AND column_default IS NULL
              AND column_name NOT IN ('id','animateur_id','tenant_id')`,
        );
        const cols = rows.map(r => r.column_name);
        const vals = rows.map(r => (r.data_type === 'date' ? `'2026-10-06'` : r.data_type.includes('int') || r.data_type === 'numeric' ? '1' : `'x'`));
        await pool.query(
          `INSERT INTO reservations_vehicules (id, animateur_id, tenant_id${cols.map(c => `, ${c}`).join('')})
           VALUES ('res-a', $1, 'commune-a'${vals.map(v => `, ${v}`).join('')})`,
          [adminA.id],
        );
      });

      const resB = await DELETE_VEHICULE(jsonRequest('/api/vehicules?id=res-a', { method: 'DELETE', cookie: await cookieFor(adminB) }));
      expect(resB.status).toBe(403);
      expect((await pool.query(`SELECT 1 FROM reservations_vehicules WHERE id = 'res-a'`)).rowCount).toBe(1);

      const resA = await DELETE_VEHICULE(jsonRequest('/api/vehicules?id=res-a', { method: 'DELETE', cookie: await cookieFor(adminA) }));
      expect(resA.status).toBe(200);
      expect((await pool.query(`SELECT 1 FROM reservations_vehicules WHERE id = 'res-a'`)).rowCount).toBe(0);
    });
  });

  describe('exigerAdminPage (pages racine réservées à l\'admin)', () => {
    it('laisse passer un admin et renvoie le tenant lu en base', async () => {
      await agirEnTantQue(adminA);
      const s = await exigerAdminPage();
      expect(s.role).toBe('admin');
      expect(s.tenant_id).toBe('commune-a');
    });

    it('redirige un animateur vers son tableau de bord', async () => {
      await agirEnTantQue(await seedAnimateur({ tenantId: 'commune-a', role: 'animateur' }));
      await expect(exigerAdminPage()).rejects.toThrow('REDIRECT:/animateur/dashboard');
    });

    it('redirige vers le login sans session', async () => {
      await agirEnTantQue(null);
      await expect(exigerAdminPage()).rejects.toThrow('REDIRECT:/login');
    });

    it('un admin rétrogradé en base est refusé alors que son jeton porte encore le rôle admin', async () => {
      const ancienAdmin = await seedAnimateur({ tenantId: 'commune-a', role: 'admin' });
      await agirEnTantQue(ancienAdmin);
      // Changement direct en base, SANS révocation de session : seul le rôle
      // lu en base par la garde peut encore protéger la page.
      await pool.query(`UPDATE animateurs SET role = 'animateur' WHERE id = $1`, [ancienAdmin.id]);
      await expect(exigerAdminPage()).rejects.toThrow('REDIRECT:/animateur/dashboard');
    });

    it('un compte suspendu est renvoyé au login', async () => {
      const suspendu = await seedAnimateur({ tenantId: 'commune-a', role: 'admin' });
      await agirEnTantQue(suspendu);
      await pool.query(`UPDATE animateurs SET statut = 'suspendu' WHERE id = $1`, [suspendu.id]);
      await expect(exigerAdminPage()).rejects.toThrow('REDIRECT:/login');
    });
  });
});
