-- ═══════════════════════════════════════════════════════════
--  Migration Super-Admin & Thème étendu
--  À exécuter après multi-tenant-migration.sql
-- ═══════════════════════════════════════════════════════════

-- 1. Étendre la table tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS adresse      TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan         TEXT DEFAULT 'standard';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS config       JSONB DEFAULT '{}';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT NOW();

-- 2. Créer le compte super-admin (mot de passe à hasher via script)
-- Le hash ci-dessous est un placeholder — le changer avec hash-passwords.js
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM animateurs WHERE id = 'superadmin-001') THEN
    INSERT INTO animateurs (
      id, nom, prenom, email, username, role, statut,
      espace_assigne, tenant_id, password_hash, created_at
    ) VALUES (
      'superadmin-001',
      'Super', 'Admin',
      'admin@jeunessenogent.cloud',
      'superadmin',
      'superadmin',
      'actif',
      'system',
      'system',
      '$2b$10$placeholder_change_me',
      NOW()
    );
  END IF;
END $$;

-- 3. Theme par défaut Nogent (si pas déjà présent)
INSERT INTO theme (id, data) VALUES ('nogent', '{
  "identiteWeb": {
    "nomPlateforme": "Pôle Jeunesse",
    "sousTitre": "Nogent-sur-Marne",
    "logo": null,
    "favicon": null,
    "siteWeb": "https://jeunessenogent.cloud"
  },
  "couleurs": {
    "primaire": "#6B1A6E",
    "secondaire": "#1B3870",
    "accent": "#8DC63F",
    "fond": "#f5f3ff",
    "texte": "#1e1b4b"
  },
  "typographie": {
    "famille": "Inter",
    "taillBase": "16px"
  },
  "contact": {
    "email": "",
    "telephone": "",
    "adresse": ""
  },
  "reseaux": {
    "facebook": "",
    "instagram": "",
    "twitter": ""
  },
  "footerText": "© 2026 Pôle Jeunesse Nogent-sur-Marne"
}')
ON CONFLICT (id) DO NOTHING;
