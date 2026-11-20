import { vi, describe, it, expect, beforeEach, afterAll } from 'vitest';
import type { Client } from 'pg';

// Les Server Actions lisent la session via next/headers et invalident le cache
// via next/cache : seuls ces deux points d'ancrage au runtime Next sont
// remplacés. L'authentification (JWT + lecture du compte en base) et toutes
// les requêtes SQL s'exécutent réellement.
const session = vi.hoisted(() => ({ nom: '', valeur: '' }));
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (nom: string) => (nom === session.nom && session.valeur ? { name: nom, value: session.valeur } : undefined),
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import pool from '@/lib/db';
import { POST, DELETE } from '@/app/api/inscriptions/route';
import { ajouterInscriptionManuelle, modifierActivite } from '@/app/activites/actions';
import { updateStatutInscription } from '@/app/inscriptions/actions';
import { resetDb, seedAnimateur, cookieFor, jsonRequest } from './helpers';
import {
  seedEspace, seedJeune, seedActivite, seedInscription, photographier,
  connexionConcurrente, observer, attendreBlocage, libererActeur, decouperCookie,
} from './integrite-helpers';

/**
 * Constat 18 de l'audit du 2026-10-06 — doubles inscriptions et dépassements
 * de capacité, par l'API et par les Server Actions, sur un vrai PostgreSQL.
 */
const URL_INS = 'http://localhost/api/inscriptions';

let cookie: string;
let observateur: Client;

const inscrire = (activiteId: string, jeuneId: string) =>
  POST(jsonRequest(URL_INS, { method: 'POST', cookie, body: { activiteId, jeuneId } }));

async function inscriptions(activiteId: string) {
  const { rows } = await pool.query<{ jeune_id: string | null; statut: string }>(
    'SELECT jeune_id, statut FROM inscriptions WHERE activite_id = $1 ORDER BY date_inscription, id', [activiteId]);
  return rows;
}
const compter = (rows: { statut: string }[], statut: string) => rows.filter(r => r.statut === statut).length;

beforeEach(async () => {
  await resetDb();
  cookie = await cookieFor(await seedAnimateur({ role: 'animateur' }));
  Object.assign(session, decouperCookie(cookie));
});

afterAll(async () => {
  await observateur?.end();
  await pool.end();
});

