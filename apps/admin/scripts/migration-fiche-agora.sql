-- ─────────────────────────────────────────────────────────────────────────────
--  Migration : fiche individuelle AGORA sur les profils de jeunes
--  À exécuter UNE SEULE FOIS. Idempotent.
--  fiche_agora     : le document (PDF ou image) encodé en data URI base64.
--  fiche_agora_nom : le nom d'origine du fichier, pour l'impression/téléchargement.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE jeunes ADD COLUMN IF NOT EXISTS fiche_agora     TEXT;
ALTER TABLE jeunes ADD COLUMN IF NOT EXISTS fiche_agora_nom TEXT;
