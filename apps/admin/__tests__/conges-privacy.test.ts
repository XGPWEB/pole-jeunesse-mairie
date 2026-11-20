import { describe, it, expect } from 'vitest';
import { maskCongesForViewer } from '@/lib/conges';

const conges = [
  { animateurId: 'anim-1', type: 'maladie', motif: 'opération du genou', dateDebut: '2026-07-01', dateFin: '2026-07-05' },
  { animateurId: 'anim-2', type: 'conge', motif: 'vacances', dateDebut: '2026-07-10', dateFin: '2026-07-20' },
];

describe('maskCongesForViewer — confidentialité du planning', () => {
  it('un admin voit tout (type + motif)', () => {
    const out = maskCongesForViewer(conges, { id: 'admin-x', role: 'admin' });
    expect(out).toEqual(conges);
    expect(out[0].motif).toBe('opération du genou');
    expect(out[0].type).toBe('maladie');
  });

  it('un animateur NE voit ni le type précis ni le motif des congés des autres', () => {
    const out = maskCongesForViewer(conges, { id: 'anim-2', role: 'animateur' });
    // Le congé maladie d'anim-1 est neutralisé pour anim-2.
    const autre = out.find(c => c.animateurId === 'anim-1')!;
    expect(autre.type).toBe('absent');
    expect(autre.motif).toBeNull();
    // Aucune fuite du mot "maladie" ni du commentaire.
    expect(JSON.stringify(out)).not.toContain('maladie');
    expect(JSON.stringify(out)).not.toContain('genou');
  });

  it('un animateur voit le détail de SES propres congés', () => {
    const out = maskCongesForViewer(conges, { id: 'anim-2', role: 'animateur' });
    const sien = out.find(c => c.animateurId === 'anim-2')!;
    expect(sien.type).toBe('conge');
    expect(sien.motif).toBe('vacances');
  });

  it('ne mute pas les objets d’origine', () => {
    maskCongesForViewer(conges, { id: 'anim-2', role: 'animateur' });
    expect(conges[0].type).toBe('maladie'); // l'original reste intact
  });
});
