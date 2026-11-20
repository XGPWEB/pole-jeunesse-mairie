/**
 * dashboardAlerts.ts — Calcul des alertes anniversaires et fin de contrat
 */

export interface BirthdayAlert {
  animateurId: string;
  prenom: string;
  nom: string;
  age: number;
}

export interface ContractAlert {
  animateurId: string;
  prenom: string;
  nom: string;
  dateFinContrat: string;
  joursRestants: number;
}

export interface DashboardAlerts {
  birthdays: BirthdayAlert[];
  contractAlerts: ContractAlert[];
}

/**
 * Vérifie si la date donnée correspond à l'anniversaire (même jour + mois)
 */
function isBirthdayToday(dateNaissance: string, today: Date): boolean {
  if (!dateNaissance) return false;
  const birth = new Date(dateNaissance + 'T00:00:00');
  return birth.getDate() === today.getDate() && birth.getMonth() === today.getMonth();
}

/**
 * Calcule l'âge en années
 */
function computeAge(dateNaissance: string, today: Date): number {
  const birth = new Date(dateNaissance + 'T00:00:00');
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

/**
 * Calcule les alertes pour le tableau de bord.
 * @param animateurs Liste des animateurs (depuis animateurs.json)
 * @param today Date du jour
 * @param contractWarningDays Nombre de jours d'avertissement avant expiration du contrat (défaut 45)
 */
export function computeDashboardAlerts(
  animateurs: any[],
  today: Date = new Date(),
  contractWarningDays: number = 45,
): DashboardAlerts {
  const birthdays: BirthdayAlert[] = [];
  const contractAlerts: ContractAlert[] = [];

  for (const anim of animateurs) {
    // Anniversaires
    if (anim.dateNaissance && isBirthdayToday(anim.dateNaissance, today)) {
      birthdays.push({
        animateurId: anim.id,
        prenom: anim.prenom,
        nom: anim.nom,
        age: computeAge(anim.dateNaissance, today),
      });
    }

    // Alertes fin de contrat
    if (anim.dateFinContrat) {
      const fin = new Date(anim.dateFinContrat + 'T00:00:00');
      const diffMs = fin.getTime() - today.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays >= 0 && diffDays <= contractWarningDays) {
        contractAlerts.push({
          animateurId: anim.id,
          prenom: anim.prenom,
          nom: anim.nom,
          dateFinContrat: anim.dateFinContrat,
          joursRestants: diffDays,
        });
      }
    }
  }

  // Tri : contrats les plus urgents en premier
  contractAlerts.sort((a, b) => a.joursRestants - b.joursRestants);

  return { birthdays, contractAlerts };
}

/**
 * Formate une date en français lisible
 */
export function formatDateFr(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
