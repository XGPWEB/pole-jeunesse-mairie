import { test, expect, type Page } from '@playwright/test';
import { xlsxFictif } from '../xlsx-fictif';

/**
 * Module PIJ dans un vrai navigateur. E2E sur environnement LOCAL ISOLÉ (voir
 * playwright.config.ts), commune E — comptes <user>.pij (informateur PIJ) et
 * <user>.college (animateur Collégiens), créés par scripts/seed-e2e.mjs.
 *
 * Les refus de l'API sont couverts en intégration (pij.test.ts) ; ici : le
 * parcours de saisie de l'informateur, et ce que voit un animateur d'un autre
 * espace.
 */
const USER = process.env.E2E_ADMIN_USER ?? '';
const PASS = process.env.E2E_ADMIN_PASS ?? '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  if (!USER || !PASS) throw new Error('E2E_ADMIN_USER / E2E_ADMIN_PASS absents : lancer via `npm run test:e2e`.');
});

async function connecter(page: Page, suffixe: 'pij' | 'college') {
  await page.goto('/login');
  await page.waitForLoadState('networkidle'); // champ vidé si rempli avant l'hydratation (démarrage à froid)
  await page.fill('input[placeholder="prenom.nom"]', `${USER}.${suffixe}`);
  await page.fill('input[placeholder="••••••••"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/animateur/dashboard', { timeout: 30_000 });
  await page.getByRole('link', { name: 'PIJ', exact: true }).click();
  await page.waitForURL('**/animateur/pij');
}

test('informateur PIJ : saisit un accueil et un dossier permis, les statistiques suivent', async ({ page }) => {
  await connecter(page, 'pij');
  const fiche = page.getByRole('main').getByRole('complementary');

  await page.getByRole('button', { name: '+ Nouvel accueil' }).click();
  await page.getByLabel('Nom *', { exact: true }).fill('DURAND');
  await page.getByLabel('Prénom *').fill('Léa');
  await page.getByLabel('Date de naissance').fill('2008-03-07');
  await page.getByLabel('Sexe').selectOption('F');
  await fiche.getByText('BAFA', { exact: true }).click();
  await fiche.getByText('Erasmus+', { exact: true }).click();
  await fiche.getByText('CAF', { exact: true }).click();
  await page.getByLabel('Quartier').selectOption('Village');
  await page.getByRole('button', { name: 'Enregistrer' }).click();

  // La fiche enregistrée s'affiche en lecture, à côté de la liste.
  await expect(fiche.getByRole('heading', { name: 'Léa DURAND' })).toBeVisible();
  await expect(fiche.getByRole('button', { name: 'Modifier' })).toBeVisible();
  await expect(fiche).toContainText('BAFA');
  await expect(fiche).toContainText('En cours de réalisation');
  // Dans la liste : une ligne par jeune, avec son âge et l'état en pastille.
  const ligne = page.getByRole('listitem').filter({ hasText: 'DURAND' });
  await expect(ligne).toContainText('Léa');
  await expect(ligne).toContainText('18 ans');
  await expect(ligne.getByRole('img', { name: 'En cours de réalisation' })).toBeVisible();
  await page.screenshot({ path: 'test-results/pij-accueil.png' });

  // Un accueil sans objet est refusé par le serveur, le message s'affiche.
  await page.getByRole('button', { name: '+ Nouvel accueil' }).click();
  await page.getByLabel('Nom *', { exact: true }).fill('SANS');
  await page.getByLabel('Prénom *').fill('Objet');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(fiche.getByRole('alert')).toContainText('au moins un objet');
  await page.screenshot({ path: 'test-results/pij-fiche.png' });
  await page.getByRole('button', { name: 'Annuler' }).click();

  await page.getByRole('tab', { name: /Dossiers/ }).click();
  await page.getByRole('button', { name: '+ Nouveau dossier permis' }).click();
  await page.getByLabel('Nom *', { exact: true }).fill('MARTIN');
  await page.getByLabel('Prénom *').fill('Noé');
  await page.getByLabel('Montant attribué (€)').fill('400');
  await page.getByLabel('Heures à réaliser').fill('20');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(fiche).toContainText('20 h restantes');

  // Les missions s'ajoutent sur la fiche, sans passer par « Modifier » : leurs
  // heures se déduisent des heures à réaliser, et chaque ligne garde son auteur.
  await fiche.getByLabel('Mission', { exact: true }).fill('Chasse aux œufs');
  await fiche.getByLabel('Heures', { exact: true }).fill('5');
  await fiche.getByRole('button', { name: '+ Ajouter la mission' }).click();
  await expect(fiche).toContainText('15 h restantes');
  await fiche.getByLabel('Mission', { exact: true }).fill('Fête de quartier');
  await fiche.getByLabel('Heures', { exact: true }).fill('2,5');
  await fiche.getByRole('button', { name: '+ Ajouter la mission' }).click();
  await expect(fiche).toContainText('12,5 h restantes');
  const journal = fiche.getByRole('table');
  await expect(journal.getByRole('row').filter({ hasText: 'Chasse aux œufs' })).toContainText('pij E2E');
  await expect(journal.getByRole('row').filter({ hasText: 'Total réalisé' })).toContainText('7,5 h');
  await expect(page.getByRole('listitem').filter({ hasText: 'MARTIN' })).toContainText('12,5 h');

  await page.screenshot({ path: 'test-results/pij-missions.png' });

  // Retirer une mission saisie par erreur rend ses heures.
  page.once('dialog', d => d.accept());
  await fiche.getByRole('button', { name: 'Retirer la mission Fête de quartier' }).click();
  await expect(fiche).toContainText('15 h restantes');
  await page.screenshot({ path: 'test-results/pij-permis.png' });

  await page.getByRole('tab', { name: 'Statistiques' }).click();
  await expect(page.getByText('Nombre de jeunes').locator('..')).toContainText('1');
  await expect(page.getByText('Nombre de dossiers').locator('..')).toContainText('2');
  await expect(page.getByRole('row').filter({ hasText: 'Filles' })).toContainText('100 %');
  await page.screenshot({ path: 'test-results/pij-stats.png', fullPage: true });
});

