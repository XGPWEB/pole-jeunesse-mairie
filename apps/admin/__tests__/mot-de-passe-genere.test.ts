import { describe, expect, it } from 'vitest';
import { erreurPolitiqueMotDePasse, genererMotDePasse } from '@/lib/password';

// Régression 2.10.1 : le mot de passe proposé à la création d'un compte ne
// contenait un caractère spécial qu'environ 4 fois sur 10, et la création,
// désormais soumise à la politique (S10), échouait.
describe('genererMotDePasse', () => {
  it('respecte toujours la politique de mot de passe', () => {
    for (let i = 0; i < 2000; i++) {
      const motDePasse = genererMotDePasse();
      expect(erreurPolitiqueMotDePasse(motDePasse), motDePasse).toBeNull();
      expect(motDePasse).toMatch(/[a-z]/);
      expect(motDePasse).toMatch(/[0-9]/);
    }
  });

  it('fait 12 caractères et varie d’un tirage à l’autre', () => {
    const tirages = new Set(Array.from({ length: 200 }, () => genererMotDePasse()));
    expect([...tirages].every(m => m.length === 12)).toBe(true);
    expect(tirages.size).toBe(200);
  });
});
