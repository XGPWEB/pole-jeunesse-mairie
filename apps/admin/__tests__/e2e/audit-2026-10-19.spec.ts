import { test, expect } from '@playwright/test';
import { Pool } from 'pg';
import { SignJWT } from 'jose';
import { randomUUID } from 'crypto';

// Base exclusivement jetable, comme playwright.config.ts ; aucun compte réel.
const databaseUrl = process.env.E2E_DATABASE_URL
  ?? `postgresql://${process.env.PGUSER ?? process.env.USER}@localhost:5432/pole_jeunesse_e2e`;
const cible = new URL(databaseUrl);
if (!['localhost', '127.0.0.1', '[::1]'].includes(cible.hostname)
  || !/^\/pole_jeunesse_e2e[a-z0-9_]*$/.test(cible.pathname)) throw new Error('Base E2E locale requise');
const pool = new Pool({ connectionString: databaseUrl });
const compteId = `audit-${randomUUID()}`;
const jeuneId = `audit-${randomUUID()}.png`;
let token: string;

test.beforeAll(async () => {
  const secret = process.env.E2E_JWT_SECRET;
  if (!secret) throw new Error('Secret E2E absent');
  await pool.query(`INSERT INTO animateurs (id, nom, prenom, username, statut, role, tenant_id, rubriques)
    VALUES ($1, 'Audit', 'Local', $1, 'actif', 'admin', 'e2e-a', '{}')`, [compteId]);
  await pool.query(`INSERT INTO jeunes (id, nom, prenom, tenant_id) VALUES ($1, 'Audit', 'Local', 'e2e-a')`, [jeuneId]);
  token = await new SignJWT({ id: compteId, role: 'admin', auth_time: Math.floor(Date.now() / 1000), sv: 0, rubriques: [] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('10m')
    .sign(new TextEncoder().encode(secret));
});
test.afterAll(async () => { await pool.end(); });

test('une extension d’image dans un identifiant ne contourne pas les droits de rubrique', async ({ request }) => {
  const res = await request.get(`/api/jeunes/${jeuneId}/fiche`, { headers: { Cookie: `pj_token=${token}` } });
  expect(res.status()).toBe(403);
});

test('une rubrique encodée ne donne accès à aucune donnée retirée', async ({ request }) => {
  const res = await request.get('/api/%70ij/accueils', { headers: { Cookie: `pj_token=${token}` } });
  expect([403, 404]).toContain(res.status());
});

test('le logo de connexion reste public', async ({ request }) => {
  for (const chemin of ['/logo-pj.png', '/icon.png', '/apple-icon.png']) {
    const res = await request.get(chemin);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
  }
});

test('une rubrique Activités permet la recherche résumée, mais pas les contacts de la fiche', async ({ request }) => {
  await pool.query('UPDATE animateurs SET rubriques = $2 WHERE id = $1', [compteId, ['activites']]);
  const jetonActivites = await new SignJWT({ id: compteId, role: 'admin', auth_time: Math.floor(Date.now() / 1000), sv: 0, rubriques: ['activites'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('10m')
    .sign(new TextEncoder().encode(process.env.E2E_JWT_SECRET));
  const headers = { Cookie: `pj_token=${jetonActivites}` };
  expect((await request.get('/api/jeunes', { headers })).status()).toBe(200);
  // La route de fiche détaillée (application mobile) n'existe plus : 404.
  expect([403, 404]).toContain((await request.get(`/api/jeunes/${jeuneId}/fiche`, { headers })).status());
});

test('un ancien bon de commande HTML garde le bac à sable dans la réponse HTTP réelle', async ({ request }) => {
  const id = `audit-bon-${randomUUID()}`;
  const contenu = `data:text/html;base64,${Buffer.from('<script>alert(document.domain)</script>').toString('base64')}`;
  await pool.query('INSERT INTO sorties (id, titre, tenant_id, bon_commande) VALUES ($1,$1,$2,$3)', [id, 'e2e-a', contenu]);
  const session = await new SignJWT({ id: 'e2e-admin-a', role: 'admin', auth_time: Math.floor(Date.now() / 1000), sv: 0, rubriques: null })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('10m')
    .sign(new TextEncoder().encode(process.env.E2E_JWT_SECRET));
  const res = await request.get(`/api/sorties/bon-commande?id=${id}`, { headers: { Cookie: `pj_token=${session}` } });
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('application/octet-stream');
  expect(res.headers()['content-disposition']).toMatch(/^attachment;/);
  expect(res.headers()['content-security-policy']).toContain('sandbox');
});

test('le profil demande le mot de passe pour changer l’adresse et renvoie vers la connexion', async ({ page }) => {
  await page.goto('/login');
  await page.getByPlaceholder('prenom.nom').fill(`${process.env.E2E_ADMIN_USER}.anim`);
  await page.getByPlaceholder('••••••••', { exact: true }).fill(process.env.E2E_ADMIN_PASS!);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL('**/animateur/dashboard');
  await page.goto('/animateur/profil');
  await page.getByLabel('Adresse email', { exact: true }).fill('audit-profil@example.test');
  await page.getByLabel('Mot de passe actuel pour changer l’adresse email').fill(process.env.E2E_ADMIN_PASS!);
  await page.getByRole('button', { name: 'Enregistrer les modifications' }).click();
  await page.waitForURL('**/login');
});
