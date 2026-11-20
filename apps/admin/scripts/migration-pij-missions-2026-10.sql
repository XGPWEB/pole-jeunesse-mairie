-- ═════════════════════════════════════════════════════════════════════════════
--  Migration « missions des dossiers permis » (2026-10)
--
--  Un dossier permis portait un seul chiffre « déjà réalisé » et un texte
--  libre « missions réalisées », réécrits à chaque mise à jour : aucune trace
--  de ce qui avait été fait, quand, ni de qui l'avait saisi.
--
--  pij_missions tient désormais le JOURNAL des missions d'un dossier : une
--  ligne par mission (date, intitulé, heures, auteur). La colonne
--  pij_dossiers.heures_realisees reste, mais n'est plus saisie : l'application
--  la recalcule comme la somme du journal à chaque ajout ou retrait.
--
--    psql -v ON_ERROR_STOP=1 -d <base> -f scripts/migration-pij-missions-2026-10.sql
--
--  ORDRE : après migration-pij-2026-10.sql, et AVANT de déployer le code du
--  journal. scripts/check-deploy-schema.sh l'exige.
--
--  REPRISE DE L'EXISTANT : pour chaque dossier permis ayant déjà des heures
--  réalisées et encore aucune ligne au journal, une ligne est créée avec ces
--  heures, datée de la commission (à défaut, de la création du dossier) et
--  intitulée d'après le texte « missions réalisées ». Le total affiché ne
--  change donc pas.
--
--  GARANTIES : idempotente (la reprise ne touche que les dossiers sans
--  journal), transactionnelle, non destructive — crée une table et y insère ;
--  aucune ligne existante n'est modifiée ni supprimée.
-- ═════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS pij_missions (
  id          TEXT PRIMARY KEY,
  tenant_id   VARCHAR(50) NOT NULL,
  dossier_id  TEXT NOT NULL REFERENCES pij_dossiers(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  libelle     TEXT NOT NULL,
  heures      NUMERIC(5,2) NOT NULL CHECK (heures > 0),
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pij_missions_dossier ON pij_missions(dossier_id, date);

INSERT INTO pij_missions (id, tenant_id, dossier_id, date, libelle, heures, created_by, created_at)
SELECT 'pij-mis-reprise-' || d.id,
       d.tenant_id,
       d.id,
       COALESCE(d.date_ref, d.created_at::date),
       COALESCE(NULLIF(TRIM(d.missions), ''), 'Heures déjà réalisées (reprise)'),
       LEAST(d.heures_realisees, 999.99),
       d.created_by,
       d.created_at
FROM pij_dossiers d
WHERE d.type = 'permis'
  AND d.heures_realisees > 0
  AND NOT EXISTS (SELECT 1 FROM pij_missions m WHERE m.dossier_id = d.id);

COMMIT;
