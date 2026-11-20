import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import pool from '@/lib/db';
import { resetDb, seedAnimateur } from './helpers';
import {
  seedJeune, seedActivite, seedInscription, seedSortie, seedParticipant, seedConge, seedRecup,
} from './integrite-helpers';

/**
 * Contraintes posées par scripts/migration-integrite-2026-10.sql.
 *
 * Ces tests écrivent DIRECTEMENT en base, sans passer par l'application : ils
 * vérifient le dernier rempart, celui qui tient même si une route future, un
 * script ou une intervention manuelle oublie les contrôles applicatifs.
 */
let animateurId: string;

/** Code SQLSTATE de l'erreur levée par la requête (ou null si elle passe). */
async function sqlstate(text: string, params: unknown[] = []): Promise<string | null> {
  try {
    await pool.query(text, params);
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? 'inconnu';
  }
}
const UNICITE = '23505';
const CHECK = '23514';
const NOT_NULL = '23502';

beforeEach(async () => {
  await resetDb();
  animateurId = (await seedAnimateur({ role: 'animateur' })).id;
});

afterAll(async () => {
  await pool.end();
});

describe('inscriptions — une seule inscription active par (activité, jeune)', () => {
  const INSERT = `INSERT INTO inscriptions (id, jeune_id, activite_id, statut, tenant_id) VALUES ($1, $2, $3, $4, 'nogent')`;

  it('refuse une seconde inscription active, quel que soit son statut actif', async () => {
    const activite = await seedActivite();
    const jeune = await seedJeune();
    await seedInscription(activite, jeune, { statut: 'confirmee' });

    expect(await sqlstate(INSERT, ['ins-2', jeune, activite, 'confirmee'])).toBe(UNICITE);
    expect(await sqlstate(INSERT, ['ins-3', jeune, activite, 'en-attente'])).toBe(UNICITE);
    expect(await sqlstate(INSERT, ['ins-4', jeune, activite, 'liste-attente'])).toBe(UNICITE);
  });

  it('autorise l’historique : plusieurs refus/annulations + une inscription active', async () => {
    const activite = await seedActivite();
    const jeune = await seedJeune();
    await seedInscription(activite, jeune, { statut: 'refusee' });
    await seedInscription(activite, jeune, { statut: 'refusee' });
    await seedInscription(activite, jeune, { statut: 'annulee' });

    expect(await sqlstate(INSERT, ['ins-active', jeune, activite, 'confirmee'])).toBeNull();
  });

  it('refuse de RÉACTIVER par UPDATE une inscription refusée s’il en existe déjà une active', async () => {
    const activite = await seedActivite();
    const jeune = await seedJeune();
    const refusee = await seedInscription(activite, jeune, { statut: 'refusee' });
    await seedInscription(activite, jeune, { statut: 'confirmee' });

    expect(await sqlstate(`UPDATE inscriptions SET statut = 'confirmee' WHERE id = $1`, [refusee])).toBe(UNICITE);
  });

  it('ne concerne ni les inscriptions manuelles sans fiche jeune, ni le même jeune sur une autre activité', async () => {
    const activite = await seedActivite();
    const autre = await seedActivite();
    const jeune = await seedJeune();
    await seedInscription(activite, null);
    await seedInscription(activite, jeune);

    expect(await sqlstate(INSERT, ['ins-manuelle-2', null, activite, 'confirmee'])).toBeNull();
    expect(await sqlstate(INSERT, ['ins-autre-activite', jeune, autre, 'confirmee'])).toBeNull();
  });
});

describe('congés', () => {
  const INSERT = `INSERT INTO conges (id, animateur_id, date_debut, date_fin, source, tenant_id) VALUES ($1, $2, $3, $4, $5, 'nogent')`;

  it('refuse une fin antérieure au début, à l’insertion comme à la modification', async () => {
    expect(await sqlstate(INSERT, ['c-inverse', animateurId, '2026-11-14', '2026-11-10', 'admin'])).toBe(CHECK);

    const id = await seedConge(animateurId, { dateDebut: '2026-11-10', dateFin: '2026-11-14' });
    expect(await sqlstate(`UPDATE conges SET date_fin = '2026-11-01' WHERE id = $1`, [id])).toBe(CHECK);
    expect(await sqlstate(`UPDATE conges SET date_debut = '2026-12-01' WHERE id = $1`, [id])).toBe(CHECK);
  });

  it('accepte un congé d’une seule journée', async () => {
    expect(await sqlstate(INSERT, ['c-jour', animateurId, '2026-11-10', '2026-11-10', 'admin'])).toBeNull();
  });

  it('refuse une origine inconnue', async () => {
    expect(await sqlstate(INSERT, ['c-source', animateurId, '2026-11-10', '2026-11-10', 'import'])).toBe(CHECK);
  });
});

