-- ─────────────────────────────────────────────────────────────────────────────
--  Diagnostic EN LECTURE SEULE — contraintes de pointages non validées
--
--  migration-securite-2026-10.sql a créé deux clés étrangères composites en
--  NOT VALID, sans les valider :
--    fk_pointages_jeune_tenant     (tenant_id, jeune_id)    → jeunes(tenant_id, id)
--    fk_pointages_activite_tenant  (tenant_id, activite_id) → activites(tenant_id, id)
--
--  « NOT VALID » signifie que PostgreSQL n'a PAS vérifié les lignes qui
--  existaient déjà — pas qu'elles sont fausses. Toute écriture depuis est
--  contrôlée. Ce script dit ce qu'il en est des anciennes lignes.
--
--    psql "$DATABASE_URL" -f apps/admin/scripts/diagnostic-pointages-fk-2026-10.sql
--
--  Transaction READ ONLY : il ne peut rien écrire. Il n'affiche que des
--  identifiants techniques et des dates, jamais de nom.
--
--  Lecture du résultat :
--    • les deux compteurs à 0  → aucune ligne incohérente : les contraintes
--      peuvent être validées telles quelles (commandes en fin de fichier) ;
--    • sinon → les lignes listées sont à arbitrer une par une. Rien n'est
--      corrigé ici.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN TRANSACTION READ ONLY;

\echo '== État des deux contraintes =='
SELECT conname AS contrainte,
       CASE WHEN convalidated THEN 'validée' ELSE 'NON validée' END AS etat
FROM pg_constraint
WHERE conname IN ('fk_pointages_jeune_tenant', 'fk_pointages_activite_tenant')
ORDER BY 1;

\echo '== Volume concerné =='
SELECT count(*) AS pointages,
       count(jeune_id) AS avec_jeune,
       count(activite_id) AS avec_activite
FROM pointages;

\echo '== Lignes qui violeraient fk_pointages_jeune_tenant (compteur) =='
SELECT count(*) AS violations_jeune
FROM pointages p
WHERE p.jeune_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM jeunes j WHERE j.id = p.jeune_id AND j.tenant_id = p.tenant_id);

\echo '== Détail (identifiants seulement) : le jeune est-il absent, ou dans une autre commune ? =='
SELECT p.id AS pointage_id, p.tenant_id AS commune_du_pointage, p.date, p.jeune_id,
       CASE WHEN j.id IS NULL THEN 'jeune inexistant (fiche supprimée ?)'
            ELSE 'jeune d''une autre commune : ' || j.tenant_id END AS cas
FROM pointages p
LEFT JOIN jeunes j ON j.id = p.jeune_id
WHERE p.jeune_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM jeunes j2 WHERE j2.id = p.jeune_id AND j2.tenant_id = p.tenant_id)
ORDER BY p.tenant_id, p.date, p.id
LIMIT 200;

\echo '== Lignes qui violeraient fk_pointages_activite_tenant (compteur) =='
SELECT count(*) AS violations_activite
FROM pointages p
WHERE p.activite_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM activites a WHERE a.id = p.activite_id AND a.tenant_id = p.tenant_id);

\echo '== Détail (identifiants seulement) : l''activité est-elle absente, ou dans une autre commune ? =='
SELECT p.id AS pointage_id, p.tenant_id AS commune_du_pointage, p.date, p.activite_id,
       CASE WHEN a.id IS NULL THEN 'activité inexistante (supprimée ?)'
            ELSE 'activité d''une autre commune : ' || a.tenant_id END AS cas
FROM pointages p
LEFT JOIN activites a ON a.id = p.activite_id
WHERE p.activite_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM activites a2 WHERE a2.id = p.activite_id AND a2.tenant_id = p.tenant_id)
ORDER BY p.tenant_id, p.date, p.id
LIMIT 200;

COMMIT;

-- ── Si, et seulement si, les deux compteurs valent 0 ─────────────────────────
-- À lancer hors de ce fichier, après accord :
--
--   ALTER TABLE pointages VALIDATE CONSTRAINT fk_pointages_jeune_tenant;
--   ALTER TABLE pointages VALIDATE CONSTRAINT fk_pointages_activite_tenant;
--
-- Effet : PostgreSQL relit toute la table pointages une fois par contrainte.
-- Verrous : SHARE UPDATE EXCLUSIVE sur pointages et ROW SHARE sur la table
-- référencée. Les lectures ET les écritures de l'application continuent
-- pendant la validation ; seules d'autres modifications de structure ou un
-- VACUUM FULL attendraient. Aucune donnée n'est modifiée. Si une ligne viole la
-- contrainte, la commande échoue sans rien changer.
-- Retour arrière : inutile (la contrainte existait déjà) ; on ne peut pas
-- « dé-valider », mais la contrainte valait déjà pour toute nouvelle écriture.