test('informateur PIJ : pose un rendez-vous et obtient un lien d’abonnement Outlook qui le contient', async ({ page, request }) => {
  await connecter(page, 'pij');
  await page.getByRole('tab', { name: 'Agenda' }).click();

  await page.getByRole('button', { name: '+ Nouveau rendez-vous' }).click();
  await page.getByLabel('Jeune du registre d’accueil').selectOption({ label: 'DURAND Léa' });
  await expect(page.getByLabel('Prénom *')).toHaveValue('Léa');
  await page.getByLabel('Heure de début *').fill('10:30');
  // La fin suit le début en gardant la durée proposée (30 min).
  await expect(page.getByLabel('Heure de fin *')).toHaveValue('11:00');
  await page.screenshot({ path: 'test-results/pij-rdv.png' });
  await page.getByRole('button', { name: 'Enregistrer' }).click();

  await expect(page.getByRole('button', { name: /10:30 – 11:00 Léa DURAND/ }).first()).toBeVisible();
  const prochains = page.getByRole('main').getByRole('complementary', { name: 'Prochains rendez-vous' });
  await expect(prochains.getByRole('listitem').filter({ hasText: 'Léa DURAND' })).toContainText('10:30');
  await page.screenshot({ path: 'test-results/pij-agenda.png' });

  await page.getByRole('button', { name: 'Connecter à Outlook' }).click();
  await page.getByRole('button', { name: 'Créer le lien' }).click();
  const url = await page.getByLabel('Votre lien d’abonnement').inputValue();
  expect(url).toMatch(/\/api\/pij\/agenda\/flux\/[\w-]+\.ics$/);

  // Le lien se lit sans session, comme le fera Outlook.
  const flux = await request.get(url, { headers: { cookie: '' } });
  expect(flux.status()).toBe(200);
  expect(flux.headers()['content-type']).toContain('text/calendar');
  const ics = await flux.text();
  expect(ics).toContain('SUMMARY:RDV PIJ — Léa D.');
  expect(ics).not.toContain('DURAND');
});

