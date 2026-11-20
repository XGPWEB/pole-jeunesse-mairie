-- ─────────────────────────────────────────────────────────────────────────────
--  Migration : ON DELETE CASCADE sur les clés étrangères de la table `presences`
--
--  Contexte : audit de la couche base de données. La table `presences`
--  (jeune_id -> jeunes.id, activite_id -> activites.id) n'a actuellement
--  aucune action ON DELETE définie sur ces deux FK. Vérifié avant écriture
--  de cette migration :
--    grep -r "INSERT INTO presences" apps/admin/src   → aucun résultat
--    grep -r "FROM presences"          apps/admin/src  → aucun résultat
--  La table n'est donc jamais alimentée ni lue par le code applicatif
--  actuel : cette migration est sans risque immédiat, mais bloquera (erreur
--  de contrainte FK) toute suppression en cascade d'un jeune ou d'une
--  activité le jour où `presences` sera utilisée, si elle n'est pas
--  appliquée avant.
--
--  Les contraintes ont été créées par apps/admin/scripts/init-db.sql via un
--  simple `REFERENCES ...(id)` en ligne, sans nom explicite : PostgreSQL leur
--  attribue alors automatiquement un nom de la forme
--  `presences_<colonne>_fkey` (ex. presences_jeune_id_fkey). C'est le nom
--  attendu sur une instance standard, mais pour ne PAS dépendre de cette
--  convention (au cas où le nom réel diffère en production — renommage
--  manuel, migration antérieure, etc.), le bloc ci-dessous RECHERCHE le nom
--  réel de la contrainte dans le catalogue système (pg_constraint) avant de
--  la supprimer, plutôt que de supposer un nom fixe.
--
--  À VÉRIFIER MANUELLEMENT AVANT D'APPLIQUER EN PRODUCTION :
--    - Confirmer qu'aucune ligne n'existe déjà dans `presences` avec un
--      jeune_id ou activite_id orphelin (ce qui empêcherait l'ajout de la
--      contrainte). Requête de contrôle :
--        SELECT COUNT(*) FROM presences p
--          LEFT JOIN jeunes j ON j.id = p.jeune_id
--          WHERE p.jeune_id IS NOT NULL AND j.id IS NULL;
--        SELECT COUNT(*) FROM presences p
--          LEFT JOIN activites a ON a.id = p.activite_id
--          WHERE p.activite_id IS NOT NULL AND a.id IS NULL;
--      (les deux devraient renvoyer 0, la table étant actuellement vide selon
--      l'audit du code applicatif — à reconfirmer directement en base).
--
--  Idempotent : peut être rejouée sans erreur si déjà appliquée (le nom de
--  contrainte recherché sera alors déjà celui attendu avec CASCADE, DROP+ADD
--  se contente de le recréer à l'identique).
--
--  Exécution :
--    psql "$DATABASE_URL" -f apps/admin/scripts/presences-fk-migration.sql
--
--  Le même changement est reporté directement dans apps/admin/scripts/init-db.sql
--  (colonnes jeune_id / activite_id de CREATE TABLE presences) pour qu'une
--  nouvelle installation soit cohérente avec les instances migrées par ce
--  script.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  fk_jeune    TEXT;
  fk_activite TEXT;
BEGIN
  -- ── presences.jeune_id → jeunes(id) ────────────────────────────────────
  SELECT con.conname INTO fk_jeune
  FROM pg_constraint con
  JOIN pg_class rel     ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
  WHERE con.contype = 'f'
    AND rel.relname = 'presences'
    AND att.attname = 'jeune_id'
  LIMIT 1;

  IF fk_jeune IS NOT NULL THEN
    EXECUTE format('ALTER TABLE presences DROP CONSTRAINT %I', fk_jeune);
  END IF;
  EXECUTE 'ALTER TABLE presences
             ADD CONSTRAINT presences_jeune_id_fkey
             FOREIGN KEY (jeune_id) REFERENCES jeunes(id) ON DELETE CASCADE';

  -- ── presences.activite_id → activites(id) ──────────────────────────────
  SELECT con.conname INTO fk_activite
  FROM pg_constraint con
  JOIN pg_class rel     ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
  WHERE con.contype = 'f'
    AND rel.relname = 'presences'
    AND att.attname = 'activite_id'
  LIMIT 1;

  IF fk_activite IS NOT NULL THEN
    EXECUTE format('ALTER TABLE presences DROP CONSTRAINT %I', fk_activite);
  END IF;
  EXECUTE 'ALTER TABLE presences
             ADD CONSTRAINT presences_activite_id_fkey
             FOREIGN KEY (activite_id) REFERENCES activites(id) ON DELETE CASCADE';
END $$;
