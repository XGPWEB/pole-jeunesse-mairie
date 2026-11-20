import { test, expect, type Page } from '@playwright/test';
import * as OTPAuth from 'otpauth';

/**
 * E2E sur environnement LOCAL ISOLÉ (voir playwright.config.ts), commune C :
 *   <user>.c    admin — tableau de bord sur le jeu de données de
 *               scripts/seed-e2e.mjs (seedTableauDeBord) ;
 *   <user>.totp admin — activation puis usage du second facteur.
 * Ces deux comptes ne servent qu'ici : activer un second facteur sur un compte
 * partagé casserait les connexions des autres parcours.
 */
const USER = process.env.E2E_ADMIN_USER ?? '';
const PASS = process.env.E2E_ADMIN_PASS ?? '';

test.beforeAll(() => {
  if (!USER || !PASS) throw new Error('E2E_ADMIN_USER / E2E_ADMIN_PASS absents : lancer via `npm run test:e2e`.');
});

async function saisirIdentifiants(page: Page, username: string) {
  await page.goto('/login');
  await page.fill('input[placeholder="prenom.nom"]', username);
  await page.fill('input[placeholder="••••••••"]', PASS);
  await page.click('button[type="submit"]');
}

/** Valeur d'une carte de statistique, repérée par son libellé. */
const carte = (page: Page, libelle: string) =>
  page.getByText(libelle, { exact: true }).locator('xpath=preceding-sibling::div[1]');

test('tableau de bord : les chiffres affichés sont ceux de la base', async ({ page }) => {
  await saisirIdentifiants(page, `${USER}.c`);
  await page.waitForURL('**/admin/dashboard', { timeout: 30_000 });

  // 3 jeunes ; 3 activités + 2 sorties (passées et annulées comprises) ;
  // 3 pointages présents sur 4 ; 3 actualités ; 2 + 1 en liste d'attente.
  await expect(carte(page, 'Jeunes inscrits')).toHaveText('3');
  await expect(carte(page, 'Activités & Sorties')).toHaveText('5');
  await expect(carte(page, 'Taux de présence')).toHaveText('75%');
  await expect(carte(page, 'Actualités publiées')).toHaveText('3');
  await expect(carte(page, "Liste d'attente")).toHaveText('3');

  // Seulement ce qui est à venir, non annulé et récent.
  for (const titre of ['Atelier cuisine E2E', 'Tournoi foot E2E', 'Sortie accrobranche E2E', 'Actu récente 1 E2E', 'Actu récente 2 E2E']) {
    await expect(page.getByText(titre).first(), titre).toBeVisible();
  }
  for (const titre of ['Activité passée E2E', 'Sortie annulée E2E', 'Actu ancienne E2E']) {
    await expect(page.getByText(titre), titre).toHaveCount(0);
  }

  const corps = page.locator('body');
  await expect(corps).toContainText('Activité complète (8 places)');
  await expect(corps).toContainText('Plus que 2 place(s)');
  await expect(corps).toContainText('Sortie complète (2/2 participants)');
  await expect(corps).toContainText('1 inscription(s) en attente');
  await expect(corps).toContainText('3 jeune(s) en liste d');
  await expect(corps).toContainText('Tournoi foot E2E (2)');
});

test('tableau de bord : une autre commune ne voit aucune de ces données', async ({ page }) => {
  await saisirIdentifiants(page, `${USER}.b`);
  await page.waitForURL('**/admin/dashboard', { timeout: 30_000 });

  await expect(carte(page, 'Jeunes inscrits')).toHaveText('0');
  await expect(page.getByText('Atelier cuisine E2E')).toHaveCount(0);
  await expect(page.getByText('Sortie accrobranche E2E')).toHaveCount(0);
});

test('double authentification : activation, mauvais code refusé, bon code accepté, rejeu refusé', async ({ browser, baseURL }) => {
  const compte = `${USER}.totp`;

  // Activation par l'API, comme le fait la page Sécurité : le serveur génère le secret.
  const prep = await browser.newContext({ baseURL });
  expect((await prep.request.post('/api/auth/login', { data: { username: compte, password: PASS } })).status()).toBe(200);
  const depart = await prep.request.post('/api/auth/totp/setup', { data: { action: 'start', password: PASS } });
  expect(depart.status()).toBe(200);
  const { secret } = await depart.json();
  const totp = new OTPAuth.TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
  const activation = await prep.request.post('/api/auth/totp/setup', { data: { action: 'enable', password: PASS, code: totp.generate() } });
  expect(activation.status()).toBe(200);
  await prep.close();

  // Le mot de passe seul n'ouvre plus de session : l'écran du code s'affiche.
  const ctx = await browser.newContext({ baseURL });
  const page = await ctx.newPage();
  await saisirIdentifiants(page, compte);
  const champCode = page.locator('input[placeholder="000000"]');
  await expect(champCode).toBeVisible();
  expect((await ctx.cookies()).find(c => c.name === 'pj_token')).toBeUndefined();

  // Code du pas SUIVANT : celui du pas courant a été consommé par l'activation
  // (antirejeu), et le serveur accepte un pas d'écart.
  const bon = totp.generate({ timestamp: Date.now() + 30_000 });
  const mauvais = bon === '000000' ? '111111' : '000000';

  await champCode.fill(mauvais);
  await page.click('button[type="submit"]');
  await expect(page.locator('.bg-red-50')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  expect((await ctx.cookies()).find(c => c.name === 'pj_token')).toBeUndefined();

  await champCode.fill(bon);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin/dashboard', { timeout: 30_000 });
  await ctx.close();

  // Le même code, rejoué depuis une autre session, est refusé.
  const ctx2 = await browser.newContext({ baseURL });
  const page2 = await ctx2.newPage();
  await saisirIdentifiants(page2, compte);
  await page2.locator('input[placeholder="000000"]').fill(bon);
  await page2.click('button[type="submit"]');
  await expect(page2.locator('.bg-red-50')).toBeVisible();
  await expect(page2).toHaveURL(/\/login/);
  expect((await ctx2.cookies()).find(c => c.name === 'pj_token')).toBeUndefined();
  await ctx2.close();
});
