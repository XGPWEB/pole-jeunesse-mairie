import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { JWT_SECRET_MIN_LENGTH, getJwtSecretKey, raisonRefusSecretJwt } from '@/lib/jwt-secret';

const RACINE = path.resolve(__dirname, '../../..');
const lire = (...segments: string[]) => readFileSync(path.resolve(RACINE, ...segments), 'utf8');

/**
 * Les valeurs de remplacement sont LUES dans les fichiers du dépôt plutôt que
 * recopiées ici : si quelqu'un change le placeholder de .env.example ou de
 * deploy.sh sans mettre à jour la garde, ce test échoue.
 */
function placeholderEnvExample(): string {
  const m = /^JWT_SECRET=(.+)$/m.exec(lire('.env.example'));
  if (!m) throw new Error('JWT_SECRET introuvable dans .env.example');
  return m[1].trim();
}
/**
 * Jeton de substitution de la configuration PM2 générée par deploy.sh. Lu dans
 * le script tant qu'il y figure ; la valeur historique reste testée même si le
 * script cesse un jour de l'écrire (des configurations déjà générées peuvent
 * encore la contenir).
 */
const PLACEHOLDER_PM2_HISTORIQUE = '__JWT_SECRET__';
function placeholdersDeploy(): string[] {
  const m = /JWT_SECRET:\s*'([^']+)'/.exec(lire('deploy.sh'));
  return Array.from(new Set([PLACEHOLDER_PM2_HISTORIQUE, ...(m ? [m[1]] : [])]));
}

describe('garde du secret JWT — raisonRefusSecretJwt', () => {
  it('refuse un secret absent, vide ou fait d’espaces', () => {
    expect(raisonRefusSecretJwt(undefined)).toBe('absent');
    expect(raisonRefusSecretJwt(null)).toBe('absent');
    expect(raisonRefusSecretJwt('')).toBe('vide');
    expect(raisonRefusSecretJwt('      ')).toBe('vide');
  });

  it(`refuse un secret de moins de ${JWT_SECRET_MIN_LENGTH} caractères, accepte à partir de ${JWT_SECRET_MIN_LENGTH}`, () => {
    expect(raisonRefusSecretJwt('x'.repeat(JWT_SECRET_MIN_LENGTH - 1))).toMatch(/trop court/);
    expect(raisonRefusSecretJwt('x'.repeat(JWT_SECRET_MIN_LENGTH))).toBeNull();
  });

  it('refuse le placeholder de .env.example bien qu’il fasse plus de 32 caractères', () => {
    const valeur = placeholderEnvExample();
    // Le cas intéressant : la seule règle de longueur le laisserait passer.
    expect(valeur.length).toBeGreaterThanOrEqual(JWT_SECRET_MIN_LENGTH);
    expect(raisonRefusSecretJwt(valeur)).toBe('valeur de remplacement connue');
    expect(raisonRefusSecretJwt(valeur.toUpperCase())).toBe('valeur de remplacement connue');
  });

  it('refuse le placeholder de la configuration PM2 de deploy.sh, même rallongé', () => {
    for (const valeur of placeholdersDeploy()) {
      expect(raisonRefusSecretJwt(valeur), valeur).not.toBeNull();
    }
    expect(raisonRefusSecretJwt(`${PLACEHOLDER_PM2_HISTORIQUE}${'a'.repeat(40)}`)).toBe('valeur de remplacement connue');
  });

  it('accepte les secrets des suites de tests (vitest.config.ts, integration/setup.ts)', () => {
    const unitaire = /JWT_SECRET:\s*'([^']+)'/.exec(lire('apps/admin/vitest.config.ts'))?.[1];
    const integration = /JWT_SECRET\s*\?\?\s*'([^']+)'/.exec(lire('apps/admin/__tests__/integration/setup.ts'))?.[1];
    expect(unitaire).toBeDefined();
    expect(integration).toBeDefined();
    expect(raisonRefusSecretJwt(unitaire, 'test')).toBeNull();
    expect(raisonRefusSecretJwt(integration, 'test')).toBeNull();
  });

  it('refuse ces mêmes secrets de test en production (ils sont publics)', () => {
    const unitaire = /JWT_SECRET:\s*'([^']+)'/.exec(lire('apps/admin/vitest.config.ts'))?.[1];
    expect(raisonRefusSecretJwt(unitaire, 'production')).toBe('secret de test utilisé en production');
  });

  it('accepte un secret aléatoire de production', () => {
    expect(raisonRefusSecretJwt('k3J9s0QvXz7LmN2pR8tYwB4cF6hD1gA5uE0iO3qS', 'production')).toBeNull();
  });
});

describe('garde du secret JWT — getJwtSecretKey', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('lève au démarrage si le secret est un placeholder', () => {
    vi.stubEnv('JWT_SECRET', placeholderEnvExample());
    vi.stubEnv('NEXT_PHASE', '');
    expect(() => getJwtSecretKey()).toThrow(/JWT_SECRET refusé/);
  });

  it('lève au démarrage si le secret est trop court', () => {
    vi.stubEnv('JWT_SECRET', 'court');
    vi.stubEnv('NEXT_PHASE', '');
    expect(() => getJwtSecretKey()).toThrow(/trop court/);
  });

  it('conserve l’exemption de la phase de build (aucun jeton n’y est signé)', () => {
    vi.stubEnv('JWT_SECRET', '');
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    expect(() => getJwtSecretKey()).not.toThrow();
  });

  it('l’exemption de build ne s’applique à aucune autre phase', () => {
    vi.stubEnv('JWT_SECRET', '');
    vi.stubEnv('NEXT_PHASE', 'phase-production-server');
    expect(() => getJwtSecretKey()).toThrow(/JWT_SECRET refusé/);
  });

  it('ne divulgue pas la valeur du secret dans le message d’erreur', () => {
    const valeur = placeholderEnvExample();
    vi.stubEnv('JWT_SECRET', valeur);
    vi.stubEnv('NEXT_PHASE', '');
    let message = '';
    try { getJwtSecretKey(); } catch (e) { message = (e as Error).message; }
    expect(message).toMatch(/JWT_SECRET refusé/);
    expect(message).not.toContain(valeur);
  });
});
