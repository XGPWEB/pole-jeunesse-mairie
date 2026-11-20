import { describe, it, expect } from 'vitest';
import { erreurChevauchement, genererIcs, heureFinRdv, plageRdv, rdvCommence, titreRdvExterne, validerRdv, type RdvPij } from '@/lib/pij-agenda';

const BASE = { date: '2026-10-14', heure: '14:00', nom: ' Durand ', prenom: 'Léa' };

describe('validerRdv', () => {
  it('applique les valeurs par défaut et nettoie les textes', () => {
    const r = validerRdv({ ...BASE, telephone: '', notes: '  ', accueilId: '' });
    expect(r.ok && r.valeurs).toMatchObject({
      nom: 'Durand', dureeMinutes: 30, statut: 'prevu', telephone: null, notes: null, accueilId: null,
    });
  });
  it('accepte l’heure avec secondes d’un champ <input type="time">', () => {
    const r = validerRdv({ ...BASE, heure: '09:30:00', dureeMinutes: '45' });
    expect(r.ok && r.valeurs).toMatchObject({ heure: '09:30', dureeMinutes: 45 });
  });
  it('refuse nom vide, date impossible, heure ou durée invalide, statut inconnu', () => {
    expect(validerRdv({ ...BASE, prenom: '' }).ok).toBe(false);
    expect(validerRdv({ ...BASE, date: '2026-02-30' }).ok).toBe(false);
    expect(validerRdv({ ...BASE, date: '' }).ok).toBe(false);
    expect(validerRdv({ ...BASE, heure: '25:00' }).ok).toBe(false);
    expect(validerRdv({ ...BASE, dureeMinutes: 0 }).ok).toBe(false);
    expect(validerRdv({ ...BASE, dureeMinutes: 'longtemps' }).ok).toBe(false);
    expect(validerRdv({ ...BASE, statut: 'reporte' }).ok).toBe(false);
  });
});

const rdv = (p: Partial<RdvPij> = {}): RdvPij => ({
  id: 'pij-rdv-1', date: '2026-10-14', heure: '14:00', dureeMinutes: 45, nom: 'Durand', prenom: 'Léa',
  telephone: '06 00 00 00 00', objet: 'BAFA', lieu: 'PIJ', notes: 'Notes confidentielles', statut: 'prevu',
  accueilId: null, creePar: 'Inès Martin', modifieLe: '2026-10-09T18:00:00.000Z', ...p,
});

