import { vi, describe, it, expect, beforeEach, afterAll } from 'vitest';

const session = vi.hoisted(() => ({ nom: '', valeur: '' }));
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (nom: string) => (nom === session.nom && session.valeur ? { name: nom, value: session.valeur } : undefined),
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import pool from '@/lib/db';
import { creerActivite, modifierActivite, supprimerActivite, ajouterInscriptionManuelle } from '@/app/activites/actions';
import { updateStatutInscription } from '@/app/inscriptions/actions';
import { POST as POST_INS, DELETE as DELETE_INS } from '@/app/api/inscriptions/route';
import { PUT as PUT_CONGE, DELETE as DELETE_CONGE, POST as POST_CONGE } from '@/app/api/conges/route';
import { PATCH as PATCH_RECUP, PUT as PUT_RECUP, DELETE as DELETE_RECUP } from '@/app/api/recuperation/route';
import { POST as POST_PROJET, DELETE as DELETE_PROJET } from '@/app/api/projets/route';
import { POST as POST_SORTIE, DELETE as DELETE_SORTIE } from '@/app/api/sorties/route';
import { POST as POST_PART, DELETE as DELETE_PART } from '@/app/api/sorties/participants/route';
import { PATCH as PATCH_DEMANDE_MODIF } from '@/app/api/sorties/demande-modif/route';
import { resetDb, seedAnimateur, cookieFor, jsonRequest } from './helpers';
import {
  seedEspace, seedJeune, seedActivite, seedInscription, seedPointage, seedSortie, seedParticipant,
  seedRecup, seedConge, seedProjet, photographier, decouperCookie,
} from './integrite-helpers';

/**
 * Cloisonnement entre communes (constat 6 de l'audit du 2026-10-06, étendu à
 * toutes les mutations du périmètre « intégrité métier »).
 *
 * Scénario unique : la commune A possède des données ; un ADMIN de la commune
 * B — le rôle le plus élevé qu'un attaquant de B puisse avoir — connaît leurs
 * identifiants et tente de les modifier ou de les supprimer. Chaque tentative
 * doit échouer ET laisser les tables de A strictement identiques, parents
 * comme enfants (comparaison intégrale avant/après, pas un champ témoin).
 */
const TABLES = [
  'activites', 'inscriptions', 'pointages', 'conges', 'demandes_recup',
  'projets', 'projets_budget', 'sorties', 'sorties_participants', 'jeunes', 'notifications',
];

interface DonneesA {
  espace: string; jeune: string; activite: string; inscription: string;
  animateur: string; conge: string; creditApprouve: string; debitEnAttente: string;
  projet: string; sortie: string; participant: string;
}

let a: DonneesA;
let cookieB: string;
let espaceB: string;
let jeuneB: string;
let avant: Record<string, unknown[]>;

async function seedCommuneA(): Promise<DonneesA> {
  const anim = await seedAnimateur({ role: 'animateur', tenantId: 'commune-a' });
  const espace = await seedEspace('commune-a');
  const jeune = await seedJeune('commune-a', espace);
  const activite = await seedActivite({ tenantId: 'commune-a', espaceId: espace, placesTotal: 5 });
  const inscription = await seedInscription(activite, jeune, { tenantId: 'commune-a', statut: 'en-attente' });
  await seedPointage(activite, jeune, 'commune-a');
  const conge = await seedConge(anim.id, { tenantId: 'commune-a' });
  const creditApprouve = await seedRecup(anim.id, { tenantId: 'commune-a', sens: 'credit', heures: 8 });
  const debitEnAttente = await seedRecup(anim.id, { tenantId: 'commune-a', sens: 'debit', heures: 2, statut: 'pending' });
  const projet = await seedProjet(anim.id, { tenantId: 'commune-a', budget: [{ designation: 'Car', cout: '300' }] });
  const sortie = await seedSortie({ tenantId: 'commune-a', capacite: 1, animateurId: anim.id });
  await seedParticipant(sortie, jeune);
  const enAttente = await seedJeune('commune-a', espace);
  await seedParticipant(sortie, enAttente, true);
  return {
    espace, jeune, activite, inscription, animateur: anim.id, conge, creditApprouve, debitEnAttente,
    projet, sortie, participant: jeune,
  };
}

const req = (url: string, method: string, body?: unknown) =>
  jsonRequest(`http://localhost${url}`, { method, cookie: cookieB, body });

