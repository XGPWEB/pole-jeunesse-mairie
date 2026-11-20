import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import type { Client } from 'pg';

import pool from '@/lib/db';
import { POST as POST_SORTIE } from '@/app/api/sorties/route';
import { POST, DELETE } from '@/app/api/sorties/participants/route';
import { resetDb, seedAnimateur, cookieFor, jsonRequest } from './helpers';
import {
  seedJeune, seedSortie, seedParticipant, photographier,
  connexionConcurrente, observer, attendreBlocage, libererActeur,
} from './integrite-helpers';

/**
 * Constat 10 de l'audit du 2026-10-06 — participants d'une sortie : capacité,
 * promotion depuis la liste d'attente, ordre d'attente. Vrai PostgreSQL.
 */
const URL = 'http://localhost/api/sorties/participants';

let cookie: string;
let observateur: Client;

const ajouter = (sortieId: string, jeuneId: string) =>
  POST(jsonRequest(URL, { method: 'POST', cookie, body: { sortieId, jeuneId } }));
const retirer = (sortieId: string, jeuneId: string) =>
  DELETE(jsonRequest(URL, { method: 'DELETE', cookie, body: { sortieId, jeuneId } }));

async function etat(sortieId: string): Promise<{ confirmes: string[]; attente: string[] }> {
  const { rows } = await pool.query<{ jeune_id: string; en_attente: boolean }>(
    'SELECT jeune_id, en_attente FROM sorties_participants WHERE sortie_id = $1 ORDER BY ordre', [sortieId]);
  return {
    confirmes: rows.filter(r => !r.en_attente).map(r => r.jeune_id),
    attente: rows.filter(r => r.en_attente).map(r => r.jeune_id),
  };
}

beforeEach(async () => {
  await resetDb();
  cookie = await cookieFor(await seedAnimateur({ role: 'animateur' }));
});

afterAll(async () => {
  await observateur?.end();
  await pool.end();
});

describe('retrait d’un participant', () => {
  it('double retrait simultané du même participant : une seule promotion, capacité respectée', async () => {
    for (let tour = 0; tour < 8; tour++) {
      const sortie = await seedSortie({ capacite: 2 });
      const [a, b, c, d] = await Promise.all([seedJeune(), seedJeune(), seedJeune(), seedJeune()]);
      await seedParticipant(sortie, a);
      await seedParticipant(sortie, b);
      await seedParticipant(sortie, c, true);
      await seedParticipant(sortie, d, true);

      const reponses = await Promise.all([retirer(sortie, a), retirer(sortie, a)]);
      const corps = await Promise.all(reponses.map(r => r.json()));

      // Un seul des deux appels a réellement retiré le participant.
      expect(corps.filter(x => x.success)).toHaveLength(1);
      expect(await etat(sortie)).toEqual({ confirmes: [b, c], attente: [d] });
    }
  });

  it('la promotion se décide sur le DELETE effectif : un retrait arrivé trop tard ne promeut personne', async () => {
    const sortie = await seedSortie({ capacite: 2 });
    const [a, b, c, d] = await Promise.all([seedJeune(), seedJeune(), seedJeune(), seedJeune()]);
    await seedParticipant(sortie, a);
    await seedParticipant(sortie, b);
    await seedParticipant(sortie, c, true);
    await seedParticipant(sortie, d, true);
    observateur ??= await connexionConcurrente();

    // Acteur A : verrouille la sortie, retire `a` et promeut `c`, sans COMMIT.
    const acteur = await pool.connect();
    try {
      await acteur.query('BEGIN');
      await acteur.query('SELECT id FROM sorties WHERE id = $1 FOR UPDATE', [sortie]);
      await acteur.query('DELETE FROM sorties_participants WHERE sortie_id = $1 AND jeune_id = $2', [sortie, a]);
      await acteur.query('UPDATE sorties_participants SET en_attente = FALSE WHERE sortie_id = $1 AND jeune_id = $2', [sortie, c]);

      // Acteur B : le vrai handler retire le MÊME participant. À cet instant
      // il le voit encore « confirmé » ; l'ancien code retenait cette lecture
      // et promouvait `d` après un DELETE de zéro ligne.
      const b2 = observer(retirer(sortie, a));
      expect(await attendreBlocage(observateur)).toBe(true);
      expect(b2.termine()).toBe(false);

      await acteur.query('COMMIT');
      const corps = await (await b2.promesse).json();

      expect(corps.success).toBe(false);
      expect(corps.error).toContain("n'est pas inscrit");
    } finally {
      await libererActeur(acteur);
    }
    expect(await etat(sortie)).toEqual({ confirmes: [b, c], attente: [d] });
  });

  it('promeut le PREMIER arrivé en liste d’attente, même si sa ligne a été réécrite depuis', async () => {
    const sortie = await seedSortie({ capacite: 1 });
    const [a, premier, second] = await Promise.all([seedJeune(), seedJeune(), seedJeune()]);
    await seedParticipant(sortie, a);
    await seedParticipant(sortie, premier, true);
    await seedParticipant(sortie, second, true);
    // Une réécriture de la ligne (ici neutre) lui donne une nouvelle adresse
    // physique, après celle de `second` : un tri sur ctid promouvait alors
    // `second`, arrivé plus tard.
    await pool.query('UPDATE sorties_participants SET en_attente = en_attente WHERE sortie_id = $1 AND jeune_id = $2', [sortie, premier]);
    const ctids = await pool.query<{ jeune_id: string }>(
      'SELECT jeune_id FROM sorties_participants WHERE sortie_id = $1 AND en_attente ORDER BY ctid', [sortie]);
    expect(ctids.rows.map(r => r.jeune_id)).toEqual([second, premier]);   // le piège est bien armé

    const corps = await (await retirer(sortie, a)).json();

    expect(corps.participants).toEqual([premier]);
    expect(corps.participantsAttente).toEqual([second]);
  });

  it('retirer un participant en attente ne promeut personne', async () => {
    const sortie = await seedSortie({ capacite: 1 });
    const [a, b, c] = await Promise.all([seedJeune(), seedJeune(), seedJeune()]);
    await seedParticipant(sortie, a);
    await seedParticipant(sortie, b, true);
    await seedParticipant(sortie, c, true);

    await retirer(sortie, b);

    expect(await etat(sortie)).toEqual({ confirmes: [a], attente: [c] });
  });

  it('ne promeut pas si la sortie est déjà au-dessus de sa capacité (données antérieures)', async () => {
    const sortie = await seedSortie({ capacite: 1 });
    const [a, b, c] = await Promise.all([seedJeune(), seedJeune(), seedJeune()]);
    await seedParticipant(sortie, a);
    await seedParticipant(sortie, b);          // surbooking hérité : 2 confirmés pour 1 place
    await seedParticipant(sortie, c, true);

    await retirer(sortie, a);

    expect(await etat(sortie)).toEqual({ confirmes: [b], attente: [c] });
  });
});

