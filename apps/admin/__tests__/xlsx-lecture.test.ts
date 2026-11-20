import { describe, it, expect } from 'vitest';
import { ErreurXlsx, lireXlsx, versTexteTabule } from '@/lib/xlsx-lecture';
import { convertirFeuille } from '@/lib/pij-import';
import { xlsxFictif } from './xlsx-fictif';

const tampon = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

const CLASSEUR = [
  { nom: 'Accueil', lignes: [
    ['N°', 'Date de la\n première visite', 'Nom', 'Prénom', 'Date de naissance', 'Sexe', 'Objet de la demande', 'Etat de la demande'],
    [1, 46029, 'DUPONT & Fils', 'Sam', 38830, 'M', 'ERASMUS +\nBAFA', 'Finalisé'],
    [2, 46034, 'MARTIN', 'Zoé "Zo"', '', 'F', 'PERMIS B', ''],
    [3, '', '', '', '', '', '', ''],
  ] },
  { nom: 'Permis de conduire', lignes: [
    ['N°', 'Date de la comission', 'Nom', 'Prénom', 'Montant attribué', 'Heures à réaliser', 'Déjà réalisé'],
    [1, 46072, 'DUPONT', 'Sam', 400, 20, 5],
  ] },
];

describe('lireXlsx', () => {
  it.each([[true, 'compressé'], [false, 'non compressé']])('lit les feuilles d’un classeur %s (%s)', async (compresser) => {
    const feuilles = await lireXlsx(tampon(xlsxFictif(CLASSEUR, { compresser: compresser as boolean })));
    expect(feuilles.map(f => f.nom)).toEqual(['Accueil', 'Permis de conduire']);
    expect(feuilles[0].lignes[1]).toEqual(['1', '46029', 'DUPONT & Fils', 'Sam', '38830', 'M', 'ERASMUS +\nBAFA', 'Finalisé']);
    // Cellule vide au milieu d'une ligne : la colonne suivante ne se décale pas.
    expect(feuilles[0].lignes[2]).toEqual(['2', '46034', 'MARTIN', 'Zoé "Zo"', '', 'F', 'PERMIS B']);
    expect(feuilles[1].lignes[1]).toEqual(['1', '46072', 'DUPONT', 'Sam', '400', '20', '5']);
  });

  it('refuse ce qui n’est pas un classeur, avec un message clair', async () => {
    await expect(lireXlsx(new TextEncoder().encode('Nom;Prénom\nA;B, simple texte, pas une archive').buffer as ArrayBuffer)).rejects.toThrow(ErreurXlsx);
    await expect(lireXlsx(new ArrayBuffer(4))).rejects.toThrow(ErreurXlsx);
  });

  it('enchaîné avec l’import PIJ : dates en numéro de série, cellules multi-lignes, guillemets', async () => {
    const [accueil, permis] = await lireXlsx(tampon(xlsxFictif(CLASSEUR)));

    const a = convertirFeuille('accueil', versTexteTabule(accueil.lignes));
    if ('erreur' in a) throw new Error(a.erreur);
    expect(a.refus).toEqual([]);
    expect(a.valides.map(v => v.valeurs)).toMatchObject([
      { dateVisite: '2026-01-07', nom: 'DUPONT & Fils', dateNaissance: '2006-04-23', objets: ['erasmus', 'bafa'], etat: 'finalise' },
      { dateVisite: '2026-01-12', prenom: 'Zoé "Zo"', dateNaissance: null, objets: ['permis'], etat: 'en_cours' },
    ]);

    const p = convertirFeuille('permis', versTexteTabule(permis.lignes));
    if ('erreur' in p) throw new Error(p.erreur);
    expect(p.valides.map(v => v.valeurs)).toMatchObject([{ dateRef: '2026-02-19', montant: 400, heuresARealiser: 20, heuresRealisees: 5 }]);
  });
});
