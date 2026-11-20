import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type { Client } from 'pg';

// Next 16 : cookies() est asynchrone. Le mock reproduit cette forme ; la garde
// réelle de @/lib/auth (JWT + relecture du compte en base) s'exécute.
const session = vi.hoisted(() => ({ nom: '', valeur: '' }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nom: string) => (nom === session.nom && session.valeur ? { name: nom, value: session.valeur } : undefined),
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import pool from '@/lib/db';
import { supprimerJeune } from '@/app/jeunes/actions';
import { POST as POST_INSCRIPTION, DELETE as DELETE_INSCRIPTION } from '@/app/api/inscriptions/route';
import { POST as POST_PARTICIPANT, DELETE as DELETE_PARTICIPANT } from '@/app/api/sorties/participants/route';
import { resetDb, seedAnimateur, cookieFor, jsonRequest } from './helpers';
import {
  seedEspace, seedJeune, seedActivite, seedInscription, seedPointage, seedSortie, seedParticipant,
  photographier, connexionConcurrente, observer, attendreBlocage, libererActeur, decouperCookie,
} from './integrite-helpers';
import {
  etatActivite, etatSortie, recalerPlaces, ecartsActivite, tracesDuJeune, AUCUNE_TRACE, TABLES_SUPPRESSION,
} from './revue-r5-helpers';

/**
 * Revue du 2026-10-06, point R5 — supprimer un jeune doit avoir exactement
 * l'effet de son désistement de chacune de ses activités et de ses sorties :
 * place libérée, premier en attente promu, `places_disponibles` recalculé.
 * Vraie Server Action, vrai PostgreSQL, vraies routes pour les acteurs
 * concurrents.
 */
type Session = Awaited<ReturnType<typeof seedAnimateur>>;

let animateur: Session;
let cookie: string;
let observateur: Client;

async function agirEnTantQue(s: Session): Promise<void> {
  const { nom, valeur } = decouperCookie(await cookieFor(s));
  session.nom = nom; session.valeur = valeur;
}

const inscrire = (activiteId: string, jeuneId: string) =>
  POST_INSCRIPTION(jsonRequest('http://localhost/api/inscriptions', { method: 'POST', cookie, body: { jeuneId, activiteId } }));
const desister = (activiteId: string, jeuneId: string) =>
  DELETE_INSCRIPTION(jsonRequest(
    `http://localhost/api/inscriptions?jeuneId=${encodeURIComponent(jeuneId)}&activiteId=${encodeURIComponent(activiteId)}`,
    { method: 'DELETE', cookie },
  ));
const ajouterParticipant = (sortieId: string, jeuneId: string) =>
  POST_PARTICIPANT(jsonRequest('http://localhost/api/sorties/participants', { method: 'POST', cookie, body: { sortieId, jeuneId } }));
const retirerParticipant = (sortieId: string, jeuneId: string) =>
  DELETE_PARTICIPANT(jsonRequest('http://localhost/api/sorties/participants', { method: 'DELETE', cookie, body: { sortieId, jeuneId } }));

/** n jeunes de la commune par défaut, créés dans l'ordre. */
async function jeunes(n: number, tenantId = 'nogent'): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await seedJeune(tenantId));
  return ids;
}

/**
 * Activité COMPLÈTE avec file d'attente. `attente` est donné dans l'ordre
 * d'arrivée : chaque jeune reçoit une date d'inscription croissante, et un
 * statut alterné 'liste-attente' / 'en-attente' (les deux coexistent en base
 * selon le chemin d'inscription ; la promotion les traite à égalité). Dates
 * anciennes : une inscription créée pendant le test (NOW()) arrive forcément après.
 */
