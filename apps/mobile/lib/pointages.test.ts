import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import {
  brouillonRestant,
  calculerEcart,
  celluleServeur,
  construireRegistre,
  idLigneManuelle,
  lireStatut,
  normaliserPointages,
  pointageASupprimer,
  Registre,
  statutAffiche,
} from './pointages';

const ACCUEIL: Registre = { type: 'accueil' };
const ATELIER: Registre = { type: 'activite', activiteId: 'act-1' };
const JOUR = '2026-10-06';

/** Ligne telle que la renvoie GET /api/pointages. */
function ligne(partiel: Record<string, unknown>): Record<string, unknown> {
  return {
    jeuneId: null,
    espaceId: 'collegiens',
    date: JOUR,
    heureArrivee: '14:00',
    heureSortie: null,
    animateur: 'anim',
    type: 'accueil-libre',
    activiteId: null,
    manuel: false,
    source: 'mobile',
    statut: null,
    prenomManuel: null,
    nomManuel: null,
    ...partiel,
  };
}

describe('statut des pointages', () => {
  it('une absence serveur reste une absence', () => {
    const pointages = normaliserPointages([
      ligne({ id: 'pt-1', jeuneId: 'j-1', type: 'activite', activiteId: 'act-1', statut: 'absent' }),
    ]);
    expect(pointages[0].statut).toBe('absent');
    const etat = construireRegistre(pointages, ATELIER);
    expect(celluleServeur(etat, 'j-1', JOUR)).toEqual({ statut: 'absent', pointageIds: ['pt-1'] });
    // Affichée telle quelle, sans brouillon : jamais « présent ».
    expect(statutAffiche(etat, {}, 'j-1', JOUR)).toBe('absent');
  });

  it('excusé et présent sont conservés ; sans statut = arrivée, donc présence', () => {
    expect(lireStatut('excuse')).toBe('excuse');
    expect(lireStatut('present')).toBe('present');
    expect(lireStatut(null)).toBe('present');
    expect(lireStatut(undefined)).toBe('present');
  });

  it("un statut inconnu écarte la ligne au lieu d'en faire une présence", () => {
    expect(lireStatut('retard')).toBeNull();
    const pointages = normaliserPointages([
      ligne({ id: 'pt-1', jeuneId: 'j-1', statut: 'retard' }),
      ligne({ id: 'pt-2', jeuneId: 'j-2', statut: 'present' }),
    ]);
    expect(pointages.map((p) => p.id)).toEqual(['pt-2']);
  });

  it('une réponse qui n’est pas une liste est une erreur, pas un registre vide', () => {
    expect(() => normaliserPointages({ error: 'Non autorisé' })).toThrow(ApiError);
  });
});

describe('cloisonnement des registres', () => {
  const pointages = normaliserPointages([
    ligne({ id: 'pt-accueil', jeuneId: 'j-1' }),
    ligne({ id: 'pt-activite', jeuneId: 'j-1', type: 'activite', activiteId: 'act-1', statut: 'present' }),
    ligne({ id: 'pt-autre', jeuneId: 'j-2', type: 'activite', activiteId: 'act-2', statut: 'absent' }),
    // Pointage d'activité dont l'activité a été détachée : pas de l'accueil pour autant.
    ligne({ id: 'pt-orphelin', jeuneId: 'j-3', type: 'activite', activiteId: null, statut: 'present' }),
  ]);

  it("un pointage d'activité n'est pas compté comme présence d'accueil", () => {
    const accueil = construireRegistre(pointages, ACCUEIL);
    expect(accueil.jeuneIds).toEqual(['j-1']);
    expect(celluleServeur(accueil, 'j-1', JOUR)?.pointageIds).toEqual(['pt-accueil']);
    expect(celluleServeur(accueil, 'j-2', JOUR)).toBeNull();
    expect(celluleServeur(accueil, 'j-3', JOUR)).toBeNull();
  });

  it("le registre d'une activité ne contient que ses propres pointages", () => {
    const atelier = construireRegistre(pointages, ATELIER);
    expect(atelier.jeuneIds).toEqual(['j-1']);
    expect(celluleServeur(atelier, 'j-1', JOUR)?.pointageIds).toEqual(['pt-activite']);
  });

  it("la suppression cible un seul id : celui du registre affiché", () => {
    expect(pointageASupprimer(construireRegistre(pointages, ACCUEIL), 'j-1', JOUR)).toBe('pt-accueil');
    expect(pointageASupprimer(construireRegistre(pointages, ATELIER), 'j-1', JOUR)).toBe('pt-activite');
    // Rien d'enregistré pour ce jeune à l'accueil : rien à supprimer.
    expect(pointageASupprimer(construireRegistre(pointages, ACCUEIL), 'j-2', JOUR)).toBeNull();
    // Autre jour : rien non plus.
    expect(pointageASupprimer(construireRegistre(pointages, ACCUEIL), 'j-1', '2026-10-05')).toBeNull();
  });

  it('en cas de doublon, tous les ids sont connus et un seul est ciblé', () => {
    const doublons = normaliserPointages([
      ligne({ id: 'pt-recent', jeuneId: 'j-1' }),
      ligne({ id: 'pt-ancien', jeuneId: 'j-1' }),
    ]);
    const etat = construireRegistre(doublons, ACCUEIL);
    expect(celluleServeur(etat, 'j-1', JOUR)?.pointageIds).toEqual(['pt-recent', 'pt-ancien']);
    expect(pointageASupprimer(etat, 'j-1', JOUR)).toBe('pt-recent');
  });
});

