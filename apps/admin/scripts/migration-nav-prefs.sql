-- ─────────────────────────────────────────────────────────────────────────────
--  Migration : préférences de menu par animateur
--  Chaque animateur peut réorganiser (ordre) et masquer ses entrées de menu.
--  Stocké en JSONB : [{ "id": "jeunes", "visible": true }, …] dans l'ordre voulu.
--  NULL = pas de personnalisation → menu par défaut (config admin / DEFAULT_NAV).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE animateurs ADD COLUMN IF NOT EXISTS nav_prefs JSONB;