describe('double inscription du même jeune', () => {
  it('API : deux POST simultanés ne créent qu’une inscription', async () => {
    for (let tour = 0; tour < 8; tour++) {
      const activite = await seedActivite({ placesTotal: 10 });
      const jeune = await seedJeune();

      const reponses = await Promise.all([inscrire(activite, jeune), inscrire(activite, jeune)]);
      const corps = await Promise.all(reponses.map(r => r.json()));

      expect(await inscriptions(activite)).toHaveLength(1);
      expect(corps.filter(c => c.alreadyExists)).toHaveLength(1);
    }
  });

  it('API : le doublon est contrôlé APRÈS le verrou activité (attend l’inscription concurrente, puis la voit)', async () => {
    const activite = await seedActivite({ placesTotal: 10 });
    const jeune = await seedJeune();
    observateur ??= await connexionConcurrente();

    // Acteur A : tient le verrou de l'activité et inscrit le jeune, sans COMMIT.
    const acteur = await pool.connect();
    try {
      await acteur.query('BEGIN');
      await acteur.query('SELECT id FROM activites WHERE id = $1 FOR UPDATE', [activite]);
      await acteur.query(
        `INSERT INTO inscriptions (id, jeune_id, activite_id, statut, tenant_id) VALUES ('ins-acteur-a', $1, $2, 'confirmee', 'nogent')`,
        [jeune, activite],
      );

      // Acteur B : le vrai handler. Avec un contrôle de doublon fait avant le
      // verrou, il conclurait « pas inscrit » maintenant et insérerait ensuite.
      const b = observer(inscrire(activite, jeune));
      expect(await attendreBlocage(observateur)).toBe(true);
      expect(b.termine()).toBe(false);

      await acteur.query('COMMIT');
      const corps = await (await b.promesse).json();

      expect(corps.alreadyExists).toBe(true);
      expect(corps.inscription.id).toBe('ins-acteur-a');
    } finally {
      await libererActeur(acteur);
    }
    expect(await inscriptions(activite)).toHaveLength(1);
  });

  it('Server Action : deux ajouts manuels simultanés du même jeune → un seul accepté', async () => {
    for (let tour = 0; tour < 8; tour++) {
      const activite = await seedActivite({ placesTotal: 10 });
      const jeune = await seedJeune();

      const resultats = await Promise.all([
        ajouterInscriptionManuelle(activite, 'Atelier', 'x', jeune, 'Durand', 'Camille'),
        ajouterInscriptionManuelle(activite, 'Atelier', 'x', jeune, 'Durand', 'Camille'),
      ]);

      expect(resultats.filter(r => r.success)).toHaveLength(1);
      expect(resultats.find(r => !r.success)?.error).toContain('déjà inscrit');
      expect(await inscriptions(activite)).toHaveLength(1);
    }
  });

  it('API et Server Action en même temps partagent le même verrou', async () => {
    for (let tour = 0; tour < 8; tour++) {
      const activite = await seedActivite({ placesTotal: 10 });
      const jeune = await seedJeune();

      await Promise.all([
        inscrire(activite, jeune),
        ajouterInscriptionManuelle(activite, 'Atelier', 'x', jeune, 'Durand', 'Camille'),
      ]);

      expect(await inscriptions(activite)).toHaveLength(1);
    }
  });

  it('un jeune refusé peut être réinscrit, et son refus reste dans l’historique', async () => {
    const activite = await seedActivite();
    const jeune = await seedJeune();
    await seedInscription(activite, jeune, { statut: 'refusee' });

    const r = await ajouterInscriptionManuelle(activite, 'Atelier', 'x', jeune, 'Durand', 'Camille');

    expect(r).toEqual({ success: true, statut: 'confirmee' });
    expect((await inscriptions(activite)).map(i => i.statut).sort()).toEqual(['confirmee', 'refusee']);
  });

  it('reconfirmer une inscription refusée alors qu’une autre est active est refusé proprement', async () => {
    const activite = await seedActivite();
    const jeune = await seedJeune();
    const refusee = await seedInscription(activite, jeune, { statut: 'refusee' });
    await seedInscription(activite, jeune, { statut: 'confirmee' });

    const r = await updateStatutInscription(refusee, 'confirmee');

    expect(r.success).toBe(false);
    expect(r.error).toContain('autre inscription active');
    expect(compter(await inscriptions(activite), 'confirmee')).toBe(1);
  });
});