describe('ajout de participants', () => {
  it('8 ajouts simultanés pour 3 places → 3 confirmés, 5 en attente', async () => {
    const sortie = await seedSortie({ capacite: 3 });
    const jeunes = await Promise.all(Array.from({ length: 8 }, () => seedJeune()));

    const corps = await Promise.all((await Promise.all(jeunes.map(j => ajouter(sortie, j)))).map(r => r.json()));

    expect(corps.every(x => x.success)).toBe(true);
    const e = await etat(sortie);
    expect(e.confirmes).toHaveLength(3);
    expect(e.attente).toHaveLength(5);
    // Chaque réponse annonce le statut réellement enregistré.
    expect(corps.filter(x => x.statut === 'confirmee')).toHaveLength(3);
  });

  it('double ajout simultané du même jeune → une seule ligne', async () => {
    const sortie = await seedSortie({ capacite: 3 });
    const jeune = await seedJeune();

    const corps = await Promise.all((await Promise.all([ajouter(sortie, jeune), ajouter(sortie, jeune)])).map(r => r.json()));

    expect(corps.filter(x => x.success)).toHaveLength(1);
    expect(corps.find(x => !x.success).error).toContain('déjà inscrit');
    expect((await etat(sortie)).confirmes).toEqual([jeune]);
  });

  it('la file d’attente suit l’ordre d’arrivée', async () => {
    const sortie = await seedSortie({ capacite: 1 });
    const jeunes = [await seedJeune(), await seedJeune(), await seedJeune(), await seedJeune()];
    for (const j of jeunes) await ajouter(sortie, j);

    expect(await etat(sortie)).toEqual({ confirmes: [jeunes[0]], attente: jeunes.slice(1) });
    await retirer(sortie, jeunes[0]);
    expect(await etat(sortie)).toEqual({ confirmes: [jeunes[1]], attente: jeunes.slice(2) });
  });
});

describe('modification de la sortie', () => {
  it('réduire la capacité sous le nombre de confirmés est refusé (409), rien n’est modifié', async () => {
    const createur = await seedAnimateur({ role: 'animateur' });
    const sortie = await seedSortie({ capacite: 3, animateurId: createur.id });
    for (let i = 0; i < 3; i++) await seedParticipant(sortie, await seedJeune());
    const avant = await photographier('sorties', 'sorties_participants');

    const reponse = await POST_SORTIE(jsonRequest('http://localhost/api/sorties', {
      method: 'POST', cookie: await cookieFor(createur), body: { id: sortie, titre: 'Renommée', capacite: 2 },
    }));

    expect(reponse.status).toBe(409);
    expect(await photographier('sorties', 'sorties_participants')).toEqual(avant);
  });

  it('une modification concurrente d’un ajout de participant ne perd pas l’historique ni la capacité', async () => {
    const createur = await seedAnimateur({ role: 'animateur' });
    const sortie = await seedSortie({ capacite: 2, animateurId: createur.id });
    const jeunes = await Promise.all(Array.from({ length: 4 }, () => seedJeune()));

    await Promise.all([
      POST_SORTIE(jsonRequest('http://localhost/api/sorties', {
        method: 'POST', cookie: await cookieFor(createur), body: { id: sortie, titre: 'Renommée', capacite: 2 },
      })),
      ...jeunes.map(j => ajouter(sortie, j)),
    ]);

    expect((await etat(sortie)).confirmes).toHaveLength(2);
    const { rows } = await pool.query<{ titre: string }>('SELECT titre FROM sorties WHERE id = $1', [sortie]);
    expect(rows[0].titre).toBe('Renommée');
  });
});
