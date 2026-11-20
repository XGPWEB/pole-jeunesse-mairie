import { describe, it, expect } from 'vitest';
import { lireFicheAgora, cleNom, ERREUR_FICHE_NON_RECONNUE, type ElementTexte } from '@/lib/fiches-agora-lecture';
import { extraireTextePdf } from '@/lib/pdf-texte';
import { valeursSante, COLONNES_SANTE_ECRITURE, aDesRenseignementsMedicaux, SANTE_VIDE } from '@/lib/jeune-sante';
import { FICHE_ENFANT_FICTIVE, FICHE_SANTE_FICTIVE, MINI_FICHE_ENFANT, pdfFictif } from './fiches-agora-fictives';

const lire = (elements: ElementTexte[]) => {
  const lecture = lireFicheAgora(elements);
  if (!lecture.ok) throw new Error(lecture.erreur);
  return lecture;
};
/** Remplace le texte du fragment situé en (x, y). */
const avec = (elements: ElementTexte[], x: number, y: number, texte: string): ElementTexte[] => {
  const cible = elements.find(e => e.x === x && e.y === y);
  if (!cible) throw new Error(`pas de fragment en ${x},${y}`);
  return elements.map(e => (e === cible ? { ...e, texte, largeur: texte.length * 5 } : e));
};

const CONTACTS = [
  { nom: 'DURAND Claire', lien: 'Mère', telephone: '06 12 34 56 78 / 01 23 45 67 89', email: 'claire.durand@exemple.fr' },
  { nom: 'PETIT Marc', lien: 'Concubin / concubine', telephone: '07 00 00 00 01', email: '' },
];

describe('lireFicheAgora — fiche enfant', () => {
  it('lit identité, adresse, responsables, contacts, santé et autorisations', () => {
    const { type, champs } = lire(FICHE_ENFANT_FICTIVE);
    expect(type).toBe('enfant');
    expect(champs).toEqual({
      nom: 'DURAND-LEROY',
      prenom: 'Sacha',
      sexe: 'M',
      dateNaissance: '2012-04-03',
      lieuNaissance: 'Nogent Sur Marne',
      adresse: '12 Rue des Lilas, 94130 Nogent Sur Marne',
      contacts: CONTACTS,
      allergies: 'Autres allergies (poussière, pollen, ...)',
      autorisationSortirAccompagne: false,
      autorisationSortirSeul: true,
      autorisationPhoto: true,
      autorisationMesuresUrgence: true,
    });
  });

  it('« null » et « N.C » ne remplissent rien : les clés sont absentes', () => {
    const { champs } = lire(FICHE_ENFANT_FICTIVE);
    for (const cle of ['etablissement', 'classe', 'regimes', 'maladies', 'hospitalisation'] as const) {
      expect(champs, cle).not.toHaveProperty(cle);
    }
  });

  it('scolarité, régimes, maladies et hospitalisation renseignés', () => {
    let e = avec(FICHE_ENFANT_FICTIVE, 280, 739, 'Collège Fictif');
    e = avec(e, 315, 716, ': 4e B');
    e = avec(e, 30, 361, 'Sans porc');
    e = avec(e, 155, 361, 'Asthme');
    e = avec(e, 454, 376, ': Hôpital Fictif');
    const { champs } = lire(e);
    expect(champs).toMatchObject({
      etablissement: 'Collège Fictif', classe: '4e B', regimes: 'Sans porc', maladies: 'Asthme', hospitalisation: 'Hôpital Fictif',
      allergies: 'Autres allergies (poussière, pollen, ...)',
    });
  });

  it('« Niveau » sert de classe quand « Classe » est vide', () => {
    expect(lire(avec(FICHE_ENFANT_FICTIVE, 316, 728, ': 4ème')).champs.classe).toBe('4ème');
  });

  it('deux responsables côte à côte : chacun garde son téléphone et son courriel', () => {
    const e: ElementTexte[] = [
      ...FICHE_ENFANT_FICTIVE,
      { x: 300, y: 609, largeur: 100, texte: 'Monsieur DURAND Luc' },
      { x: 300, y: 547, largeur: 130, texte: 'Email : luc.durand@exemple.fr' },
      { x: 404, y: 531, largeur: 40, texte: 'Portable' },
      { x: 398, y: 518, largeur: 67, texte: '06 99 99 99 99' },
    ];
    expect(lire(e).champs.contacts).toEqual([
      CONTACTS[0],
      { nom: 'DURAND Luc', lien: 'Père', telephone: '06 99 99 99 99', email: 'luc.durand@exemple.fr' },
      CONTACTS[1],
    ]);
  });

  it('nom et prénom tout en capitales : départagés par la position', () => {
    expect(lire(avec(FICHE_ENFANT_FICTIVE, 35, 751, 'SACHA DURAND-LEROY')).champs).toMatchObject({ prenom: 'SACHA', nom: 'DURAND-LEROY' });
    expect(lire(avec(FICHE_SANTE_FICTIVE, 35, 739, 'DURAND-LEROY SACHA')).champs).toMatchObject({ prenom: 'SACHA', nom: 'DURAND-LEROY' });
  });

  it('date impossible : ignorée plutôt que transmise', () => {
    expect(lire(avec(FICHE_ENFANT_FICTIVE, 35, 728, 'Né le 31/02/2012 à Nogent Sur Marne')).champs).not.toHaveProperty('dateNaissance');
  });
});

