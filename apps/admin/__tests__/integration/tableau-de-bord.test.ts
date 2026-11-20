import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import pool from '@/lib/db';
import { chargerTableauDeBord } from '@/lib/dashboard-data';
import { resetDb, seedTenant } from './helpers';

/**
 * Le tableau de bord ne charge plus les tables entières : le tri (à venir,
 * annulé, liste d'attente, 30 derniers jours) est fait en SQL. Ces tests
 * verrouillent que les chiffres affichés sont ceux que calculait la page
 * quand elle filtrait tout en JavaScript.
 */
const TODAY = '2026-10-07';
const DEPUIS = '2026-09-07';

async function activite(id: string, date: string | null, extra: { statut?: string; dispo?: number; tenant?: string } = {}) {
  await pool.query(
    `INSERT INTO activites (id, titre, date, places_total, places_disponibles, statut, tenant_id) VALUES ($1, $2, $3, 10, $4, $5, $6)`,
    [id, `Activité ${id}`, date, extra.dispo ?? 10, extra.statut ?? 'ouvert', extra.tenant ?? 'nogent'],
  );
}
async function inscription(id: string, activiteId: string, statut: string, tenant = 'nogent') {
  await pool.query(`INSERT INTO inscriptions (id, activite_id, statut, tenant_id) VALUES ($1, $2, $3, $4)`, [id, activiteId, statut, tenant]);
}
async function sortie(id: string, date: string, extra: { statut?: string | null; capacite?: number } = {}) {
  await pool.query(
    `INSERT INTO sorties (id, titre, date, statut, capacite, tenant_id) VALUES ($1, $2, $3, $4, $5, 'nogent')`,
    [id, `Sortie ${id}`, date, extra.statut === undefined ? 'planifiee' : extra.statut, extra.capacite ?? 0],
  );
}
async function participant(sortieId: string, jeuneId: string, enAttente: boolean) {
  await pool.query(`INSERT INTO sorties_participants (sortie_id, jeune_id, en_attente) VALUES ($1, $2, $3)`, [sortieId, jeuneId, enAttente]);
}
async function actualite(id: string, date: string) {
  await pool.query(`INSERT INTO actualites (id, titre, date, tenant_id) VALUES ($1, $2, $3, 'nogent')`, [id, `Actu ${id}`, date]);
}

