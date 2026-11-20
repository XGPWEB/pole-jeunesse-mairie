import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import pool from '@/lib/db';
import { POST } from '@/app/api/projets/route';
import { resetDb, seedAnimateur, cookieFor, jsonRequest } from './helpers';

/**
 * Reproduit le bug de prod du 2026-07-30 : POST /api/projets renvoyait 500
 * quand le champ « date de dépôt » était laissé vide. Cause : `body.dateDepot
 * ?? null` ne convertit pas la chaîne vide qu'envoie un <input type="date">
 * vidé, et PostgreSQL rejette '' pour une colonne DATE. Corrigé via
 * emptyToNull() dans lib/db.ts.
 *
 * Ce test appelle le VRAI handler contre un VRAI PostgreSQL — c'est la seule
 * façon d'attraper ce genre de bug : les 47 tests unitaires mockent `pg` et
 * un mock ne reproduit pas le rejet de type de PostgreSQL.
 */
describe('POST /api/projets', () => {
  let cookie: string;

  beforeEach(async () => {
    await resetDb();
    const session = await seedAnimateur({ role: 'admin' });
    cookie = await cookieFor(session);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('crée un projet avec dateDepot vide sans renvoyer 500 (régression)', async () => {
    const res = await POST(jsonRequest('http://localhost/api/projets', {
      method: 'POST',
      cookie,
      body: { titre: 'Séjour été', dateDepot: '' },
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.projet.dateDepot).toBeNull();
  });

  it('persiste une vraie date de dépôt sans décalage de fuseau', async () => {
    const res = await POST(jsonRequest('http://localhost/api/projets', {
      method: 'POST',
      cookie,
      body: { titre: 'Séjour hiver', dateDepot: '2026-12-15' },
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    // Règle du projet : ::text sur les colonnes DATE pour éviter la
    // sérialisation en datetime ISO ('2026-12-15T00:00:00.000Z').
    expect(data.projet.dateDepot).toBe('2026-12-15');
  });

  it('rejette une requête non authentifiée', async () => {
    const res = await POST(jsonRequest('http://localhost/api/projets', {
      method: 'POST',
      body: { titre: 'Sans session' },
    }));
    expect(res.status).toBe(401);
  });

  it('modifie un projet existant en effaçant sa date de dépôt', async () => {
    const created = await POST(jsonRequest('http://localhost/api/projets', {
      method: 'POST',
      cookie,
      body: { titre: 'À corriger', dateDepot: '2026-09-01' },
    }));
    const { projet } = await created.json();

    const updated = await POST(jsonRequest('http://localhost/api/projets', {
      method: 'POST',
      cookie,
      body: { id: projet.id, dateDepot: '' },
    }));

    expect(updated.status).toBe(200);
    const data = await updated.json();
    expect(data.projet.dateDepot).toBeNull();
  });
});