describe('entrées manuelles : identifiants stables', () => {
  it("l'identifiant local et celui reconstruit depuis le serveur sont identiques", () => {
    const local = idLigneManuelle('Paul', 'DURAND');
    const etat = construireRegistre(
      normaliserPointages([ligne({ id: 'pt-9', manuel: true, prenomManuel: ' paul', nomManuel: 'Durand ' })]),
      ACCUEIL,
    );
    expect(etat.manuels).toEqual([{ rowId: local, prenom: ' paul', nom: 'Durand ' }]);
    expect(pointageASupprimer(etat, local, JOUR)).toBe('pt-9');
  });

  it('les synchronisations répétées ne dupliquent pas la ligne', () => {
    const brut = [
      ligne({ id: 'pt-9', manuel: true, prenomManuel: 'Paul', nomManuel: 'DURAND' }),
      ligne({ id: 'pt-8', manuel: true, prenomManuel: 'Paul', nomManuel: 'DURAND', date: '2026-10-05' }),
    ];
    const premiere = construireRegistre(normaliserPointages(brut), ACCUEIL);
    const seconde = construireRegistre(normaliserPointages(brut), ACCUEIL);
    expect(premiere.manuels).toHaveLength(1);
    expect(seconde).toEqual(premiere);
    expect(Object.keys(premiere.cellules[idLigneManuelle('Paul', 'DURAND')]).sort()).toEqual([
      '2026-10-05',
      JOUR,
    ]);
  });

  it('une entrée supprimée du serveur ne réapparaît pas à la synchronisation suivante', () => {
    const apresSuppression = construireRegistre(normaliserPointages([]), ACCUEIL);
    expect(apresSuppression.manuels).toEqual([]);
    expect(apresSuppression.cellules).toEqual({});
  });
});

describe("écart brouillon / serveur pour les présences d'une activité", () => {
  const serveur = construireRegistre(
    normaliserPointages([
      ligne({ id: 'pt-1', jeuneId: 'j-1', type: 'activite', activiteId: 'act-1', statut: 'absent' }),
      ligne({ id: 'pt-2', jeuneId: 'j-2', type: 'activite', activiteId: 'act-1', statut: 'present' }),
    ]),
    ATELIER,
  );

  it("n'envoie que ce qui diffère du serveur et supprime par id ce qui est remplacé ou effacé", () => {
    const ecart = calculerEcart(
      serveur,
      { 'j-1': 'present', 'j-2': null, 'j-3': 'excuse', 'j-4': null },
      JOUR,
    );
    expect(ecart.aEnvoyer).toEqual([
      { rowId: 'j-1', statut: 'present' },
      { rowId: 'j-3', statut: 'excuse' },
    ]);
    expect(ecart.aSupprimer).toEqual(['pt-1', 'pt-2']);
  });

  it('une saisie identique au serveur ne produit aucune écriture', () => {
    expect(calculerEcart(serveur, { 'j-1': 'absent', 'j-2': 'present' }, JOUR)).toEqual({
      aEnvoyer: [],
      aSupprimer: [],
    });
  });

  it('après rechargement, seules les saisies reflétées par le serveur quittent le brouillon', () => {
    // Le serveur n'a pris en compte que j-1 : j-3 doit rester à enregistrer.
    const apres = construireRegistre(
      normaliserPointages([
        ligne({ id: 'pt-10', jeuneId: 'j-1', type: 'activite', activiteId: 'act-1', statut: 'present' }),
      ]),
      ATELIER,
    );
    expect(brouillonRestant(apres, { 'j-1': 'present', 'j-3': 'excuse' }, JOUR)).toEqual({ 'j-3': 'excuse' });
  });
});
