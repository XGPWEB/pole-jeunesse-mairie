import { test, expect, type Page } from '@playwright/test';

/**
 * Pièce « fiche AGORA » dans un vrai navigateur (audit 2026-10-07, A1).
 * E2E sur environnement LOCAL ISOLÉ (voir playwright.config.ts), commune D,
 * compte <user>.d — données dans scripts/seed-e2e.mjs (seedFicheAgora).
 *
 * Les refus (HTML, SVG, taille, type annoncé faux) sont couverts en
 * intégration, où l'action serveur est appelée sans passer par le formulaire.
 * Ici : les usages légitimes s'affichent toujours, et une pièce active déjà
 * en base ne s'exécute plus.
 */
const USER = process.env.E2E_ADMIN_USER ?? '';
const PASS = process.env.E2E_ADMIN_PASS ?? '';

// PNG 1×1 valide.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
// PDF d'environ 2 Mo : au-delà de la limite par défaut des actions serveur de Next (1 Mo).
const PDF_2_MO = Buffer.concat([
  Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n', 'latin1'),
  Buffer.alloc(2 * 1024 * 1024, '% remplissage\n', 'latin1'),
  Buffer.from('\n%%EOF\n', 'latin1'),
]);

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

/** Crée un jeune par le formulaire avec la pièce donnée ; rend l'URL de sa pièce AGORA. */
async function creerAvecPiece(page: Page, prenom: string, fichier: { name: string; mimeType: string; buffer: Buffer }): Promise<string> {
  await page.goto('/jeunes/nouveau');
  await page.fill('input[placeholder="Prénom"]', prenom);
  await page.fill('input[placeholder="NOM"]', 'AGORA');
  await page.fill('input[type="date"]', '2012-03-04');
  await page.setInputFiles('input[type="file"][data-piece="enfant"]', fichier);
  await expect(page.getByText(fichier.name, { exact: true })).toBeVisible();
  await page.click('button[type="submit"]');
  const lien = page.getByRole('link', { name: /Imprimer la fiche AGORA/ });
  await expect(lien).toBeVisible({ timeout: 30_000 });
  return (await lien.getAttribute('href'))!;
}

test('formulaire jeune : la liste des espaces est celle de la commune, pas une liste figée', async ({ page }) => {
  await connecter(page);
  await page.goto('/jeunes/nouveau');
  // La commune D n'a qu'un espace (seed-e2e.mjs) : ni lycéens, ni PIJ, ni CLAS.
  await expect(page.locator('select').filter({ hasText: 'Collégiens' }).locator('option')).toHaveText(['Collégiens (11-14 ans)']);
});

test('image PNG : enregistrée par le formulaire, puis affichée par le navigateur', async ({ page }) => {
  await connecter(page);
  const url = await creerAvecPiece(page, 'Image', { name: 'fiche-agora.png', mimeType: 'image/png', buffer: PNG });

  const res = await page.request.get(url);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('image/png');
  expect(res.headers()['content-disposition']).toMatch(/^inline; /);
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
  expect((await res.body()).equals(PNG)).toBe(true);
  // Politique propre à la route, sans bac à sable ; les autres en-têtes globaux restent posés.
  expect(res.headers()['content-security-policy']).toBe("frame-ancestors 'none'");
  expect(res.headers()['x-frame-options']).toBe('DENY');

  // Ouverte comme le fait le lien « Imprimer » : le navigateur rend bien une image.
  await page.goto(url);
  expect(await page.evaluate(() => document.images[0]?.naturalWidth)).toBe(1);
});

test('PDF de 2 Mo : enregistré par le formulaire et resservi à l\'identique comme PDF', async ({ page }) => {
  await connecter(page);
  const url = await creerAvecPiece(page, 'Document', { name: 'fiche-agora.pdf', mimeType: 'application/pdf', buffer: PDF_2_MO });

  const res = await page.request.get(url);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('application/pdf');
  expect(res.headers()['content-disposition']).toMatch(/^inline; /);
  expect((await res.body()).equals(PDF_2_MO)).toBe(true);
});

test('pièce HTML enregistrée avant le contrôle : téléchargée, jamais exécutée', async ({ page }) => {
  await connecter(page);
  const url = '/api/jeunes/fiche-agora?id=e2e-j-html';

  const res = await page.request.get(url);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('application/octet-stream');
  expect(res.headers()['content-disposition']).toMatch(/^attachment; /);
  expect(res.headers()['content-security-policy']).toContain('sandbox');
  expect(res.headers()['content-security-policy']).not.toContain('unsafe-inline');
  // … et le reste du site garde sa politique habituelle.
  expect((await page.request.get('/login')).headers()['content-security-policy']).toContain("default-src 'self'");

  // Le lien de la fiche ouvre un téléchargement : aucun document HTML n'est rendu sur l'origine du site.
  await page.goto('/jeunes/e2e-j-html');
  const titreAvant = await page.title();
  const [telechargement] = await Promise.all([
    page.waitForEvent('download'),
    page.goto(url).catch(() => { /* la navigation est remplacée par le téléchargement */ }),
  ]);
  expect(telechargement.suggestedFilename()).toBe('ancienne-piece.html');
  for (const p of page.context().pages()) {
    expect(await p.title()).not.toContain('SCRIPT-EXECUTE-E2E');
    expect(await p.title()).not.toContain('PIECE-ACTIVE-E2E');
  }
  expect(await page.title()).toBe(titreAvant);
});
