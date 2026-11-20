import { test, expect, type Page } from '@playwright/test';

/**
 * Création d'un compte depuis la page Équipe, avec le mot de passe proposé
 * par l'écran. Régression 2.10.1 : ce mot de passe ne respectait la politique
 * (S10) qu'environ 4 fois sur 10 et la création échouait avec « Le mot de
 * passe doit contenir au moins un caractère spécial ».
 *
 * Commune F (scripts/seed-e2e.mjs) : <user>.f gère les droits.
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

test('un compte se crée avec le mot de passe proposé, sans le modifier', async ({ page }, info) => {
  await login(page, `${USER}.f`);
  await page.goto('/admin/animateurs');
  await page.getByRole('button', { name: '+ Nouvel animateur' }).click();
  await expect(page.getByRole('heading', { name: 'Nouvel animateur' })).toBeVisible();

  // Nom distinct à chaque répétition : l'identifiant est dérivé du nom.
  const nom = `Creation${String.fromCharCode(97 + (info.repeatEachIndex % 26))}${String.fromCharCode(97 + Math.floor(info.repeatEachIndex / 26))}`;
  await page.getByRole('textbox', { name: 'Prénom', exact: true }).fill('Essai');
  await page.getByRole('textbox', { name: 'Nom', exact: true }).fill(nom);
  await page.getByRole('textbox', { name: 'Email professionnel' }).fill(`essai.${nom.toLowerCase()}@example.test`);
  await page.getByRole('button', { name: 'Créer le compte' }).click();

  await expect(page.getByText('Compte créé et enregistré !')).toBeVisible();
  await expect(page.getByText(/mot de passe doit/i)).toHaveCount(0);
});
