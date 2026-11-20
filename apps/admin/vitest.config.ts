import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    exclude: ['__tests__/e2e/**', '__tests__/integration/**', 'node_modules/**'],
    // src/lib/auth.ts (et src/middleware.ts) exigent désormais JWT_SECRET dans
    // TOUS les environnements — plus de secret de repli codé en dur. Les tests
    // unitaires qui importent @/lib/auth ont donc besoin d'une valeur ici.
    env: {
      JWT_SECRET: 'vitest-unit-test-secret-not-for-prod',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
