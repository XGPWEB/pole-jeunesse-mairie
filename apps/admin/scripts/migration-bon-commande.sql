-- ─────────────────────────────────────────────────────────────────────────────
--  Migration : bon de commande sur les fiches de sortie
--  À exécuter UNE SEULE FOIS. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

-- bon_commande : le fichier (PDF ou image) encodé en data URI base64.
-- bon_commande_nom : le nom d'origine du fichier, pour le téléchargement.
ALTER TABLE sorties ADD COLUMN IF NOT EXISTS bon_commande     TEXT;
ALTER TABLE sorties ADD COLUMN IF NOT EXISTS bon_commande_nom TEXT;
