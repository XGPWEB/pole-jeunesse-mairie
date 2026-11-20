import { describe, it, expect } from 'vitest';

import { emptyToNull } from '@/lib/db';

/**
 * Ce piège a provoqué trois 500 en production (véhicules en juin, projets en
 * juillet, fiche animateur). Un `<input type="date">` vidé envoie la chaîne
 * VIDE, que `?? null` ne convertit pas, et PostgreSQL refuse '' pour une
 * colonne DATE / INTEGER (SQLSTATE 22007 / 22P02).
 */
describe('emptyToNull', () => {
  it("convertit la chaîne vide en null (cas du champ date vidé)", () => {
    expect(emptyToNull('')).toBeNull();
  });

  it('convertit une chaîne d\'espaces en null', () => {
    expect(emptyToNull('   ')).toBeNull();
  });

  it('convertit undefined et null en null', () => {
    expect(emptyToNull(undefined)).toBeNull();
    expect(emptyToNull(null)).toBeNull();
  });

  it('convertit NaN en null (parseInt sur un champ number vidé)', () => {
    expect(emptyToNull(Number.parseInt('', 10))).toBeNull();
  });

  it('préserve une date valide', () => {
    expect(emptyToNull('2026-07-30')).toBe('2026-07-30');
  });

  it('préserve zéro — 0 est une capacité légitime, pas une absence de valeur', () => {
    expect(emptyToNull(0)).toBe(0);
  });

  it('préserve false', () => {
    expect(emptyToNull(false)).toBe(false);
  });

  it('préserve un nombre normal', () => {
    expect(emptyToNull(12)).toBe(12);
  });
});
