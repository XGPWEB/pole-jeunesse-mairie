import { describe, it, expect } from 'vitest';
import { adresseExpediteur, expediteur } from '@/lib/expediteur';

describe("adresse d'expédition des courriels", () => {
  it('prend MAIL_FROM, même quand le compte SMTP est une adresse', () => {
    expect(adresseExpediteur({ MAIL_FROM: 'pole.jeunesse@ville.fr', SMTP_USER: 'autre@ville.fr' }))
      .toBe('pole.jeunesse@ville.fr');
  });

  it('extrait l\'adresse de la forme "Nom" <adresse>', () => {
    expect(adresseExpediteur({ MAIL_FROM: '"Pôle Jeunesse" <pj@ville.fr>' })).toBe('pj@ville.fr');
  });

  it("n'utilise pas un compte SMTP technique comme expéditeur", () => {
    expect(adresseExpediteur({ SMTP_USER: 'MAIRIE\\srv-pj' })).toBeNull();
    expect(adresseExpediteur({ MAIL_FROM: '', SMTP_USER: 'srv-pj' })).toBeNull();
  });

  it('se replie sur SMTP_USER quand il ressemble à une adresse', () => {
    expect(adresseExpediteur({ SMTP_USER: 'pj@ville.fr' })).toBe('pj@ville.fr');
  });

  it('ignore un MAIL_FROM invalide au profit de SMTP_USER', () => {
    expect(adresseExpediteur({ MAIL_FROM: 'pas une adresse', SMTP_USER: 'pj@ville.fr' })).toBe('pj@ville.fr');
  });

  it("refuse d'envoyer sans adresse d'expédition", () => {
    expect(() => expediteur('Pôle Jeunesse', { SMTP_USER: 'srv-pj' })).toThrow(/MAIL_FROM/);
    expect(expediteur('Pôle Jeunesse', { MAIL_FROM: 'pj@ville.fr' }))
      .toEqual({ name: 'Pôle Jeunesse', address: 'pj@ville.fr' });
  });
});
