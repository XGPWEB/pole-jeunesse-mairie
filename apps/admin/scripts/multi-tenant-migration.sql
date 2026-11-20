-- ═══════════════════════════════════════════════════════════
--  Migration Multi-tenant — Pôle Jeunesse
--  À exécuter UNE SEULE FOIS sur le VPS
-- ═══════════════════════════════════════════════════════════

-- 1. Table des tenants (communes)
CREATE TABLE IF NOT EXISTS tenants (
  id         VARCHAR(50) PRIMARY KEY,   -- 'nogent', 'vincennes', …
  nom        TEXT        NOT NULL,
  domaine    TEXT,                       -- sous-domaine optionnel
  actif      BOOLEAN     DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO tenants (id, nom, domaine) VALUES ('nogent', 'Pôle Jeunesse Nogent-sur-Marne', 'jeunessenogent.cloud')
  ON CONFLICT (id) DO NOTHING;

-- 2. Ajout de tenant_id sur toutes les tables métier
ALTER TABLE espaces              ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(50) DEFAULT 'nogent';
ALTER TABLE animateurs           ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(50) DEFAULT 'nogent';
ALTER TABLE jeunes               ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(50) DEFAULT 'nogent';
ALTER TABLE activites            ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(50) DEFAULT 'nogent';
ALTER TABLE inscriptions         ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(50) DEFAULT 'nogent';
ALTER TABLE pointages            ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(50) DEFAULT 'nogent';
ALTER TABLE presences            ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(50) DEFAULT 'nogent';
ALTER TABLE sorties              ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(50) DEFAULT 'nogent';
ALTER TABLE actualites           ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(50) DEFAULT 'nogent';
ALTER TABLE evenements           ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(50) DEFAULT 'nogent';
ALTER TABLE notifications        ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(50) DEFAULT 'nogent';
ALTER TABLE projets              ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(50) DEFAULT 'nogent';
ALTER TABLE reservations_vehicules ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(50) DEFAULT 'nogent';
ALTER TABLE audit_log            ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(50) DEFAULT 'nogent';

-- 3. Backfill toutes les lignes existantes → tenant 'nogent'
UPDATE espaces               SET tenant_id = 'nogent' WHERE tenant_id IS NULL;
UPDATE animateurs            SET tenant_id = 'nogent' WHERE tenant_id IS NULL;
UPDATE jeunes                SET tenant_id = 'nogent' WHERE tenant_id IS NULL;
UPDATE activites             SET tenant_id = 'nogent' WHERE tenant_id IS NULL;
UPDATE inscriptions          SET tenant_id = 'nogent' WHERE tenant_id IS NULL;
UPDATE pointages             SET tenant_id = 'nogent' WHERE tenant_id IS NULL;
UPDATE presences             SET tenant_id = 'nogent' WHERE tenant_id IS NULL;
UPDATE sorties               SET tenant_id = 'nogent' WHERE tenant_id IS NULL;
UPDATE actualites            SET tenant_id = 'nogent' WHERE tenant_id IS NULL;
UPDATE evenements            SET tenant_id = 'nogent' WHERE tenant_id IS NULL;
UPDATE notifications         SET tenant_id = 'nogent' WHERE tenant_id IS NULL;
UPDATE projets               SET tenant_id = 'nogent' WHERE tenant_id IS NULL;
UPDATE reservations_vehicules SET tenant_id = 'nogent' WHERE tenant_id IS NULL;
UPDATE audit_log             SET tenant_id = 'nogent' WHERE tenant_id IS NULL;

-- 4. Migrer les tables singleton (parametres, theme, rgpd)
--    Leur PK 'default' devient le tenant_id
UPDATE parametres SET id = 'nogent' WHERE id = 'default';
UPDATE theme      SET id = 'nogent' WHERE id = 'default';
UPDATE rgpd       SET id = 'nogent' WHERE id = 'default';

-- 5. NOT NULL + FK vers tenants
ALTER TABLE espaces               ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE animateurs            ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE jeunes                ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE activites             ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE inscriptions          ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE pointages             ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE presences             ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE sorties               ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE actualites            ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE evenements            ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE notifications         ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE projets               ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE reservations_vehicules ALTER COLUMN tenant_id SET NOT NULL;

-- 6. Index sur tenant_id pour les performances
CREATE INDEX IF NOT EXISTS idx_espaces_tenant        ON espaces(tenant_id);
CREATE INDEX IF NOT EXISTS idx_animateurs_tenant     ON animateurs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_jeunes_tenant         ON jeunes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_activites_tenant      ON activites(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inscriptions_tenant   ON inscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pointages_tenant      ON pointages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_presences_tenant      ON presences(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sorties_tenant        ON sorties(tenant_id);
CREATE INDEX IF NOT EXISTS idx_actualites_tenant     ON actualites(tenant_id);
CREATE INDEX IF NOT EXISTS idx_evenements_tenant     ON evenements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant  ON notifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_projets_tenant        ON projets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reservations_tenant   ON reservations_vehicules(tenant_id);
