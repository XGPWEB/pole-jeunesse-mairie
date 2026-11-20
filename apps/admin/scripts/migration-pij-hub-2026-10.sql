-- ═════════════════════════════════════════════════════════════════════════════
--  Migration « synchro LE HUB » de l'agenda PIJ (2026-10)
--
--  Les rendez-vous PIJ pris par les jeunes dans l'appli LE HUB sont recopiés
--  dans pij_rdv par LE HUB lui-même (route /api/pij/hub/rdv, secret partagé).
--  `hub_id` porte l'identifiant du rendez-vous côté LE HUB : il permet de
--  mettre à jour la même ligne à chaque envoi, et signale qu'elle appartient
--  à LE HUB (date, heure, jeune y sont modifiés ; ici, seul le pointage
--  honoré / absent et les notes le sont). NULL pour un rendez-vous saisi ici.
--
--    psql -v ON_ERROR_STOP=1 -d <base> -f scripts/migration-pij-hub-2026-10.sql
--
--  ORDRE : après migration-pij-agenda-2026-10.sql, et AVANT de déployer le
--  code de la synchro. scripts/check-deploy-schema.sh l'exige.
--
--  GARANTIES : idempotente, transactionnelle, non destructive (ajoute une
--  colonne vide et un index ; aucune donnée existante n'est modifiée).
-- ═════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE pij_rdv ADD COLUMN IF NOT EXISTS hub_id TEXT;

-- Un rendez-vous LE HUB n'a qu'une ligne par commune. Index partiel : les
-- rendez-vous saisis ici (hub_id NULL) ne sont pas concernés.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pij_rdv_hub ON pij_rdv(tenant_id, hub_id) WHERE hub_id IS NOT NULL;

COMMIT;
