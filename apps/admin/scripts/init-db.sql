-- ═══════════════════════════════════════════════════════════
--  Pôle Jeunesse — Schéma PostgreSQL Multi-tenant
-- ═══════════════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Tenants (communes) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id           VARCHAR(50) PRIMARY KEY,
  nom          TEXT        NOT NULL,
  domaine      TEXT,
  actif        BOOLEAN     DEFAULT true,
  adresse      TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  plan         TEXT        DEFAULT 'standard',
  config       JSONB       DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Espaces ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS espaces (
  id           TEXT PRIMARY KEY,
  nom          TEXT NOT NULL,
  description  TEXT,
  tranche_age  TEXT,
  adresse      TEXT,
  horaires     TEXT,
  animateur_ref TEXT,
  couleur      TEXT,
  icon         TEXT,
  capacite     INTEGER DEFAULT 0,
  email        TEXT,
  telephone    TEXT,
  statut       TEXT DEFAULT 'actif',
  tenant_id    VARCHAR(50) NOT NULL DEFAULT 'nogent'
);

-- ── Animateurs ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS animateurs (
  id                       TEXT PRIMARY KEY,
  nom                      TEXT NOT NULL,
  prenom                   TEXT NOT NULL,
  email                    TEXT,
  espace_assigne           TEXT,
  poste                    TEXT,
  unite                    TEXT,
  date_embauche            DATE,
  date_fin_contrat         DATE,
  type_contrat             TEXT,
  telephone                TEXT,
  date_naissance           DATE,
  adresse                  TEXT,
  username                 TEXT UNIQUE NOT NULL,
  statut                   TEXT DEFAULT 'actif',
  role                     TEXT DEFAULT 'animateur',
  password_hash            TEXT,
  photo_url                TEXT,
  password_reset_requested  BOOLEAN DEFAULT FALSE,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  last_login                TIMESTAMPTZ,
  session_invalidated_at    TIMESTAMPTZ,
  totp_secret               TEXT,
  totp_enabled              BOOLEAN NOT NULL DEFAULT FALSE,
  nav_prefs                 JSONB,
  tenant_id                 VARCHAR(50) NOT NULL DEFAULT 'nogent'
);

-- ── Jeunes ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jeunes (
  id                       TEXT PRIMARY KEY,
  nom                      TEXT NOT NULL,
  prenom                   TEXT NOT NULL,
  date_naissance           DATE,
  sexe                     TEXT,
  secteur                  TEXT,
  espace_id                TEXT REFERENCES espaces(id),
  etablissement            TEXT,
  classe                   TEXT,
  observations             TEXT,
  autorisation_sortie      BOOLEAN DEFAULT FALSE,
  autorisation_photo       BOOLEAN DEFAULT FALSE,
  autorisation_soins_benins BOOLEAN DEFAULT FALSE,
  adresse                  TEXT,
  fiche_agora              TEXT,
  fiche_agora_nom          TEXT,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  tenant_id                VARCHAR(50) NOT NULL DEFAULT 'nogent'
);

CREATE TABLE IF NOT EXISTS jeunes_contacts (
  id        SERIAL PRIMARY KEY,
  jeune_id  TEXT REFERENCES jeunes(id) ON DELETE CASCADE,
  nom       TEXT,
  lien      TEXT,
  email     TEXT,
  telephone TEXT
);

-- ── Activités ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activites (
  id                  TEXT PRIMARY KEY,
  titre               TEXT NOT NULL,
  description         TEXT,
  espace_id           TEXT REFERENCES espaces(id),
  date                DATE,
  heure_debut         TEXT,
  heure_fin           TEXT,
  lieu                TEXT,
  animateur           TEXT,
  places_total        INTEGER DEFAULT 0,
  places_disponibles  INTEGER DEFAULT 0,
  statut              TEXT DEFAULT 'ouvert',
  tags                TEXT[],
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  tenant_id           VARCHAR(50) NOT NULL DEFAULT 'nogent'
);

-- ── Inscriptions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inscriptions (
  id               TEXT PRIMARY KEY,
  jeune_id         TEXT REFERENCES jeunes(id),
  jeune_nom        TEXT,
  jeune_prenom     TEXT,
  activite_id      TEXT REFERENCES activites(id),
  activite_titre   TEXT,
  espace_id        TEXT,
  date_inscription TIMESTAMPTZ DEFAULT NOW(),
  statut           TEXT DEFAULT 'confirmee',
  note             TEXT,
  manuel           BOOLEAN DEFAULT FALSE,
  auto_refus       BOOLEAN DEFAULT FALSE,
  date_refus       DATE,
  tenant_id        VARCHAR(50) NOT NULL DEFAULT 'nogent'
);