async function activiteComplete(confirmes: string[], attente: string[], placesTotal = confirmes.length): Promise<string> {
  const activite = await seedActivite({ placesTotal });
  for (const j of confirmes) await seedInscription(activite, j, { dateInscription: '2020-01-01T08:00:00Z' });
  for (let i = 0; i < attente.length; i++) {
    await seedInscription(activite, attente[i], {
      statut: i % 2 === 0 ? 'liste-attente' : 'en-attente',
      dateInscription: `2020-01-02T${String(8 + i).padStart(2, '0')}:00:00Z`,
    });
  }
  await recalerPlaces(activite);
  return activite;
}

async function sortieComplete(confirmes: string[], attente: string[], capacite = confirmes.length): Promise<string> {
  const sortie = await seedSortie({ capacite });
  for (const j of confirmes) await seedParticipant(sortie, j);
  for (const j of attente) await seedParticipant(sortie, j, true);
  return sortie;
}

beforeAll(async () => {
  // Pannes provoquées EN BASE, à trois moments différents de la transaction.
  // Chaque déclencheur ne réagit qu'à un marqueur posé par le test concerné :
  // les autres tests (et les autres fichiers) ne sont pas affectés, et tout
  // est retiré dans afterAll.
  await pool.query(`
    CREATE OR REPLACE FUNCTION test_r5_panne_fiche() RETURNS trigger AS $$
    BEGIN
      IF OLD.nom = 'PANNE-FICHE' THEN RAISE EXCEPTION 'panne simulée à la suppression de la fiche'; END IF;
      RETURN OLD;
    END $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS test_r5_panne_fiche ON jeunes;
    CREATE TRIGGER test_r5_panne_fiche BEFORE DELETE ON jeunes
      FOR EACH ROW EXECUTE FUNCTION test_r5_panne_fiche();

    CREATE OR REPLACE FUNCTION test_r5_panne_places() RETURNS trigger AS $$
    BEGIN
      IF OLD.titre = 'PANNE-PLACES' AND NEW.titre = 'PANNE-PLACES' THEN RAISE EXCEPTION 'panne simulée au recalcul des places'; END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS test_r5_panne_places ON activites;
    CREATE TRIGGER test_r5_panne_places BEFORE UPDATE ON activites
      FOR EACH ROW EXECUTE FUNCTION test_r5_panne_places();

    CREATE OR REPLACE FUNCTION test_r5_panne_promotion() RETURNS trigger AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM sorties WHERE id = NEW.sortie_id AND titre = 'PANNE-PROMOTION') THEN
        RAISE EXCEPTION 'panne simulée à la promotion sur la sortie';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS test_r5_panne_promotion ON sorties_participants;
    CREATE TRIGGER test_r5_panne_promotion BEFORE UPDATE ON sorties_participants
      FOR EACH ROW EXECUTE FUNCTION test_r5_panne_promotion();
  `);
});

beforeEach(async () => {
  await resetDb();
  animateur = await seedAnimateur({ role: 'animateur' });
  cookie = await cookieFor(animateur);
  await agirEnTantQue(animateur);
});

afterAll(async () => {
  await pool.query(`
    DROP TRIGGER IF EXISTS test_r5_panne_fiche ON jeunes;
    DROP FUNCTION IF EXISTS test_r5_panne_fiche();
    DROP TRIGGER IF EXISTS test_r5_panne_places ON activites;
    DROP FUNCTION IF EXISTS test_r5_panne_places();
    DROP TRIGGER IF EXISTS test_r5_panne_promotion ON sorties_participants;
    DROP FUNCTION IF EXISTS test_r5_panne_promotion();
  `);
  await observateur?.end();
  await pool.end();
});

