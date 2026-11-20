-- ═════════════════════════════════════════════════════════════════════════════
--  Migration « audit du 2026-10-07 » — constats A3 et A4
--
--  A3 : une réservation de véhicule pouvait finir avant de commencer.
--  A4 : un jeune pouvait être rattaché à l'espace d'une autre commune.
--
--  Le code applicatif valide désormais ces deux points ; cette migration pose
--  les mêmes invariants EN BASE, pour tout autre chemin d'écriture (script,
--  future route, intervention manuelle).
--
--    psql -v ON_ERROR_STOP=1 -d <base> -f scripts/migration-reservations-espaces-2026-10.sql
--
--  AVANT de l'appliquer : lire le résultat de
--  scripts/diagnostic-reservations-espaces-2026-10.sql (lecture seule).
--
--  ORDRE : aucun. Le code ne LIT rien de ce que crée cette migration : il
--  fonctionne avant comme après, et elle peut être appliquée avant ou après le
--  déploiement. Elle n'est donc pas exigée par scripts/check-deploy-schema.sh.
--
--  GARANTIES (mêmes que migration-integrite-2026-10.sql)
--   • Idempotente : rejouable sans effet.
--   • Transactionnelle : tout ou rien.
--   • Non destructive : AUCUN DELETE, AUCUN UPDATE. Aucune donnée n'est
--     supprimée, corrigée ni réaffectée.
--
--  DONNÉES EXISTANTES NON CONFORMES : chaque contrainte est ajoutée NOT VALID
--  — immédiatement appliquée à toute NOUVELLE écriture — puis validée si les
--  données le permettent. Sinon un WARNING liste les identifiants fautifs et
--  la contrainte reste NOT VALID : rien n'est bloqué ni perdu. Corriger ces
--  lignes relève d'une décision métier ; rejouer ensuite la migration valide.
--
--  Effet sur l'existant d'une contrainte NOT VALID : une ligne déjà fautive
--  reste lisible et supprimable.
--   • Réservation fautive (CHECK) : toute modification de la ligne doit la
--     rendre conforme.
--   • Jeune rattaché à l'espace d'une autre commune (clé étrangère) : ses
--     autres colonnes restent modifiables en base ; l'application, elle,
--     demande de choisir un espace de la commune avant d'enregistrer la fiche.
-- ═════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Réservations de véhicules (A3) — CHECK ajoutés NOT VALID puis validés
--
--    Les heures sont des colonnes TEXT au format HH:MM ; l'absence de retour
--    est stockée comme chaîne vide (ou NULL sur d'anciennes lignes).
--    L'ordre des heures n'est imposé que sur une réservation d'UN jour : sur
--    plusieurs jours, « départ 18:00, retour 09:00 » est légitime.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  c RECORD;
  n_viol BIGINT;
  exemples TEXT;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('reservations_vehicules', 'reservations_dates_coherentes',
       'date_fin >= date_debut',
       'id || '' ('' || date_debut || '' → '' || date_fin || '')'''),

      ('reservations_vehicules', 'reservations_heure_depart_valide',
       'heure_depart ~ ''^([01][0-9]|2[0-3]):[0-5][0-9]$''',
       'id || '' (départ='' || heure_depart || '')'''),

      ('reservations_vehicules', 'reservations_heure_retour_valide',
       'COALESCE(heure_retour, '''') = '''' OR heure_retour ~ ''^([01][0-9]|2[0-3]):[0-5][0-9]$''',
       'id || '' (retour='' || heure_retour || '')'''),

      ('reservations_vehicules', 'reservations_heures_ordonnees',
       'date_debut <> date_fin OR COALESCE(heure_retour, '''') = '''' OR heure_retour > heure_depart',
       'id || '' ('' || heure_depart || '' → '' || heure_retour || '')''')
    ) AS t(nom_table, nom_contrainte, expression, libelle)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = c.nom_contrainte AND conrelid = c.nom_table::regclass
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s) NOT VALID',
                     c.nom_table, c.nom_contrainte, c.expression);
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = c.nom_contrainte AND conrelid = c.nom_table::regclass AND NOT convalidated
    ) THEN
      EXECUTE format('SELECT COUNT(*) FROM %I WHERE NOT (%s)', c.nom_table, c.expression)
        INTO n_viol;
      IF n_viol = 0 THEN
        EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', c.nom_table, c.nom_contrainte);
      ELSE
        EXECUTE format(
          'SELECT string_agg(l, '', '') FROM (SELECT %s AS l FROM %I WHERE NOT (%s) ORDER BY 1 LIMIT 20) x',
          c.libelle, c.nom_table, c.expression)
          INTO exemples;
        RAISE WARNING E'Contrainte % sur % laissée NOT VALID : % ligne(s) existante(s) la violent.\n'
          '  Lignes à corriger (20 premières) : %\n'
          '  Aucune donnée n''a été modifiée. La contrainte s''applique déjà aux nouvelles écritures ;\n'
          '  corriger ces lignes puis relancer la migration pour la valider.',
          c.nom_contrainte, c.nom_table, n_viol, exemples;
      END IF;
    END IF;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Espace d'un jeune dans SA commune (A4)
--
--    `jeunes.espace_id REFERENCES espaces(id)` garantit que l'espace existe,
--    pas qu'il appartient à la commune du jeune. La clé étrangère composite
--    (commune, espace) le garantit. Elle s'ajoute à l'ancienne, sans la
--    remplacer. Un jeune sans espace (espace_id NULL) n'est pas concerné.
--
--    `espaces.id` étant déjà clé primaire, (tenant_id, id) est unique par
--    construction : l'index ci-dessous ne peut pas échouer sur l'existant. Il
--    sert de cible à la clé étrangère.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_espaces_tenant_id ON espaces(tenant_id, id);

DO $$
DECLARE
  n_viol BIGINT;
  exemples TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_jeunes_espace_commune' AND conrelid = 'jeunes'::regclass
  ) THEN
    ALTER TABLE jeunes
      ADD CONSTRAINT fk_jeunes_espace_commune
      FOREIGN KEY (tenant_id, espace_id) REFERENCES espaces(tenant_id, id) NOT VALID;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_jeunes_espace_commune' AND conrelid = 'jeunes'::regclass AND NOT convalidated
  ) THEN
    SELECT COUNT(*) INTO n_viol
    FROM jeunes j
    WHERE j.espace_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM espaces e WHERE e.id = j.espace_id AND e.tenant_id = j.tenant_id);
    IF n_viol = 0 THEN
      ALTER TABLE jeunes VALIDATE CONSTRAINT fk_jeunes_espace_commune;
    ELSE
      -- Identifiants seulement : pas de nom de mineur dans la sortie d'une migration.
      SELECT string_agg(l, ', ') INTO exemples FROM (
        SELECT j.id || ' (commune ' || j.tenant_id || ', espace ' || j.espace_id || ')' AS l
        FROM jeunes j
        WHERE j.espace_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM espaces e WHERE e.id = j.espace_id AND e.tenant_id = j.tenant_id)
        ORDER BY 1 LIMIT 20
      ) x;
      RAISE WARNING E'Contrainte fk_jeunes_espace_commune laissée NOT VALID : % jeune(s) rattaché(s) à l''espace d''une autre commune.\n'
        '  Fiches concernées (20 premières) : %\n'
        '  Aucune donnée n''a été modifiée ni réaffectée. Choisir le bon espace est une décision\n'
        '  métier : corriger chaque fiche depuis l''interface, puis relancer la migration pour valider.',
        n_viol, exemples;
    END IF;
  END IF;
END $$;

COMMIT;
