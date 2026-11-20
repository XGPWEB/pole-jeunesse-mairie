import { estDateCivile, normaliserHeure } from '@/lib/dates';

/**
 * Validation d'une demande de réservation de véhicule (audit 2026-10-07, A3).
 *
 * La route ne contrôlait que la présence de trois champs : un retour la veille
 * du départ, ou à 9 h pour un départ à 18 h le même jour, était enregistré.
 * La détection des conflits suppose pourtant des intervalles bien orientés.
 *
 * Règles :
 *   - dates civiles réelles, fin ≥ début (fin absente = même jour) ;
 *   - heures au format HH:MM, normalisées ;
 *   - heure de retour FACULTATIVE (véhicule gardé jusqu'à la fin de journée) ;
 *   - sur une réservation d'un seul jour, le retour est après le départ ;
 *   - sur plusieurs jours, les heures ne sont pas comparées entre elles
 *     (départ 18 h lundi, retour 9 h mardi est légitime).
 * Les mêmes invariants sont posés en base (migration-reservations-espaces-2026-10.sql).
 */
export interface ReservationValidee {
  dateDebut: string;
  dateFin: string;
  heureDepart: string;
  /** Chaîne vide quand le retour n'est pas renseigné (convention de la table). */
  heureRetour: string;
  motif: string;
}

export const MOTIF_MAX = 500;

const vide = (v: unknown) => v === undefined || v === null || v === '';

export function validerReservation(corps: unknown): { ok: true; reservation: ReservationValidee } | { ok: false; erreur: string } {
  const c = (typeof corps === 'object' && corps !== null ? corps : {}) as Record<string, unknown>;
  const refus = (erreur: string) => ({ ok: false as const, erreur });

  if (vide(c.dateDebut) || vide(c.heureDepart) || typeof c.motif !== 'string' || !c.motif.trim()) {
    return refus('Champs obligatoires manquants');
  }
  if (!estDateCivile(c.dateDebut)) return refus('Date de départ invalide (format attendu : AAAA-MM-JJ).');
  const dateDebut = c.dateDebut;
  const dateFin = vide(c.dateFin) ? dateDebut : c.dateFin;
  if (!estDateCivile(dateFin)) return refus('Date de retour invalide (format attendu : AAAA-MM-JJ).');
  if (dateFin < dateDebut) return refus('La date de retour ne peut pas précéder la date de départ.');

  const heureDepart = normaliserHeure(c.heureDepart);
  if (!heureDepart) return refus('Heure de départ invalide (format attendu : HH:MM).');
  let heureRetour = '';
  if (!vide(c.heureRetour)) {
    const h = normaliserHeure(c.heureRetour);
    if (!h) return refus('Heure de retour invalide (format attendu : HH:MM).');
    heureRetour = h;
  }
  if (dateFin === dateDebut && heureRetour && heureRetour <= heureDepart) {
    return refus('L\'heure de retour doit être après l\'heure de départ.');
  }

  const motif = c.motif.trim();
  if (motif.length > MOTIF_MAX) return refus(`Motif trop long (${MOTIF_MAX} caractères maximum).`);

  return { ok: true, reservation: { dateDebut, dateFin, heureDepart, heureRetour, motif } };
}
