import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Config séparée des tests unitaires (vitest.config.ts).
 *
 * Ces tests appellent les vrais handlers de route contre un vrai PostgreSQL
 * jetable (pole_jeunesse_test) — pas de mock de `pg`. Pourquoi : les mocks
 * acceptent une chaîne vide sur une colonne DATE ou INTEGER, un vrai driver
 * contre un vrai schéma la rejette (SQLSTATE 22007 / 22P02). Les deux bugs
 * de prod du 2026-07-30 (projets, sorties) étaient de cette nature —
 * invisibles pour les tests unitaires par construction.
 *
 * `fileParallelism: false` : tous les fichiers partagent la même base ; des
 * fichiers exécutés en parallèle se marcheraient dessus (resetDb() de l'un
 * effacerait les données en cours d'utilisation par l'autre).
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/integration/**/*.test.ts'],
    setupFiles: ['./__tests__/integration/setup.ts'],
    fileParallelism: false,
    testTimeout: 10_000,
    env: { NODE_ENV: 'test' },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
