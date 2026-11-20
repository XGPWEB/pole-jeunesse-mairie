-- ─────────────────────────────────────────────────────────────────────────────
--  Migration : index manquants sur des clés étrangères fréquemment filtrées
--
--  Contexte : audit de la couche base de données. Ces colonnes (espace_id,
--  jeune_id, dest_animateur_id) sont utilisées dans des clauses WHERE/JOIN
--  courantes mais n'avaient pas d'index dédié, ce qui force des scans
--  séquentiels sur les tables concernées à mesure qu'elles grossissent.
--
--  Idempotent (IF NOT EXISTS) : peut être appliquée plusieurs fois sans
--  risque. À exécuter directement sur la base de production :
--    psql "$DATABASE_URL" -f apps/admin/scripts/indexes-migration.sql
--
--  Ces mêmes index sont désormais aussi créés par apps/admin/scripts/init-db.sql
--  pour que les nouvelles installations soient cohérentes d'emblée.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_activites_espace              ON activites(espace_id);
CREATE INDEX IF NOT EXISTS idx_sorties_espace                ON sorties(espace_id);
CREATE INDEX IF NOT EXISTS idx_actualites_espace              ON actualites(espace_id);
CREATE INDEX IF NOT EXISTS idx_projets_espace                 ON projets(espace_id);
CREATE INDEX IF NOT EXISTS idx_reservations_vehicules_espace  ON reservations_vehicules(espace_id);
CREATE INDEX IF NOT EXISTS idx_inscriptions_espace            ON inscriptions(espace_id);
CREATE INDEX IF NOT EXISTS idx_sorties_participants_jeune     ON sorties_participants(jeune_id);
CREATE INDEX IF NOT EXISTS idx_notifications_dest             ON notifications(dest_animateur_id);
