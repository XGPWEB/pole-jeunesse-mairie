-- ─────────────────────────────────────────────────────────────────────────────
--  Migration : module « Congés & Récupération »
--  À exécuter UNE SEULE FOIS sur le VPS.
--  Idempotent (IF NOT EXISTS) — peut être rejoué sans dommage.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Congés (entrées du planning) ─────────────────────────────────────────────
-- Saisis par un admin, OU créés automatiquement lors de la validation d'une
-- pose de récupération (source = 'recup').
CREATE TABLE IF NOT EXISTS conges (
  id            TEXT PRIMARY KEY,
  animateur_id  TEXT NOT NULL REFERENCES animateurs(id) ON DELETE CASCADE,
  date_debut    DATE NOT NULL,
  date_fin      DATE NOT NULL,
  type          TEXT NOT NULL DEFAULT 'paye',   -- paye | sans-solde | recuperation | maladie | autre
  motif         TEXT,
  source        TEXT NOT NULL DEFAULT 'admin',  -- admin | recup
  created_by    TEXT,                            -- id de l'animateur/admin auteur
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  tenant_id     VARCHAR(50) NOT NULL DEFAULT 'nogent'
);

-- ── Demandes de récupération (les DEUX flux, unifiés par `sens`) ──────────────
-- sens = 'credit' : déclaration d'heures effectuées (alimente le solde)
-- sens = 'debit'  : pose de récupération (consomme le solde)
-- Le solde n'est PAS stocké : il se calcule (voir lib/recuperation.ts) à partir
-- des lignes 'approved'. Choix délibéré — un solde stocké se désynchronise.
CREATE TABLE IF NOT EXISTS demandes_recup (
  id            TEXT PRIMARY KEY,
  animateur_id  TEXT NOT NULL REFERENCES animateurs(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  heures        NUMERIC(5,2) NOT NULL CHECK (heures > 0),
  sens          TEXT NOT NULL CHECK (sens IN ('credit','debit')),
  motif         TEXT,
  statut        TEXT NOT NULL DEFAULT 'pending' CHECK (statut IN ('pending','approved','rejected')),
  valide_par    TEXT,
  valide_at     TIMESTAMPTZ,
  conge_id      TEXT REFERENCES conges(id) ON DELETE SET NULL,  -- congé créé si pose validée
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  tenant_id     VARCHAR(50) NOT NULL DEFAULT 'nogent'
);

-- ── Index sur les colonnes réellement filtrées ───────────────────────────────
CREATE INDEX IF NOT EXISTS idx_conges_tenant        ON conges(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conges_animateur     ON conges(animateur_id);
CREATE INDEX IF NOT EXISTS idx_conges_dates         ON conges(date_debut, date_fin);
CREATE INDEX IF NOT EXISTS idx_recup_tenant         ON demandes_recup(tenant_id);
CREATE INDEX IF NOT EXISTS idx_recup_animateur      ON demandes_recup(animateur_id);
CREATE INDEX IF NOT EXISTS idx_recup_statut         ON demandes_recup(statut);
