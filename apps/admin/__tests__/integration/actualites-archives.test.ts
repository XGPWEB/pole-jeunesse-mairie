import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import pool from '@/lib/db';
import { GET } from '@/app/api/actualites/route';
import { todayLocal } from '@/lib/dates';
import { resetDb, seedAnimateur, cookieFor, jsonRequest } from './helpers';

/** GET /api/actualites : les événements passés sont archivés, rendus seulement sur demande. */
const decale = (jours: number) => {
  const d = new Date(`${todayLocal()}T12:00:00`);
  d.setDate(d.getDate() + jours);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
let cookie: string;
const ids = async (url: string) => ((await (await GET(jsonRequest(url, { cookie }))).json()) as { id: string }[]).map(a => a.id).sort();

beforeEach(async () => {
  await resetDb();
  cookie = await cookieFor(await seedAnimateur());
  const actu = (id: string, date: string, categorie: string, tenant = 'nogent') => pool.query(
    `INSERT INTO actualites (id, titre, date, categorie, tenant_id) VALUES ($1, $1, $2, $3, $4)`, [id, date, categorie, tenant]);
  await actu('ev-hier', decale(-1), 'Evenement');
  await actu('ev-jour', decale(0), 'evenement');
  await actu('ev-demain', decale(1), 'Evenement');
  await actu('info-ancienne', decale(-90), 'Info');
});
afterAll(async () => { await pool.end(); });

describe('GET /api/actualites', () => {
  it('par défaut : sans les événements passés', async () => {
    expect(await ids('/api/actualites')).toEqual(['ev-demain', 'ev-jour', 'info-ancienne']);
  });

  it('archives=1 : tout, événements passés compris', async () => {
    expect(await ids('/api/actualites?archives=1')).toEqual(['ev-demain', 'ev-hier', 'ev-jour', 'info-ancienne']);
  });
});
