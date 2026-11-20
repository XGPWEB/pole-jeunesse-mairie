import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ajouterJours,
  calculerAge,
  dateCivileParis,
  estDateCivile,
  formaterDateCivile,
  heureParis,
  jourSemaineIso,
  joursDeLaSemaine,
  lundiDeLaSemaine,
  versDateCivile,
} from './dates';

const utc = (iso: string) => new Date(iso);

// Chaque série est rejouée avec l'appareil réglé sur des fuseaux très éloignés
// de Paris : le résultat ne doit dépendre que de l'instant, jamais de l'appareil.
const FUSEAUX_APPAREIL = ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Europe/Paris'];

describe.each(FUSEAUX_APPAREIL)('dates civiles Europe/Paris — appareil en %s', (fuseau) => {
  let fuseauInitial: string | undefined;
  beforeAll(() => {
    fuseauInitial = process.env.TZ;
    process.env.TZ = fuseau;
  });
  afterAll(() => {
    process.env.TZ = fuseauInitial;
  });

  it("le fuseau de l'appareil simulé est effectif", () => {
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(fuseau);
    // Les getters locaux varient bien d'un fuseau à l'autre : c'est ce que le module évite.
    const heuresLocales: Record<string, number> = {
      UTC: 22,
      'America/Los_Angeles': 15,
      'Pacific/Kiritimati': 12,
      'Europe/Paris': 0,
    };
    expect(new Date('2026-10-05T22:30:00Z').getHours()).toBe(heuresLocales[fuseau]);
  });

  it('6 octobre 2026 à 00:30 à Paris est le 2026-10-06 (et non la veille UTC)', () => {
    const instant = utc('2026-10-05T22:30:00Z'); // 00:30 heure d'été à Paris
    expect(instant.toISOString().startsWith('2026-10-05')).toBe(true); // le piège
    expect(dateCivileParis(instant)).toBe('2026-10-06');
    expect(heureParis(instant)).toBe('00:30');
  });

  it('bascule de jour exactement à minuit Paris', () => {
    expect(dateCivileParis(utc('2026-10-05T21:59:59Z'))).toBe('2026-10-05');
    expect(dateCivileParis(utc('2026-10-05T22:00:00Z'))).toBe('2026-10-06');
    // En hiver (UTC+1) minuit Paris = 23:00 UTC.
    expect(dateCivileParis(utc('2026-01-14T22:59:59Z'))).toBe('2026-01-14');
    expect(dateCivileParis(utc('2026-01-14T23:00:00Z'))).toBe('2026-01-15');
  });

  it("passage à l'heure d'été — 29 mars 2026", () => {
    expect(dateCivileParis(utc('2026-03-28T22:59:59Z'))).toBe('2026-03-28'); // 23:59:59 +01
    expect(dateCivileParis(utc('2026-03-28T23:00:00Z'))).toBe('2026-03-29'); // 00:00 +01
    expect(heureParis(utc('2026-03-29T00:59:00Z'))).toBe('01:59');           // avant le saut
    expect(heureParis(utc('2026-03-29T01:00:00Z'))).toBe('03:00');           // 02:00 n'existe pas
    expect(dateCivileParis(utc('2026-03-29T21:59:59Z'))).toBe('2026-03-29'); // 23:59:59 +02
    expect(dateCivileParis(utc('2026-03-29T22:00:00Z'))).toBe('2026-03-30'); // journée de 23 h
  });

  it("passage à l'heure d'hiver — 25 octobre 2026", () => {
    expect(dateCivileParis(utc('2026-10-24T21:59:59Z'))).toBe('2026-10-24'); // 23:59:59 +02
    expect(dateCivileParis(utc('2026-10-24T22:00:00Z'))).toBe('2026-10-25'); // 00:00 +02
    expect(heureParis(utc('2026-10-25T00:30:00Z'))).toBe('02:30');           // 02:30 +02
    expect(heureParis(utc('2026-10-25T01:30:00Z'))).toBe('02:30');           // 02:30 +01 (heure répétée)
    expect(dateCivileParis(utc('2026-10-25T01:30:00Z'))).toBe('2026-10-25');
    expect(dateCivileParis(utc('2026-10-25T22:59:59Z'))).toBe('2026-10-25'); // journée de 25 h
    expect(dateCivileParis(utc('2026-10-25T23:00:00Z'))).toBe('2026-10-26');
  });

  it('bornes de semaine : lundi → samedi de la semaine civile de Paris', () => {
    // Mardi 6 octobre 2026, 00:30 à Paris.
    const semaine = joursDeLaSemaine(0, utc('2026-10-05T22:30:00Z'));
    expect(semaine.map((j) => j.dateStr)).toEqual([
      '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10',
    ]);
    expect(semaine.map((j) => j.shortLabel)).toEqual(['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']);
    expect(semaine.map((j) => j.jourDuMois)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(semaine.filter((j) => j.isToday).map((j) => j.dateStr)).toEqual(['2026-10-06']);
    expect(semaine.filter((j) => j.isFuture).map((j) => j.dateStr)).toEqual([
      '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10',
    ]);
  });

  it('bornes de semaine : dimanche soir et lundi 00:00 à Paris', () => {
    // Dimanche 4 octobre 23:59:59 à Paris → semaine du 28 septembre.
    const dimanche = joursDeLaSemaine(0, utc('2026-10-04T21:59:59Z'));
    expect(dimanche[0].dateStr).toBe('2026-09-28');
    expect(dimanche[5].dateStr).toBe('2026-10-03');
    expect(dimanche.some((j) => j.isToday)).toBe(false); // le dimanche n'est pas affiché
    expect(dimanche.some((j) => j.isFuture)).toBe(false);
    // Une seconde plus tard : lundi 5 octobre 00:00 à Paris.
    const lundi = joursDeLaSemaine(0, utc('2026-10-04T22:00:00Z'));
    expect(lundi[0].dateStr).toBe('2026-10-05');
    expect(lundi[0].isToday).toBe(true);
    expect(lundi[5].dateStr).toBe('2026-10-10');
  });

  it("bornes de semaine autour des changements d'heure et avec décalage", () => {
    // Dimanche 29 mars 2026 (heure d'été) → semaine du 23 au 28 mars.
    expect(joursDeLaSemaine(0, utc('2026-03-29T10:00:00Z')).map((j) => j.dateStr)).toEqual([
      '2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27', '2026-03-28',
    ]);
    // Semaine suivante : enjambe le changement d'heure sans perdre ni doubler de jour.
    expect(joursDeLaSemaine(1, utc('2026-03-27T10:00:00Z')).map((j) => j.dateStr)).toEqual([
      '2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04',
    ]);
    // Lundi 26 octobre 2026 00:10 à Paris (lendemain du passage à l'heure d'hiver).
    expect(joursDeLaSemaine(0, utc('2026-10-25T23:10:00Z')).map((j) => j.dateStr)).toEqual([
      '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31',
    ]);
    // Semaine précédente : contient le 24 octobre, veille du changement.
    expect(joursDeLaSemaine(-1, utc('2026-10-25T23:10:00Z')).map((j) => j.dateStr)).toEqual([
      '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24',
    ]);
  });

  it('arithmétique calendaire', () => {
    expect(ajouterJours('2026-03-28', 1)).toBe('2026-03-29');
    expect(ajouterJours('2026-03-29', 1)).toBe('2026-03-30');
    expect(ajouterJours('2026-10-25', 1)).toBe('2026-10-26');
    expect(ajouterJours('2026-12-31', 1)).toBe('2027-01-01');
    expect(ajouterJours('2028-03-01', -1)).toBe('2028-02-29');
    expect(jourSemaineIso('2026-10-06')).toBe(2);
    expect(jourSemaineIso('2026-10-11')).toBe(7);
    expect(lundiDeLaSemaine('2026-10-11')).toBe('2026-10-05');
    expect(lundiDeLaSemaine('2026-10-05')).toBe('2026-10-05');
  });

  it('valeurs serveur : une colonne DATE reste telle quelle, un horodatage est converti', () => {
    expect(versDateCivile('2026-10-06')).toBe('2026-10-06');
    expect(versDateCivile('2026-10-05T22:30:00.000Z')).toBe('2026-10-06');
    expect(() => versDateCivile('pas une date')).toThrow(RangeError);
    expect(estDateCivile('2026-02-30')).toBe(false);
    expect(estDateCivile('2026-2-3')).toBe(false);
  });

  it("l'affichage d'une date civile ne glisse pas d'un jour", () => {
    expect(formaterDateCivile('2026-10-06', { day: 'numeric', month: 'long' })).toBe('6 octobre');
    expect(formaterDateCivile('2026-03-29', { weekday: 'long', day: 'numeric', month: 'long' })).toBe(
      'dimanche 29 mars',
    );
  });

  it('âge révolu', () => {
    expect(calculerAge('2011-10-06', '2026-10-06')).toBe(15);
    expect(calculerAge('2011-10-07', '2026-10-06')).toBe(14);
    expect(calculerAge('', '2026-10-06')).toBeNull();
  });
});