describe('activités : place libérée et liste d’attente', () => {
  it('supprimer un jeune CONFIRMÉ d’une activité complète promeut le premier arrivé en attente', async () => {
    const [a, b, premier, second, troisieme] = await jeunes(5);
    const activite = await activiteComplete([a, b], [premier, second, troisieme]);
    expect(await etatActivite(activite)).toMatchObject({ placesDisponibles: 0, statut: 'complet' });

    expect(await supprimerJeune(a)).toEqual({ success: true });

    // Une place libérée → UNE promotion, celle du plus ancien en attente
    // (date d'inscription), les autres gardent leur rang.
    expect(await etatActivite(activite)).toEqual({
      placesTotal: 2, placesDisponibles: 0, statut: 'complet',
      confirmes: [b, premier].sort(), attente: [second, troisieme],
    });
    expect(await tracesDuJeune(a)).toEqual(AUCUNE_TRACE);
  });

  it('même effet qu’un désistement par l’API sur une activité jumelle', async () => {
    const [a, b, c, d] = await jeunes(4);
    const parSuppression = await activiteComplete([a, b], [c, d]);
    const [a2, b2, c2, d2] = await jeunes(4);
    const parDesistement = await activiteComplete([a2, b2], [c2, d2]);

    expect(await supprimerJeune(a)).toEqual({ success: true });
    expect((await desister(parDesistement, a2)).status).toBe(200);

    const s = await etatActivite(parSuppression);
    const d0 = await etatActivite(parDesistement);
    expect({ places: s.placesDisponibles, statut: s.statut, nbConfirmes: s.confirmes.length, nbAttente: s.attente.length })
      .toEqual({ places: d0.placesDisponibles, statut: d0.statut, nbConfirmes: d0.confirmes.length, nbAttente: d0.attente.length });
    expect(s.confirmes).toEqual([b, c].sort());
    expect(d0.confirmes).toEqual([b2, c2].sort());
  });

  it('sans liste d’attente, la place redevient disponible et l’activité rouvre', async () => {
    const [a, b] = await jeunes(2);
    const activite = await activiteComplete([a, b], []);

    expect(await supprimerJeune(a)).toEqual({ success: true });

    expect(await etatActivite(activite)).toEqual({
      placesTotal: 2, placesDisponibles: 1, statut: 'ouvert', confirmes: [b], attente: [],
    });
  });

  it('supprimer un jeune seulement EN ATTENTE ne promeut personne et ne change pas les places', async () => {
    const [a, b, enAttente, suivant] = await jeunes(4);
    const activite = await activiteComplete([a, b], [enAttente, suivant]);
    const activitesAvant = await photographier('activites');

    expect(await supprimerJeune(enAttente)).toEqual({ success: true });

    expect(await photographier('activites')).toEqual(activitesAvant);
    expect(await etatActivite(activite)).toEqual({
      placesTotal: 2, placesDisponibles: 0, statut: 'complet', confirmes: [a, b].sort(), attente: [suivant],
    });
    expect(await tracesDuJeune(enAttente)).toEqual(AUCUNE_TRACE);
  });

  it('une inscription refusée ou annulée du jeune supprimé ne libère aucune place', async () => {
    const [a, b, refuse, enAttente] = await jeunes(4);
    const activite = await activiteComplete([a, b], [enAttente]);
    await seedInscription(activite, refuse, { statut: 'refusee' });
    const activitesAvant = await photographier('activites');

    expect(await supprimerJeune(refuse)).toEqual({ success: true });

    expect(await photographier('activites')).toEqual(activitesAvant);
    expect((await etatActivite(activite)).attente).toEqual([enAttente]);
  });
});

