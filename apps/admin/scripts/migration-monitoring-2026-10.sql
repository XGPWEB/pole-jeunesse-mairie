-- ═══════════════════════════════════════════════════════════════════════════
--  Pôle Jeunesse — Journal de monitoring (2026-10)
--
--  psql -v ON_ERROR_STOP=1 -d <base> -f scripts/migration-monitoring-2026-10.sql
--
--  Même principe que le journal de bugs de LE HUB : chaque erreur serveur,
--  erreur du navigateur, échec de tâche planifiée ou quota de connexion épuisé
--  est consignée ici, et signalée par courriel au plus une fois par type toutes
--  les 30 minutes.
--
--  IDEMPOTENTE, purement additive : deux nouvelles tables, aucune donnée
--  existante lue ni modifiée. À appliquer avant de démarrer une version qui
--  affiche la page Monitoring (le code n'échoue pas si la table manque — un
--  événement non journalisé ne casse jamais la requête — mais rien ne serait
--  enregistré).
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE TABLE IF NOT EXISTS monitoring_events (
  id       TEXT PRIMARY KEY,
  at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source   TEXT NOT NULL,            -- serveur, navigateur, tache, exploitation…
  type     TEXT NOT NULL,            -- libellé affiché et clé de regroupement
  message  TEXT NOT NULL,
  detail   TEXT,                     -- pile d'appels ou contexte, tronqué par l'application
  path     TEXT
);
CREATE INDEX IF NOT EXISTS idx_monitoring_events_at ON monitoring_events(at DESC);

-- Dernière alerte envoyée par type : en base (et non en mémoire) pour que la
-- temporisation survive aux redémarrages et vaille pour plusieurs processus.
CREATE TABLE IF NOT EXISTS monitoring_alerts (
  type          TEXT PRIMARY KEY,
  last_alert_at TIMESTAMPTZ NOT NULL
);

COMMIT;
