import { defineConfig } from 'vitest/config';

// Tests unitaires des modules purs de lib/ (aucune dépendance React Native).
// Ils s'exécutent sous Node, sans simulateur ni backend.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
});
