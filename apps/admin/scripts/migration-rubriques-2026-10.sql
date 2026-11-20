-- ─────────────────────────────────────────────────────────────────────────────
--  Migration : rubriques du menu latéral accordées compte par compte (2026-10)
--  Idempotent : peut être rejoué sans effet.
--
--  animateurs.rubriques : identifiants des entrées du menu latéral que le
--  compte peut voir ET ouvrir (pages, routes API, server actions), parmi les
--  entrées de son rôle (voir src/lib/rubriques.ts).
--    - NULL  = accès complet au menu de son rôle. C'est la valeur de tous les
--              comptes existants : un admin garde tout, un animateur garde son
--              menu actuel. Un compte créé « tout coché » par un admin complet
--              reçoit aussi NULL (et donc les rubriques ajoutées plus tard).
--    - liste = seules ces rubriques ; le Tableau de bord (et « Mon profil »
--              chez les animateurs) reste toujours accessible.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE animateurs ADD COLUMN IF NOT EXISTS rubriques TEXT[];

-- animateurs.gere_droits : le compte qui règle les droits des autres (rôle et
-- rubriques). Les autres admins ayant la rubrique « Animateurs » créent et
-- modifient les fiches, sans toucher aux droits. La marque ne se pose qu'ici,
-- en base : aucun écran ne permet de la donner ou de la retirer.
ALTER TABLE animateurs ADD COLUMN IF NOT EXISTS gere_droits BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE animateurs SET gere_droits = TRUE
 WHERE username = 'xavier.gerinette' AND tenant_id = 'nogent' AND NOT gere_droits;
