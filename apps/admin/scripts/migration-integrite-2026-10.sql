-- ═════════════════════════════════════════════════════════════════════════════
--  Migration « intégrité métier » — remédiation de l'audit du 2026-10-06
--  (constats 10, 18, 19, 20, 22)
--
--  À appliquer AVANT de déployer le code correspondant : les routes
--  /api/sorties* lisent la colonne `sorties_participants.ordre` créée ici.
--
--    psql -v ON_ERROR_STOP=1 -d <base> -f scripts/migration-integrite-2026-10.sql
--
--  GARANTIES
--   • Idempotente : rejouable sans effet (IF NOT EXISTS, tests sur pg_constraint).
--   • Transactionnelle : tout ou rien (BEGIN … COMMIT). Si elle s'arrête, la
--     base est exactement dans l'état d'avant.
--   • Non destructive : AUCUN DELETE, AUCUN UPDATE sur des données métier. La
--     seule écriture de données est le remplissage de la NOUVELLE colonne
--     `ordre`.
--
--  DONNÉES EXISTANTES NON CONFORMES — deux comportements, selon la contrainte :
--   1. Index UNIQUE (inscriptions actives) : PostgreSQL ne sait pas créer un
--      index unique « non validé ». Si des doublons existent, la migration
--      S'ARRÊTE en listant les lignes à arbitrer, sans rien modifier. Choisir
--      laquelle garder est une décision métier (laquelle est confirmée ? la
--      plus ancienne ?) qu'un script ne doit pas prendre à la place de l'équipe.
--   2. Contraintes CHECK : ajoutées en NOT VALID — immédiatement appliquées à
--      toute NOUVELLE écriture — puis validées si les données le permettent.
--      Sinon un WARNING liste les lignes fautives et la contrainte reste NOT
--      VALID : rien n'est bloqué ni perdu, et rejouer la migration après
--      correction la valide.
--
--  Dépendances : scripts/init-db.sql (ou migration-conges-recup.sql) appliqué.
--  Aucune dépendance d'ordre avec les autres migrations d'octobre 2026.
-- ═════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Pré-contrôle bloquant : doublons d'inscriptions actives (constat 18)
--    Fait en premier pour s'arrêter avant toute modification du schéma.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n_groupes INTEGER;
  detail    TEXT;
BEGIN
  IF to_regclass('public.uniq_inscriptions_actives') IS NOT NULL THEN
    RETURN;  -- index déjà en place : l'unicité est garantie, rien à contrôler
  END IF;

  SELECT COUNT(*), string_agg(ligne, E'\n' ORDER BY ligne)
    INTO n_groupes, detail
  FROM (
    SELECT format('  activité %s / jeune %s (tenant %s) : %s',
                  activite_id, jeune_id, min(tenant_id),
                  string_agg(format('%s [%s, %s]', id, statut, date_inscription::date), ', '
                             ORDER BY date_inscription, id)) AS ligne
    FROM inscriptions
    WHERE jeune_id IS NOT NULL AND activite_id IS NOT NULL
      AND statut NOT IN ('annulee', 'refusee')
    GROUP BY activite_id, jeune_id
    HAVING COUNT(*) > 1
  ) d;

  IF n_groupes > 0 THEN
    RAISE EXCEPTION E'Migration interrompue, AUCUNE modification appliquée.\n'
      '% jeune(s) ont plusieurs inscriptions ACTIVES à la même activité :\n%\n'
      'Arbitrage requis : pour chaque groupe, ne garder qu''une inscription active\n'
      '(passer les autres au statut ''annulee'' ou les supprimer depuis l''interface),\n'
      'puis relancer cette migration.', n_groupes, detail;
  END IF;
END $$;

-- Même pré-contrôle pour l'index unique demandes_recup(conge_id) (section 4).
DO $$
DECLARE
  n_groupes INTEGER;
  detail    TEXT;
BEGIN
  IF to_regclass('public.uniq_recup_conge') IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT COUNT(*), string_agg(ligne, E'\n' ORDER BY ligne)
    INTO n_groupes, detail
  FROM (
    SELECT format('  congé %s ← demandes %s', conge_id, string_agg(id, ', ' ORDER BY id)) AS ligne
    FROM demandes_recup
    WHERE conge_id IS NOT NULL
    GROUP BY conge_id
    HAVING COUNT(*) > 1
  ) d;

  IF n_groupes > 0 THEN
    RAISE EXCEPTION E'Migration interrompue, AUCUNE modification appliquée.\n'
      '% congé(s) sont rattachés à plusieurs demandes de récupération :\n%\n'
      'Arbitrage requis : ne laisser qu''une demande par congé, puis relancer cette migration.',
      n_groupes, detail;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Inscriptions : une seule inscription ACTIVE par (activité, jeune)
--    (constat 18)
--
--    Index PARTIEL plutôt que contrainte UNIQUE classique :
--     • un jeune refusé ou annulé doit pouvoir être réinscrit — l'historique
--       des refus est conservé (statistiques), il ne doit pas bloquer ;
--     • les inscriptions manuelles sans fiche (jeune_id NULL, nom libre) ne
--       sont pas concernées.
--    Le prédicat DOIT rester identique à STATUTS_INACTIFS (src/lib/inscriptions.ts).
--    activite_id étant une clé primaire globale, le tenant est implicite.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uniq_inscriptions_actives
  ON inscriptions (activite_id, jeune_id)
  WHERE jeune_id IS NOT NULL AND statut NOT IN ('annulee', 'refusee');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Sorties : ordre d'attente stable (constat 10)
