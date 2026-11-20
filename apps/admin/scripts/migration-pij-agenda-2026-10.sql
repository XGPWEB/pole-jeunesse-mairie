-- ═════════════════════════════════════════════════════════════════════════════
--  Migration « agenda PIJ » (2026-10)
--
--  Rendez-vous du Point Information Jeunesse, et liens d'abonnement qui les
--  exposent au format iCalendar (Outlook, puis LE HUB).
--
--    pij_rdv           → un rendez-vous (date, heure de Paris, durée, jeune) ;
--    pij_agenda_liens  → un lien d'abonnement par compte. Seule l'empreinte
--                        SHA-256 du jeton est stockée : le lien n'est montré
--                        qu'à sa création et ne peut pas être relu en base.
--
--    psql -v ON_ERROR_STOP=1 -d <base> -f scripts/migration-pij-agenda-2026-10.sql
--
--  ORDRE : après migration-pij-2026-10.sql (clé étrangère vers pij_accueils),
--  et AVANT de déployer le code de l'agenda. scripts/check-deploy-schema.sh
--  l'exige.
--
--  GARANTIES : idempotente, transactionnelle, non destructive (ne fait que
--  créer ; aucune table existante n'est modifiée).
-- ═════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

BEGIN;

-- `date` + `heure` : heure locale de Paris, sans fuseau — un rendez-vous à
-- 14:00 reste à 14:00 quel que soit le changement d'heure.
-- `accueil_id` : fiche du registre d'accueil, facultative ; la suppression de
-- la fiche ne supprime pas le rendez-vous (nom et prénom y sont recopiés).
CREATE TABLE IF NOT EXISTS pij_rdv (
  id             TEXT PRIMARY KEY,
  tenant_id      VARCHAR(50) NOT NULL,
  date           DATE NOT NULL,
  heure          TEXT NOT NULL CHECK (heure ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  duree_minutes  INTEGER NOT NULL DEFAULT 30 CHECK (duree_minutes BETWEEN 5 AND 480),
  nom            TEXT NOT NULL,
  prenom         TEXT NOT NULL,
  telephone      TEXT,
  objet          TEXT,
  lieu           TEXT,
  notes          TEXT,
  statut         TEXT NOT NULL DEFAULT 'prevu'
                 CHECK (statut IN ('prevu', 'honore', 'absent', 'annule')),
  accueil_id     TEXT REFERENCES pij_accueils(id) ON DELETE SET NULL,
  created_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pij_agenda_liens (
  animateur_id  TEXT PRIMARY KEY REFERENCES animateurs(id) ON DELETE CASCADE,
  tenant_id     VARCHAR(50) NOT NULL,
  jeton_hash    TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pij_rdv_tenant_date ON pij_rdv(tenant_id, date);

COMMIT;