beforeEach(async () => {
  await resetDb();
  a = await seedCommuneA();
  const adminB = await seedAnimateur({ role: 'admin', tenantId: 'commune-b' });
  cookieB = await cookieFor(adminB);
  Object.assign(session, decouperCookie(cookieB));
  espaceB = await seedEspace('commune-b');
  jeuneB = await seedJeune('commune-b', espaceB);
  avant = await photographier(...TABLES);
});

afterAll(async () => {
  await pool.end();
});

/** Les données de A (et tout le reste) sont exactement celles d'avant l'appel. */
async function rienNaChange() {
  expect(await photographier(...TABLES)).toEqual(avant);
}

const DONNEES_ACTIVITE = {
  titre: 'Détournée', date: '2026-12-25', heureDebut: '09:00', heureFin: '10:00', placesTotal: 99, statut: 'annule',
};

describe('activités (Server Actions)', () => {
  it('modifierActivite sur une activité de A : introuvable, rien ne change', async () => {
    const r = await modifierActivite(a.activite, { ...DONNEES_ACTIVITE, espaceId: espaceB });
    expect(r).toEqual({ success: false, error: 'Activité introuvable' });
    await rienNaChange();
  });

  it('supprimerActivite sur une activité de A : ni l’activité, ni ses inscriptions, ni ses pointages ne partent', async () => {
    const r = await supprimerActivite(a.activite);
    expect(r).toEqual({ success: false, error: 'Activité introuvable' });
    await rienNaChange();
  });

  it('une activité de B ne peut pas être rattachée à un espace de A', async () => {
    expect((await creerActivite({ ...DONNEES_ACTIVITE, espaceId: a.espace })).success).toBe(false);
    const activiteB = await seedActivite({ tenantId: 'commune-b', espaceId: espaceB });
    avant = await photographier(...TABLES);
    expect((await modifierActivite(activiteB, { ...DONNEES_ACTIVITE, espaceId: a.espace })).success).toBe(false);
    await rienNaChange();
  });

  it('ajouterInscriptionManuelle : ni sur une activité de A, ni avec un jeune de A', async () => {
    expect((await ajouterInscriptionManuelle(a.activite, 'x', espaceB, jeuneB, 'N', 'P')).success).toBe(false);
    const activiteB = await seedActivite({ tenantId: 'commune-b', espaceId: espaceB });
    avant = await photographier(...TABLES);
    const r = await ajouterInscriptionManuelle(activiteB, 'x', espaceB, a.jeune, 'N', 'P');
    expect(r).toEqual({ success: false, error: 'Jeune introuvable' });
    await rienNaChange();
  });

  it('updateStatutInscription sur une inscription de A : introuvable', async () => {
    expect(await updateStatutInscription(a.inscription, 'confirmee')).toEqual({ success: false, error: 'Inscription introuvable' });
    await rienNaChange();
  });

  it('supprimerActivite reste fonctionnel pour sa propre commune (enfants compris)', async () => {
    const activiteB = await seedActivite({ tenantId: 'commune-b', espaceId: espaceB });
    await seedInscription(activiteB, jeuneB, { tenantId: 'commune-b' });
    await seedPointage(activiteB, jeuneB, 'commune-b');

    expect(await supprimerActivite(activiteB)).toEqual({ success: true });

    expect((await pool.query(`SELECT 1 FROM activites WHERE tenant_id = 'commune-b'`)).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM inscriptions WHERE tenant_id = 'commune-b'`)).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM pointages WHERE tenant_id = 'commune-b'`)).rowCount).toBe(0);
    // … et A n'a pas bougé.
    const apres = await photographier(...TABLES);
    for (const t of ['conges', 'demandes_recup', 'projets', 'sorties', 'sorties_participants']) {
      expect(apres[t]).toEqual(avant[t]);
    }
    expect((await pool.query(`SELECT 1 FROM inscriptions WHERE tenant_id = 'commune-a'`)).rowCount).toBe(1);
    expect((await pool.query(`SELECT 1 FROM pointages WHERE tenant_id = 'commune-a'`)).rowCount).toBe(1);
  });
});

describe('inscriptions (API)', () => {
  it('POST avec une activité ou un jeune de A : 404', async () => {
    expect((await POST_INS(req('/api/inscriptions', 'POST', { activiteId: a.activite, jeuneId: jeuneB }))).status).toBe(404);
    const activiteB = await seedActivite({ tenantId: 'commune-b', espaceId: espaceB });
    avant = await photographier(...TABLES);
    expect((await POST_INS(req('/api/inscriptions', 'POST', { activiteId: activiteB, jeuneId: a.jeune }))).status).toBe(404);
    await rienNaChange();
  });

  it('DELETE par id ou par couple jeune/activité de A : rien n’est supprimé', async () => {
    await DELETE_INS(req(`/api/inscriptions?id=${a.inscription}`, 'DELETE'));
    await DELETE_INS(req(`/api/inscriptions?jeuneId=${a.jeune}&activiteId=${a.activite}`, 'DELETE'));
    await rienNaChange();
  });
});

