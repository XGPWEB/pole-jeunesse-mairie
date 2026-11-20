-- Migration espaces v2 — à exécuter une fois en production
-- Ajoute téléphone, email, statut sur la table espaces

ALTER TABLE espaces
  ADD COLUMN IF NOT EXISTS telephone TEXT,
  ADD COLUMN IF NOT EXISTS email     TEXT,
  ADD COLUMN IF NOT EXISTS statut    TEXT DEFAULT 'actif';

-- Marquer tous les espaces existants comme actifs
UPDATE espaces SET statut = 'actif' WHERE statut IS NULL;
