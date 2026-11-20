import { test, expect, type Page } from '@playwright/test';

/**
 * Les administrateurs supervisent : ils ne font pas partie de l'équipe
 * mobilisable. Ils sont listés dans Administration › Administrateurs (page du
 * compte qui gère les droits), pas avec les animateurs, et n'apparaissent pas
 * dans les listes d'animateurs des activités.
 *
 * Commune F (scripts/seed-e2e.mjs) : <user>.f (admin qui gère les droits),
 * <user>.superviseur (admin), <user>.animatrice (animatrice).
 */
const USER = process.env.E2E_ADMIN_USER ?? '';
const PASS = process.env.E2E_ADMIN_PASS ?? '';

async function login(page: Page, username: string) {
  await page.goto('/login');
  await page.fill('input[placeholder="prenom.nom"]', username);
  await page.fill('input[placeholder="••••••••"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin/dashboard', { timeout: 30_000 });
}

test('les administrateurs ont leur propre page, hors de l’équipe', async ({ page }) => {
  await login(page, `${USER}.f`);

  // Équipe : seulement les animateurs.
  await page.goto('/admin/animateurs');
  await expect(page.getByText(`@${USER}.animatrice`)).toBeVisible();
  await expect(page.getByText(`@${USER}.superviseur`)).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(0);

  // Administration › Administrateurs, dans le menu.
  await page.getByRole('button', { name: 'Administration' }).click();
  await page.getByRole('link', { name: 'Administrateurs' }).click();
  await page.waitForURL('**/admin/administrateurs');
  await expect(page.getByText(`@${USER}.superviseur`)).toBeVisible();
  await expect(page.getByText(`@${USER}.animatrice`)).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Espace' })).toHaveCount(0);

  // Création : ni espace, ni contrat, ni date d'embauche.
  await page.getByRole('button', { name: '+ Nouvel administrateur' }).click();
  await expect(page.getByRole('heading', { name: 'Nouvel administrateur' })).toBeVisible();
  await expect(page.getByText('Espace assigné')).toHaveCount(0);
  await expect(page.getByText('Date d\'embauche')).toHaveCount(0);
  await expect(page.getByText('Type de contrat')).toHaveCount(0);
});

test('un administrateur n’est pas proposé comme animateur d’une activité', async ({ page }) => {
  await login(page, `${USER}.f`);
  await page.goto('/admin/activites/nouvelle');
  const choix = page.locator('select:has(option:text-is("— Sélectionner —")) option');
  await expect(choix).toHaveText(['— Sélectionner —', 'Animatrice E2E']);
});

test('la page Administrateurs est réservée au compte qui gère les droits', async ({ page }) => {
  await login(page, `${USER}.superviseur`);
  await expect(page.getByRole('link', { name: 'Administrateurs' })).toHaveCount(0);
  await page.goto('/admin/administrateurs');
  await expect(page).toHaveURL(/\/admin\/dashboard/);
});
