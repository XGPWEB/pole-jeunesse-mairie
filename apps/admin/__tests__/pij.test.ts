import { describe, it, expect } from 'vitest';
import {
  agePij, calculerStatsPij, heuresRestantes, peutSaisirPij, validerAccueil, validerDossier, validerMission,
  type AccueilPij,
} from '@/lib/pij';

describe('peutSaisirPij — saisie réservée aux admins et aux informateurs PIJ', () => {
  it('autorise un admin, quel que soit son espace', () => {
    expect(peutSaisirPij({ role: 'admin', espaceAssigne: 'Collégiens' })).toBe(true);
  });
  it('autorise un animateur affecté au PIJ', () => {
    expect(peutSaisirPij({ role: 'animateur', espaceAssigne: 'PIJ' })).toBe(true);
    expect(peutSaisirPij({ role: 'animateur', espaceAssigne: ' pij ' })).toBe(true);
  });
  it.each(['Collégiens', 'Lycéens', 'CLAS', 'Tous', '', null])('refuse un animateur de l’espace %s', (espace) => {
    expect(peutSaisirPij({ role: 'animateur', espaceAssigne: espace })).toBe(false);
  });
  it('refuse en l’absence de session', () => {
    expect(peutSaisirPij(null)).toBe(false);
  });
});

const BASE = { dateVisite: '2026-01-09', nom: ' Durand ', prenom: 'Léa', objets: ['bafa'] };