describe('capacité sous concurrence', () => {
  it('API : 8 inscriptions simultanées pour 3 places → 3 confirmées, 5 en attente', async () => {
    const activite = await seedActivite({ placesTotal: 3 });
    const jeunes = await Promise.all(Array.from({ length: 8 }, () => seedJeune()));

    const reponses = await Promise.all(jeunes.map(j => inscrire(activite, j)));

    expect(reponses.every(r => r.status === 200)).toBe(true);
    const lignes = await inscriptions(activite);
    expect(compter(lignes, 'confirmee')).toBe(3);
    expect(compter(lignes, 'en-attente')).toBe(5);
    const { rows } = await pool.query<{ places_disponibles: number; statut: string }>(
      'SELECT places_disponibles, statut FROM activites WHERE id = $1', [activite]);
    expect(rows[0]).toEqual({ places_disponibles: 0, statut: 'complet' });
  });

  it('Server Action : 8 ajouts manuels simultanés pour 3 places → jamais plus de 3 confirmés', async () => {
    const activite = await seedActivite({ placesTotal: 3 });
    const jeunes = await Promise.all(Array.from({ length: 8 }, () => seedJeune()));

    const resultats = await Promise.all(
      jeunes.map(j => ajouterInscriptionManuelle(activite, 'Atelier', 'x', j, 'Durand', 'Camille')),
    );

    expect(resultats.filter(r => r.statut === 'confirmee')).toHaveLength(3);
    expect(resultats.filter(r => r.statut === 'liste-attente')).toHaveLength(5);
    expect(compter(await inscriptions(activite), 'confirmee')).toBe(3);
  });

  it('confirmations simultanées d’inscriptions en attente : la capacité tient', async () => {
    const activite = await seedActivite({ placesTotal: 2 });
    const enAttente = await Promise.all(
      Array.from({ length: 6 }, async () => seedInscription(activite, await seedJeune(), { statut: 'en-attente' })),
    );

    const resultats = await Promise.all(enAttente.map(id => updateStatutInscription(id, 'confirmee')));

    expect(resultats.filter(r => r.success)).toHaveLength(2);
    expect(compter(await inscriptions(activite), 'confirmee')).toBe(2);
  });

  it('double désistement simultané du même jeune : une seule promotion', async () => {
    for (let tour = 0; tour < 8; tour++) {
      const activite = await seedActivite({ placesTotal: 2 });
      const [a, b, c, d] = await Promise.all([seedJeune(), seedJeune(), seedJeune(), seedJeune()]);
      await seedInscription(activite, a, { dateInscription: '2026-10-01T10:00:00Z' });
      await seedInscription(activite, b, { dateInscription: '2026-10-01T10:01:00Z' });
      await seedInscription(activite, c, { statut: 'liste-attente', dateInscription: '2026-10-01T10:02:00Z' });
      await seedInscription(activite, d, { statut: 'liste-attente', dateInscription: '2026-10-01T10:03:00Z' });

      const retirer = () =>
        DELETE(jsonRequest(`${URL_INS}?jeuneId=${a}&activiteId=${activite}`, { method: 'DELETE', cookie }));
      await Promise.all([retirer(), retirer()]);

      const lignes = await inscriptions(activite);
      expect(compter(lignes, 'confirmee')).toBe(2);              // b + c, pas plus que la capacité
      expect(lignes.find(l => l.jeune_id === c)?.statut).toBe('confirmee');
      expect(lignes.find(l => l.jeune_id === d)?.statut).toBe('liste-attente');
    }
  });

  it('désistement pendant une confirmation manuelle concurrente : ni interblocage, ni dépassement', async () => {
    for (let tour = 0; tour < 8; tour++) {
      const activite = await seedActivite({ placesTotal: 1 });
      const [a, b] = await Promise.all([seedJeune(), seedJeune()]);
      const insA = await seedInscription(activite, a);
      const insB = await seedInscription(activite, b, { statut: 'en-attente' });

      const [suppression] = await Promise.all([
        DELETE(jsonRequest(`${URL_INS}?id=${insA}`, { method: 'DELETE', cookie })),
        updateStatutInscription(insB, 'confirmee'),
      ]);

      expect(suppression.status).toBe(200);
      const lignes = await inscriptions(activite);
      expect(lignes).toHaveLength(1);
      expect(lignes[0]).toEqual({ jeune_id: b, statut: 'confirmee' });
    }
  });
});

describe('modifierActivite — capacité', () => {
  const donnees = (espaceId: string, placesTotal: number) => ({
    titre: 'Atelier cuisine', espaceId, date: '2026-11-04', heureDebut: '14:00', heureFin: '16:00',
    placesTotal, statut: 'ouvert',
  });

  it('refuse de réduire les places sous le nombre de confirmés, sans rien modifier', async () => {
    const espace = await seedEspace();
    const activite = await seedActivite({ espaceId: espace, placesTotal: 5 });
    for (let i = 0; i < 3; i++) await seedInscription(activite, await seedJeune());
    const avant = await photographier('activites', 'inscriptions');

    const r = await modifierActivite(activite, donnees(espace, 2));

    expect(r.success).toBe(false);
    expect(r.error).toContain('3 inscriptions');
    expect(await photographier('activites', 'inscriptions')).toEqual(avant);
  });

  it('recalcule les places disponibles à partir des confirmés réels', async () => {
    const espace = await seedEspace();
    const activite = await seedActivite({ espaceId: espace, placesTotal: 5 });
    for (let i = 0; i < 3; i++) await seedInscription(activite, await seedJeune());

    expect((await modifierActivite(activite, donnees(espace, 8))).success).toBe(true);

    const { rows } = await pool.query<{ places_total: number; places_disponibles: number }>(
      'SELECT places_total, places_disponibles FROM activites WHERE id = $1', [activite]);
    expect(rows[0]).toEqual({ places_total: 8, places_disponibles: 5 });
  });
});