--
--    La promotion du « premier en attente » triait sur ctid, l'adresse
--    PHYSIQUE de la ligne : elle change à chaque UPDATE (dont la promotion
--    elle-même) et après un VACUUM FULL. Ce n'est pas un ordre d'arrivée.
--
--    `ordre` est un numéro monotone tiré d'une séquence à l'insertion. Une
--    séquence plutôt qu'un horodatage : deux ajouts dans la même transaction
--    ou la même microseconde auraient le même NOW(), jamais le même nextval().
--
--    Rétro-remplissage SANS PERTE : les lignes existantes reçoivent un numéro
--    dans leur ordre physique actuel (ctid) — c'est exactement l'ordre que
--    l'application utilisait jusqu'ici, donc la file d'attente observée par
--    les équipes ne change pas. Aucune date d'inscription n'est inventée.
--
--    L'unicité (sortie, jeune) est déjà garantie par la clé primaire
--    sorties_participants(sortie_id, jeune_id) : rien à ajouter.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS sorties_participants_ordre_seq;

ALTER TABLE sorties_participants ADD COLUMN IF NOT EXISTS ordre BIGINT;

-- Verrou explicite : pas d'ajout de participant entre le remplissage et la
-- pose du DEFAULT/NOT NULL.
LOCK TABLE sorties_participants IN SHARE ROW EXCLUSIVE MODE;

UPDATE sorties_participants sp
SET ordre = n.ordre
FROM (
  SELECT sortie_id, jeune_id, nextval('sorties_participants_ordre_seq') AS ordre
  FROM (
    SELECT sortie_id, jeune_id FROM sorties_participants
    WHERE ordre IS NULL
    ORDER BY ctid
  ) existants
) n
WHERE sp.sortie_id = n.sortie_id AND sp.jeune_id = n.jeune_id;

ALTER TABLE sorties_participants
  ALTER COLUMN ordre SET DEFAULT nextval('sorties_participants_ordre_seq'),
  ALTER COLUMN ordre SET NOT NULL;

ALTER SEQUENCE sorties_participants_ordre_seq OWNED BY sorties_participants.ordre;

CREATE INDEX IF NOT EXISTS idx_sorties_participants_ordre
  ON sorties_participants (sortie_id, ordre);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Contraintes CHECK — ajoutées NOT VALID puis validées si possible
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  c RECORD;
  n_viol BIGINT;
  exemples TEXT;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      -- (constat 22) Un congé ne peut pas finir avant d'avoir commencé. La
      -- route valide désormais le couple final ; le CHECK couvre tout autre
      -- chemin d'écriture (script, future route, intervention manuelle).
      ('conges', 'conges_dates_coherentes',
       'date_fin >= date_debut',
       'id || '' ('' || date_debut || '' → '' || date_fin || '')'''),

      -- (constat 19) Vocabulaire fermé de l'origine d'un congé : le code
      -- distingue les congés saisis par un admin de ceux issus d'une
      -- récupération pour décider de ce qui est modifiable.
      ('conges', 'conges_source_valide',
       'source IN (''admin'', ''recup'')',
       'id || '' (source='' || source || '')'''),

      -- (constats 19/20) Un congé n'est rattaché qu'à une pose APPROUVÉE. Un
      -- crédit, une demande en attente ou refusée ne doit jamais porter de
      -- congé : le planning afficherait une absence sans débit correspondant.
      ('demandes_recup', 'recup_conge_seulement_si_pose_approuvee',
       'conge_id IS NULL OR (sens = ''debit'' AND statut = ''approved'')',
       'id || '' (sens='' || sens || '', statut='' || statut || '')'''),

      -- Une capacité négative fausserait toutes les comparaisons de quota
      -- (0 = illimité pour une sortie).
      ('sorties', 'sorties_capacite_positive',
       'capacite IS NULL OR capacite >= 0',
       'id || '' (capacite='' || capacite || '')'''),

      ('activites', 'activites_places_total_positif',
       'places_total IS NULL OR places_total >= 0',
       'id || '' (places_total='' || places_total || '')'''),

      -- en_attente NULL serait ignoré à la fois par « = TRUE » et « = FALSE » :
      -- le participant ne compterait ni comme confirmé ni comme en attente.
      -- CHECK plutôt que SET NOT NULL, qui échouerait sur un NULL existant.
      ('sorties_participants', 'sorties_participants_en_attente_defini',
       'en_attente IS NOT NULL',
       'sortie_id || '' / '' || jeune_id')
    ) AS t(nom_table, nom_contrainte, expression, libelle)
  LOOP
    -- 3a. Création (une seule fois). NOT VALID : pas de balayage de la table,
    --     pas d'échec sur l'existant, mais contrôle actif sur toute nouvelle
    --     écriture dès maintenant.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = c.nom_contrainte AND conrelid = c.nom_table::regclass
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s) NOT VALID',
                     c.nom_table, c.nom_contrainte, c.expression);
    END IF;

    -- 3b. Validation, seulement si elle n'est pas déjà acquise.
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
-- 4. Récupération : un congé n'appartient qu'à UNE demande (constat 19)
--
--    Le lien demande → congé est 1-1 : la suppression ou la correction d'une
--    demande supprime ou déplace « son » congé. Deux demandes pointant le même
--    congé rendraient ces opérations incohérentes. Index partiel (les demandes
--    sans congé — la grande majorité — ne sont pas indexées).
--    Aucun chemin applicatif ne peut produire de doublon (le congé est créé
--    avec un UUID neuf à chaque validation) ; si une intervention manuelle en
--    avait créé un, le pré-contrôle de la section 0 a déjà arrêté la migration.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uniq_recup_conge
  ON demandes_recup (conge_id)
  WHERE conge_id IS NOT NULL;

COMMIT;