test('animateur Collégiens : consulte, mais ne peut pas saisir', async ({ page }) => {
  await connecter(page, 'college');

  await expect(page.getByText('Consultation uniquement')).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Nouvel accueil' })).toHaveCount(0);

  await page.getByRole('listitem').filter({ hasText: 'DURAND' }).getByRole('button').click();
  const fiche = page.getByRole('main').getByRole('complementary');
  await expect(fiche.getByRole('heading', { name: 'Léa DURAND' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Modifier' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Supprimer' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/pij-lecture.png' });

  await page.getByRole('tab', { name: 'Agenda' }).click();
  await expect(page.getByRole('button', { name: '+ Nouveau rendez-vous' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connecter à Outlook' })).toHaveCount(0);

  // Même en contournant l'écran, le serveur refuse.
  const res = await page.request.post('/api/pij/accueils', {
    data: { dateVisite: '2026-01-09', nom: 'X', prenom: 'Y', objets: ['bafa'] },
  });
  expect(res.status()).toBe(403);
});

test('admin : importe le classeur Excel du PIJ, sans doublon à la relance', async ({ page }) => {
  await page.goto('/login');
  await page.waitForLoadState('networkidle'); // champ vidé si rempli avant l'hydratation (démarrage à froid)
  await page.fill('input[placeholder="prenom.nom"]', `${USER}.e`);
  await page.fill('input[placeholder="••••••••"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/admin/dashboard', { timeout: 30_000 });
  await page.goto('/admin/pij');

  // Classeur fictif, à la forme du vrai : dates en numéro de série Excel,
  // cellule multi-lignes, lignes numérotées vides, autres feuilles à ignorer.
  const entetes = ['N°', 'Date de la\n première visite', 'Nom', 'Prénom', 'Date de naissance', 'Age', 'Sexe', 'Commune', 'Objet de la demande', 'Etat de la demande'];
  const classeur = xlsxFictif([
    { nom: 'Accueil', lignes: [
      entetes,
      [1, 46034, 'IMPORT', 'Alice', 39571, '17 ans', 'F', 'Nogent-sur-Marne', 'BAFA\nERASMUS +', 'Finalisé'],
      [2, 46035, 'IMPORT', 'Bob', '', '', 'M', 'Bry-sur-Marne', 'PERMIS B', 'En cours de réalisation'],
      [3, 'pas une date', 'IMPORT', 'Chloé', '', '', 'F', '', 'BAFA', ''],
      [4, '', '', '', '', '', '', '', '', ''],
    ] },
    { nom: 'STATS', lignes: [['Statistiques PIJ 2026']] },
  ]);

  await page.getByRole('button', { name: 'Importer du tableur' }).click();
  await page.getByLabel('Fichier Excel du PIJ').setInputFiles({
    name: 'PIJ_Data_2026 .xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: classeur,
  });

  // Le fichier est lu et vérifié sans autre clic ; rien n'est encore enregistré.
  const bilan = page.getByRole('dialog').getByRole('status');
  await expect(bilan).toContainText('2 fiches à importer');
  await expect(bilan).toContainText('Ligne 4 : Date non reconnue');
  await expect(page.getByText('Fichier lu : PIJ_Data_2026 .xlsx — feuille « Accueil »')).toBeVisible();
  await page.screenshot({ path: 'test-results/pij-import.png' });
  await page.getByRole('button', { name: 'Importer 2 fiches' }).click();
  await expect(bilan).toContainText('2 fiches importées');
  await page.getByRole('button', { name: 'Fermer', exact: true }).click();

  await expect(page.getByRole('listitem').filter({ hasText: 'Bob' })).toBeVisible();
  await page.getByRole('listitem').filter({ hasText: 'Alice' }).getByRole('button').click();
  await expect(page.getByRole('main').getByRole('complementary')).toContainText('Erasmus+');

  // Relance, cette fois par collage : les fiches déjà présentes sont ignorées.
  await page.getByRole('button', { name: 'Importer du tableur' }).click();
  await page.getByRole('button', { name: 'Coller la feuille à la place' }).click();
  await page.getByLabel('Ou collez la feuille copiée depuis Excel').fill([
    'N°\tDate de la première visite\tNom\tPrénom\tObjet de la demande',
    '1\t12/01/2026\tIMPORT\tAlice\t"BAFA\nERASMUS +"',
    '2\t13/01/2026\tIMPORT\tBob\tPERMIS B',
  ].join('\n'));
  await page.getByRole('button', { name: 'Vérifier' }).click();
  await expect(bilan).toContainText('0 fiche à importer');
  await expect(bilan).toContainText('2 déjà présentes');

  // Un fichier qui n'est pas un classeur est refusé avec un message, sans plantage.
  await page.getByLabel('Fichier Excel du PIJ').setInputFiles({ name: 'photo.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('pas un classeur') });
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('n’est pas un classeur Excel');
});
