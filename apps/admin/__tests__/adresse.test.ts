import { describe, expect, it } from 'vitest';
import { adresseApplication, normaliserAdresse, origineAutorisee } from '@/lib/adresse';

const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;

describe('adresseApplication', () => {
  it('lit APP_BASE_URL et retire le « / » final', () => {
    expect(adresseApplication(env({ APP_BASE_URL: 'https://polejeunesse.ville-nogentsurmarne.fr/' })))
      .toBe('https://polejeunesse.ville-nogentsurmarne.fr');
  });

  it('APP_BASE_URL prime sur ALLOWED_ORIGIN, qui sert de repli', () => {
    expect(adresseApplication(env({ APP_BASE_URL: 'https://a.fr', ALLOWED_ORIGIN: 'https://b.fr' }))).toBe('https://a.fr');
    expect(adresseApplication(env({ ALLOWED_ORIGIN: 'https://b.fr' }))).toBe('https://b.fr');
  });

  it('en production, sans adresse configurée : erreur plutôt qu\'un lien faux', () => {
    expect(() => adresseApplication(env({ NODE_ENV: 'production' }))).toThrow(/APP_BASE_URL manquant/);
    expect(() => adresseApplication(env({ NODE_ENV: 'production', APP_BASE_URL: '  ' }))).toThrow(/APP_BASE_URL manquant/);
  });

  it('hors production, repli sur localhost', () => {
    expect(adresseApplication(env({ NODE_ENV: 'test' }))).toBe('http://localhost:3000');
  });

  it('ne contient plus l\'ancienne adresse en dur', () => {
    expect(adresseApplication(env({ NODE_ENV: 'development' }))).not.toMatch(/jeunessenogent/);
  });
});

describe('normaliserAdresse', () => {
  it('refuse une adresse invalide, un autre protocole ou un chemin', () => {
    expect(() => normaliserAdresse('polejeunesse.fr')).toThrow(/invalide/);
    expect(() => normaliserAdresse('ftp://polejeunesse.fr')).toThrow(/https/);
    expect(() => normaliserAdresse('https://polejeunesse.fr/admin')).toThrow(/sans chemin/);
    expect(() => normaliserAdresse('https://polejeunesse.fr/?x=1')).toThrow(/sans chemin/);
  });

  it('garde le port s\'il y en a un', () => {
    expect(normaliserAdresse('http://127.0.0.1:3100')).toBe('http://127.0.0.1:3100');
  });
});

describe('origineAutorisee', () => {
  it('ALLOWED_ORIGIN, sinon origine de APP_BASE_URL, sinon localhost', () => {
    expect(origineAutorisee(env({ ALLOWED_ORIGIN: 'https://b.fr', APP_BASE_URL: 'https://a.fr' }))).toBe('https://b.fr');
    expect(origineAutorisee(env({ APP_BASE_URL: 'https://a.fr/' }))).toBe('https://a.fr');
    expect(origineAutorisee(env({ NODE_ENV: 'production' }))).toBe('http://localhost:3000');
  });

  it('ne lève jamais d\'erreur (calculée au chargement des routes, build compris)', () => {
    expect(origineAutorisee(env({ NODE_ENV: 'production', APP_BASE_URL: 'pas une url' }))).toBe('http://localhost:3000');
  });
});
