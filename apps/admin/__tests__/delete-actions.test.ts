import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('bcryptjs', () => ({ default: { hash: vi.fn(async () => 'hashed'), compare: vi.fn(async () => true) } }));
// Les suppressions en cascade passent par une transaction (pool.connect), les
// autres écritures par pool.query. Le mock expose les deux, et `clientQuery`
// enregistre les requêtes transactionnelles pour pouvoir vérifier l'ordre
// des suppressions ET la présence du BEGIN/COMMIT.
const clientQuery = vi.fn();
const clientRelease = vi.fn();
vi.mock('@/lib/db', () => ({
  default: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}));
vi.mock('@/lib/auth', () => {
  const requireActionAuth = vi.fn(async () => ({ id: 'anim-001', role: 'admin', tenant_id: 'nogent' }));
  return {
    getTenantId: vi.fn(async () => 'nogent'),
    requireActionAuth,
    // Garde par rubrique : mêmes réponses que requireActionAuth (les rubriques
    // sont testées contre la vraie base, __tests__/integration/rubriques.test.ts).
    requireActionRubrique: vi.fn(() => requireActionAuth()),
    requireActionAdmin: vi.fn(async () => ({ id: 'anim-001', role: 'admin', tenant_id: 'nogent' })),
    roleEffectif: (r: string | null | undefined) => (r === 'admin' ? 'admin' : 'animateur'),
  };
});

import pool from '@/lib/db';
import { requireActionAuth, requireActionAdmin } from '@/lib/auth';
import { supprimerAnimateur } from '@/app/animateurs/actions';
import { supprimerJeune } from '@/app/jeunes/actions';
import { supprimerActivite } from '@/app/activites/actions';

const mockQuery   = vi.mocked(pool.query);
const mockConnect = vi.mocked((pool as any).connect);
const mockAuth    = vi.mocked(requireActionAuth);
const mockAdmin   = vi.mocked(requireActionAdmin);

/** Requêtes vues par la transaction, dans l'ordre. */
const txQueries = () => clientQuery.mock.calls.map(c => c[0] as string);

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rowCount: 1, rows: [] } as any);

  clientQuery.mockReset();
  clientQuery.mockResolvedValue({ rowCount: 1, rows: [] } as any);
  clientRelease.mockReset();
  mockConnect.mockReset();
  mockConnect.mockResolvedValue({ query: clientQuery, release: clientRelease } as any);

  mockAuth.mockResolvedValue({ id: 'anim-001', role: 'admin', tenant_id: 'nogent' } as any);
  mockAdmin.mockResolvedValue({ id: 'anim-001', role: 'admin', tenant_id: 'nogent' } as any);
});

