-- ═══════════════════════════════════════════════════════════
--  Pôle Jeunesse — Migration anti-rejeu TOTP
--  À lancer UNE SEULE FOIS sur la DB de production :
--  psql -U pj_admin -d pole_jeunesse -f scripts/totp-anti-replay-migration.sql
--
--  Contexte : totp.validate({ window: 1 }) accepte un code valide sur une
--  fenêtre de temps, mais ne mémorise jamais le dernier "step" (pas Unix de
--  30s) déjà validé pour un utilisateur donné. Un même code TOTP intercepté
--  (ex. via un proxy compromis, un log, ou capture réseau) peut donc être
--  rejoué tel quel tant qu'il reste dans la fenêtre de validité, ce qui
--  contourne la 2FA. `last_totp_step` retient le step Unix (`floor(unix/30)`)
--  du dernier code accepté par utilisateur ; toute vérification dont le step
--  calculé est <= à cette valeur doit être refusée, même si le code est
--  arithmétiquement correct.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE animateurs ADD COLUMN IF NOT EXISTS last_totp_step BIGINT;
