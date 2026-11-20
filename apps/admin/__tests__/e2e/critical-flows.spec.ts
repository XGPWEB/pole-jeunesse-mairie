import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

/**
 * E2E sur environnement LOCAL ISOLÉ (voir playwright.config.ts) : serveur Next
 * lancé par Playwright, base jetable pole_jeunesse_e2e recréée à chaque
 * exécution, comptes créés par scripts/seed-e2e.mjs avec un mot de passe
 * généré pour l'exécution. Aucune de ces valeurs n'existe hors de ce run.
 *
 * Comptes : <user> (admin, commune A), <user>.anim (animateur, commune A),
 *           <user>.b (admin, commune B).
 */
const USER = process.env.E2E_ADMIN_USER ?? '';
const PASS = process.env.E2E_ADMIN_PASS ?? '';

test.beforeAll(() => {
  if (!USER || !PASS) throw new Error('E2E_ADMIN_USER / E2E_ADMIN_PASS absents : lancer via `npm run test:e2e`.');
});

async function login(page: Page, username: string, destination: string) {
  await page.goto('/login');
  await page.fill('input[placeholder="prenom.nom"]', username);
  await page.fill('input[placeholder="••••••••"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL(`**${destination}`, { timeout: 30_000 });
}

async function apiLogin(request: APIRequestContext, username: string) {
  const res = await request.post('/api/auth/login', { data: { username, password: PASS } });
  expect(res.status()).toBe(200);
}

test('un visiteur anonyme est renvoyé au login et les API répondent 401', async ({ page, request }) => {
  await page.goto('/admin/dashboard');
  await expect(page).toHaveURL(/\/login/);

  for (const chemin of ['/api/jeunes', '/api/pointages?date=2026-10-06', '/api/notifications', '/api/animateurs/me']) {
    const res = await request.get(chemin);
    expect(res.status(), chemin).toBe(401);
  }
});

test('un mot de passe erroné est refusé sans ouvrir de session', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[placeholder="prenom.nom"]', USER);
  await page.fill('input[placeholder="••••••••"]', `${PASS}-faux`);
  await page.click('button[type="submit"]');
  await expect(page.getByText('Identifiants incorrects')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  const cookies = await page.context().cookies();
  expect(cookies.find(c => c.name === 'pj_token')).toBeUndefined();
});

test('login admin : dashboard, navigation et pages principales rendues', async ({ page }) => {
  await login(page, USER, '/admin/dashboard');
  await expect(page.locator('nav a, aside a').first()).toBeVisible();

  const routes = [
    { path: '/admin/jeunes', titre: /Jeunes/i },
    { path: '/admin/activites', titre: /Activit/i },
    { path: '/admin/animateurs', titre: /Animateur/i },
    { path: '/admin/conges', titre: /Cong/i },
  ];
  for (const { path, titre } of routes) {
    const reponse = await page.goto(path);
    expect(reponse?.status(), path).toBe(200);
    await expect(page.getByText(titre).first()).toBeVisible();
  }

  // Le compte admin de la commune A apparaît dans SA liste d'animateurs…
  await page.goto('/admin/animateurs');
  await expect(page.getByText(USER, { exact: false }).first()).toBeVisible();
});

test('un animateur ne peut pas ouvrir les pages réservées à l\'admin', async ({ page }) => {
  await login(page, `${USER}.anim`, '/animateur/dashboard');

  for (const chemin of ['/admin/dashboard', '/animateurs', '/securite', '/parametres', '/rgpd']) {
    await page.goto(chemin);
    await expect(page, chemin).toHaveURL(/\/animateur\/dashboard/);
  }

  // … ni appeler une opération d'administration.
  const res = await page.request.post('/api/auth/reset-password', { data: { animateurId: 'e2e-admin-a' } });
  expect(res.status()).toBe(403);
});

test('cloisonnement : la commune B ne voit ni ne modifie les données de la commune A', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    await apiLogin(ctxA.request, USER);
    await apiLogin(ctxB.request, `${USER}.b`);

    // A crée un projet avec une ligne de budget.
    const creation = await ctxA.request.post('/api/projets', {
      data: { titre: 'Projet E2E commune A', lignesBudget: [{ designation: 'Transport', cout: '120' }] },
    });
    expect(creation.ok()).toBeTruthy();
    const corps = await creation.json();
    const projetId: string = corps.projet?.id ?? corps.id;
    expect(projetId).toBeTruthy();

    // B ne le voit pas dans sa liste…
    const listeB = await (await ctxB.request.get('/api/projets')).json();
    expect(JSON.stringify(listeB)).not.toContain('Projet E2E commune A');

    // … et ne peut ni le modifier ni le supprimer en devinant son identifiant.
    const modif = await ctxB.request.post('/api/projets', { data: { id: projetId, titre: 'Détourné par B' } });
    expect(modif.ok()).toBeFalsy();
    const suppr = await ctxB.request.delete(`/api/projets?id=${encodeURIComponent(projetId)}`);
    expect([403, 404]).toContain(suppr.status());

    const listeA = await (await ctxA.request.get('/api/projets')).json();
    expect(JSON.stringify(listeA)).toContain('Projet E2E commune A');
    expect(JSON.stringify(listeA)).not.toContain('Détourné par B');

    // La page de B sur l'identifiant de A répond « introuvable ».
    const pageB = await ctxB.newPage();
    const reponse = await pageB.goto(`/admin/projets/${projetId}`);
    expect(reponse?.status()).toBe(404);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test('révocation : un cookie copié reste refusé après déconnexion puis reconnexion', async ({ browser }) => {
  const victime = await browser.newContext();
  const copie = await browser.newContext();
  try {
    await apiLogin(victime.request, `${USER}.anim`);
    const jeton = (await victime.cookies()).find(c => c.name === 'pj_token');
    expect(jeton).toBeDefined();

    // « Vol » du cookie : même valeur dans un autre navigateur.
    await copie.addCookies([jeton!]);
    expect((await copie.request.get('/api/animateurs/me')).status()).toBe(200);

    expect((await victime.request.post('/api/auth/logout')).ok()).toBeTruthy();
    expect((await copie.request.get('/api/animateurs/me')).status()).toBe(401);

    // La reconnexion du titulaire ne doit PAS réactiver la copie (constat 3).
    await apiLogin(victime.request, `${USER}.anim`);
    expect((await victime.request.get('/api/animateurs/me')).status()).toBe(200);
    expect((await copie.request.get('/api/animateurs/me')).status()).toBe(401);

    const pageCopie = await copie.newPage();
    await pageCopie.goto('/animateur/dashboard');
    await expect(pageCopie).toHaveURL(/\/login/);
  } finally {
    await victime.close();
    await copie.close();
  }
});

test('mot de passe oublié : réponse générique et mot de passe inchangé', async ({ request, browser }) => {
  const connu = await request.post('/api/auth/forgot-password', { data: { username: `${USER}.anim` } });
  const inconnu = await request.post('/api/auth/forgot-password', { data: { username: 'compte.inexistant' } });
  expect(connu.status()).toBe(200);
  expect(inconnu.status()).toBe(200);
  expect(await connu.json()).toEqual(await inconnu.json());

  // La demande anonyme n'a rien détruit : l'ancien mot de passe ouvre toujours la session.
  const ctx = await browser.newContext();
  try {
    await apiLogin(ctx.request, `${USER}.anim`);
  } finally {
    await ctx.close();
  }
});

test('fiche détaillée d\'un jeune : protégée, et « introuvable » sous un vrai serveur Next', async ({ request, browser }) => {
  // Anonyme : la route dynamique passe bien par le proxy et la garde.
  expect((await request.get('/api/jeunes/identifiant-inexistant/fiche')).status()).toBe(401);

  const ctx = await browser.newContext();
  try {
    await apiLogin(ctx.request, `${USER}.anim`);
    const res = await ctx.request.get('/api/jeunes/identifiant-inexistant/fiche');
    expect(res.status()).toBe(404);
    expect(res.headers()['cache-control']).toContain('no-store');
  } finally {
    await ctx.close();
  }
});

test('favicon : servi sans session et déclaré sur la page de connexion', async ({ page, request }) => {
  for (const [chemin, type] of [['/favicon.ico', 'image/'], ['/icon.png', 'image/png'], ['/apple-icon.png', 'image/png']] as const) {
    const res = await request.get(chemin);
    expect(res.status(), chemin).toBe(200);
    expect(res.headers()['content-type'], chemin).toContain(type);
    expect((await res.body()).length, chemin).toBeGreaterThan(500);
  }
  await page.goto('/login');
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute('href', /favicon\.ico|icon\.png/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', /apple-icon\.png/);
});

test('version affichée et page Monitoring : un rapport du navigateur apparaît dans le journal de l\'exploitant seulement', async ({ page, browser, request }) => {
  const sante = await (await request.get('/api/health')).json();
  expect(sante.version).toMatch(/^\d+\.\d+\.\d+$/);

  // Rapport anonyme, comme l'enverrait une page en erreur.
  const marque = `Erreur de test E2E ${Date.now()}`;
  const rapport = await request.post('/api/monitoring/report', {
    data: { kind: 'js_error', message: marque, path: '/login?jeton=secret' },
  });
  expect(rapport.status()).toBe(200);
  // Le journal n'est pas lisible sans session.
  expect((await request.get('/api/monitoring/events')).status()).toBe(401);

  await login(page, USER, '/admin/dashboard');
  await expect(page.getByText(`v${sante.version}`, { exact: false }).first()).toBeVisible();

  await page.goto('/admin/monitoring');
  await expect(page.getByRole('heading', { name: 'Répartition par type' })).toBeVisible();
  await expect(page.getByText(marque)).toBeVisible();
  await expect(page.getByText('Erreur JavaScript — interface web').first()).toBeVisible();
  // La chaîne de requête du chemin signalé n'est pas conservée.
  await expect(page.getByText('jeton=secret')).toHaveCount(0);

  // Suppression de l'entrée depuis la page.
  await page.getByRole('button', { name: /Supprimer l'entrée « Erreur JavaScript/ }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.getByText(marque)).toHaveCount(0);

  // L'admin d'une autre commune n'y a pas accès, ni à la page ni à l'API.
  const ctxB = await browser.newContext();
  try {
    await apiLogin(ctxB.request, `${USER}.b`);
    expect((await ctxB.request.get('/api/monitoring/events')).status()).toBe(403);
    const pageB = await ctxB.newPage();
    await pageB.goto('/admin/monitoring');
    await expect(pageB).toHaveURL(/\/admin\/dashboard/);
  } finally {
    await ctxB.close();
  }
});
