-- ═══════════════════════════════════════════════════════════════════════════
--  Pôle Jeunesse — Migration sécurité 2026-10 (remédiation de l'audit du 6/10)
--
--  psql -v ON_ERROR_STOP=1 -d <base> -f scripts/migration-securite-2026-10.sql
--
--  IDEMPOTENTE : peut être rejouée sans effet (IF NOT EXISTS partout, blocs DO
--  qui testent le catalogue). Aucune donnée existante n'est modifiée, à une
--  exception VOLONTAIRE décrite au point 1.
--
--  À appliquer AVANT de démarrer la nouvelle version de l'application : le
--  code lit `session_version` à chaque requête authentifiée.
--
--  ⚠️  EFFET AU DÉPLOIEMENT : toutes les sessions ouvertes sont fermées (une
--      seule fois, à la première exécution). Chaque utilisateur doit se
--      reconnecter. Voir point 1.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Révocation durable des sessions (constat 3) ──────────────────────────
-- `session_version` : compteur monotone, recopié dans chaque JWT (claim `sv`).
-- Un jeton n'est accepté que si son `sv` égale la version courante. Révoquer =
-- incrémenter. Se reconnecter n'y change rien : c'est ce qui manquait à
-- `session_invalidated_at`, remis à NULL à chaque login (la borne de
-- révocation disparaissait et les JWT copiés redevenaient valables).
--
-- À la PREMIÈRE exécution seulement (la colonne n'existe pas encore), on pose
-- `session_invalidated_at = NOW()` sur tous les comptes. Pourquoi : les jetons
-- émis par l'ancienne version n'ont pas de `sv`, et ceux qui avaient été
-- révoqués puis « réactivés » par une reconnexion sont indiscernables des
-- jetons légitimes. La seule façon de les éteindre est de refuser tous les
-- jetons antérieurs à la migration. La garde applicative conserve ce contrôle
-- par horodatage pour les jetons sans `sv` ; il n'est plus jamais remis à NULL.
-- Les exécutions suivantes ne refont PAS cette invalidation.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'animateurs' AND column_name = 'session_version'
  ) THEN
    ALTER TABLE animateurs ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
    UPDATE animateurs SET session_invalidated_at = NOW();
  END IF;
END $$;

-- ── 2. TOTP : antirejeu et secret provisoire côté serveur (constats 5, 29) ──
-- `last_totp_step` existe déjà sur les instances ayant reçu
-- totp-anti-replay-migration.sql, mais PAS dans init-db.sql : une base créée
-- depuis init-db.sql seul n'avait pas la colonne (verify-totp y échouait).
ALTER TABLE animateurs ADD COLUMN IF NOT EXISTS last_totp_step BIGINT;

-- Secret en attente de confirmation (activation initiale ou rotation). Il
-- reste côté serveur : le client ne renvoie plus de secret à valider. Le
-- facteur actif (`totp_secret`) n'est remplacé qu'à la confirmation.
ALTER TABLE animateurs ADD COLUMN IF NOT EXISTS totp_pending_secret     TEXT;
ALTER TABLE animateurs ADD COLUMN IF NOT EXISTS totp_pending_expires_at TIMESTAMPTZ;

-- ── 3. Jetons de réinitialisation de mot de passe (constat 15) ──────────────
-- Usage unique (`used_at`), expiration courte (`expires_at`), stockés HACHÉS
-- (SHA-256 du jeton aléatoire de 256 bits) : la base ne contient jamais de
-- quoi réinitialiser un compte. Le hash du mot de passe n'est modifié qu'à la
-- consommation du jeton.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id            TEXT PRIMARY KEY,
  animateur_id  TEXT        NOT NULL REFERENCES animateurs(id) ON DELETE CASCADE,
  tenant_id     VARCHAR(50) NOT NULL,
  token_hash    TEXT        NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  created_by    TEXT,                          -- admin émetteur, NULL si demande du titulaire
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prt_animateur ON password_reset_tokens(animateur_id);
CREATE INDEX IF NOT EXISTS idx_prt_expires   ON password_reset_tokens(expires_at);

-- Ménage : les jetons expirés depuis plus de 7 jours n'ont plus d'intérêt
-- (rejouer la migration les purge ; aucune tâche planifiée n'existe à ce jour).
DELETE FROM password_reset_tokens WHERE expires_at < NOW() - INTERVAL '7 days';

-- ── 4. Notifications : recherche des demandes de reset par compte ───────────
CREATE INDEX IF NOT EXISTS idx_notifications_reset
  ON notifications(tenant_id, from_animateur_id) WHERE type = 'reset-request';

-- ── 5. Pointages : références composites tenant + id (constat 7) ────────────
-- Objectif : que la BASE refuse un pointage dont le jeune ou l'activité
-- appartient à une autre structure, même si un chemin applicatif oublie le
-- contrôle (défense en profondeur ; la route /api/pointages le fait déjà).
--
-- Sans risque pour l'existant, parce que :
--  * les index uniques (tenant_id, id) sont toujours satisfaits (`id` est déjà
--    clé primaire) — ils servent seulement de cible aux clés composites ;
--  * les contraintes sont créées NOT VALID : PostgreSQL ne contrôle PAS les
--    lignes déjà présentes (d'éventuelles références croisées historiques ne
--    bloquent ni la migration ni l'application) ; seules les NOUVELLES lignes
--    et les modifications des colonnes de la clé sont vérifiées ;
--  * MATCH SIMPLE (défaut) : une ligne sans jeune (saisie manuelle) ou sans
--    activité (accueil libre) n'est pas concernée ;
--  * l'ordre de suppression existant (pointages d'abord, puis jeune/activité)
--    reste valable : aucune action ON DELETE n'est ajoutée ni retirée.
--
-- NON fait, volontairement :
--  * `pointages.espace_id` : pas de clé étrangère. La colonne n'en a jamais eu,
--    son contenu historique n'est pas garanti (valeurs libres possibles) et les
--    identifiants d'espaces sont des slugs réutilisés d'une structure à
--    l'autre. Le contrôle est applicatif (route /api/pointages).
--  * VALIDATE CONSTRAINT : à lancer à la main après avoir vérifié que les deux
--    requêtes de contrôle en fin de fichier renvoient 0.
CREATE UNIQUE INDEX IF NOT EXISTS uq_jeunes_tenant_id    ON jeunes(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_activites_tenant_id ON activites(tenant_id, id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pointages_jeune_tenant') THEN
    ALTER TABLE pointages
      ADD CONSTRAINT fk_pointages_jeune_tenant
      FOREIGN KEY (tenant_id, jeune_id) REFERENCES jeunes(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pointages_activite_tenant') THEN
    ALTER TABLE pointages
      ADD CONSTRAINT fk_pointages_activite_tenant
      FOREIGN KEY (tenant_id, activite_id) REFERENCES activites(tenant_id, id) NOT VALID;
  END IF;
END $$;

COMMIT;

-- ── Contrôles manuels avant VALIDATE (hors transaction, lecture seule) ──────
--   SELECT count(*) FROM pointages p
--    WHERE p.jeune_id IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM jeunes j WHERE j.id = p.jeune_id AND j.tenant_id = p.tenant_id);
--   SELECT count(*) FROM pointages p
--    WHERE p.activite_id IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM activites a WHERE a.id = p.activite_id AND a.tenant_id = p.tenant_id);
-- Si les deux valent 0 :
--   ALTER TABLE pointages VALIDATE CONSTRAINT fk_pointages_jeune_tenant;
--   ALTER TABLE pointages VALIDATE CONSTRAINT fk_pointages_activite_tenant;
