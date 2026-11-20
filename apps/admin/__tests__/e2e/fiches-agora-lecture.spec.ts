import { test, expect, type Page } from '@playwright/test';
import { MINI_FICHE_ENFANT, pdfFictif } from '../fiches-agora-fictives';

/**
 * Lecture automatique d'une édition AGORA à la création d'un jeune, et
 * impression à la demande des fiches sanitaires d'une sortie.
 * E2E sur environnement LOCAL ISOLÉ (voir playwright.config.ts), commune D,
 * compte <user>.d — données fictives dans scripts/seed-e2e.mjs (seedFicheAgora).
 */
const USER = process.env.E2E_ADMIN_USER ?? '';
const PASS = process.env.E2E_ADMIN_PASS ?? '';

test.beforeAll(() => {
  if (!USER || !PASS) throw new Error('E2E_ADMIN_USER / E2E_ADMIN_PASS absents : lancer via `npm run test:e2e`.');
});

async function connecter(page: Page) {
  await page.goto('/login');
  await page.fill('input[placeholder="prenom.nom"]', `${USER}.d`);
  await page.fill('input[placeholder="••••••••"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin/dashboard', { timeout: 30_000 });
}

test('nouveau jeune : la fiche enfant AGORA déposée remplit le formulaire et reste jointe', async ({ page }) => {
  await connecter(page);
  await page.goto('/jeunes/nouveau');
  await page.setInputFiles('input[type="file"][data-piece="agora"]', {
    name: 'fiche_enfant.pdf', mimeType: 'application/pdf', buffer: pdfFictif(MINI_FICHE_ENFANT),
  });

  await expect(page.getByText(/Fiche enfant lue \(fiche_enfant\.pdf\)/)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('input[placeholder="Prénom"]')).toHaveValue('Sacha');
  await expect(page.locator('input[placeholder="NOM"]')).toHaveValue('DURAND-LEROY');
  await expect(page.locator('input[type="date"]')).toHaveValue('2012-04-03');
  await expect(page.getByLabel('Lieu de naissance')).toHaveValue('Nogent Sur Marne');
  await expect(page.getByLabel('Adresse')).toHaveValue('12 Rue des Lilas');
  await expect(page.getByText('Nouveau fichier — sera enregistré avec la fiche.')).toHaveCount(1);

  await page.click('button[type="submit"]');
  await expect(page.getByRole('link', { name: /Imprimer la fiche AGORA/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: /Sacha\s+DURAND-LEROY/i })).toBeVisible();
});

test('une fiche AGORA d\'un autre jeune est refusée et ne modifie rien', async ({ page }) => {
  await connecter(page);
  await page.goto('/jeunes/nouveau');
  await page.fill('input[placeholder="Prénom"]', 'Camille');
  await page.fill('input[placeholder="NOM"]', 'AUTRE');
  await page.setInputFiles('input[type="file"][data-piece="agora"]', {
    name: 'fiche_enfant.pdf', mimeType: 'application/pdf', buffer: pdfFictif(MINI_FICHE_ENFANT),
  });

  await expect(page.getByText(/est celle de Sacha DURAND-LEROY/)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('input[placeholder="Prénom"]')).toHaveValue('Camille');
  await expect(page.getByText('Nouveau fichier — sera enregistré avec la fiche.')).toHaveCount(0);
});

test('sortie : les fiches sanitaires s\'ouvrent à part, rien ne s\'imprime sans clic, on choisit les jeunes', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { impressions: number }).impressions = 0;
    window.print = () => { (window as unknown as { impressions: number }).impressions += 1; };
  });
  const impressions = () => page.evaluate(() => (window as unknown as { impressions: number }).impressions);
  await connecter(page);

  // La fiche sortie renvoie vers les fiches sanitaires sans les contenir.
  await page.goto('/animateur/sorties/e2e-sortie-d/print');
  await expect(page.getByText('FICHE SORTIE')).toBeVisible();
  await expect(page.getByText('Arachide')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Fiches sanitaires des participants/ })).toHaveAttribute('href', '/animateur/sorties/e2e-sortie-d/fiches-sanitaires');

  await page.goto('/animateur/sorties/e2e-sortie-d/fiches-sanitaires');
  // Deux participants confirmés ; celui en liste d'attente n'a pas de fiche.
  await expect(page.locator('.page')).toHaveCount(2);
  const alix = page.locator('.page', { hasText: 'SANITAIRE Alix' });
  await expect(alix).toContainText('Arachide');
  await expect(alix).toContainText('Asthme');
  await expect(alix).toContainText('BERNARD Paul — 01 98 76 54 32');
  await expect(alix).toContainText('06 12 34 56 78');
  await expect(alix).toContainText('02/01/2020');
  const lou = page.locator('.page', { hasText: 'SANSFICHE Lou' });
  await expect(lou).toContainText('Aucune allergie renseignée');
  await expect(lou).toContainText('Non renseigné');
  await expect(page.getByText('aucun renseignement médical saisi')).toHaveCount(1);
  expect(await impressions()).toBe(0);

  // L'animateur a déjà la fiche de Lou : il la décoche.
  await page.getByLabel('SANSFICHE Lou').uncheck();
  await expect(lou).toBeHidden();
  await expect(alix).toBeVisible();
  await page.getByRole('button', { name: 'Imprimer 1 fiche' }).click();
  expect(await impressions()).toBe(1);

  await page.getByRole('button', { name: 'Tout décocher' }).click();
  await expect(page.getByRole('button', { name: /Imprimer 0 fiche/ })).toBeDisabled();
});
