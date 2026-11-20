-- ─────────────────────────────────────────────────────────────────────────────
--  Diagnostic EN LECTURE SEULE — audit du 2026-10-07, constats A3 et A4
--
--  À lire AVANT d'appliquer scripts/migration-reservations-espaces-2026-10.sql : il montre
--  les lignes existantes que les nouvelles contraintes refuseraient. La
--  transaction est READ ONLY : ce script ne peut rien écrire.
--
--    psql "$DATABASE_URL" -f apps/admin/scripts/diagnostic-reservations-espaces-2026-10.sql
--
--  Tous les tableaux vides = la migration validera toutes ses contraintes.
--  Sinon la migration s'applique quand même (contraintes NOT VALID) et les
--  lignes listées restent à corriger à la main. Seuls des identifiants sont
--  affichés, jamais de nom de jeune.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN TRANSACTION READ ONLY;

\echo '== A3 — réservations de véhicules : date de retour avant la date de départ =='
SELECT tenant_id, id, statut, date_debut, date_fin
FROM reservations_vehicules
WHERE date_fin < date_debut
ORDER BY 1, 4;

\echo '== A3 — heure de départ absente ou hors format HH:MM =='
SELECT tenant_id, id, statut, date_debut, heure_depart
FROM reservations_vehicules
WHERE heure_depart IS NULL OR heure_depart !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
ORDER BY 1, 4;

\echo '== A3 — heure de retour renseignée mais hors format HH:MM =='
SELECT tenant_id, id, statut, date_debut, heure_retour
FROM reservations_vehicules
WHERE COALESCE(heure_retour, '') <> '' AND heure_retour !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
ORDER BY 1, 4;

\echo '== A3 — réservation d''un seul jour dont le retour n''est pas après le départ =='
SELECT tenant_id, id, statut, date_debut, heure_depart, heure_retour
FROM reservations_vehicules
WHERE date_debut = date_fin AND COALESCE(heure_retour, '') <> '' AND heure_retour <= heure_depart
ORDER BY 1, 4;

\echo '== A4 — jeunes rattachés à l''espace d''une AUTRE commune (identifiants seulement) =='
SELECT j.tenant_id AS commune_du_jeune, j.id AS jeune_id, j.espace_id, e.tenant_id AS commune_de_l_espace
FROM jeunes j
JOIN espaces e ON e.id = j.espace_id
WHERE e.tenant_id <> j.tenant_id
ORDER BY 1, 2;

\echo '== A4 — pour information : mêmes références croisées dans les autres tables (non traitées par la migration) =='
SELECT 'activites' AS table_concernee, a.tenant_id AS commune, COUNT(*) AS lignes
  FROM activites a JOIN espaces e ON e.id = a.espace_id WHERE e.tenant_id <> a.tenant_id GROUP BY 1, 2
UNION ALL
SELECT 'sorties', s.tenant_id, COUNT(*)
  FROM sorties s JOIN espaces e ON e.id = s.espace_id WHERE e.tenant_id <> s.tenant_id GROUP BY 1, 2
UNION ALL
SELECT 'actualites', a.tenant_id, COUNT(*)
  FROM actualites a JOIN espaces e ON e.id = a.espace_id WHERE e.tenant_id <> a.tenant_id GROUP BY 1, 2
UNION ALL
SELECT 'inscriptions', i.tenant_id, COUNT(*)
  FROM inscriptions i JOIN espaces e ON e.id = i.espace_id WHERE e.tenant_id <> i.tenant_id GROUP BY 1, 2
ORDER BY 1, 2;

\echo '== Espaces par commune (référence pour l''import CSV et le formulaire) =='
SELECT tenant_id, id, nom FROM espaces ORDER BY 1, 2;

COMMIT;