describe('genererIcs', () => {
  const ics = genererIcs([rdv()], new Date('2026-10-09T12:00:00Z'));

  it('produit un calendrier iCalendar en heure de Paris, lignes terminées par CRLF', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('BEGIN:VTIMEZONE\r\nTZID:Europe/Paris');
    expect(ics).toContain('UID:pij-rdv-1@pole-jeunesse\r\n');
    expect(ics).toContain('DTSTART;TZID=Europe/Paris:20261014T140000\r\n');
    expect(ics).toContain('DTEND;TZID=Europe/Paris:20261014T144500\r\n');
    expect(ics).toContain('DTSTAMP:20261009T180000Z\r\n');
    expect(ics).toContain('STATUS:CONFIRMED\r\n');
    expect(ics.split('\r\n').every(l => !l.includes('\n'))).toBe(true);
  });
  it('n’exporte ni nom complet, ni téléphone, ni notes', () => {
    expect(ics).toContain('SUMMARY:RDV PIJ — Léa D.\r\n');
    expect(ics).not.toContain('Durand');
    expect(ics).not.toContain('06 00');
    expect(ics).not.toContain('confidentielles');
  });
  it('échappe les caractères réservés et les retours à la ligne', () => {
    const texte = genererIcs([rdv({ lieu: 'PIJ; salle 2, étage', objet: 'CV / lettre' })]);
    expect(texte).toContain('LOCATION:PIJ\\; salle 2\\, étage\r\n');
    expect(texte).toContain('DESCRIPTION:Objet : CV / lettre\\nPosé par : Inès Martin\r\n');
  });
  it('plie les lignes à 75 octets sans couper un caractère accentué', () => {
    const texte = genererIcs([rdv({ lieu: 'é'.repeat(100) })]);
    const lignes = texte.split('\r\n');
    expect(lignes.every(l => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(texte.replace(/\r\n /g, '')).toContain(`LOCATION:${'é'.repeat(100)}`);
  });
  it('un rendez-vous qui dépasse minuit finit le lendemain', () => {
    expect(genererIcs([rdv({ date: '2026-12-31', heure: '23:30', dureeMinutes: 60 })]))
      .toContain('DTEND;TZID=Europe/Paris:20270101T003000');
  });
  it('marque un rendez-vous annulé', () => {
    const texte = genererIcs([rdv({ statut: 'annule' })]);
    expect(texte).toContain('STATUS:CANCELLED');
    expect(titreRdvExterne(rdv({ statut: 'annule' }))).toBe('Annulé — RDV PIJ — Léa D.');
  });
  it('un agenda vide reste un calendrier valide', () => {
    expect(genererIcs([])).not.toContain('BEGIN:VEVENT');
  });
});

describe('créneau : heure de début et de fin', () => {
  it('l’heure de fin donne la durée', () => {
    const r = validerRdv({ ...BASE, heure: '14:00', heureFin: '15:15', dureeMinutes: undefined });
    expect(r.ok && r.valeurs.dureeMinutes).toBe(75);
  });
  it('refuse une fin avant ou égale au début, ou mal formée', () => {
    expect(validerRdv({ ...BASE, heure: '14:00', heureFin: '14:00' })).toMatchObject({ ok: false, erreur: expect.stringContaining('après') });
    expect(validerRdv({ ...BASE, heure: '14:00', heureFin: '13:30' }).ok).toBe(false);
    expect(validerRdv({ ...BASE, heure: '14:00', heureFin: '14h30' }).ok).toBe(false);
  });
  it('sans heure de fin, la durée reste acceptée (LE HUB, import)', () => {
    const r = validerRdv({ ...BASE, heure: '14:00', heureFin: '', dureeMinutes: 45 });
    expect(r.ok && r.valeurs.dureeMinutes).toBe(45);
  });
  it('affichage de la plage et message de chevauchement', () => {
    expect(heureFinRdv('14:00', 30)).toBe('14:30');
    expect(heureFinRdv('23:30', 120)).toBe('23:59');
    expect(plageRdv({ heure: '09:15', dureeMinutes: 45 })).toBe('09:15 – 10:00');
    expect(erreurChevauchement({ heure: '14:00', dureeMinutes: 30, prenom: 'Léa', nom: 'durand' })).toContain('Léa D. (14:00 – 14:30)');
  });
});

describe('pointage seulement une fois le rendez-vous commencé (heure de Paris)', () => {
  // 26/10/2026 07:08 à Paris = 06:08 UTC (heure d'hiver).
  const MAINTENANT = new Date('2026-10-26T06:08:00Z');
  it('rdvCommence compare à l’heure de Paris, borne incluse', () => {
    expect(rdvCommence({ date: '2026-10-26', heure: '07:08' }, MAINTENANT)).toBe(true);
    expect(rdvCommence({ date: '2026-10-26', heure: '07:09' }, MAINTENANT)).toBe(false);
    expect(rdvCommence({ date: '2026-10-25', heure: '23:30' }, MAINTENANT)).toBe(true);
    expect(rdvCommence({ date: '2026-10-26', heure: '18:00' }, MAINTENANT)).toBe(false);
  });
  it('validerRdv refuse honoré/absent avant le début, accepte prévu et annulé', () => {
    const A_VENIR = { ...BASE, date: '2026-10-26', heure: '18:00' };
    expect(validerRdv({ ...A_VENIR, statut: 'honore' }, MAINTENANT)).toMatchObject({ ok: false, erreur: expect.stringContaining('26/10 à 18:00') });
    expect(validerRdv({ ...A_VENIR, statut: 'absent' }, MAINTENANT).ok).toBe(false);
    expect(validerRdv({ ...A_VENIR, statut: 'prevu' }, MAINTENANT).ok).toBe(true);
    expect(validerRdv({ ...A_VENIR, statut: 'annule' }, MAINTENANT).ok).toBe(true);
    expect(validerRdv({ ...BASE, date: '2026-10-26', heure: '07:00', statut: 'honore' }, MAINTENANT).ok).toBe(true);
  });
});
