import { test, expect, type Page } from '@playwright/test';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

/**
 * Modal « Réinitialisation demandée » de la page Équipe (retour de revue du
 * 20 octobre 2026, point 2). Deux échecs à distinguer :
 *  - l'enregistrement est refusé : le mot de passe proposé ne fonctionne pas,
 *    l'écran ne doit pas inviter à le transmettre ;
 *  - l'enregistrement réussit mais le courriel échoue : le transmettre de vive
 *    voix est le secours prévu.
 * Aucun courriel réel : le serveur E2E n'a pas de SMTP (playwright.config.ts),
 * l'envoi échoue donc toujours.
 *
 * Commune dédiée, créée et supprimée ici : un administrateur limité à la
 * rubrique Animateurs, deux animatrices qui ont demandé une réinitialisation.
 */
const databaseUrl = process.env.E2E_DATABASE_URL
  ?? `postgresql://${process.env.PGUSER ?? process.env.USER}@localhost:5432/pole_jeunesse_e2e`;
const base = new URL(databaseUrl);
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
  || !/^\/pole_jeunesse_e2e[a-z0-9_]*$/.test(base.pathname)) throw new Error('Base E2E locale requise');
const pool = new Pool({ connectionString: databaseUrl });

const PASS = process.env.E2E_ADMIN_PASS ?? '';
const suffixe = randomUUID().slice(0, 8);
const tenant = `e2e-revue-${suffixe}`;
const auteur = `revue.auteur.${suffixe}`;
// Menu animateur complet : plus large que celui de l'auteur, qui ne peut donc
// pas toucher à ce compte (modifierAnimateur refuse l'enregistrement).
const protegee = { id: `revue-protegee-${suffixe}`, username: `revue.protegee.${suffixe}`, rubriques: null as string[] | null };
// Aucune rubrique : dans le périmètre de l'auteur, l'enregistrement passe.
const ordinaire = { id: `revue-ordinaire-${suffixe}`, username: `revue.ordinaire.${suffixe}`, rubriques: [] as string[] };
let hashInitial = '';

test.beforeAll(async () => {
  hashInitial = await bcrypt.hash(PASS, 10);
  await pool.query('INSERT INTO tenants (id, nom) VALUES ($1, $2)', [tenant, 'Commune E2E revue']);
  await pool.query(
    `INSERT INTO animateurs (id, nom, prenom, username, statut, role, tenant_id, password_hash, rubriques)
     VALUES ($1, 'E2E', 'Auteur', $2, 'actif', 'admin', $3, $4, '{animateurs}')`,
    [`revue-auteur-${suffixe}`, auteur, tenant, hashInitial],
  );
  for (const [compte, prenom] of [[protegee, 'Protegee'], [ordinaire, 'Ordinaire']] as const) {
    await pool.query(
      `INSERT INTO animateurs (id, nom, prenom, username, email, statut, role, tenant_id, espace_assigne,
                               password_hash, password_reset_requested, rubriques)
       VALUES ($1, 'E2E', $2, $3, $4, 'actif', 'animateur', $5, 'Collégiens', $6, TRUE, $7)`,
      [compte.id, prenom, compte.username, `${compte.username}@example.test`, tenant, hashInitial, compte.rubriques],
    );
  }
});
test.afterAll(async () => {
  await pool.query('DELETE FROM audit_log WHERE tenant_id = $1', [tenant]).catch(() => {});
  await pool.query('DELETE FROM animateurs WHERE tenant_id = $1', [tenant]);
  await pool.query('DELETE FROM tenants WHERE id = $1', [tenant]);
  await pool.end();
});

async function ouvrirDemande(page: Page, username: string): Promise<string> {
  await page.goto('/login');
  await page.fill('input[placeholder="prenom.nom"]', auteur);
  await page.fill('input[placeholder="••••••••"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin/dashboard', { timeout: 30_000 });
  await page.goto('/admin/animateurs');
  await page.locator('tr', { hasText: `@${username}` }).getByRole('button', { name: 'Réinitialiser' }).click();
  await expect(page.getByRole('heading', { name: 'Réinitialisation demandée' })).toBeVisible();
  const propose = (await page.getByText('Nouveau mot de passe qui sera envoyé').locator('xpath=following-sibling::p').innerText()).trim();
  expect(propose).toHaveLength(12);
  return propose;
}
const hashDe = async (id: string) =>
  (await pool.query<{ password_hash: string }>('SELECT password_hash FROM animateurs WHERE id = $1', [id])).rows[0].password_hash;

test('enregistrement refusé : rien n’est envoyé et le mot de passe proposé n’est pas à transmettre', async ({ page }) => {
  const propose = await ouvrirDemande(page, protegee.username);
  await page.getByRole('button', { name: /Générer et envoyer/ }).click();

  const alerte = page.getByRole('alert').filter({ hasText: 'Mot de passe non enregistré' });
  await expect(alerte).toBeVisible();
  await expect(alerte).toContainText('ne transmettez pas');
  await expect(page.getByText(/Communiquez/)).toHaveCount(0);
  await expect(page.getByText(propose, { exact: true })).toHaveCount(0);
  // Le compte garde son mot de passe.
  expect(await hashDe(protegee.id)).toBe(hashInitial);
});

test('courriel en échec après enregistrement : le mot de passe affiché est bien celui du compte', async ({ page }) => {
  const propose = await ouvrirDemande(page, ordinaire.username);
  await page.getByRole('button', { name: /Générer et envoyer/ }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'Échec de l\'envoi email' })).toBeVisible();
  await expect(page.getByText('Le nouveau mot de passe est enregistré. Communiquez-le manuellement')).toBeVisible();
  await expect(page.getByText(propose, { exact: true })).toBeVisible();
  // Ce qui est proposé à la transmission manuelle fonctionne réellement.
  expect(await bcrypt.compare(propose, await hashDe(ordinaire.id))).toBe(true);
});