describe('congés', () => {
  it('PUT et DELETE sur un congé de A : 404', async () => {
    expect((await PUT_CONGE(req('/api/conges', 'PUT', { id: a.conge, dateDebut: '2027-01-01', dateFin: '2027-01-02', motif: 'x' }))).status).toBe(404);
    expect((await DELETE_CONGE(req(`/api/conges?id=${a.conge}`, 'DELETE'))).status).toBe(404);
    await rienNaChange();
  });

  it('POST pour un animateur de A : 404', async () => {
    const r = await POST_CONGE(req('/api/conges', 'POST', { animateurId: a.animateur, dateDebut: '2027-01-01', dateFin: '2027-01-02' }));
    expect(r.status).toBe(404);
    await rienNaChange();
  });
});

describe('récupération', () => {
  it('PATCH, PUT et DELETE sur les demandes de A : 404', async () => {
    expect((await PATCH_RECUP(req('/api/recuperation', 'PATCH', { id: a.debitEnAttente, decision: 'approve' }))).status).toBe(404);
    expect((await PATCH_RECUP(req('/api/recuperation', 'PATCH', { id: a.debitEnAttente, decision: 'reject' }))).status).toBe(404);
    expect((await PUT_RECUP(req('/api/recuperation', 'PUT', { id: a.creditApprouve, heures: 1, motif: 'x' }))).status).toBe(404);
    expect((await DELETE_RECUP(req(`/api/recuperation?id=${a.creditApprouve}`, 'DELETE'))).status).toBe(404);
    expect((await DELETE_RECUP(req(`/api/recuperation?id=${a.debitEnAttente}`, 'DELETE'))).status).toBe(404);
    await rienNaChange();
  });
});

describe('projets', () => {
  it('modification (projet + budget) et suppression d’un projet de A : refusées', async () => {
    const maj = await POST_PROJET(req('/api/projets', 'POST', { id: a.projet, titre: 'Détourné', budget: [] }));
    expect(maj.status).toBe(404);
    const sup = await DELETE_PROJET(req(`/api/projets?id=${a.projet}`, 'DELETE'));
    expect(sup.status).toBe(403);
    await rienNaChange();
  });
});

describe('sorties et participants', () => {
  it('modifier ou supprimer une sortie de A : 404', async () => {
    expect((await POST_SORTIE(req('/api/sorties', 'POST', { id: a.sortie, titre: 'Détournée', capacite: 0, bonCommande: null }))).status).toBe(404);
    expect((await DELETE_SORTIE(req(`/api/sorties?id=${a.sortie}`, 'DELETE'))).status).toBe(404);
    await rienNaChange();
  });

  it('retirer un participant d’une sortie de A : 404, pas de promotion', async () => {
    const r = await DELETE_PART(req('/api/sorties/participants', 'DELETE', { sortieId: a.sortie, jeuneId: a.participant }));
    expect(r.status).toBe(404);
    await rienNaChange();
  });

  it('ajouter un participant : ni à une sortie de A, ni un jeune de A à une sortie de B', async () => {
    expect((await POST_PART(req('/api/sorties/participants', 'POST', { sortieId: a.sortie, jeuneId: jeuneB }))).status).toBe(404);
    const sortieB = await seedSortie({ tenantId: 'commune-b' });
    avant = await photographier(...TABLES);
    expect((await POST_PART(req('/api/sorties/participants', 'POST', { sortieId: sortieB, jeuneId: a.jeune }))).status).toBe(404);
    await rienNaChange();
  });

  it('accorder un accès en modification : ni sur une sortie de A, ni à un animateur de A', async () => {
    expect((await PATCH_DEMANDE_MODIF(req('/api/sorties/demande-modif', 'PATCH', { sortieId: a.sortie, demandeurId: a.animateur }))).status).toBe(404);
    const sortieB = await seedSortie({ tenantId: 'commune-b' });
    avant = await photographier(...TABLES);
    expect((await PATCH_DEMANDE_MODIF(req('/api/sorties/demande-modif', 'PATCH', { sortieId: sortieB, demandeurId: a.animateur }))).status).toBe(404);
    await rienNaChange();
  });
});
