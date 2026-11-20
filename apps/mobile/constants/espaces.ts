import { Espace } from '@/types';

/**
 * Présentation institutionnelle des espaces du Pôle Jeunesse (nom, adresse,
 * horaires, tranche d'âge). Contenu public et statique, sans donnée
 * personnelle : il ne remplace aucune donnée du backend.
 */
export const ESPACES: Espace[] = [
  {
    id: 'collegiens',
    nom: 'Espace Collégiens',
    description: 'Accueil collectif de mineurs municipal pour les jeunes de 10 à 14 ans. Zones thématiques : jeux, activités manuelles, lecture, coin détente. Co-construction de la programmation avec les jeunes.',
    trancheAge: '10–14 ans',
    adresse: '122 rue de Coulmiers, 94130 Nogent-sur-Marne',
    horaires: 'Lun/Mar/Jeu/Ven : 15h30–19h | Mer/Sam : 13h30–19h',
    couleur: '#4A90D9',
    icon: 'school',
    capacite: 40,
  },
  {
    id: 'lyceens',
    nom: 'Espace Lycéens',
    description: 'Espace dédié aux lycéens de 15 à 17 ans : expression personnelle, débat citoyen, engagement. Ateliers créatifs (musique, vidéo, écriture), préparations aux oraux, actions solidaires et sorties culturelles.',
    trancheAge: '15–17 ans',
    adresse: '68 rue de Plaisance, 94130 Nogent-sur-Marne',
    horaires: 'Lun/Mar/Jeu/Ven : 15h30–19h | Mer/Sam : 13h30–19h',
    couleur: '#8B5CF6',
    icon: 'book',
    capacite: 30,
  },
  {
    id: 'pij',
    nom: 'PIJ — Point Information Jeunesse',
    description: 'Accueil libre, gratuit, anonyme et neutre pour les 16-25 ans. Orientation, formation, emploi, logement, santé, mobilité européenne et engagement citoyen. Labellisé Information Jeunesse par l\'État.',
    trancheAge: '16–25 ans',
    adresse: '68 rue de Plaisance, 94130 Nogent-sur-Marne',
    horaires: 'Lun–Ven : 10h–12h / 13h30–19h',
    couleur: '#F5A623',
    icon: 'information-circle',
    capacite: 15,
  },
  {
    id: 'clas',
    nom: 'CLAS — Accompagnement Scolaire',
    description: 'Contrat Local d\'Accompagnement à la Scolarité pour les 10-17 ans. Petits groupes encadrés par des professionnels, ressources numériques, partenariats culturels. Développement des méthodes de travail, autonomie et estime de soi.',
    trancheAge: '10–17 ans',
    adresse: '68 rue de Plaisance, 94130 Nogent-sur-Marne',
    horaires: 'Lun/Mar/Jeu : 17h–19h',
    couleur: '#27AE60',
    icon: 'library',
    capacite: 20,
  },
];
