-- ═══════════════════════════════════════════════════════════════════════════
--  Pôle Jeunesse — Diagnostic : participations de sortie sans jeune (LECTURE SEULE)
--
--  psql -v ON_ERROR_STOP=1 -d <base> -f scripts/diagnostic-participants-orphelins.sql
--
--  À lancer AVANT migration-participants-fk-2026-10.sql, qui refuse de
--  s'appliquer tant qu'une de ces lignes existe. Ce script ne modifie rien.
--
--  COMMENT TRAITER UNE LIGNE
--  Une participation orpheline désigne un jeune dont la fiche n'existe plus.
--   - « en attente »  : elle n'occupe aucune place ; la retirer ne change ni
--     l'effectif ni la file des autres.
--   - « CONFIRMÉ »    : elle occupe une place. La retirer libère cette place et
--     doit promouvoir le premier jeune en attente (colonne « premier en
--     attente »).
--  Dans les deux cas, retirer la ligne par l'APPLICATION et non par un DELETE
--  SQL : dans l'interface, ouvrir la sortie et retirer le participant, ou
--  appeler DELETE /api/sorties/participants avec { sortieId, jeuneId } en
--  étant connecté à la commune indiquée. Ce chemin prend le verrou de la
--  sortie et applique la promotion ; un DELETE SQL direct ne promeut personne.
--  Si la fiche a été supprimée par erreur, la recréer avec le même identifiant
--  est l'autre issue possible : c'est une décision métier.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN READ ONLY;

\echo '── Participations orphelines (jeune inexistant) ──'
SELECT s.tenant_id                                        AS commune,
       sp.sortie_id,
       s.titre                                            AS sortie,
       s.date::text                                       AS date_sortie,
       sp.jeune_id                                        AS jeune_inexistant,
       CASE WHEN sp.en_attente THEN 'en attente' ELSE 'CONFIRMÉ' END AS etat,
       s.capacite,
       (SELECT COUNT(*) FROM sorties_participants c
         WHERE c.sortie_id = sp.sortie_id AND NOT c.en_attente)      AS confirmes,
       (SELECT a.jeune_id FROM sorties_participants a
         WHERE a.sortie_id = sp.sortie_id AND a.en_attente
           AND EXISTS (SELECT 1 FROM jeunes j WHERE j.id = a.jeune_id)
         ORDER BY a.ordre LIMIT 1)                                   AS premier_en_attente
  FROM sorties_participants sp
  LEFT JOIN sorties s ON s.id = sp.sortie_id
 WHERE NOT EXISTS (SELECT 1 FROM jeunes j WHERE j.id = sp.jeune_id)
 ORDER BY s.tenant_id, s.date, sp.sortie_id, sp.ordre;

\echo '── Total ──'
SELECT COUNT(*) AS participations_orphelines
  FROM sorties_participants sp
 WHERE NOT EXISTS (SELECT 1 FROM jeunes j WHERE j.id = sp.jeune_id);

COMMIT;