describe('sorties : place libérée et file d’attente', () => {
  it('supprimer un participant CONFIRMÉ promeut le premier de la file (colonne ordre)', async () => {
    const [a, b, premier, second] = await jeunes(4);
    const sortie = await sortieComplete([a, b], [premier, second]);
    // Réécriture neutre de la ligne du premier : seul `ordre` doit décider.
    await pool.query('UPDATE sorties_participants SET en_attente = en_attente WHERE sortie_id = $1 AND jeune_id = $2', [sortie, premier]);

    expect(await supprimerJeune(a)).toEqual({ success: true });

    expect(await etatSortie(sortie)).toEqual({ confirmes: [b, premier], attente: [second] });
    expect(await tracesDuJeune(a)).toEqual(AUCUNE_TRACE);
  });

  it('supprimer un participant EN ATTENTE ne promeut personne', async () => {
    const [a, b, enAttente, suivant] = await jeunes(4);
    const sortie = await sortieComplete([a, b], [enAttente, suivant]);

    expect(await supprimerJeune(enAttente)).toEqual({ success: true });

    expect(await etatSortie(sortie)).toEqual({ confirmes: [a, b], attente: [suivant] });
  });

  it('la capacité n’est jamais dépassée : pas de promotion si la sortie reste pleine', async () => {
    // Trois confirmés pour deux places (état hérité) : en retirer un laisse
    // la sortie pleine, personne ne doit être promu.
    const [a, b, c, enAttente] = await jeunes(4);
    const sortie = await sortieComplete([a, b, c], [enAttente], 2);

    expect(await supprimerJeune(a)).toEqual({ success: true });

    expect(await etatSortie(sortie)).toEqual({ confirmes: [b, c], attente: [enAttente] });
  });

  it('même effet qu’un retrait par l’API sur une sortie jumelle', async () => {
    const [a, b, c, d] = await jeunes(4);
    const parSuppression = await sortieComplete([a, b], [c, d]);
    const [a2, b2, c2, d2] = await jeunes(4);
    const parRetrait = await sortieComplete([a2, b2], [c2, d2]);

    expect(await supprimerJeune(a)).toEqual({ success: true });
    expect((await (await retirerParticipant(parRetrait, a2)).json()).success).toBe(true);

    expect(await etatSortie(parSuppression)).toEqual({ confirmes: [b, c], attente: [d] });
    expect(await etatSortie(parRetrait)).toEqual({ confirmes: [b2, c2], attente: [d2] });
  });
});

describe('jeune inscrit partout à la fois', () => {
  it('toutes ses activités et sorties sont cohérentes après la suppression', async () => {
    const espace = await seedEspace();
    const cible = await seedJeune('nogent', espace);
    const [b, c, d, e, f, g] = await jeunes(6);
    await pool.query(`INSERT INTO jeunes_contacts (jeune_id, nom, telephone) VALUES ($1, 'Parent', '0600000000')`, [cible]);

    const actConfirmeAvecAttente = await activiteComplete([cible, b], [c, d]);
    const actEnAttente = await activiteComplete([b, c], [cible, d]);
    const actConfirmeSansAttente = await activiteComplete([cible], [], 3);
    const sortieConfirme = await sortieComplete([cible, e], [f, g]);
    const sortieEnAttente = await sortieComplete([e, f], [cible, g]);
    const sortieIllimitee = await sortieComplete([cible, e], [], 0);
    await seedPointage(actConfirmeAvecAttente, cible);
    await seedPointage(actConfirmeSansAttente, cible);
    const pointageAutre = await seedPointage(actConfirmeAvecAttente, b);

    expect(await supprimerJeune(cible)).toEqual({ success: true });

    expect(await tracesDuJeune(cible)).toEqual(AUCUNE_TRACE);
    expect(await etatActivite(actConfirmeAvecAttente)).toEqual({
      placesTotal: 2, placesDisponibles: 0, statut: 'complet', confirmes: [b, c].sort(), attente: [d],
    });
    expect(await etatActivite(actEnAttente)).toEqual({
      placesTotal: 2, placesDisponibles: 0, statut: 'complet', confirmes: [b, c].sort(), attente: [d],
    });
    expect(await etatActivite(actConfirmeSansAttente)).toEqual({
      placesTotal: 3, placesDisponibles: 3, statut: 'ouvert', confirmes: [], attente: [],
    });
    for (const act of [actConfirmeAvecAttente, actEnAttente, actConfirmeSansAttente]) {
      expect(await ecartsActivite(act)).toEqual([]);
    }
    expect(await etatSortie(sortieConfirme)).toEqual({ confirmes: [e, f], attente: [g] });
    expect(await etatSortie(sortieEnAttente)).toEqual({ confirmes: [e, f], attente: [g] });
    expect(await etatSortie(sortieIllimitee)).toEqual({ confirmes: [e], attente: [] });
    // Le pointage d'un autre jeune sur la même activité n'est pas touché.
    const { rows } = await pool.query('SELECT id FROM pointages');
    expect(rows.map(r => r.id)).toEqual([pointageAutre]);
  });
});