describe('lireFicheAgora — fiche santé', () => {
  it('lit vaccins, médecin, assurance et allergies', () => {
    const { type, champs } = lire(FICHE_SANTE_FICTIVE);
    expect(type).toBe('sante');
    expect(champs).toEqual({
      nom: 'DURAND-LEROY',
      prenom: 'Sacha',
      sexe: 'M',
      dateNaissance: '2012-04-03',
      lieuNaissance: 'Nogent Sur Marne',
      adresse: '12 Rue des Lilas, 94130 NOGENT SUR MARNE',
      contacts: CONTACTS,
      vaccins: [
        { nom: 'Diphtérie, tétanos, la', date: '2018-02-01' },
        { nom: 'Haemophilus influenzae', date: '2018-02-01' },
        { nom: 'Hépatite B', date: '2013-06-15' },
        { nom: 'Infections à Pneumocoques', date: '2013-01-10' },
        { nom: 'Méningocoque de sérogroupe', date: '2013-06-15' },
        { nom: 'Rougeole Oreillons Rubéole', date: '2013-01-10' },
      ],
      assuranceCompagnie: 'Assurance Fictive',
      assurancePolice: '000000-00X',
      medecinNom: 'BERNARD Paul',
      medecinTelephone: '01 98 76 54 32',
      allergies: 'Autres allergies (poussière, pollen, ...)',
    });
  });

  it('minimisation : ni sécurité sociale, ni allocataire, ni numéro de famille dans ce qui est rendu', () => {
    const rendu = JSON.stringify(lire(FICHE_SANTE_FICTIVE));
    for (const interdit of ['200000000000000', '0000001', '1000', 'Allocations', 'Allocataire']) {
      expect(rendu, interdit).not.toContain(interdit);
    }
  });

  it('maladies, hospitalisation et précision d\'allergie renseignées', () => {
    let e = avec(FICHE_SANTE_FICTIVE, 36, 370, 'Asthme');
    e = avec(e, 377, 240, ': Oui');
    e = avec(e, 408, 228, ': Hôpital Fictif');
    e = avec(e, 218, 171, ': acariens');
    expect(lire(e).champs).toMatchObject({
      maladies: 'Asthme', hospitalisation: 'Oui', lieuHospitalisation: 'Hôpital Fictif',
      allergies: 'Autres allergies (poussière, pollen, ...) : acariens',
    });
  });
});

describe('lireFicheAgora — rubriques imprimées seulement si renseignées', () => {
  /** Insère une rubrique entre les contacts et « Maladie(s) », en décalant la suite vers le bas. */
  const avecRubrique = (titre: string, lignes: string[]): ElementTexte[] => {
    const hauteur = 16 + 12 * lignes.length + 8;
    return [
      ...FICHE_SANTE_FICTIVE.map(e => (e.y < 400 && e.y > 100 ? { ...e, y: e.y - hauteur } : e)),
      { x: 297 - titre.length * 3, y: 388, largeur: titre.length * 6, texte: titre },
      ...lignes.map((texte, i) => ({ x: 36, y: 372 - 12 * i, largeur: texte.length * 5, texte })),
    ];
  };

  it('« Régime(s) alimentaire(s) » : lu comme régime, jamais comme contact (retour d\'usage du 2026-10-12)', () => {
    const { champs } = lire(avecRubrique('Régime(s) alimentaire(s)', ['Sans porc :', 'Sans gluten : sur avis médical']));
    expect(champs.contacts).toEqual(CONTACTS);
    expect(champs.regimes).toBe('Sans porc, Sans gluten : sur avis médical');
    // Le reste de la fiche est lu comme avant, malgré le décalage.
    expect(champs).toMatchObject({
      medecinNom: 'BERNARD Paul', assuranceCompagnie: 'Assurance Fictive',
      allergies: 'Autres allergies (poussière, pollen, ...)',
    });
    expect(champs.vaccins).toHaveLength(6);
    expect(champs).not.toHaveProperty('maladies');
  });

  it('« Allergie(s) » : ajoutée aux allergies', () => {
    const { champs } = lire(avecRubrique('Allergie(s)', ['Arachide :']));
    expect(champs.contacts).toEqual(CONTACTS);
    expect(champs.allergies).toBe('Arachide, Autres allergies (poussière, pollen, ...)');
  });

  it('rubrique inconnue : ni contact, ni perdue — reportée avec son titre', () => {
    const { champs } = lire(avecRubrique('Recommandation(s)', ['Porte des lunettes']));
    expect(champs.contacts).toEqual(CONTACTS);
    expect(champs.maladies).toBe('Recommandation(s) : Porte des lunettes');
  });

  it('fiche enfant : un titre inconnu sous les contacts ferme aussi leur liste', () => {
    const e: ElementTexte[] = [
      ...FICHE_ENFANT_FICTIVE.map(f => (f.y < 410 && f.y > 100 ? { ...f, y: f.y - 30 } : f)),
      { x: 240, y: 404, largeur: 110, texte: 'Recommandation(s)' },
      { x: 30, y: 392, largeur: 90, texte: 'Porte des lunettes' },
    ];
    expect(lire(e).champs.contacts).toEqual(CONTACTS);
  });
});