// ── supprimerAnimateur ────────────────────────────────────────────────────────
describe('supprimerAnimateur', () => {
  it('nullifie animateur_id dans sorties avant de supprimer', async () => {
    const result = await supprimerAnimateur('anim-123');

    expect(result.success).toBe(true);
    const calls = txQueries();
    const updateIdx = calls.findIndex(q => q.includes('UPDATE sorties'));
    const deleteIdx = calls.findIndex(q => q.includes('DELETE FROM animateurs'));
    expect(updateIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeGreaterThan(updateIdx);
  });

  it('nettoie actualites_prefs avant de supprimer', async () => {
    await supprimerAnimateur('anim-123');
    expect(txQueries().some(q => q.includes('actualites_prefs'))).toBe(true);
  });

  it('exécute les suppressions dans une transaction validée', async () => {
    await supprimerAnimateur('anim-123');
    const calls = txQueries();
    expect(calls[0]).toBe('BEGIN');
    expect(calls[calls.length - 1]).toBe('COMMIT');
    expect(clientRelease).toHaveBeenCalled();
  });

  it('retourne success: false si animateur introuvable, sans aucune écriture', async () => {
    // La vérification d'appartenance (SELECT ... FOR UPDATE) est la première
    // requête de la transaction : si elle ne remonte rien, tout doit être
    // annulé sans qu'aucune écriture ne parte.
    clientQuery.mockResolvedValueOnce({ rowCount: 1 } as any); // BEGIN
    clientQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] } as any); // SELECT ... FOR UPDATE
    const result = await supprimerAnimateur('inconnu');

    expect(result.success).toBe(false);
    const calls = txQueries();
    expect(calls.some(q => q.includes('UPDATE sorties'))).toBe(false);
    expect(calls.some(q => q.includes('DELETE FROM animateurs'))).toBe(false);
    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
  });

  it('écrit la trace d\'audit DANS la transaction, avec le même client, après le DELETE et avant le COMMIT', async () => {
    clientQuery.mockImplementation(async (sql: string) =>
      (/FOR UPDATE/.test(sql) ? { rowCount: 1, rows: [{ username: 'compte.retire', role: 'animateur' }] } : { rowCount: 1, rows: [] }) as any);

    expect((await supprimerAnimateur('anim-123')).success).toBe(true);

    const calls = txQueries();
    const iDelete = calls.findIndex(q => q.includes('DELETE FROM animateurs'));
    const iAudit = calls.findIndex(q => q.includes('INSERT INTO audit_log'));
    const iCommit = calls.indexOf('COMMIT');
    expect(iDelete).toBeGreaterThanOrEqual(0);
    expect(iAudit).toBeGreaterThan(iDelete);
    expect(iCommit).toBeGreaterThan(iAudit);
    const audit = clientQuery.mock.calls[iAudit];
    expect(audit[1]).toEqual(expect.arrayContaining(['ANIMATEUR_SUPPRIME', 'animateurs', 'anim-123', 'anim-001', 'nogent']));
    expect(String((audit[1] as unknown[])[6])).toContain('compte.retire');
    // Rien n'est écrit hors transaction, par le pool.
    expect(mockQuery.mock.calls.some(c => String(c[0]).includes('audit_log'))).toBe(false);
  });

  it('si la trace d\'audit ne peut pas être écrite, la suppression est ANNULÉE', async () => {
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {});
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO audit_log')) throw new Error('journal indisponible');
      return { rowCount: 1, rows: [{ username: 'x', role: 'animateur' }] } as any;
    });

    const result = await supprimerAnimateur('anim-123');

    expect(result.success).toBe(false);
    const calls = txQueries();
    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
    expect(clientRelease).toHaveBeenCalled();
    // L'échec est journalisé avec une étiquette que le monitoring reconnaît.
    expect(journal.mock.calls.some(c => c[0] === '[supprimerAnimateur]')).toBe(true);
    journal.mockRestore();
  });

  it('une suppression qui échoue n\'écrit aucune trace d\'audit', async () => {
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {});
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('DELETE FROM animateurs')) throw new Error('panne simulée');
      return { rowCount: 1, rows: [{ username: 'x', role: 'animateur' }] } as any;
    });

    expect((await supprimerAnimateur('anim-123')).success).toBe(false);
    expect(txQueries().some(q => q.includes('audit_log'))).toBe(false);
    expect(mockQuery.mock.calls.some(c => String(c[0]).includes('audit_log'))).toBe(false);
    expect(txQueries()).toContain('ROLLBACK');
    journal.mockRestore();
  });

  it("vérifie l'appartenance au tenant avant de supprimer", async () => {
    await supprimerAnimateur('anim-123');
    // La requête de verrou lit aussi l'identifiant et le rôle du compte, repris
    // dans la trace d'audit de la suppression.
    const verrou = clientQuery.mock.calls.find(c => /SELECT id.* FROM animateurs .*FOR UPDATE/.test(String(c[0])));
    expect(verrou).toBeDefined();
    expect(String(verrou![0])).toContain('tenant_id');
    expect(verrou![1]).toContain('nogent');
  });
});

