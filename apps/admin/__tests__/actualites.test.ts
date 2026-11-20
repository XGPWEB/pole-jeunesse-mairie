import { describe, it, expect } from 'vitest';
import { estCategorieEvenement, estEvenementPasse, sqlEvenementPasse } from '@/lib/actualites';

describe('archivage des événements passés', () => {
  it('reconnaît la catégorie événement sous toutes ses formes saisies', () => {
    for (const c of ['Evenement', 'evenement', 'Événement', ' ÉVÉNEMENT ']) expect(estCategorieEvenement(c), c).toBe(true);
    for (const c of ['Info', 'annonce', 'atelier', 'sortie', 'Urgence', '', null, undefined]) expect(estCategorieEvenement(c), String(c)).toBe(false);
  });

  it('archive dès le lendemain, jamais le jour même', () => {
    const jour = '2026-10-12';
    expect(estEvenementPasse({ categorie: 'Evenement', date: '2026-10-11' }, jour)).toBe(true);
    expect(estEvenementPasse({ categorie: 'evenement', date: '2026-09-06T00:00:00.000Z' }, jour)).toBe(true);
    expect(estEvenementPasse({ categorie: 'Evenement', date: '2026-10-12' }, jour)).toBe(false);
    expect(estEvenementPasse({ categorie: 'Evenement', date: '2026-11-01' }, jour)).toBe(false);
  });

  it('les autres catégories et les événements sans date ne s\'archivent pas', () => {
    expect(estEvenementPasse({ categorie: 'Info', date: '2020-01-01' }, '2026-10-12')).toBe(false);
    expect(estEvenementPasse({ categorie: 'annonce', date: '2020-01-01' }, '2026-10-12')).toBe(false);
    expect(estEvenementPasse({ categorie: 'Evenement', date: null }, '2026-10-12')).toBe(false);
  });

  it('le fragment SQL porte le numéro de paramètre et l\'alias demandés', () => {
    expect(sqlEvenementPasse(3)).toContain('date < $3::date');
    expect(sqlEvenementPasse(2, 'a.')).toContain('a.categorie');
  });
});
