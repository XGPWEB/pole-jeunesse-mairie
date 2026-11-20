import { vi, describe, it, expect, beforeEach } from 'vitest';

// Le calcul du solde est la source de vérité du module Récupération : un solde
// faux, c'est un litige RH. On mocke la base et on vérifie la formule exacte.
//
// Le mock est typé explicitement : `pool.query` de node-postgres est surchargé
// (promesse OU callback), et `vi.mocked(pool.query)` retenait la surcharge à
// callback — d'où un `mockResolvedValue` attendu en `void` par TypeScript.
type Ligne = Record<string, unknown>;
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn<(sql: string, params?: unknown[]) => Promise<{ rows: Ligne[] }>>(),
}));
vi.mock('@/lib/db', () => ({ default: { query: mockQuery } }));

import { soldeRecup, soldesParAnimateur, soldeApresOperation, effetSurSolde } from '@/lib/recuperation';

beforeEach(() => {
  mockQuery.mockReset();
});

describe('soldeRecup', () => {
  it('calcule crédits approuvés − débits approuvés (SQL) et renvoie un nombre', async () => {
    mockQuery.mockResolvedValue({ rows: [{ solde: 12.5 }] });
    const solde = await soldeRecup('anim-1', 'nogent');

    expect(solde).toBe(12.5);
    const [sql, params] = mockQuery.mock.calls[0];
    // La formule et le filtre statut='approved' doivent être dans la requête.
    expect(sql).toContain("statut = 'approved'");
    expect(sql).toContain('credit');
    expect(sql).toContain('-heures');
    expect(params).toEqual(['anim-1', 'nogent']);
  });

  it('renvoie 0 quand aucune ligne approuvée', async () => {
    mockQuery.mockResolvedValue({ rows: [{ solde: 0 }] });
    expect(await soldeRecup('anim-1', 'nogent')).toBe(0);
  });

  it('filtre bien par tenant', async () => {
    mockQuery.mockResolvedValue({ rows: [{ solde: 3 }] });
    await soldeRecup('anim-1', 'structure-b');
    expect(mockQuery.mock.calls[0][1]).toContain('structure-b');
  });
});

describe('soldesParAnimateur', () => {
  it('agrège les soldes en une seule requête (évite le N+1)', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { animateurId: 'anim-1', solde: 8 },
        { animateurId: 'anim-2', solde: -2 },
      ],
    });
    const soldes = await soldesParAnimateur('nogent');

    expect(soldes).toEqual({ 'anim-1': 8, 'anim-2': -2 });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toContain('GROUP BY animateur_id');
  });
});

// Invariant du solde : fonction pure, donc testable sans base. Les scénarios
// concurrents (verrou) sont couverts en intégration sur un vrai PostgreSQL.
describe('soldeApresOperation', () => {
  it('autorise un débit couvert par le solde, y compris au centième près', () => {
    expect(soldeApresOperation(8, -6)).toEqual({ autorise: true, soldeApres: 2 });
    expect(soldeApresOperation(8, -8)).toEqual({ autorise: true, soldeApres: 0 });
    // 0.1 + 0.2 ≠ 0.3 en flottant : la comparaison se fait en centièmes.
    expect(soldeApresOperation(0.1 + 0.2, -0.3).autorise).toBe(true);
  });

  it('refuse un débit qui ferait passer le solde sous zéro', () => {
    expect(soldeApresOperation(8, -12)).toEqual({ autorise: false, soldeApres: -4 });
    expect(soldeApresOperation(2, -2.01).autorise).toBe(false);
  });

  it('refuse de creuser un solde déjà négatif, mais autorise à le renflouer', () => {
    expect(soldeApresOperation(-4, -1).autorise).toBe(false);
    // Régularisation : le solde reste négatif après coup, mais il s'améliore.
    expect(soldeApresOperation(-4, 3)).toEqual({ autorise: true, soldeApres: -1 });
    expect(soldeApresOperation(-4, 0).autorise).toBe(true);
  });
});

describe('effetSurSolde', () => {
  it('un crédit ajoute, un débit retire', () => {
    expect(effetSurSolde('credit', 5)).toBe(5);
    expect(effetSurSolde('debit', 5)).toBe(-5);
  });
});
