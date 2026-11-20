-- ═══════════════════════════════════════════════════════════════════════════
-- Migration : date de fin de contrat des animateurs
-- Date      : 2026-07-30
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CONTEXTE
-- Le champ « Date de fin de contrat » était saisissable dans deux formulaires
-- (AnimateursClient et FicheAnimateurClient) et le tableau de bord admin
-- affiche un encart « Contrats arrivant à échéance » alimenté par
-- lib/dashboardAlerts.ts (anim.dateFinContrat).
--
-- Or la colonne n'existait PAS en base : la saisie était silencieusement jetée
-- (modifierAnimateur ne listait pas le champ, l'INSERT ne le mentionnait pas)
-- et l'encart du dashboard ne s'est donc JAMAIS affiché.
--
-- Cette migration ajoute la colonne manquante et rattrape au passage trois
-- colonnes présentes en production mais absentes de init-db.sql et de toute
-- migration (ajoutées à la main sur le serveur) : une installation neuve à
-- partir de init-db.sql aurait échoué dès la création d'un animateur, car
-- creerAnimateur écrit dans telephone / date_naissance / adresse.
--
-- Idempotent (IF NOT EXISTS) : sans effet sur les colonnes déjà en place.
-- ═══════════════════════════════════════════════════════════════════════════

-- Colonne réellement nouvelle
ALTER TABLE animateurs ADD COLUMN IF NOT EXISTS date_fin_contrat DATE;

-- Rattrapage de la dérive schéma prod ↔ init-db.sql
ALTER TABLE animateurs ADD COLUMN IF NOT EXISTS telephone      TEXT;
ALTER TABLE animateurs ADD COLUMN IF NOT EXISTS date_naissance DATE;
ALTER TABLE animateurs ADD COLUMN IF NOT EXISTS adresse        TEXT;

-- Vérification
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'animateurs'
  AND column_name IN ('date_fin_contrat', 'telephone', 'date_naissance', 'adresse')
ORDER BY column_name;