describe('demandes de récupération', () => {
  it('un congé ne se rattache qu’à une pose approuvée', async () => {
    const conge = await seedConge(animateurId, { source: 'recup' });
    const credit = await seedRecup(animateurId, { sens: 'credit', statut: 'approved' });
    const poseEnAttente = await seedRecup(animateurId, { sens: 'debit', statut: 'pending' });
    const poseApprouvee = await seedRecup(animateurId, { sens: 'debit', statut: 'approved', heures: 2 });
    const lier = `UPDATE demandes_recup SET conge_id = $2 WHERE id = $1`;

    expect(await sqlstate(lier, [credit, conge])).toBe(CHECK);
    expect(await sqlstate(lier, [poseEnAttente, conge])).toBe(CHECK);
    expect(await sqlstate(lier, [poseApprouvee, conge])).toBeNull();
  });

  it('un même congé ne peut pas être porté par deux demandes', async () => {
    const conge = await seedConge(animateurId, { source: 'recup' });
    await seedRecup(animateurId, { sens: 'debit', statut: 'approved', heures: 2, congeId: conge });

    expect(await sqlstate(
      `INSERT INTO demandes_recup (id, animateur_id, date, heures, sens, statut, conge_id, tenant_id)
       VALUES ('recup-doublon', $1, '2026-10-20', 1, 'debit', 'approved', $2, 'nogent')`,
      [animateurId, conge],
    )).toBe(UNICITE);
  });

  it('les contraintes d’origine tiennent toujours (heures > 0, sens et statut fermés)', async () => {
    const INSERT = `INSERT INTO demandes_recup (id, animateur_id, date, heures, sens, statut, tenant_id)
                    VALUES ($1, $2, '2026-10-20', $3, $4, $5, 'nogent')`;
    expect(await sqlstate(INSERT, ['r1', animateurId, 0, 'credit', 'pending'])).toBe(CHECK);
    expect(await sqlstate(INSERT, ['r2', animateurId, -3, 'debit', 'pending'])).toBe(CHECK);
    expect(await sqlstate(INSERT, ['r3', animateurId, 2, 'transfert', 'pending'])).toBe(CHECK);
    expect(await sqlstate(INSERT, ['r4', animateurId, 2, 'credit', 'valide'])).toBe(CHECK);
  });
});

describe('sorties', () => {
  it('un jeune ne figure qu’une fois dans une sortie', async () => {
    const sortie = await seedSortie();
    const jeune = await seedJeune();
    await seedParticipant(sortie, jeune);

    expect(await sqlstate(
      `INSERT INTO sorties_participants (sortie_id, jeune_id, en_attente) VALUES ($1, $2, TRUE)`, [sortie, jeune],
    )).toBe(UNICITE);
  });

  it('chaque participant reçoit un numéro d’ordre croissant, non nul, et un statut d’attente défini', async () => {
    const sortie = await seedSortie();
    const [a, b, c] = [await seedJeune(), await seedJeune(), await seedJeune()];
    for (const j of [a, b, c]) await seedParticipant(sortie, j);

    const { rows } = await pool.query<{ jeune_id: string; ordre: string }>(
      'SELECT jeune_id, ordre FROM sorties_participants WHERE sortie_id = $1 ORDER BY ordre', [sortie]);
    expect(rows.map(r => r.jeune_id)).toEqual([a, b, c]);
    expect(new Set(rows.map(r => r.ordre)).size).toBe(3);

    expect(await sqlstate(`UPDATE sorties_participants SET ordre = NULL WHERE sortie_id = $1`, [sortie])).toBe(NOT_NULL);
    expect(await sqlstate(`UPDATE sorties_participants SET en_attente = NULL WHERE sortie_id = $1`, [sortie])).toBe(CHECK);
  });

  it('refuse une capacité ou un nombre de places négatif', async () => {
    const sortie = await seedSortie({ capacite: 5 });
    const activite = await seedActivite({ placesTotal: 5 });

    expect(await sqlstate(`UPDATE sorties SET capacite = -1 WHERE id = $1`, [sortie])).toBe(CHECK);
    expect(await sqlstate(`UPDATE activites SET places_total = -1 WHERE id = $1`, [activite])).toBe(CHECK);
    expect(await sqlstate(`UPDATE sorties SET capacite = 0 WHERE id = $1`, [sortie])).toBeNull();
  });
});