// ── supprimerJeune ────────────────────────────────────────────────────────────
describe('supprimerJeune', () => {
  /**
   * Depuis la revue R5, l'action lit d'abord les activités et sorties du
   * jeune, les verrouille, puis supprime. Le mock répond à ces lectures par
   * un jeune inscrit à une activité (confirmé) et à une sortie (confirmé) :
   * sans cela aucune ressource ne serait verrouillée et les tests d'ordre
   * ne vérifieraient rien. `echec` fait échouer la première requête qui
   * contient ce texte, pour simuler une panne à une étape précise.
   */
  function jeuneInscrit(echec?: string) {
    clientQuery.mockImplementation(async (sql: string) => {
      if (echec && sql.includes(echec)) throw new Error('connexion perdue');
      if (sql.includes('SELECT DISTINCT activite_id')) return { rowCount: 1, rows: [{ activiteId: 'act-1' }] };
      if (sql.includes('SELECT sp.sortie_id')) return { rowCount: 1, rows: [{ sortieId: 'sortie-1' }] };
      if (sql.includes('FROM activites') && sql.includes('FOR UPDATE')) {
        return { rowCount: 1, rows: [{ titre: 'Atelier', espaceId: 'collegiens', placesTotal: 10 }] };
      }
      if (sql.includes('FROM sorties WHERE') && sql.includes('FOR UPDATE')) return { rowCount: 1, rows: [{ capacite: 5 }] };
      if (sql.includes('DELETE FROM sorties_participants')) return { rowCount: 1, rows: [{ enAttente: false }] };
      if (sql.includes('DELETE FROM inscriptions')) return { rowCount: 1, rows: [{ activiteId: 'act-1', statut: 'confirmee' }] };
      if (sql.includes('SELECT 1 FROM sorties_participants')) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    });
  }
  const indexDe = (fragment: string) => txQueries().findIndex(q => q.includes(fragment));

  it('supprime pointages, sorties_participants et inscriptions avant le jeune', async () => {
    jeuneInscrit();
    const result = await supprimerJeune('j-123');

    expect(result.success).toBe(true);
    const ptgIdx   = indexDe('DELETE FROM pointages');
    const spIdx    = indexDe('DELETE FROM sorties_participants');
    const insIdx   = indexDe('DELETE FROM inscriptions');
    const jeuneIdx = indexDe('DELETE FROM jeunes');

    expect(ptgIdx).toBeGreaterThanOrEqual(0);
    expect(spIdx).toBeGreaterThanOrEqual(0);
    expect(insIdx).toBeGreaterThanOrEqual(0);
    expect(jeuneIdx).toBeGreaterThan(Math.max(ptgIdx, spIdx, insIdx));
  });

  it('exécute les suppressions dans une transaction validée', async () => {
    jeuneInscrit();
    await supprimerJeune('j-123');
    const calls = txQueries();
    expect(calls[0]).toBe('BEGIN');
    expect(calls[calls.length - 1]).toBe('COMMIT');
    expect(calls.filter(q => q === 'BEGIN')).toHaveLength(1);
    expect(clientRelease).toHaveBeenCalled();
  });

  // Revue R5 : l'ordre des verrous est ce qui évite l'interblocage avec une
  // inscription ou un désistement simultanés (activité → sortie → jeune).
  it('verrouille activités puis sorties puis la fiche du jeune, avant toute suppression', async () => {
    jeuneInscrit();
    await supprimerJeune('j-123');

    const calls = txQueries();
    const verrouActivite = calls.findIndex(q => q.includes('FROM activites') && q.includes('FOR UPDATE'));
    const verrouSortie   = calls.findIndex(q => q.includes('FROM sorties WHERE') && q.includes('FOR UPDATE'));
    const verrouJeune    = calls.findIndex(q => q.includes('FROM jeunes') && q.includes('FOR UPDATE'));
    const premierDelete  = calls.findIndex(q => q.includes('DELETE'));

    expect(verrouActivite).toBeGreaterThanOrEqual(0);
    expect(verrouSortie).toBeGreaterThan(verrouActivite);
    expect(verrouJeune).toBeGreaterThan(verrouSortie);
    expect(premierDelete).toBeGreaterThan(verrouJeune);
  });

  it('libère la place : promotion puis recalcul des places après la suppression des inscriptions', async () => {
    jeuneInscrit();
    await supprimerJeune('j-123');

    const insIdx       = indexDe('DELETE FROM inscriptions');
    const promotionIdx = indexDe("UPDATE inscriptions SET statut = 'confirmee'");
    const placesIdx    = indexDe('SET places_disponibles');
    const sortieIdx    = indexDe('SET en_attente = FALSE');
    const jeuneIdx     = indexDe('DELETE FROM jeunes');

    expect(promotionIdx).toBeGreaterThan(insIdx);
    expect(placesIdx).toBeGreaterThan(promotionIdx);
    expect(sortieIdx).toBeGreaterThan(indexDe('DELETE FROM sorties_participants'));
    expect(jeuneIdx).toBeGreaterThan(Math.max(placesIdx, sortieIdx));
  });

  it('borne chaque suppression au tenant de la session', async () => {
    mockAuth.mockResolvedValue({
      id: 'anim-001', username: 'anim.b', role: 'animateur', espaceAssigne: 'Collégiens', tenant_id: 'structure-b',
    });
    jeuneInscrit();
    await supprimerJeune('j-123');

    for (const table of ['pointages', 'inscriptions', 'jeunes']) {
      const appel = clientQuery.mock.calls.find(c => String(c[0]).includes(`DELETE FROM ${table}`));
      expect(String(appel![0])).toContain('tenant_id');
      expect(appel![1]).toEqual(['j-123', 'structure-b']);
    }
    // sorties_participants n'a pas de colonne tenant : la suppression ne vise
    // que les sorties verrouillées, elles-mêmes lues avec le tenant.
    const verrouSortie = clientQuery.mock.calls.find(c => String(c[0]).includes('FROM sorties WHERE'));
    expect(verrouSortie![1]).toEqual(['sortie-1', 'structure-b']);
    const delParticipant = clientQuery.mock.calls.find(c => String(c[0]).includes('DELETE FROM sorties_participants'));
    expect(delParticipant![1]).toEqual(['sortie-1', 'j-123']);
  });

  it('annule la transaction si le jeune est introuvable (aucune perte d’historique)', async () => {
    clientQuery.mockResolvedValue({ rowCount: 0, rows: [] } as any);
    const result = await supprimerJeune('inconnu');

    expect(result.success).toBe(false);
    // Le point critique : rien ne doit être validé, sinon l'historique du jeune
    // (pointages, inscriptions, sorties) serait effacé sans que la fiche parte.
    expect(txQueries()).toContain('ROLLBACK');
    expect(txQueries()).not.toContain('COMMIT');
    expect(txQueries().some(q => q.includes('DELETE'))).toBe(false);
    expect(clientRelease).toHaveBeenCalled();
  });

  // Une panne à CHAQUE étape d'écriture doit annuler l'ensemble.
  it.each([
    'DELETE FROM pointages',
    'DELETE FROM sorties_participants',
    'SET en_attente = FALSE',
    'DELETE FROM inscriptions',
    "UPDATE inscriptions SET statut = 'confirmee'",
    'SET places_disponibles',
    'DELETE FROM jeunes',
  ])('annule la transaction si « %s » échoue', async (etape) => {
    jeuneInscrit(etape);
    const result = await supprimerJeune('j-123');

    expect(result.success).toBe(false);
    expect(txQueries()).toContain('ROLLBACK');
    expect(txQueries()).not.toContain('COMMIT');
    expect(clientRelease).toHaveBeenCalled();
  });
});

