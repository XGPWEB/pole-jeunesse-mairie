-- ─────────────────────────────────────────────────────────────────────────────
--  Diagnostic EN LECTURE SEULE — pièces « fiche AGORA » déjà enregistrées
--  (audit du 2026-10-07, constat A1)
--
--  Avant le contrôle serveur, une requête fabriquée pouvait enregistrer autre
--  chose qu'un PDF ou une image. L'application ne les affiche plus (elles
--  partent en téléchargement opaque), mais il est utile de savoir s'il en
--  existe. Ce script ne modifie rien et n'affiche aucun contenu de pièce.
--
--    psql "$DATABASE_URL" -f apps/admin/scripts/diagnostic-fiches-agora-2026-10.sql
--
--  Le type listé est celui ANNONCÉ à l'enregistrement, pas le contenu réel :
--  une ligne « application/pdf » peut cacher autre chose. L'application, elle,
--  juge sur le contenu. Tout type hors des quatre attendus mérite un regard.
-- ─────────────────────────────────────────────────────────────────────────────

\echo '== Pièces AGORA par commune et par type annoncé =='
SELECT tenant_id,
       CASE WHEN fiche_agora LIKE 'data:%' THEN split_part(substr(fiche_agora, 6, 80), ';', 1) ELSE '(pas une data URI)' END AS type_annonce,
       COUNT(*) AS pieces,
       pg_size_pretty(SUM(length(fiche_agora))::bigint) AS volume_base64
FROM jeunes
WHERE fiche_agora IS NOT NULL
GROUP BY 1, 2
ORDER BY 1, 2;

\echo '== Pièces dont le type annoncé n''est ni PDF, ni PNG, ni JPEG, ni WEBP (identifiants seulement) =='
SELECT tenant_id, id AS jeune_id, fiche_agora_nom AS nom_fichier,
       CASE WHEN fiche_agora LIKE 'data:%' THEN split_part(substr(fiche_agora, 6, 80), ';', 1) ELSE '(pas une data URI)' END AS type_annonce
FROM jeunes
WHERE fiche_agora IS NOT NULL
  AND fiche_agora !~ '^data:(application/pdf|image/png|image/jpeg|image/webp);base64,'
ORDER BY 1, 2;

\echo '== Pièces de plus de 5 Mo (base64 > 6 990 508 caractères) =='
SELECT tenant_id, id AS jeune_id, pg_size_pretty(length(fiche_agora)::bigint) AS taille_base64
FROM jeunes
WHERE length(fiche_agora) > 6990508
ORDER BY 1, 2;
