/**
 * Exécuté une fois par fichier de test, AVANT que le fichier n'importe quoi
 * que ce soit — donc avant que `@/lib/db` ne construise son Pool. C'est ce qui
 * permet de forcer DATABASE_URL sur la base jetable avant que quiconque
 * n'ouvre une connexion.
 *
 * Garde-fou : si DATABASE_URL est déjà positionné sur autre chose que la base
 * de test (ex. héritage d'un shell avec la prod), on refuse de démarrer. Un
 * TRUNCATE lancé par erreur contre la prod n'est pas un risque qu'on accepte
 * de courir pour gagner en confort de config.
 */
const DB_NAME = 'pole_jeunesse_test';

const existing = process.env.DATABASE_URL;
if (existing && !existing.includes(DB_NAME)) {
  throw new Error(
    `[integration] DATABASE_URL pointe sur "${existing}", pas sur ${DB_NAME}. ` +
    `Lancer 'npm run test:integration' sans DATABASE_URL positionné dans l'environnement, ` +
    `ou 'unset DATABASE_URL' avant.`,
  );
}

process.env.DATABASE_URL =
  existing ?? `postgresql://${process.env.USER}@localhost:5432/${DB_NAME}`;
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'integration-test-secret-not-for-prod';
// NODE_ENV='test' est posé par vitest.integration.config.ts (test.env) : l'affecter
// ici ne compile pas, les types de Next déclarent process.env.NODE_ENV en lecture seule.
