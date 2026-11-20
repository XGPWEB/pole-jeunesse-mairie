import { describe, it, expect } from 'vitest';

import { computeDashboardAlerts } from '@/lib/dashboardAlerts';

/**
 * L'encart « Contrats arrivant à échéance » du dashboard admin n'avait JAMAIS
 * pu s'afficher : la colonne date_fin_contrat n'existait pas en base et la
 * saisie du formulaire était silencieusement jetée (migration du 2026-07-30).
 * La logique de calcul n'ayant jamais tourné avec de vraies données, on la
 * verrouille ici — notamment les bornes de la fenêtre d'alerte.
 */

const anim = (over: Record<string, unknown> = {}) => ({
  id: 'anim-1', prenom: 'Léa', nom: 'Martin',
  dateNaissance: null, dateFinContrat: null, ...over,
});

// Midi, pour qu'aucun arrondi de fuseau ne fasse basculer le calcul d'un jour.
const today = new Date('2026-07-30T12:00:00');

describe('computeDashboardAlerts — alertes fin de contrat', () => {
  it('alerte pour un contrat qui expire dans la fenêtre (45 j par défaut)', () => {
    const { contractAlerts } = computeDashboardAlerts([anim({ dateFinContrat: '2026-08-15' })], today);
    expect(contractAlerts).toHaveLength(1);
    expect(contractAlerts[0].joursRestants).toBe(16);
    expect(contractAlerts[0].dateFinContrat).toBe('2026-08-15');
  });

  it("alerte le jour même de l'expiration (joursRestants = 0)", () => {
    const { contractAlerts } = computeDashboardAlerts([anim({ dateFinContrat: '2026-07-30' })], today);
    expect(contractAlerts).toHaveLength(1);
    // Le contrat finit à 00:00 et « today » est à 12:00 : l'écart est de −0,5 j,
    // donc Math.ceil renvoie -0. Sans conséquence — l'encart teste
    // `joursRestants === 0`, et `-0 === 0` est vrai. On assert donc l'égalité
    // stricte (et non `toBe`, qui distingue 0 de -0 via Object.is).
    expect(contractAlerts[0].joursRestants === 0).toBe(true);
  });

  it("n'alerte pas pour un contrat déjà expiré", () => {
    const { contractAlerts } = computeDashboardAlerts([anim({ dateFinContrat: '2026-07-29' })], today);
    expect(contractAlerts).toHaveLength(0);
  });

  it("n'alerte pas au-delà de la fenêtre de 45 jours", () => {
    const { contractAlerts } = computeDashboardAlerts([anim({ dateFinContrat: '2026-12-31' })], today);
    expect(contractAlerts).toHaveLength(0);
  });

  it('ignore un animateur sans date de fin de contrat (cas des titulaires)', () => {
    const { contractAlerts } = computeDashboardAlerts(
      [anim({ dateFinContrat: null }), anim({ id: 'anim-2', dateFinContrat: '' })],
      today,
    );
    expect(contractAlerts).toHaveLength(0);
  });

  it('trie les contrats du plus urgent au moins urgent', () => {
    const { contractAlerts } = computeDashboardAlerts([
      anim({ id: 'a', dateFinContrat: '2026-08-20' }),
      anim({ id: 'b', dateFinContrat: '2026-08-01' }),
      anim({ id: 'c', dateFinContrat: '2026-08-10' }),
    ], today);
    expect(contractAlerts.map(c => c.animateurId)).toEqual(['b', 'c', 'a']);
  });
});