describe('validerAccueil', () => {
  it('nettoie les textes et convertit les champs vidés en null', () => {
    const r = validerAccueil({ ...BASE, dateNaissance: '', email: '  ', sexe: '', quartier: '' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valeurs).toMatchObject({
      nom: 'Durand', dateNaissance: null, email: null, sexe: null, quartier: null, etat: 'en_cours',
    });
  });
  it('exige nom, prénom, date de visite et au moins un objet', () => {
    expect(validerAccueil({ ...BASE, nom: '  ' }).ok).toBe(false);
    expect(validerAccueil({ ...BASE, dateVisite: '' }).ok).toBe(false);
    expect(validerAccueil({ ...BASE, objets: [] }).ok).toBe(false);
  });
  it('refuse une date impossible, un objet, un quartier ou un état hors liste', () => {
    expect(validerAccueil({ ...BASE, dateVisite: '2026-02-30' }).ok).toBe(false);
    expect(validerAccueil({ ...BASE, dateNaissance: '09/01/2008' }).ok).toBe(false);
    expect(validerAccueil({ ...BASE, objets: ['bafa', 'inconnu'] }).ok).toBe(false);
    expect(validerAccueil({ ...BASE, quartier: 'Ailleurs' }).ok).toBe(false);
    expect(validerAccueil({ ...BASE, etat: 'perdu' }).ok).toBe(false);
  });
  it('refuse une naissance postérieure à la visite', () => {
    expect(validerAccueil({ ...BASE, dateNaissance: '2027-01-01' }).ok).toBe(false);
  });
  it('dédoublonne les orientations sans tenir compte de la casse', () => {
    const r = validerAccueil({ ...BASE, orientations: ['CAF', 'caf', ' IFAC ', ''] });
    expect(r.ok && r.valeurs.orientations).toEqual(['CAF', 'IFAC']);
  });
});

describe('validerDossier', () => {
  it('ne retient que les colonnes de la feuille concernée', () => {
    const r = validerDossier({ type: 'chantier', nom: 'A', prenom: 'B', objet: 'Peinture', montant: '400', organisme: 'X' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valeurs).toMatchObject({ objet: 'Peinture', montant: null, organisme: null });
  });
  it('accepte les nombres saisis avec une virgule et les champs vidés', () => {
    const r = validerDossier({ type: 'permis', nom: 'A', prenom: 'B', montant: '400,50', heuresARealiser: '20', heuresRealisees: '', dateRef: '' });
    expect(r.ok && r.valeurs).toMatchObject({ montant: 400.5, heuresARealiser: 20, heuresRealisees: null, dateRef: null });
  });
  it('refuse un type inconnu, un nombre négatif ou non numérique', () => {
    expect(validerDossier({ type: 'autre', nom: 'A', prenom: 'B' }).ok).toBe(false);
    expect(validerDossier({ type: 'permis', nom: 'A', prenom: 'B', montant: -1 }).ok).toBe(false);
    expect(validerDossier({ type: 'permis', nom: 'A', prenom: 'B', heuresARealiser: 'vingt' }).ok).toBe(false);
  });
});

describe('validerMission', () => {
  const BASE_MISSION = { dossierId: 'd1', date: '2026-04-05', libelle: ' Chasse aux œufs ', heures: '2,5' };
  it('accepte une mission, heures à virgule comprises', () => {
    const r = validerMission(BASE_MISSION);
    expect(r.ok && r.valeurs).toEqual({ dossierId: 'd1', date: '2026-04-05', libelle: 'Chasse aux œufs', heures: 2.5 });
  });
  it('exige un dossier, un intitulé, une date réelle et des heures strictement positives', () => {
    expect(validerMission({ ...BASE_MISSION, dossierId: '' }).ok).toBe(false);
    expect(validerMission({ ...BASE_MISSION, libelle: '  ' }).ok).toBe(false);
    expect(validerMission({ ...BASE_MISSION, date: '' }).ok).toBe(false);
    expect(validerMission({ ...BASE_MISSION, date: '2026-02-30' }).ok).toBe(false);
    expect(validerMission({ ...BASE_MISSION, heures: '0' }).ok).toBe(false);
    expect(validerMission({ ...BASE_MISSION, heures: '' }).ok).toBe(false);
    expect(validerMission({ ...BASE_MISSION, heures: '-2' }).ok).toBe(false);
    expect(validerMission({ ...BASE_MISSION, heures: 'cinq' }).ok).toBe(false);
  });
});

describe('calculs du tableur', () => {
  it('âge révolu : change le jour de l’anniversaire', () => {
    expect(agePij('2008-03-15', '2026-03-14')).toBe(17);
    expect(agePij('2008-03-15', '2026-03-15')).toBe(18);
    expect(agePij(null, '2026-03-15')).toBeNull();
  });
  it('heures restantes = à réaliser − déjà réalisé', () => {
    expect(heuresRestantes({ heuresARealiser: 20, heuresRealisees: 5 })).toBe(15);
    expect(heuresRestantes({ heuresARealiser: 20, heuresRealisees: null })).toBe(20);
    expect(heuresRestantes({ heuresARealiser: null, heuresRealisees: 5 })).toBeNull();
  });
});

function accueil(p: Partial<AccueilPij>): AccueilPij {
  return {
    id: Math.random().toString(36), dateVisite: '2026-01-09', nom: 'N', prenom: 'P', dateNaissance: null,
    sexe: null, adresse: null, codePostal: null, commune: null, quartier: null, email: null, telephone: null,
    objets: [], objetPrecision: null, prochainRdv: null, remarques: null, orientations: [], suivi: null,
    etat: 'en_cours', ...p,
  };
}
const effectif = (lignes: { label: string; effectif: number }[], label: string) =>
  lignes.find(l => l.label === label)?.effectif;

describe('calculerStatsPij — feuille « STATS »', () => {
  const stats = calculerStatsPij([
    accueil({ sexe: 'M', dateNaissance: '2006-04-20', commune: 'Nogent-sur-Marne', quartier: 'Village', objets: ['autre'], orientations: ['GRETA'], etat: 'finalise' }),
    accueil({ sexe: 'F', dateNaissance: '2008-03-07', commune: 'Nogent-sur-Marne ', quartier: 'Les Viselets', objets: ['erasmus', 'bafa'], orientations: ['CAF', 'IFAC'] }),
    accueil({ sexe: 'F', dateNaissance: '2009-01-01', commune: 'Bry-sur-Marne', quartier: 'Village', objets: ['job_stage'], orientations: ["Maison de l'europe du 94"] }),
    accueil({ objets: ['bafa'] }),
  ], '2026-10-09');

  it('compte les jeunes, et un dossier par objet de demande', () => {
    expect(stats.nbJeunes).toBe(4);
    expect(stats.nbDossiers).toBe(5);
  });
  it('répartit par sexe, objet et état, lignes à zéro comprises', () => {
    expect(stats.parSexe).toEqual([
      { label: 'Garçons', effectif: 1 }, { label: 'Filles', effectif: 2 }, { label: 'Non renseigné', effectif: 1 },
    ]);
    expect(effectif(stats.parObjet, 'BAFA')).toBe(2);
    expect(effectif(stats.parObjet, 'PSC1')).toBe(0);
    expect(effectif(stats.parEtat, 'Finalisé')).toBe(1);
    expect(effectif(stats.parEtat, 'En cours de réalisation')).toBe(3);
  });
  it('calcule les âges au jour donné', () => {
    expect(effectif(stats.parAge, '20 ans')).toBe(1);
    expect(effectif(stats.parAge, '18 ans')).toBe(1);
    expect(effectif(stats.parAge, '17 ans')).toBe(1);
    expect(effectif(stats.parAge, 'Non renseigné')).toBe(1);
  });
  it('regroupe les variantes d’écriture d’une commune', () => {
    expect(effectif(stats.parCommune, 'Nogent-sur-Marne')).toBe(2);
    expect(effectif(stats.parCommune, 'Bry-sur-Marne')).toBe(1);
  });
  it('ne compte les quartiers que pour les Nogentais', () => {
    expect(effectif(stats.parQuartier, 'Village')).toBe(1);
    expect(effectif(stats.parQuartier, 'Les Viselets')).toBe(1);
  });
  it('compte chaque orientation d’une demande multi-orientée', () => {
    expect(effectif(stats.parOrientation, 'CAF')).toBe(1);
    expect(effectif(stats.parOrientation, 'IFAC')).toBe(1);
    expect(effectif(stats.parOrientation, "Maison de l'Europe du 94")).toBe(1);
    expect(effectif(stats.parOrientation, 'Non renseigné')).toBe(1);
  });
});