-- ── Pointages ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pointages (
  id            TEXT PRIMARY KEY,
  jeune_id      TEXT REFERENCES jeunes(id),
  espace_id     TEXT,
  date          DATE,
  heure_arrivee TEXT,
  heure_sortie  TEXT,
  animateur     TEXT,
  type          TEXT,
  activite_id   TEXT,
  manuel        BOOLEAN DEFAULT FALSE,
  source        TEXT,
  statut        TEXT,
  prenom_manuel TEXT,
  nom_manuel    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  tenant_id     VARCHAR(50) NOT NULL DEFAULT 'nogent'
);

-- ── Présences (aux activités) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS presences (
  id          SERIAL PRIMARY KEY,
  jeune_id    TEXT REFERENCES jeunes(id) ON DELETE CASCADE,
  activite_id TEXT REFERENCES activites(id) ON DELETE CASCADE,
  date        DATE,
  statut      TEXT,
  note        TEXT,
  tenant_id   VARCHAR(50) NOT NULL DEFAULT 'nogent'
);

-- ── Sorties ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sorties (
  id                  TEXT PRIMARY KEY,
  titre               TEXT NOT NULL,
  date                DATE,
  heure_depart        TEXT,
  heure_retour        TEXT,
  lieu_depart         TEXT,
  lieu_destination    TEXT,
  transport           TEXT,
  itineraire          TEXT,
  nb_encadrants       INTEGER DEFAULT 0,
  autre_encadrant     TEXT,
  capacite            INTEGER DEFAULT 0,
  observations        TEXT,
  animateur_id        TEXT REFERENCES animateurs(id),
  animateur_nom       TEXT,
  espace_id           TEXT,
  statut              TEXT DEFAULT 'planifiee',
  editeurs            TEXT[] DEFAULT '{}',
  historique          JSONB DEFAULT '[]',
  bon_commande        TEXT,
  bon_commande_nom    TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  tenant_id           VARCHAR(50) NOT NULL DEFAULT 'nogent'
);

CREATE TABLE IF NOT EXISTS sorties_participants (
  sortie_id  TEXT REFERENCES sorties(id) ON DELETE CASCADE,
  jeune_id   TEXT,
  en_attente BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (sortie_id, jeune_id)
);

-- ── Actualités ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS actualites (
  id        TEXT PRIMARY KEY,
  titre     TEXT NOT NULL,
  contenu   TEXT,
  date      DATE,
  categorie TEXT,
  auteur    TEXT,
  epingle   BOOLEAN DEFAULT FALSE,
  espace_id TEXT,
  tenant_id VARCHAR(50) NOT NULL DEFAULT 'nogent'
);

-- ── Événements ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS evenements (
  id          TEXT PRIMARY KEY,
  titre       TEXT NOT NULL,
  description TEXT,
  date        DATE,
  heure_debut TEXT,
  heure_fin   TEXT,
  lieu        TEXT,
  espaces     TEXT[],
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  tenant_id   VARCHAR(50) NOT NULL DEFAULT 'nogent'
);

-- ── Notifications ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id                      TEXT PRIMARY KEY,
  type                    TEXT,
  titre                   TEXT NOT NULL,
  message                 TEXT,
  cible                   TEXT,
  urgent                  BOOLEAN DEFAULT FALSE,
  envoye_par              TEXT,
  envoye_at               TIMESTAMPTZ DEFAULT NOW(),
  lu_par                  TEXT[] DEFAULT '{}',
  dismissed_par           TEXT[] DEFAULT '{}',
  dest_animateur_id       TEXT,
  sortie_id               TEXT,
  sortie_url              TEXT,
  demandeur_id            TEXT,
  demandeur_nom           TEXT,
  expediteur_id           TEXT,
  expediteur_nom          TEXT,
  expediteur_username     TEXT,
  expediteur_espace       TEXT,
  from_animateur_id       TEXT,
  from_animateur_username TEXT,
  from_animateur_prenom   TEXT,
  from_animateur_nom      TEXT,
  from_animateur_email    TEXT,
  tenant_id               VARCHAR(50) NOT NULL DEFAULT 'nogent'
);

-- ── Projets ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projets (
  id                       TEXT PRIMARY KEY,
  titre                    TEXT NOT NULL,
  animateur_id             TEXT,
  animateur_nom            TEXT,
  espace_id                TEXT,
  statut                   TEXT DEFAULT 'brouillon',
  date_depot               DATE,
  duree                    TEXT,
  lieu                     TEXT,
  objectifs_synthetiques   TEXT,
  public_cible             TEXT,
  constat                  TEXT,
  objectifs                TEXT,
  resultats_attendus       TEXT,
  deroulement              TEXT,
  moyens_humains           TEXT,
  moyens_materiels         TEXT,
  partenaires              TEXT,
  modes_communication      TEXT,
  retro_planning           TEXT,
  outils_evaluation        TEXT,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW(),
  tenant_id                VARCHAR(50) NOT NULL DEFAULT 'nogent'
);

