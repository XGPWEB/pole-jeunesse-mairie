-- ═════════════════════════════════════════════════════════════════════════════
--  Migration « module PIJ » — reprise du tableur PIJ_Data (2026-10)
--
--  Le Point Information Jeunesse tenait son suivi dans un classeur à six
--  feuilles. Cette migration crée les deux tables qui le remplacent :
--
--    pij_accueils  → feuille « Accueil » (registre des jeunes reçus) ;
--    pij_dossiers  → feuilles « Permis de conduire », « Chantiers jeunes »,
--                    « Bourses » et « BAFA », distinguées par `type`.
--
--  La feuille « STATS » n'est pas stockée : elle est recalculée à l'affichage
--  à partir de pij_accueils (src/lib/pij.ts, `calculerStatsPij`).
--
--    psql -v ON_ERROR_STOP=1 -d <base> -f scripts/migration-pij-2026-10.sql
--
--  ORDRE : à appliquer AVANT de déployer le code du module — les pages et les
--  routes /api/pij/* lisent ces tables. scripts/check-deploy-schema.sh l'exige.
--
--  GARANTIES
--   • Idempotente : rejouable sans effet.
--   • Transactionnelle : tout ou rien.
--   • Non destructive : ne fait que créer ; aucune table existante n'est
--     modifiée, aucune donnée touchée.
-- ═════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

BEGIN;

-- ── Registre d'accueil ───────────────────────────────────────────────────────
-- `objets` et `orientations` : une demande peut avoir plusieurs objets et
-- plusieurs orientations (cellules multi-lignes du tableur). `objets` contient
-- des clés stables (voir OBJETS_PIJ dans src/lib/pij.ts), `orientations` des
-- libellés (liste proposée + saisie libre).
CREATE TABLE IF NOT EXISTS pij_accueils (
  id               TEXT PRIMARY KEY,
  tenant_id        VARCHAR(50) NOT NULL,
  date_visite      DATE NOT NULL,
  nom              TEXT NOT NULL,
  prenom           TEXT NOT NULL,
  date_naissance   DATE,
  sexe             TEXT CHECK (sexe IN ('M', 'F')),
  adresse          TEXT,
  code_postal      TEXT,
  commune          TEXT,
  quartier         TEXT,
  email            TEXT,
  telephone        TEXT,
  objets           TEXT[] NOT NULL DEFAULT '{}',
  objet_precision  TEXT,
  prochain_rdv     TEXT,
  remarques        TEXT,
  orientations     TEXT[] NOT NULL DEFAULT '{}',
  suivi            TEXT,
  etat             TEXT NOT NULL DEFAULT 'en_cours'
                   CHECK (etat IN ('en_cours', 'finalise', 'non_finalise')),
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Dossiers suivis (permis, chantiers jeunes, bourses, BAFA) ────────────────
-- Une seule table : les quatre feuilles partagent identité, téléphone, date de
-- référence et remarques. Colonnes propres à un type laissées NULL ailleurs :
--   permis   : montant, heures_a_realiser, heures_realisees, missions, etat, organisme
--   chantier : objet (mission et services), date_ref (date), horaire
--   bourse   : objet (objet de la bourse), prochain_rdv
--   bafa     : objet (session), prochain_rdv, organisme
-- Les heures restantes du permis ne sont pas stockées (à réaliser − réalisées).
CREATE TABLE IF NOT EXISTS pij_dossiers (
  id                 TEXT PRIMARY KEY,
  tenant_id          VARCHAR(50) NOT NULL,
  type               TEXT NOT NULL CHECK (type IN ('permis', 'chantier', 'bourse', 'bafa')),
  nom                TEXT NOT NULL,
  prenom             TEXT NOT NULL,
  date_naissance     DATE,
  telephone          TEXT,
  date_ref           DATE,
  objet              TEXT,
  horaire            TEXT,
  prochain_rdv       TEXT,
  remarques          TEXT,
  organisme          TEXT,
  montant            NUMERIC(8,2) CHECK (montant >= 0),
  heures_a_realiser  NUMERIC(6,2) CHECK (heures_a_realiser >= 0),
  heures_realisees   NUMERIC(6,2) CHECK (heures_realisees >= 0),
  missions           TEXT,
  etat               TEXT,
  created_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pij_accueils_tenant_date ON pij_accueils(tenant_id, date_visite);
CREATE INDEX IF NOT EXISTS idx_pij_dossiers_tenant_type ON pij_dossiers(tenant_id, type);

COMMIT;
