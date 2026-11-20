import { describe, it, expect } from 'vitest';
import { estDateCivile, normaliserHeure } from '@/lib/dates';
import { MOTIF_MAX, validerReservation } from '@/lib/reservations-vehicules';
import { resoudreEspaceCsv, type EspaceCommune } from '@/lib/espaces';

describe('estDateCivile', () => {
  it('accepte les jours qui existent, 29 février bissextile compris', () => {
    for (const d of ['2026-01-01', '2026-12-31', '2024-02-29', '2000-02-29', '1900-01-01']) expect(estDateCivile(d), d).toBe(true);
  });

  it('refuse les jours impossibles, les autres formats et les non-chaînes', () => {
    for (const d of [
      '2026-02-31', '2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '2026-01-32',
      '2026-1-5', '26-01-05', '05/01/2026', '2026-01-05T00:00:00Z', ' 2026-01-05', '2026-01-05 ', '', '1899-12-31', '9999-01-01',
      null, undefined, 20260105, new Date(),
    ]) expect(estDateCivile(d), String(d)).toBe(false);
  });
});

describe('normaliserHeure', () => {
  it('normalise en HH:MM', () => {
    expect(normaliserHeure('09:05')).toBe('09:05');
    expect(normaliserHeure('9:05')).toBe('09:05');
    expect(normaliserHeure(' 23:59 ')).toBe('23:59');
    expect(normaliserHeure('00:00')).toBe('00:00');
  });

  it('refuse ce qui n\'est pas une heure du jour', () => {
    for (const h of ['24:00', '12:60', '9h30', '09:5', '09:05:00', '0905', 'midi', '', '-1:00', null, undefined, 930]) {
      expect(normaliserHeure(h), String(h)).toBeNull();
    }
  });
});

describe('validerReservation (A3)', () => {
  const base = { dateDebut: '2026-11-10', heureDepart: '10:00', motif: 'Sortie piscine' };
  const erreur = (corps: unknown) => { const v = validerReservation(corps); return v.ok ? null : v.erreur; };

  it('un seul jour sans retour, un seul jour avec retour, plusieurs jours : acceptés et normalisés', () => {
    expect(validerReservation(base)).toEqual({ ok: true, reservation: { dateDebut: '2026-11-10', dateFin: '2026-11-10', heureDepart: '10:00', heureRetour: '', motif: 'Sortie piscine' } });
    expect(validerReservation({ ...base, dateFin: '', heureRetour: null, heureDepart: '9:30', motif: '  Courses  ' }))
      .toMatchObject({ ok: true, reservation: { dateFin: '2026-11-10', heureDepart: '09:30', heureRetour: '', motif: 'Courses' } });
    expect(validerReservation({ ...base, heureRetour: '10:01' })).toMatchObject({ ok: true, reservation: { heureRetour: '10:01' } });
    // Séjour : départ 18 h, retour 9 h trois jours plus tard.
    expect(validerReservation({ ...base, dateFin: '2026-11-13', heureDepart: '18:00', heureRetour: '09:00' }))
      .toMatchObject({ ok: true, reservation: { dateFin: '2026-11-13', heureDepart: '18:00', heureRetour: '09:00' } });
  });

  it('refuse les dates inversées et les heures inversées ou égales sur un seul jour', () => {
    expect(erreur({ ...base, dateFin: '2026-11-09' })).toContain('ne peut pas précéder');
    expect(erreur({ ...base, heureDepart: '18:00', heureRetour: '09:00' })).toContain('après l\'heure de départ');
    expect(erreur({ ...base, dateFin: '2026-11-10', heureRetour: '10:00' })).toContain('après l\'heure de départ');
  });

  it('refuse dates impossibles, heures invalides, champs manquants ou mal typés, motif démesuré', () => {
    expect(erreur({ ...base, dateDebut: '2026-02-31' })).toContain('Date de départ invalide');
    expect(erreur({ ...base, dateFin: '2026-11-31' })).toContain('Date de retour invalide');
    expect(erreur({ ...base, dateDebut: 20261110 })).toContain('Date de départ invalide');
    expect(erreur({ ...base, heureDepart: '25:00' })).toContain('Heure de départ invalide');
    expect(erreur({ ...base, heureRetour: 'midi' })).toContain('Heure de retour invalide');
    expect(erreur({ ...base, motif: 'x'.repeat(MOTIF_MAX + 1) })).toContain('Motif trop long');
    for (const corps of [null, undefined, 'texte', [], {}, { ...base, motif: '   ' }, { ...base, motif: 12 }, { ...base, dateDebut: '' }, { ...base, heureDepart: null }]) {
      expect(erreur(corps), JSON.stringify(corps)).toBe('Champs obligatoires manquants');
    }
  });
});

describe('resoudreEspaceCsv (A5)', () => {
  const espaces: EspaceCommune[] = [
    { id: 'collegiens', nom: 'Espace Collégiens', trancheAge: '11-14 ans' },
    { id: 'studio-musique-1f0c', nom: 'Studio Musique', trancheAge: null },
    { id: 'annexe-a', nom: 'Annexe', trancheAge: null },
    { id: 'annexe-b', nom: 'Annexe', trancheAge: null },
  ];

  it('reconnaît l\'identifiant (sans tenir compte de la casse), puis le nom (casse et accents ignorés)', () => {
    expect(resoudreEspaceCsv('collegiens', espaces)).toEqual({ ok: true, id: 'collegiens' });
    expect(resoudreEspaceCsv(' COLLEGIENS ', espaces)).toEqual({ ok: true, id: 'collegiens' });
    expect(resoudreEspaceCsv('Studio-Musique-1F0C', espaces)).toEqual({ ok: true, id: 'studio-musique-1f0c' });
    expect(resoudreEspaceCsv('espace collegiens', espaces)).toEqual({ ok: true, id: 'collegiens' });
    expect(resoudreEspaceCsv('STUDIO   MUSIQUE', espaces)).toEqual({ ok: true, id: 'studio-musique-1f0c' });
  });

  it('nom porté par deux espaces : refus, avec les identifiants à utiliser', () => {
    expect(resoudreEspaceCsv('Annexe', espaces)).toEqual({ ok: false, erreur: expect.stringContaining('annexe-a, annexe-b') });
    expect(resoudreEspaceCsv('annexe-b', espaces)).toEqual({ ok: true, id: 'annexe-b' });
  });

  it('espace inconnu : refus listant les espaces de la commune', () => {
    const r = resoudreEspaceCsv('lyceens', espaces);
    expect(r).toEqual({ ok: false, erreur: expect.stringContaining('Espace inconnu "lyceens"') });
    if (!r.ok) expect(r.erreur).toContain('Espace Collégiens (collegiens)');
    expect(resoudreEspaceCsv('collegiens', [])).toEqual({ ok: false, erreur: expect.stringContaining('aucun espace') });
  });
});