describe('rollback intégral sur une erreur en base', () => {
  /** Jeune inscrit partout, avec files d'attente : chaque étape a quelque chose à écrire. */
  async function scenarioComplet() {
    const cible = await seedJeune();
    const [b, c, d] = await jeunes(3);
    await pool.query(`INSERT INTO jeunes_contacts (jeune_id, nom) VALUES ($1, 'Parent')`, [cible]);
    const activite = await activiteComplete([cible, b], [c, d]);
    const sortie = await sortieComplete([cible, b], [c, d]);
    await seedPointage(activite, cible);
    return { cible, activite, sortie };
  }

  it('panne à la toute fin (suppression de la fiche) : rien n’est modifié', async () => {
    const { cible } = await scenarioComplet();
    await pool.query(`UPDATE jeunes SET nom = 'PANNE-FICHE' WHERE id = $1`, [cible]);
    const avant = await photographier(...TABLES_SUPPRESSION);

    const res = await supprimerJeune(cible);

    expect(res.success).toBe(false);
    expect(res.error).toContain('panne simulée à la suppression de la fiche');
    expect(await photographier(...TABLES_SUPPRESSION)).toEqual(avant);
  });

  it('panne au recalcul des places (après la promotion) : rien n’est modifié', async () => {
    const { cible, activite } = await scenarioComplet();
    await pool.query(`UPDATE activites SET titre = 'PANNE-PLACES' WHERE id = $1`, [activite]);
    const avant = await photographier(...TABLES_SUPPRESSION);

    const res = await supprimerJeune(cible);

    expect(res.success).toBe(false);
    expect(res.error).toContain('panne simulée au recalcul des places');
    expect(await photographier(...TABLES_SUPPRESSION)).toEqual(avant);
  });

  it('panne à la promotion sur la sortie (avant les inscriptions) : rien n’est modifié', async () => {
    const { cible, sortie } = await scenarioComplet();
    await pool.query(`UPDATE sorties SET titre = 'PANNE-PROMOTION' WHERE id = $1`, [sortie]);
    const avant = await photographier(...TABLES_SUPPRESSION);

    const res = await supprimerJeune(cible);

    expect(res.success).toBe(false);
    expect(res.error).toContain('panne simulée à la promotion sur la sortie');
    expect(await photographier(...TABLES_SUPPRESSION)).toEqual(avant);
  });

  it('une fois la panne levée, la même suppression aboutit et la connexion du pool est saine', async () => {
    const { cible, activite, sortie } = await scenarioComplet();
    await pool.query(`UPDATE activites SET titre = 'PANNE-PLACES' WHERE id = $1`, [activite]);
    expect((await supprimerJeune(cible)).success).toBe(false);

    await pool.query(`UPDATE activites SET titre = 'Atelier' WHERE id = $1`, [activite]);
    expect(await supprimerJeune(cible)).toEqual({ success: true });
    expect(await ecartsActivite(activite)).toEqual([]);
    expect((await etatSortie(sortie)).confirmes).toHaveLength(2);
  });
});

