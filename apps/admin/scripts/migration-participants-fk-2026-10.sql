-- ═══════════════════════════════════════════════════════════════════════════
--  Pôle Jeunesse — Clé étrangère sorties_participants → jeunes (2026-10)
--
--  psql -v ON_ERROR_STOP=1 -d <base> -f scripts/migration-participants-fk-2026-10.sql
--
--  POURQUOI
--  `sorties_participants.jeune_id` n'avait aucune clé étrangère : rien, en
--  base, n'empêchait une participation de désigner un jeune supprimé. Le code
--  ferme désormais la fenêtre de concurrence (ajout à une sortie pendant la
--  suppression du jeune) par des verrous ; cette contrainte est le filet de
--  sécurité si un chemin d'écriture l'oubliait un jour.
--
--  ON DELETE RESTRICT — choix délibéré, PAS de CASCADE
--  Retirer un participant CONFIRMÉ libère une place : le premier de la liste
--  d'attente doit être promu (lib/sorties.ts, `retirerParticipant`). Un
--  ON DELETE CASCADE effacerait la participation en silence, sans promotion :
--  la place resterait vide alors qu'un jeune attend. Avec RESTRICT, la
--  suppression d'un jeune qui a encore des participations est REFUSÉE par la
--  base : le seul chemin possible est celui de l'application (supprimerJeune),
--  qui retire d'abord chaque participation en appliquant la promotion.
--
--  DONNÉES EXISTANTES
--  Aucune ligne n'est supprimée ni modifiée. Si des participations orphelines
--  existent déjà, la migration S'ARRÊTE AVANT TOUTE MODIFICATION en les
--  listant : les effacer d'office changerait des effectifs et des listes
--  d'attente sans décision humaine. Diagnostic détaillé et marche à suivre :
--  scripts/diagnostic-participants-orphelins.sql (lecture seule).
--
--  IDEMPOTENTE : rejouable sans effet. Indépendante des migrations sécurité et
--  intégrité 2026-10, mais à appliquer APRÈS elles (elle s'appuie sur la
--  colonne `ordre` pour présenter la file d'attente dans le diagnostic).
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  n       INTEGER;
  detail  TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_sorties_participants_jeune'
       AND conrelid = 'public.sorties_participants'::regclass
  ) THEN
    RAISE NOTICE 'fk_sorties_participants_jeune déjà présente : rien à faire.';
    RETURN;
  END IF;

  -- Verrou AVANT le contrôle : aucune participation ne peut être ajoutée ni
  -- aucun jeune supprimé entre la vérification et la pose de la contrainte.
  LOCK TABLE jeunes, sorties_participants IN SHARE ROW EXCLUSIVE MODE;

  SELECT COUNT(*) INTO n
    FROM sorties_participants sp
   WHERE NOT EXISTS (SELECT 1 FROM jeunes j WHERE j.id = sp.jeune_id);

  IF n > 0 THEN
    SELECT string_agg(
             format('sortie=%s jeune=%s %s', sp.sortie_id, sp.jeune_id,
                    CASE WHEN sp.en_attente THEN '(en attente)' ELSE '(CONFIRMÉ)' END),
             E'\n  ' ORDER BY sp.sortie_id, sp.jeune_id)
      INTO detail
      FROM (SELECT * FROM sorties_participants sp0
             WHERE NOT EXISTS (SELECT 1 FROM jeunes j WHERE j.id = sp0.jeune_id)
             ORDER BY sortie_id, jeune_id
             LIMIT 50) sp;
    RAISE EXCEPTION E'% participation(s) orpheline(s) (jeune inexistant) : migration interrompue, RIEN n''a été modifié.\n  %\n(50 premières au plus)', n, detail
      USING HINT = 'Lancer scripts/diagnostic-participants-orphelins.sql, traiter chaque ligne (voir ce fichier), puis rejouer la migration.';
  END IF;

  ALTER TABLE sorties_participants
    ADD CONSTRAINT fk_sorties_participants_jeune
    FOREIGN KEY (jeune_id) REFERENCES jeunes(id) ON DELETE RESTRICT;
END $$;

-- La clé primaire (sortie_id, jeune_id) ne sert pas les recherches par jeune
-- seul, que font la vérification de la contrainte et supprimerJeune.
CREATE INDEX IF NOT EXISTS idx_sorties_participants_jeune ON sorties_participants(jeune_id);

COMMIT;