// ── supprimerActivite ─────────────────────────────────────────────────────────
describe('supprimerActivite', () => {
  /**
   * L'action verrouille d'abord l'activité DU TENANT (SELECT ... FOR UPDATE)
   * et ne supprime rien si cette lecture ne remonte aucune ligne. Le mock
   * répond donc à cette requête-là par une activité, et laisse le résultat
   * par défaut aux autres.
   */
  function activiteTrouvee() {
    clientQuery.mockImplementation(async (sql: string) =>
      sql.includes('FROM activites') && sql.includes('FOR UPDATE')
        ? { rowCount: 1, rows: [{ titre: 'Atelier', espaceId: 'collegiens', placesTotal: 10 }] }
        : { rowCount: 1, rows: [] },
    );
  }

  it("supprime pointages et inscriptions avant l'activité", async () => {
    activiteTrouvee();
    const result = await supprimerActivite('act-123');

    expect(result.success).toBe(true);
    const calls = txQueries();
    const ptgIdx = calls.findIndex(q => q.includes('pointages'));
    const insIdx = calls.findIndex(q => q.includes('inscriptions'));
    const actIdx = calls.findIndex(q => q.includes('DELETE FROM activites'));

    expect(ptgIdx).toBeGreaterThanOrEqual(0);
    expect(insIdx).toBeGreaterThanOrEqual(0);
    expect(actIdx).toBeGreaterThan(Math.max(ptgIdx, insIdx));
    expect(calls[0]).toBe('BEGIN');
    expect(calls[calls.length - 1]).toBe('COMMIT');
  });

  it('annule la transaction si activité introuvable', async () => {
    clientQuery.mockResolvedValue({ rowCount: 0, rows: [] } as any);
    const result = await supprimerActivite('inconnu');

    expect(result.success).toBe(false);
    expect(txQueries()).toContain('ROLLBACK');
    expect(txQueries()).not.toContain('COMMIT');
  });

  // Constat 6 de l'audit du 2026-10-06 : les enfants étaient supprimés sur le
  // seul identifiant d'activité, avant tout contrôle d'appartenance.
  it("n'émet AUCUN DELETE si l'activité n'appartient pas au tenant de la session", async () => {
    clientQuery.mockResolvedValue({ rowCount: 0, rows: [] });
    await supprimerActivite('act-autre-structure');

    expect(txQueries().some(q => q.includes('DELETE'))).toBe(false);
  });

  it('applique le tenant de la session à chaque suppression, enfants compris', async () => {
    mockAuth.mockResolvedValue({
      id: 'anim-001', username: 'anim.b', role: 'animateur', espaceAssigne: 'Collégiens', tenant_id: 'structure-b',
    });
    activiteTrouvee();
    await supprimerActivite('act-123');

    const deletes = clientQuery.mock.calls.filter(c => String(c[0]).includes('DELETE'));
    expect(deletes).toHaveLength(3);
    for (const [sql, params] of deletes) {
      expect(String(sql)).toContain('tenant_id');
      expect(params).toEqual(['act-123', 'structure-b']);
    }
  });
});

