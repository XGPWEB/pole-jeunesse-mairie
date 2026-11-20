-- ═══════════════════════════════════════════════════════════════════════════
--  Remise à zéro des données saisies pendant la démonstration
--  (avant la mise en service sur le serveur de la mairie — novembre 2026)
--
--  CONSERVÉ
--    tenants, espaces, parametres, theme, rgpd          configuration
--    animateurs : UNIQUEMENT les comptes admin / superadmin (pour pouvoir se
--                 connecter et recréer l'équipe). Le script s'arrête sans rien
--                 modifier s'il ne reste aucun compte admin actif.
--    Le véhicule (Renault Trafic) n'est pas en base : il est dans le code.
--
--  VIDÉ
--    fiches jeunes (+ contacts), inscriptions, pointages, présences,
--    activités, événements, sorties (+ participants), projets (+ budget),
--    actualités (+ préférences), notifications, congés, demandes de
--    récupération, réservations du véhicule, tout le PIJ (accueils, dossiers,
--    RDV, missions), journal d'audit, monitoring, tentatives de connexion,
--    jetons de réinitialisation de mot de passe, comptes au rôle « animateur »
--    (et, par cascade, leurs liens d'abonnement à l'agenda PIJ).
--    Les statistiques et la fréquentation se calculent à partir de ces tables :
--    elles repartent donc de zéro.
--
--  USAGE (par scripts/remise-a-zero.sh, qui fait d'abord une sauvegarde)
--    psql -v ON_ERROR_STOP=1 -f remise-a-zero-2026-11.sql
--        → SIMULATION : affiche ce qui serait supprimé, puis annule (ROLLBACK).
--    psql -v ON_ERROR_STOP=1 -v confirmation=REMISE-A-ZERO -f remise-a-zero-2026-11.sql
--        → EXÉCUTION réelle (COMMIT).
--
--  Sûreté : tout se passe dans UNE transaction. TRUNCATE sans CASCADE : si une
--  table conservée référençait une table vidée, PostgreSQL refuserait et rien
--  ne serait modifié.
-- ═══════════════════════════════════════════════════════════════════════════

\set QUIET on
\pset footer off

\if :{?confirmation}
  SELECT :'confirmation' = 'REMISE-A-ZERO' AS reel \gset
\else
  \set reel false
\endif

BEGIN;

-- Une table absente (migration non appliquée) est simplement ignorée.
CREATE TEMP TABLE _a_vider (nom TEXT PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _a_vider (nom)
SELECT t FROM unnest(ARRAY[
  'jeunes', 'jeunes_contacts',
  'inscriptions', 'pointages', 'presences',
  'activites', 'evenements',
  'sorties', 'sorties_participants',
  'projets', 'projets_budget',
  'actualites', 'actualites_prefs', 'notifications',
  'conges', 'demandes_recup',
  'reservations_vehicules',
  'pij_accueils', 'pij_dossiers', 'pij_rdv', 'pij_missions',
  'audit_log', 'login_attempts', 'password_reset_tokens',
  'monitoring_events', 'monitoring_alerts'
]) AS t
WHERE to_regclass('public.' || t) IS NOT NULL;

\echo ''
\echo '── Lignes présentes AVANT ─────────────────────────────'
DO $$
DECLARE r RECORD; n BIGINT;
BEGIN
  FOR r IN SELECT nom FROM _a_vider ORDER BY nom LOOP
    EXECUTE format('SELECT count(*) FROM %I', r.nom) INTO n;
    RAISE NOTICE '  % : %', rpad(r.nom, 24), n;
  END LOOP;
END $$;

SELECT 'TRUNCATE TABLE ' || string_agg(format('%I', nom), ', ' ORDER BY nom)
       || ' RESTART IDENTITY' AS ordre_truncate
  FROM _a_vider \gset
:ordre_truncate;

\echo ''
\echo '── Comptes animateurs supprimés ───────────────────────'
DO $$
DECLARE n BIGINT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM animateurs
                  WHERE role IN ('admin', 'superadmin') AND statut = 'actif') THEN
    RAISE EXCEPTION 'Aucun compte admin/superadmin actif : plus personne ne pourrait se connecter. Annulation.';
  END IF;
  DELETE FROM animateurs WHERE role IS DISTINCT FROM 'admin' AND role IS DISTINCT FROM 'superadmin';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '  % compte(s) supprimé(s)', n;
END $$;

\echo ''
\echo '── Conservé ───────────────────────────────────────────'
SELECT username AS compte_conserve, prenom, nom, role, statut
  FROM animateurs ORDER BY role, username;
SELECT (SELECT count(*) FROM espaces) AS espaces,
       (SELECT count(*) FROM tenants) AS tenants;

\echo '── Contrôle APRÈS (doit être 0 partout) ───────────────'
DO $$
DECLARE r RECORD; n BIGINT; reste BIGINT := 0;
BEGIN
  FOR r IN SELECT nom FROM _a_vider LOOP
    EXECUTE format('SELECT count(*) FROM %I', r.nom) INTO n;
    reste := reste + n;
  END LOOP;
  IF reste <> 0 THEN
    RAISE EXCEPTION 'Il reste % ligne(s) après la remise à zéro : annulation.', reste;
  END IF;
  IF EXISTS (SELECT 1 FROM animateurs WHERE role NOT IN ('admin', 'superadmin') OR role IS NULL) THEN
    RAISE EXCEPTION 'Il reste des comptes non administrateurs : annulation.';
  END IF;
  RAISE NOTICE '  OK : toutes les tables vidées.';
END $$;

\if :reel
  COMMIT;
  \echo ''
  \echo '✅ REMISE À ZÉRO EFFECTUÉE (COMMIT).'
\else
  ROLLBACK;
  \echo ''
  \echo 'ℹ️  SIMULATION seulement : rien n''a été modifié (ROLLBACK).'
  \echo '   Pour exécuter réellement : -v confirmation=REMISE-A-ZERO'
\endif