describe('concurrence réelle', () => {
  it('suppression + désistement + inscription + retrait + ajout simultanés : une promotion par place libérée', async () => {
    for (let tour = 0; tour < 8; tour++) {
      const [a, b, c, d, e, nouveau] = await jeunes(6);
      const activite = await activiteComplete([a, b], [c, d, e]);
      const sortie = await sortieComplete([a, b], [c, d, e]);

      const [suppression, desistement, inscription, retrait, ajout] = await Promise.all([
        supprimerJeune(a),
        desister(activite, b),
        inscrire(activite, nouveau),
        retirerParticipant(sortie, b),
        ajouterParticipant(sortie, nouveau),
      ]);

      // Aucun interblocage : tous les acteurs aboutissent.
      expect(suppression).toEqual({ success: true });
      expect(desistement.status).toBe(200);
      expect(inscription.status).toBe(200);
      expect((await retrait.json()).success).toBe(true);
      expect((await ajout.json()).success).toBe(true);

      // Deux places libérées → exactement les deux premiers de la file
      // promus, quel que soit l'entrelacement ; le nouveau venu, arrivé sur
      // une activité pleine, attend derrière `e`.
      const etat = await etatActivite(activite);
      expect(etat.confirmes).toEqual([c, d].sort());
      expect(etat.attente).toEqual([e, nouveau]);
      expect(await ecartsActivite(activite)).toEqual([]);
      expect(await etatSortie(sortie)).toEqual({ confirmes: [c, d], attente: [e, nouveau] });
      expect(await tracesDuJeune(a)).toEqual(AUCUNE_TRACE);
    }
  });

  it('suppression pendant qu’on inscrit CE MÊME jeune ailleurs : pas d’interblocage, aucune trace orpheline', async () => {
    for (let tour = 0; tour < 10; tour++) {
      const [a, b, c] = await jeunes(3);
      const dejaInscrit = await activiteComplete([a, b], [c]);
      const autre = await activiteComplete([b], [], 2);
      const sortie = await sortieComplete([a], [], 1);
      const debut = Date.now();

      const [suppression, inscription] = await Promise.all([supprimerJeune(a), inscrire(autre, a)]);

      // L'inscription a soit précédé la suppression (puis été effacée avec le
      // jeune), soit été refusée parce que le jeune n'existe plus. Dans les
      // deux cas la suppression aboutit, sans attendre le détecteur
      // d'interblocage de PostgreSQL (1 s par défaut).
      expect(suppression).toEqual({ success: true });
      expect([200, 404, 500]).toContain(inscription.status);
      expect(Date.now() - debut).toBeLessThan(900);
      expect(await tracesDuJeune(a)).toEqual(AUCUNE_TRACE);
      expect(await ecartsActivite(dejaInscrit)).toEqual([]);
      expect(await ecartsActivite(autre)).toEqual([]);
      expect((await etatActivite(autre)).confirmes).toEqual([b]);
      expect(await etatSortie(sortie)).toEqual({ confirmes: [], attente: [] });
    }
  });

  it('deux suppressions simultanées de jeunes partageant activités et sorties (ordres de verrou croisés)', async () => {
    for (let tour = 0; tour < 8; tour++) {
      const [a, b, c, d, e] = await jeunes(5);
      const act1 = await activiteComplete([a, b], [c, d, e]);
      const act2 = await activiteComplete([b, a], [d, c, e]);
      const sortie1 = await sortieComplete([a, b], [c, d, e]);
      const sortie2 = await sortieComplete([b, a], [d, c, e]);

      const resultats = await Promise.all([supprimerJeune(a), supprimerJeune(b), supprimerJeune(a)]);

      // Le doublon sur `a` : une seule des deux demandes le supprime.
      expect(resultats[1]).toEqual({ success: true });
      expect([resultats[0], resultats[2]].filter(r => r.success)).toHaveLength(1);
      expect([resultats[0], resultats[2]].find(r => !r.success)).toEqual({ success: false, error: 'Jeune introuvable' });
      expect(await etatActivite(act1)).toMatchObject({ confirmes: [c, d].sort(), attente: [e], placesDisponibles: 0 });
      expect(await etatActivite(act2)).toMatchObject({ confirmes: [c, d].sort(), attente: [e], placesDisponibles: 0 });
      expect(await etatSortie(sortie1)).toEqual({ confirmes: [c, d], attente: [e] });
      expect(await etatSortie(sortie2)).toEqual({ confirmes: [d, c], attente: [e] });
    }
  });

  it('déterministe — la suppression attend le verrou de l’activité tenu par un désistement en cours', async () => {
    const [a, b, c, d, e] = await jeunes(5);
    const activite = await activiteComplete([a, b], [c, d, e]);
    observateur ??= await connexionConcurrente();

    // Acteur : désistement de `b` en cours (verrou activité, suppression,
    // promotion de `c`), pas encore validé.
    const acteur = await pool.connect();
    try {
      await acteur.query('BEGIN');
      await acteur.query('SELECT id FROM activites WHERE id = $1 FOR UPDATE', [activite]);
      await acteur.query('DELETE FROM inscriptions WHERE activite_id = $1 AND jeune_id = $2', [activite, b]);
      await acteur.query(`UPDATE inscriptions SET statut = 'confirmee' WHERE activite_id = $1 AND jeune_id = $2`, [activite, c]);

      // La suppression de `a` doit ATTENDRE : décider maintenant, sur la file
      // telle qu'elle est visible (c encore en attente), promouvrait `c` une
      // seconde fois et laisserait une place vide.
      const suppression = observer(supprimerJeune(a));
      expect(await attendreBlocage(observateur)).toBe(true);
      expect(suppression.termine()).toBe(false);

      // Pendant cette attente la fiche du jeune n'est PAS verrouillée (ordre
      // activité → jeune) : l'acteur, qui tient l'activité, peut encore
      // écrire une ligne qui référence ce jeune. Avec l'ordre inverse cette
      // écriture attendrait la suppression, qui attend l'acteur : interblocage.
      await acteur.query(
        `INSERT INTO pointages (id, jeune_id, date, type, activite_id, statut, tenant_id)
         VALUES ('ptg-r5-acteur', $1, '2026-11-04', 'activite', $2, 'present', 'nogent')`,
        [a, activite],
      );
      expect(suppression.termine()).toBe(false);

      await acteur.query('COMMIT');
      expect(await suppression.promesse).toEqual({ success: true });
    } finally {
      await libererActeur(acteur);
    }

    // Deux places libérées (b puis a) → c puis d promus, e attend toujours.
    expect(await etatActivite(activite)).toEqual({
      placesTotal: 2, placesDisponibles: 0, statut: 'complet', confirmes: [c, d].sort(), attente: [e],
    });
    expect(await tracesDuJeune(a)).toEqual(AUCUNE_TRACE);
  });

  it('déterministe — la suppression attend le verrou de la sortie tenu par un retrait en cours', async () => {
    const [a, b, c, d, e] = await jeunes(5);
    const sortie = await sortieComplete([a, b], [c, d, e]);
    observateur ??= await connexionConcurrente();

    const acteur = await pool.connect();
    try {
      await acteur.query('BEGIN');
      await acteur.query('SELECT id FROM sorties WHERE id = $1 FOR UPDATE', [sortie]);
      await acteur.query('DELETE FROM sorties_participants WHERE sortie_id = $1 AND jeune_id = $2', [sortie, b]);
      await acteur.query('UPDATE sorties_participants SET en_attente = FALSE WHERE sortie_id = $1 AND jeune_id = $2', [sortie, c]);

      const suppression = observer(supprimerJeune(a));
      expect(await attendreBlocage(observateur)).toBe(true);
      expect(suppression.termine()).toBe(false);

      await acteur.query('COMMIT');
      expect(await suppression.promesse).toEqual({ success: true });
    } finally {
      await libererActeur(acteur);
    }

    expect(await etatSortie(sortie)).toEqual({ confirmes: [c, d], attente: [e] });
  });

  it('déterministe — une inscription et une participation apparues pendant l’attente sont traitées (reprise)', async () => {
    const [a, b, c, d, e, f] = await jeunes(6);
    const bloquee = await activiteComplete([a, b], [c]);
    const apparue = await activiteComplete([b], [d, e], 2);
    const sortieApparue = await sortieComplete([b], [f], 2);
    observateur ??= await connexionConcurrente();

    const acteur = await pool.connect();
    try {
      await acteur.query('BEGIN');
      await acteur.query('SELECT id FROM activites WHERE id = $1 FOR UPDATE', [bloquee]);

      // La suppression a lu « une seule activité, aucune sortie » et attend.
      const suppression = observer(supprimerJeune(a));
      expect(await attendreBlocage(observateur)).toBe(true);

      // Entre-temps, par les vraies routes : `a` prend la dernière place
      // d'une autre activité et d'une sortie, que la suppression n'a donc
      // pas verrouillées.
      expect((await inscrire(apparue, a)).status).toBe(200);
      expect((await (await ajouterParticipant(sortieApparue, a)).json()).statut).toBe('confirmee');
      expect((await etatActivite(apparue)).confirmes).toEqual([a, b].sort());
      expect(suppression.termine()).toBe(false);

      await acteur.query('COMMIT');
      expect(await suppression.promesse).toEqual({ success: true });
    } finally {
      await libererActeur(acteur);
    }

    expect(await tracesDuJeune(a)).toEqual(AUCUNE_TRACE);
    // Sur chacune, la place de `a` est revenue au premier en attente.
    expect((await etatActivite(bloquee)).confirmes).toEqual([b, c].sort());
    expect(await etatActivite(apparue)).toMatchObject({ confirmes: [b, d].sort(), attente: [e], placesDisponibles: 0 });
    expect(await etatSortie(sortieApparue)).toEqual({ confirmes: [b, f], attente: [] });
    for (const act of [bloquee, apparue]) expect(await ecartsActivite(act)).toEqual([]);
  });
});

