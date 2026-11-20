/**
 * Aucun hook d'inscriptions côté mobile pour l'instant.
 *
 * L'ancienne version lisait data/inscriptions.json et « Mes inscriptions »
 * affichait celles d'un jeune fixe. Le backend ne connaît aucune identité
 * jeune/famille (seule la table `animateurs` porte des comptes) : il n'existe
 * donc pas d'inscriptions « de l'utilisateur » à charger. Voir
 * app/(jeune)/mes-inscriptions.tsx.
 */
export {};
