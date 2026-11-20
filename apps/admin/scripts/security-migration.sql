-- ═══════════════════════════════════════════════════════════
--  Pôle Jeunesse — Migration sécurité 2026-06-13
--  À lancer UNE SEULE FOIS sur la DB de production :
--  psql -U pj_admin -d pole_jeunesse -f scripts/security-migration.sql
-- ═══════════════════════════════════════════════════════════

-- Session invalidation (révocation JWT côté serveur)
ALTER TABLE animateurs ADD COLUMN IF NOT EXISTS session_invalidated_at TIMESTAMPTZ;

-- 2FA TOTP
ALTER TABLE animateurs ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE animateurs ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Index audit log (déjà dans init-db.sql mais idempotent)
CREATE INDEX IF NOT EXISTS idx_audit_animateur ON audit_log(animateur_id);
CREATE INDEX IF NOT EXISTS idx_audit_action    ON audit_log(action);