describe('lireFicheAgora — documents non reconnus', () => {
  it.each([
    ['aucun fragment', []],
    ['un autre document', [{ x: 30, y: 800, largeur: 60, texte: 'FACTURE' }, { x: 30, y: 780, largeur: 90, texte: 'Sacha DURAND' }]],
    ['un titre sans identité', [{ x: 370, y: 790, largeur: 100, texte: 'FICHE ENFANT' }]],
  ])('%s', (_cas, elements) => {
    expect(lireFicheAgora(elements as ElementTexte[])).toEqual({ ok: false, erreur: ERREUR_FICHE_NON_RECONNUE });
  });
});

describe('extraireTextePdf', () => {
  it('rend les fragments d\'un vrai PDF avec leur position, lisibles par lireFicheAgora', async () => {
    const elements = await extraireTextePdf(pdfFictif(MINI_FICHE_ENFANT));
    expect(elements.map(e => e.texte)).toEqual(MINI_FICHE_ENFANT.map(f => f.texte));
    expect(Math.round(elements[1].x)).toBe(35);
    expect(Math.round(elements[1].y)).toBe(751);
    expect(lire(elements).champs).toEqual({
      nom: 'DURAND-LEROY', prenom: 'Sacha', sexe: 'M', dateNaissance: '2012-04-03',
      lieuNaissance: 'Nogent Sur Marne', adresse: '12 Rue des Lilas',
    });
  });

  it('fichier qui n\'est pas un PDF lisible : exception', async () => {
    await expect(extraireTextePdf(Buffer.from('%PDF-1.4\nrien\n%%EOF'))).rejects.toBeTruthy();
  });
});

describe('cleNom', () => {
  it('ignore accents, casse, espaces et traits d\'union', () => {
    expect(cleNom('Durand-Leroy')).toBe(cleNom('DURAND LEROY'));
    expect(cleNom('Éloïse')).toBe('ELOISE');
  });
});

describe('valeursSante — bornage côté serveur', () => {
  it('autant de valeurs que de colonnes, vides en NULL, autorisations à trois états', () => {
    const v = valeursSante({ ...SANTE_VIDE, allergies: '  pollen ', autorisationSortirSeul: false, autorisationMesuresUrgence: 'oui' as never });
    expect(v).toHaveLength(COLONNES_SANTE_ECRITURE.length);
    const parColonne = Object.fromEntries(COLONNES_SANTE_ECRITURE.map((c, i) => [c, v[i]]));
    expect(parColonne).toMatchObject({
      allergies: 'pollen', regimes: null, vaccins: '[]',
      autorisation_sortir_seul: false, autorisation_sortir_accompagne: null, autorisation_mesures_urgence: null,
    });
  });

  it('vaccins : entrées mal formées écartées, dates invalides vidées, nombre et longueurs bornés', () => {
    const vaccins = JSON.parse(valeursSante({
      vaccins: [
        { nom: 'DTP', date: '2020-01-02' }, { nom: 'ROR', date: '02/01/2020' }, { nom: '   ' }, 'texte', null,
        { nom: 'x'.repeat(500), date: '' },
        ...Array.from({ length: 100 }, (_, i) => ({ nom: `v${i}`, date: '' })),
      ],
    })[COLONNES_SANTE_ECRITURE.indexOf('vaccins')] as string);
    expect(vaccins.slice(0, 2)).toEqual([{ nom: 'DTP', date: '2020-01-02' }, { nom: 'ROR', date: '' }]);
    expect(vaccins[2].nom).toHaveLength(200);
    expect(vaccins.length).toBeLessThanOrEqual(40);
    expect(JSON.parse(valeursSante({ vaccins: 'pas une liste' })[4] as string)).toEqual([]);
  });

  it('texte long tronqué, type inattendu ignoré', () => {
    const v = valeursSante({ maladies: 'a'.repeat(5000), medecinNom: 42 as never });
    expect((v[COLONNES_SANTE_ECRITURE.indexOf('maladies')] as string)).toHaveLength(2000);
    expect(v[COLONNES_SANTE_ECRITURE.indexOf('medecin_nom')]).toBeNull();
  });

  it('aDesRenseignementsMedicaux : les autorisations seules ne comptent pas', () => {
    expect(aDesRenseignementsMedicaux({ ...SANTE_VIDE, autorisationMesuresUrgence: true, lieuNaissance: 'Nogent' })).toBe(false);
    expect(aDesRenseignementsMedicaux({ ...SANTE_VIDE, vaccins: [{ nom: 'DTP', date: '' }] })).toBe(true);
  });
});
