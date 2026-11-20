-- ─────────────────────────────────────────────────────────────────────────────
--  Migration : renseignements sanitaires sur les fiches jeunes (2026-10)
--  Idempotent : peut être rejoué sans effet.
--
--  - Renseignements lus sur les éditions AGORA « Fiche enfant » et « Fiche
--    santé » (ou saisis à la main) : régimes, maladies, allergies, vaccins,
--    médecin traitant, assurance, hospitalisation, lieu de naissance.
--  - Trois autorisations AGORA, NULL = non renseigné (à ne pas afficher comme
--    un refus) : sortir seul, sortir avec un mineur de plus de 11 ans, mesures
--    d'urgence.
--  - fiche_sante / fiche_sante_nom : l'édition « Fiche santé » d'origine (PDF
--    ou image, data URI base64), à côté de fiche_agora (la « Fiche enfant »).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE jeunes ADD COLUMN IF NOT EXISTS lieu_naissance                  TEXT;
ALTER TABLE jeunes ADD COLUMN IF NOT EXISTS regimes                         TEXT;
ALTER TABLE jeunes ADD COLUMN IF NOT EXISTS maladies                        TEXT;
ALTER TABLE jeunes ADD COLUMN IF NOT EXISTS allergies                       TEXT;
ALTER TABLE jeunes ADD COLUMN IF NOT EXISTS vaccins                         JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE jeunes ADD COLUMN IF NOT EXISTS medecin_nom                     TEXT;
ALTER TABLE jeunes ADD COLUMN IF NOT EXISTS medecin_telephone               TEXT;
ALTER TABLE jeunes ADD COLUMN IF NOT EXISTS assurance_compagnie             TEXT;
ALTER TABLE jeunes ADD COLUMN IF NOT EXISTS assurance_police                TEXT;
ALTER TABLE jeunes ADD COLUMN IF NOT EXISTS hospitalisation                 TEXT;
ALTER TABLE jeunes ADD COLUMN IF NOT EXISTS lieu_hospitalisation            TEXT;
ALTER TABLE jeunes ADD COLUMN IF NOT EXISTS autorisation_sortir_seul        BOOLEAN;
ALTER TABLE jeunes ADD COLUMN IF NOT EXISTS autorisation_sortir_accompagne  BOOLEAN;
ALTER TABLE jeunes ADD COLUMN IF NOT EXISTS autorisation_mesures_urgence    BOOLEAN;
ALTER TABLE jeunes ADD COLUMN IF NOT EXISTS fiche_sante                     TEXT;
ALTER TABLE jeunes ADD COLUMN IF NOT EXISTS fiche_sante_nom                 TEXT;