// ── Gardes d'authentification ─────────────────────────────────────────────────
describe('gardes auth des server actions', () => {
  it('supprimerAnimateur refuse un non-admin sans toucher la base', async () => {
    mockAdmin.mockResolvedValue(null);
    const result = await supprimerAnimateur('anim-123');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Accès refusé');
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('supprimerJeune refuse un appel non authentifié sans toucher la base', async () => {
    mockAuth.mockResolvedValue(null);
    const result = await supprimerJeune('j-123');
    expect(result.success).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
    // Ces actions passent par une transaction : vérifier pool.query seul
    // laisserait le test passer même si la transaction s'exécutait.
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('supprimerActivite refuse un appel non authentifié sans toucher la base', async () => {
    mockAuth.mockResolvedValue(null);
    const result = await supprimerActivite('act-123');
    expect(result.success).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockConnect).not.toHaveBeenCalled();
  });
});

// ── Cloisonnement multi-tenant ────────────────────────────────────────────────
// Ces tests verrouillent la règle la plus sensible de l'application : une
// structure ne doit jamais pouvoir écrire sur les données d'une autre.
describe('cloisonnement multi-tenant', () => {
  it('supprimerJeune filtre sur le tenant de la session', async () => {
    mockAuth.mockResolvedValue({ id: 'anim-001', role: 'admin', tenant_id: 'structure-b' } as any);
    await supprimerJeune('j-123');

    const verrou = clientQuery.mock.calls.find(c => String(c[0]).includes('SELECT id FROM jeunes'));
    expect(verrou).toBeDefined();
    expect(String(verrou![0])).toContain('tenant_id');
    expect(verrou![1]).toContain('structure-b');
  });

  it('supprimerJeune n’efface rien si le jeune appartient à une autre structure', async () => {
    clientQuery.mockResolvedValue({ rowCount: 0, rows: [] } as any);
    const result = await supprimerJeune('j-autre-structure');

    expect(result.success).toBe(false);
    const calls = txQueries();
    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
    expect(calls.some(q => q.includes('DELETE FROM pointages'))).toBe(false);
    expect(calls.some(q => q.includes('DELETE FROM jeunes'))).toBe(false);
  });
});
