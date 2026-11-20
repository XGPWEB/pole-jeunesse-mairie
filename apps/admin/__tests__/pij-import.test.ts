import { describe, it, expect } from 'vitest';
import { analyserTableau, convertirFeuille, dateTableur, objetsTableur } from '@/lib/pij-import';

// Données fictives, à la forme des feuilles du tableur PIJ.

describe('analyserTableau', () => {
  it('lit un copier-coller d’Excel avec cellules multi-lignes et guillemets doublés', () => {
    expect(analyserTableau('A\tB\n"ligne 1\nligne 2"\t"dit ""oui"""\r\nx\t\n')).toEqual([
      ['A', 'B'], ['ligne 1\nligne 2', 'dit "oui"'], ['x', ''],
    ]);
  });
  it('lit un CSV français (point-virgule), BOM compris', () => {
    expect(analyserTableau('﻿Nom;Prénom\nDurand;"Léa; dite Lé"')).toEqual([['Nom', 'Prénom'], ['Durand', 'Léa; dite Lé']]);
  });
});

describe('dateTableur', () => {
  it.each([
    ['07/01/2026', '2026-01-07'], ['7/1/26', '2026-01-07'], ['2026-01-07', '2026-01-07'],
    ['46029', '2026-01-07'], ['20/02//2026', '2026-02-20'], ['', ''],
  ])('%s → %s', (entree, attendu) => expect(dateTableur(entree)).toBe(attendu));
  it('rend null pour une valeur non reconnue', () => {
    expect(dateTableur('janvier')).toBeNull();
  });
});

describe('objetsTableur', () => {
  it('traduit les libellés du tableur en clés', () => {
    expect(objetsTableur('RECHERCHE JOB/STAGE\n CV/lettre de motivation').objets).toEqual(['job_stage', 'cv_lettre']);
    expect(objetsTableur('ERASMUS +\nBAFA').objets).toEqual(['erasmus', 'bafa']);
    expect(objetsTableur('PERMIS B').objets).toEqual(['permis']);
    expect(objetsTableur('Accès aux droits/démarches administratives').objets).toEqual(['acces_droits']);
  });
  it('garde la précision de « Autre » et ne perd pas un libellé inconnu', () => {
    expect(objetsTableur('Autre (ASSR2)')).toEqual({ objets: ['autre'], precision: 'ASSR2' });
    expect(objetsTableur('Service civique')).toEqual({ objets: ['autre'], precision: 'Service civique' });
  });
});

const ENTETES_ACCUEIL = [
  'N°', '"Date de la\n première visite"', 'Nom', 'Prénom', 'Date de naissance', 'Age', 'Sexe', 'Adresse postale',
  '"Code\n postale"', 'Commune', '"QUARTIER\n (si Nogent)"', 'Mail', 'Téléphone portable',
  '"Objet de la demande\n(multi-sélection possible)"', 'Date(s) du prochain RDV', 'Remarque complémentaires',
  'Orientation (vers qui ?)', 'Suivi (résultat de la demande)', 'Etat de la demande',
].join('\t');
const ligne = (...cellules: string[]) => cellules.join('\t');

describe('convertirFeuille — Accueil', () => {
  const texte = [
    ENTETES_ACCUEIL,
    ligne('1', '46029', 'DUPONT', 'Sam', '38830', '19 ans', 'M', '1 rue X', '94130', 'Nogent-sur-Marne ', 'Village', 's@exemple.fr', '06 00 00 00 00', 'Autre (ASSR2)', '14/01/2026 à 17h', 'A rappeler', '"Mission locale\nFrance travail"', 'Pris en charge', 'Finalisé'),
    ligne('2', '13/01/2026', 'MARTIN', 'Zoé', '', '', 'F', '', '', 'Bry-sur-Marne', 'Quartier inconnu', '', '', '"ERASMUS +\nBAFA"', '', '', "Maison de l'europe du 94", '', ''),
    ligne('3', 'bientôt', 'ERREUR', 'Date', '', '', '', '', '', '', '', '', '', 'BAFA', '', '', '', '', ''),
    ligne('4', '14/01/2026', 'ERREUR', 'Objet', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''),
    ligne('5', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''),
  ].join('\n');
  const res = convertirFeuille('accueil', texte);

  it('convertit les lignes valides', () => {
    if ('erreur' in res) throw new Error(res.erreur);
    expect(res.valides.map(v => v.ligne)).toEqual([2, 3]);
    expect(res.valides[0].valeurs).toMatchObject({
      dateVisite: '2026-01-07', dateNaissance: '2006-04-23', sexe: 'M', commune: 'Nogent-sur-Marne',
      quartier: 'Village', objets: ['autre'], objetPrecision: 'ASSR2', prochainRdv: '14/01/2026 à 17h',
      orientations: ['Mission locale', 'France travail'], etat: 'finalise',
    });
    expect(res.valides[1].valeurs).toMatchObject({
      dateVisite: '2026-01-13', dateNaissance: null, quartier: null, objets: ['erasmus', 'bafa'],
      orientations: ["Maison de l'Europe du 94"], etat: 'en_cours',
    });
  });
  it('refuse avec son motif une ligne à date illisible ou sans objet, ignore les lignes vides', () => {
    if ('erreur' in res) throw new Error(res.erreur);
    expect(res.refus).toEqual([
      { ligne: 4, motif: 'Date non reconnue : « bientôt ».' },
      { ligne: 5, motif: 'Indiquez au moins un objet de la demande.' },
    ]);
  });
  it('refuse un collage sans la ligne de titres', () => {
    expect(convertirFeuille('accueil', '1\t46029\tDUPONT\tSam\n2\t46030\tA\tB')).toHaveProperty('erreur');
    expect(convertirFeuille('accueil', '')).toHaveProperty('erreur');
  });
});

describe('convertirFeuille — Permis de conduire', () => {
  it('convertit montant en euros, heures et date de commission', () => {
    const res = convertirFeuille('permis', [
      'N°\tDate de la comission\tNom\tPrénom\tTéléphone portable\tMontant attribué\tHeures à réaliser\tDéjà réalisé\tHeures restantes\tMissions réalisées\tEtat du dossier\tOrganisme',
      '1\t19/02/2026\tDUPONT\tSam\t06 00 00 00 00\t400,00 €\t20\t5\t15\tChasse aux œufs (5h)\tCOMPLET\tAuto-école X',
      '2\t\t\t\t\t\t20\t\t20\t\t\t',
    ].join('\n'));
    if ('erreur' in res) throw new Error(res.erreur);
    expect(res.refus).toEqual([]);
    expect(res.valides).toHaveLength(1);
    expect(res.valides[0].valeurs).toMatchObject({
      type: 'permis', dateRef: '2026-02-19', montant: 400, heuresARealiser: 20, heuresRealisees: 5,
      missions: 'Chasse aux œufs (5h)', etat: 'COMPLET', organisme: 'Auto-école X',
    });
  });
});