describe('chargerTableauDeBord', () => {
  beforeEach(async () => {
    await resetDb();
    await seedTenant('nogent');
    await seedTenant('autre');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('activités : compte tout, ne renvoie que celles à venir, avec leur liste d\'attente', async () => {
    await activite('a-passee', '2026-10-06');
    await activite('a-jour', TODAY, { statut: 'complet', dispo: 0 });
    await activite('a-future', '2026-11-01', { dispo: 2 });
    await activite('a-sans-date', null);
    await activite('a-autre', '2026-11-01', { tenant: 'autre' });
    await inscription('i1', 'a-future', 'liste-attente');
    await inscription('i2', 'a-future', 'liste-attente');
    await inscription('i3', 'a-future', 'confirmee');
    await inscription('i4', 'a-passee', 'liste-attente');
    await inscription('i5', 'a-jour', 'en-attente');
    await inscription('i6', 'a-autre', 'en-attente', 'autre');

    const d = await chargerTableauDeBord('nogent', TODAY, DEPUIS);

    expect(d.compteurs.activites).toBe(4);
    expect(d.activitesAVenir.map(a => a.id)).toEqual(['a-jour', 'a-future']);
    expect(d.activitesAVenir.map(a => a.attente)).toEqual([0, 2]);
    expect(d.activitesAVenir[0]).toMatchObject({ date: TODAY, statut: 'complet', placesTotal: 10, placesDisponibles: 0 });
    expect(d.compteurs.inscriptionsEnAttente).toBe(1);
  });

  it('sorties : compte tout, écarte les passées et les annulées, compte confirmés et liste d\'attente', async () => {
    await sortie('s-passee', '2026-10-01');
    await sortie('s-annulee', '2026-10-20', { statut: 'annulee' });
    await sortie('s-sans-statut', '2026-10-25', { statut: null });
    await sortie('s-future', '2026-10-15', { capacite: 2 });
    await pool.query(`INSERT INTO jeunes (id, nom, prenom, tenant_id) VALUES ('j1', 'A', 'A', 'nogent'), ('j2', 'B', 'B', 'nogent'), ('j3', 'C', 'C', 'nogent')`);
    await participant('s-future', 'j1', false);
    await participant('s-future', 'j2', false);
    await participant('s-future', 'j3', true);
    await participant('s-passee', 'j1', true);

    const d = await chargerTableauDeBord('nogent', TODAY, DEPUIS);

    expect(d.compteurs.sorties).toBe(4);
    expect(d.sortiesAVenir.map(s => s.id)).toEqual(['s-future', 's-sans-statut']);
    expect(d.sortiesAVenir[0]).toMatchObject({ capacite: 2, participantsCount: 2, participantsAttenteCount: 1 });
    expect(d.sortiesAVenir[1]).toMatchObject({ participantsCount: 0, participantsAttenteCount: 0 });
  });

  it('actualités : compte tout, fil limité aux 5 plus récentes des 30 derniers jours', async () => {
    await actualite('vieille', '2026-08-01');
    for (let j = 1; j <= 7; j++) await actualite(`r${j}`, `2026-10-0${j}`);

    const d = await chargerTableauDeBord('nogent', TODAY, DEPUIS);

    expect(d.compteurs.actualites).toBe(8);
    expect(d.actualitesFeed.map((a: { id: string }) => a.id)).toEqual(['r7', 'r6', 'r5', 'r4', 'r3']);
  });

  it('jeunes et pointages : compteurs par structure', async () => {
    await pool.query(`INSERT INTO jeunes (id, nom, prenom, tenant_id, created_at) VALUES
      ('j1', 'A', 'A', 'nogent', now()), ('j2', 'B', 'B', 'nogent', now() - interval '3 months'), ('j3', 'C', 'C', 'autre', now())`);
    await pool.query(`INSERT INTO pointages (id, statut, tenant_id) VALUES
      ('p1', 'present', 'nogent'), ('p2', 'present', 'nogent'), ('p3', 'absent', 'nogent'), ('p4', 'present', 'autre')`);

    const d = await chargerTableauDeBord('nogent', TODAY, DEPUIS);

    expect(d.compteurs).toMatchObject({ jeunes: 2, nouveauxJeunesCeMois: 1, pointagesPresents: 2, pointagesTotal: 3 });
  });

  it('base vide : des zéros, pas d\'erreur', async () => {
    const d = await chargerTableauDeBord('nogent', TODAY, DEPUIS);

    expect(d.compteurs).toEqual({
      jeunes: 0, nouveauxJeunesCeMois: 0, activites: 0, sorties: 0, actualites: 0,
      inscriptionsEnAttente: 0, pointagesPresents: 0, pointagesTotal: 0, jeunesPij: 0,
    });
    expect(d.activitesAVenir).toEqual([]);
    expect(d.sortiesAVenir).toEqual([]);
  });

  it('carte PIJ : personnes distinctes du registre PIJ, pas les seules fiches jeunes', async () => {
    const accueil = (id: string, nom: string, prenom: string, tenant = 'nogent') => pool.query(
      `INSERT INTO pij_accueils (id, tenant_id, date_visite, nom, prenom) VALUES ($1, $2, '2026-10-01', $3, $4)`, [id, tenant, nom, prenom]);
    const dossier = (id: string, nom: string, prenom: string) => pool.query(
      `INSERT INTO pij_dossiers (id, tenant_id, type, nom, prenom) VALUES ($1, 'nogent', 'permis', $2, $3)`, [id, nom, prenom]);
    await accueil('pa1', 'DURAND', 'Sacha');
    await accueil('pa2', 'Durand ', 'sacha');           // même personne, deuxième visite
    await accueil('pa3', 'PETIT', 'Alix');
    await dossier('pd1', 'DURAND', 'Sacha');            // même personne, un dossier
    await dossier('pd2', 'BERNARD', 'Lou');             // suivie sans être passée à l'accueil
    await accueil('pa-autre', 'AUTRE', 'Commune', 'autre');
    await pool.query(`INSERT INTO espaces (id, nom, tenant_id) VALUES ('pij', 'PIJ', 'nogent'), ('collegiens', 'Collégiens', 'nogent')`);
    await pool.query(`INSERT INTO jeunes (id, nom, prenom, espace_id, tenant_id) VALUES
      ('j-pij', 'MARTIN', 'Eden', 'pij', 'nogent'), ('j-pij-2', 'PETIT', 'Alix', 'pij', 'nogent'), ('j-col', 'COLLEGE', 'Nina', 'collegiens', 'nogent')`);

    const { compteurs } = await chargerTableauDeBord('nogent', TODAY, DEPUIS);
    // DURAND Sacha, PETIT Alix, BERNARD Lou, MARTIN Eden.
    expect(compteurs.jeunesPij).toBe(4);
    // « Jeunes inscrits » reste le nombre de fiches jeunes.
    expect(compteurs.jeunes).toBe(3);
    expect((await chargerTableauDeBord('autre', TODAY, DEPUIS)).compteurs.jeunesPij).toBe(1);
  });

  it('événements passés : archivés, donc ni comptés ni dans le fil ; les autres catégories restent', async () => {
    const actu = (id: string, date: string, categorie: string) => pool.query(
      `INSERT INTO actualites (id, titre, date, categorie, tenant_id) VALUES ($1, $1, $2, $3, 'nogent')`, [id, date, categorie]);
    await actu('ev-passe', '2026-10-06', 'Evenement');
    await actu('ev-passe-ancienne-saisie', '2026-09-20', 'evenement');
    await actu('ev-jour', TODAY, 'Evenement');
    await actu('ev-futur', '2026-10-20', 'Événement');
    await actu('info-passee', '2026-10-01', 'Info');
    await actu('annonce-passee', '2026-10-02', 'annonce');

    const d = await chargerTableauDeBord('nogent', TODAY, DEPUIS);
    expect(d.compteurs.actualites).toBe(4);
    expect(d.actualitesFeed.map((a: { id: string }) => a.id)).toEqual(['ev-futur', 'ev-jour', 'annonce-passee', 'info-passee']);
  });
});
