import { defineConfig, devices } from '@playwright/test';
import { randomBytes } from 'crypto';

/**
 * E2E — environnement LOCAL ISOLÉ uniquement.
 *
 * Cette configuration ciblait auparavant la production par défaut
 * (`E2E_BASE_URL ?? 'https://jeunessenogent.cloud'`) : un simple
 * `npx playwright test` se connectait au service réel avec un compte admin.
 * Désormais :
 *   - la cible par défaut est un serveur Next lancé par Playwright lui-même sur
 *     127.0.0.1, branché sur une base PostgreSQL jetable (`pole_jeunesse_e2e`,
 *     détruite et recréée à chaque lancement par scripts/e2e-server.sh) ;
 *   - toute URL non locale est REFUSÉE, même fournie explicitement ;
 *   - le secret JWT et le mot de passe du compte de test sont générés à chaque
 *     exécution, jamais écrits sur disque ni versionnés.
 */
const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${E2E_PORT}`;

const HOTES_LOCAUX = new Set(['localhost', '127.0.0.1', '[::1]']);
const hote = new URL(baseURL).hostname;
if (!HOTES_LOCAUX.has(hote) && !hote.endsWith('.localhost')) {
  throw new Error(
    `[e2e] REFUS : E2E_BASE_URL="${baseURL}" n'est pas un hôte local. ` +
    `Les E2E créent des comptes et écrivent en base : ils ne tournent que contre ` +
    `un serveur local et une base jetable.`,
  );
}

const E2E_DB_NAME = 'pole_jeunesse_e2e';
const databaseUrl =
  process.env.E2E_DATABASE_URL ?? `postgresql://${process.env.PGUSER ?? process.env.USER}@localhost:5432/${E2E_DB_NAME}`;
if (!new URL(databaseUrl).pathname.startsWith(`/${E2E_DB_NAME}`) || !HOTES_LOCAUX.has(new URL(databaseUrl).hostname)) {
  throw new Error(`[e2e] REFUS : la base E2E doit être locale et s'appeler ${E2E_DB_NAME}*.`);
}

// Générés une fois dans le processus principal ; les workers Playwright et le
// serveur web héritent de process.env et voient donc les mêmes valeurs.
process.env.E2E_ADMIN_USER ??= 'e2e.admin';
process.env.E2E_ADMIN_PASS ??= randomBytes(18).toString('base64url');
process.env.E2E_JWT_SECRET ??= randomBytes(48).toString('base64url');

export default defineConfig({
  testDir: './__tests__/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // une seule base partagée
  reporter: 'list',
  use: {
    baseURL,
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'bash scripts/e2e-server.sh',
    url: `${baseURL}/api/health`,
    timeout: 180_000,
    // Jamais de réutilisation d'un serveur déjà présent : il pourrait être
    // branché sur une autre base que la base jetable.
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      E2E_PORT: String(E2E_PORT),
      E2E_DB_NAME,
      DATABASE_URL: databaseUrl,
      JWT_SECRET: process.env.E2E_JWT_SECRET,
      E2E_ADMIN_USER: process.env.E2E_ADMIN_USER,
      E2E_ADMIN_PASS: process.env.E2E_ADMIN_PASS,
      // Aucun courriel réel ne doit partir pendant les E2E.
      SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '',
      // La commune A des comptes de test tient le rôle d'exploitant de l'instance.
      MONITORING_OWNER_TENANT: 'e2e-a',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