describe('cloisonnement entre communes', () => {
  it('supprimer depuis A un jeune de B échoue sans rien modifier', async () => {
    const adminA = await seedAnimateur({ tenantId: 'commune-a' });
    await seedAnimateur({ tenantId: 'commune-b' });
    const [cibleB, autreB, attenteB] = await jeunes(3, 'commune-b');
    const activiteB = await seedActivite({ tenantId: 'commune-b', placesTotal: 2 });
    await seedInscription(activiteB, cibleB, { tenantId: 'commune-b' });
    await seedInscription(activiteB, autreB, { tenantId: 'commune-b' });
    await seedInscription(activiteB, attenteB, { tenantId: 'commune-b', statut: 'en-attente' });
    await recalerPlaces(activiteB);
    const sortieB = await seedSortie({ tenantId: 'commune-b', capacite: 1 });
    await seedParticipant(sortieB, cibleB);
    await seedParticipant(sortieB, attenteB, true);
    await seedPointage(activiteB, cibleB, 'commune-b');
    await pool.query(`INSERT INTO jeunes_contacts (jeune_id, nom) VALUES ($1, 'Parent')`, [cibleB]);
    const avant = await photographier(...TABLES_SUPPRESSION);

    await agirEnTantQue(adminA);
    expect(await supprimerJeune(cibleB)).toEqual({ success: false, error: 'Jeune introuvable' });

    expect(await photographier(...TABLES_SUPPRESSION)).toEqual(avant);
  });

  it('sans session, rien n’est modifié', async () => {
    const [a, b, c] = await jeunes(3);
    await activiteComplete([a, b], [c]);
    const avant = await photographier(...TABLES_SUPPRESSION);
    session.nom = ''; session.valeur = '';

    expect(await supprimerJeune(a)).toEqual({ success: false, error: 'Non authentifié' });

    expect(await photographier(...TABLES_SUPPRESSION)).toEqual(avant);
  });
});