CREATE TABLE IF NOT EXISTS projets_budget (
  id          SERIAL PRIMARY KEY,
  projet_id   TEXT REFERENCES projets(id) ON DELETE CASCADE,
  designation TEXT,
  cout        TEXT
);

-- ── Réservations véhicules ────────────────────────────────────
CREATE TABLE IF NOT EXISTS reservations_vehicules (
  id            TEXT PRIMARY KEY,
  vehicule      TEXT,
  animateur_id  TEXT,
  animateur_nom TEXT,
  espace_id     TEXT,
  date_debut    DATE,
  date_fin      DATE,
  heure_depart  TEXT,
  heure_retour  TEXT,
  motif         TEXT,
  destination   TEXT,
  statut        TEXT DEFAULT 'confirmee',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  tenant_id     VARCHAR(50) NOT NULL DEFAULT 'nogent'
);

-- ── Préférences actualités ────────────────────────────────────
CREATE TABLE IF NOT EXISTS actualites_prefs (
  animateur_id TEXT NOT NULL,
  actualite_id TEXT NOT NULL,
  dismissed    BOOLEAN DEFAULT FALSE,
  favorite     BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (animateur_id, actualite_id)
);

-- ── Config (JSONB — structure libre) ──────────────────────────
CREATE TABLE IF NOT EXISTS parametres (
  id   TEXT PRIMARY KEY DEFAULT 'default',
  data JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS theme (
  id   TEXT PRIMARY KEY DEFAULT 'default',
  data JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS rgpd (
  id   TEXT PRIMARY KEY DEFAULT 'default',
  data JSONB NOT NULL DEFAULT '{}'
);

-- ── Rate limiting ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS login_attempts (
  ip       TEXT PRIMARY KEY,
  count    INTEGER DEFAULT 1,
  reset_at TIMESTAMPTZ NOT NULL
);

-- ── Audit log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id                  SERIAL PRIMARY KEY,
  action              TEXT NOT NULL,
  table_name          TEXT,
  record_id           TEXT,
  animateur_id        TEXT,
  animateur_username  TEXT,
  details             JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  tenant_id           VARCHAR(50) DEFAULT 'nogent'
);

-- ── Index de performance ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pointages_date      ON pointages(date);
CREATE INDEX IF NOT EXISTS idx_pointages_jeune     ON pointages(jeune_id);
CREATE INDEX IF NOT EXISTS idx_pointages_espace    ON pointages(espace_id);
CREATE INDEX IF NOT EXISTS idx_inscriptions_jeune  ON inscriptions(jeune_id);
CREATE INDEX IF NOT EXISTS idx_inscriptions_act    ON inscriptions(activite_id);
CREATE INDEX IF NOT EXISTS idx_presences_act       ON presences(activite_id);
CREATE INDEX IF NOT EXISTS idx_presences_jeune     ON presences(jeune_id);
CREATE INDEX IF NOT EXISTS idx_audit_created       ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip   ON login_attempts(ip);

-- Index tenant_id (multi-tenant)
CREATE INDEX IF NOT EXISTS idx_espaces_tenant           ON espaces(tenant_id);
CREATE INDEX IF NOT EXISTS idx_animateurs_tenant        ON animateurs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_jeunes_tenant            ON jeunes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_activites_tenant         ON activites(tenant_id);
CREATE INDEX IF NOT EXISTS idx_inscriptions_tenant      ON inscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pointages_tenant         ON pointages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_presences_tenant         ON presences(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sorties_tenant           ON sorties(tenant_id);
CREATE INDEX IF NOT EXISTS idx_actualites_tenant        ON actualites(tenant_id);
CREATE INDEX IF NOT EXISTS idx_evenements_tenant        ON evenements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant     ON notifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_projets_tenant           ON projets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reservations_tenant      ON reservations_vehicules(tenant_id);

-- Index sur les clés étrangères espace_id / jeune_id / dest_animateur_id
-- (voir aussi scripts/indexes-migration.sql pour les instances déjà déployées)
CREATE INDEX IF NOT EXISTS idx_activites_espace              ON activites(espace_id);
CREATE INDEX IF NOT EXISTS idx_sorties_espace                ON sorties(espace_id);
CREATE INDEX IF NOT EXISTS idx_actualites_espace              ON actualites(espace_id);
CREATE INDEX IF NOT EXISTS idx_projets_espace                 ON projets(espace_id);
CREATE INDEX IF NOT EXISTS idx_reservations_vehicules_espace  ON reservations_vehicules(espace_id);
CREATE INDEX IF NOT EXISTS idx_inscriptions_espace            ON inscriptions(espace_id);
CREATE INDEX IF NOT EXISTS idx_sorties_participants_jeune     ON sorties_participants(jeune_id);
CREATE INDEX IF NOT EXISTS idx_notifications_dest             ON notifications(dest_animateur_id);

-- ── Congés & Récupération (voir scripts/migration-conges-recup.sql) ───────────
CREATE TABLE IF NOT EXISTS conges (
  id            TEXT PRIMARY KEY,
  animateur_id  TEXT NOT NULL REFERENCES animateurs(id) ON DELETE CASCADE,
  date_debut    DATE NOT NULL,
  date_fin      DATE NOT NULL,
  type          TEXT NOT NULL DEFAULT 'paye',   -- paye | sans-solde | recuperation | maladie | autre
  motif         TEXT,
  source        TEXT NOT NULL DEFAULT 'admin',  -- admin | recup
  created_by    TEXT,                            -- id de l'animateur/admin auteur
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  tenant_id     VARCHAR(50) NOT NULL DEFAULT 'nogent'
);

-- ── Demandes de récupération (les DEUX flux, unifiés par `sens`) ──────────────
-- sens = 'credit' : déclaration d'heures effectuées (alimente le solde)
-- sens = 'debit'  : pose de récupération (consomme le solde)
-- Le solde n'est PAS stocké : il se calcule (voir lib/recuperation.ts) à partir
-- des lignes 'approved'. Choix délibéré — un solde stocké se désynchronise.
CREATE TABLE IF NOT EXISTS demandes_recup (
  id            TEXT PRIMARY KEY,
  animateur_id  TEXT NOT NULL REFERENCES animateurs(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  heures        NUMERIC(5,2) NOT NULL CHECK (heures > 0),
  sens          TEXT NOT NULL CHECK (sens IN ('credit','debit')),
  motif         TEXT,
  statut        TEXT NOT NULL DEFAULT 'pending' CHECK (statut IN ('pending','approved','rejected')),
  valide_par    TEXT,
  valide_at     TIMESTAMPTZ,
  conge_id      TEXT REFERENCES conges(id) ON DELETE SET NULL,  -- congé créé si pose validée
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  tenant_id     VARCHAR(50) NOT NULL DEFAULT 'nogent'
);

-- ── Index sur les colonnes réellement filtrées ───────────────────────────────
CREATE INDEX IF NOT EXISTS idx_conges_tenant        ON conges(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conges_animateur     ON conges(animateur_id);
CREATE INDEX IF NOT EXISTS idx_conges_dates         ON conges(date_debut, date_fin);
CREATE INDEX IF NOT EXISTS idx_recup_tenant         ON demandes_recup(tenant_id);
CREATE INDEX IF NOT EXISTS idx_recup_animateur      ON demandes_recup(animateur_id);
CREATE INDEX IF NOT EXISTS idx_recup_statut         ON demandes_recup(statut);

-- ═══════════════════════════════════════════════════════════════════════════
--  Migrations 2026-10 (remédiation de l'audit du 6 octobre 2026)
--
--  Incluses plutôt que recopiées : une seule source de vérité pour une base
--  neuve et pour une base existante, donc plus de dérive entre ce schéma de
--  référence et les migrations (25 colonnes avaient divergé en juillet 2026).
--  Les fichiers sont idempotents ; ordre : sécurité, intégrité, puis clé
--  étrangère des participants.
--
--  ⚠️ `\ir` est une méta-commande psql résolue par rapport à CE fichier :
--     appliquer ce schéma avec `psql -f scripts/init-db.sql`, pas par
--     redirection de l'entrée standard (`psql < init-db.sql`).
-- ═══════════════════════════════════════════════════════════════════════════
\ir migration-securite-2026-10.sql
\ir migration-integrite-2026-10.sql
\ir migration-participants-fk-2026-10.sql
\ir migration-monitoring-2026-10.sql
\ir migration-reservations-espaces-2026-10.sql
\ir migration-pij-2026-10.sql
\ir migration-pij-agenda-2026-10.sql
\ir migration-pij-missions-2026-10.sql
\ir migration-pij-hub-2026-10.sql
\ir migration-fiche-sante-2026-10.sql
\ir migration-rubriques-2026-10.sql
