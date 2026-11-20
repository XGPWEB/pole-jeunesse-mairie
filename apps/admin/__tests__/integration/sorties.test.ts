import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import pool from '@/lib/db';
import { POST } from '@/app/api/sorties/route';
import { resetDb, seedAnimateur, cookieFor, jsonRequest } from './helpers';

/**
 * `sorties.capacite` est INTEGER (contrairement à `projets.date_depot` qui
 * est DATE) : même piège, erreur PostgreSQL différente — 22P02 (invalid input
 * syntax for type integer) au lieu de 22007. Corrigé le 2026-07-30 par le
 * même emptyToNull(), en même temps que le bug projets. Verrouillé ici pour
 * la même raison : un mock de `pg` ne rejette jamais '' pour une colonne
 * INTEGER, un vrai PostgreSQL le fait systématiquement.
 */
describe('POST /api/sorties', () => {
  let cookie: string;

  beforeEach(async () => {
    await resetDb();
    const session = await seedAnimateur({ role: 'animateur' });
    cookie = await cookieFor(session);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("crée une sortie avec une capacité vidée par l'utilisateur sans renvoyer 500", async () => {
    const res = await POST(jsonRequest('http://localhost/api/sorties', {
      method: 'POST',
      cookie,
      body: { titre: 'Sortie accrobranche', date: '2026-09-10', capacite: '' },
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    // capacite ?? 0 côté route : '' devient null via emptyToNull, puis 0 au INSERT.
    expect(data.sortie.capacite).toBe(0);
  });

  it('persiste une capacité et une date réelles', async () => {
    const res = await POST(jsonRequest('http://localhost/api/sorties', {
      method: 'POST',
      cookie,
      body: { titre: 'Sortie piscine', date: '2026-09-12', capacite: 25 },
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sortie.capacite).toBe(25);
    expect(data.sortie.date).toBe('2026-09-12');
  });

  it("modifier une sortie en vidant sa capacité ne renvoie pas 500 (et conserve l'ancienne valeur : capacite=COALESCE($12,capacite), une capacité vidée n'écrase pas — comportement actuel, pas testé comme souhaitable ici)", async () => {
    const created = await POST(jsonRequest('http://localhost/api/sorties', {
      method: 'POST',
      cookie,
      body: { titre: 'À corriger', date: '2026-09-15', capacite: 10 },
    }));
    const { sortie } = await created.json();

    const updated = await POST(jsonRequest('http://localhost/api/sorties', {
      method: 'POST',
      cookie,
      body: { id: sortie.id, capacite: '' },
    }));

    expect(updated.status).toBe(200);
    const data = await updated.json();
    expect(data.sortie.capacite).toBe(10);
  });
});
