import type { PoolClient } from 'pg';
import { createHash, randomUUID } from 'crypto';
import pool from '@/lib/db';
import { LIBELLE_REPRISE_HEURES, type AccueilPijSaisie, type DossierPijSaisie } from '@/lib/pij';
import type { RdvPij, RdvPijSaisie } from '@/lib/pij-agenda';

/**
 * Écritures du module PIJ partagées par la saisie (/api/pij/accueils,
 * /api/pij/dossiers) et par l'import du tableur (/api/pij/import) : une seule
 * liste de colonnes, donc pas de dérive entre les deux chemins.
 *
 * Les valeurs sont celles rendues par `validerAccueil` / `validerDossier`.
 */
type Executeur = Pick<PoolClient, 'query'>;

export const parametresAccueil = (v: AccueilPijSaisie) => [
  v.dateVisite, v.nom, v.prenom, v.dateNaissance, v.sexe, v.adresse, v.codePostal, v.commune,
  v.quartier, v.email, v.telephone, v.objets, v.objetPrecision, v.prochainRdv, v.remarques,
  v.orientations, v.suivi, v.etat,
];

export const parametresDossier = (v: DossierPijSaisie) => [
  v.nom, v.prenom, v.dateNaissance, v.telephone, v.dateRef, v.objet, v.horaire, v.prochainRdv,
  v.remarques, v.organisme, v.montant, v.heuresARealiser, v.heuresRealisees, v.missions, v.etat,
];

export async function insererAccueil(
  v: AccueilPijSaisie, tenantId: string, auteurId: string, executeur: Executeur = pool,
): Promise<string> {
  const id = `pij-acc-${randomUUID()}`;
  await executeur.query(`
    INSERT INTO pij_accueils (
      id, tenant_id, created_by,
      date_visite, nom, prenom, date_naissance, sexe, adresse, code_postal, commune,
      quartier, email, telephone, objets, objet_precision, prochain_rdv, remarques,
      orientations, suivi, etat
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
  `, [id, tenantId, auteurId, ...parametresAccueil(v)]);
  return id;
}

export async function insererDossier(
  v: DossierPijSaisie, tenantId: string, auteurId: string, executeur: Executeur = pool,
): Promise<string> {
  const id = `pij-dos-${randomUUID()}`;
  // Un permis créé avec des heures déjà réalisées (import du tableur) ouvre son
  // journal par une ligne de reprise, dans la MÊME instruction : le total du
  // dossier et son journal ne peuvent pas diverger.
  await executeur.query(`
    WITH d AS (
      INSERT INTO pij_dossiers (
        id, tenant_id, created_by, type,
        nom, prenom, date_naissance, telephone, date_ref, objet, horaire, prochain_rdv,
        remarques, organisme, montant, heures_a_realiser, heures_realisees, missions, etat
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING id, tenant_id, created_by, type, date_ref, heures_realisees, missions
    )
    INSERT INTO pij_missions (id, tenant_id, dossier_id, date, libelle, heures, created_by)
    SELECT $20, d.tenant_id, d.id, COALESCE(d.date_ref, CURRENT_DATE),
           COALESCE(NULLIF(TRIM(d.missions), ''), $21), LEAST(d.heures_realisees, 999.99), d.created_by
    FROM d
    WHERE d.type = 'permis' AND d.heures_realisees > 0
  `, [id, tenantId, auteurId, v.type, ...parametresDossier(v), `pij-mis-${randomUUID()}`, LIBELLE_REPRISE_HEURES]);
  return id;
}

/** Lecture d'un rendez-vous, partagée par /api/pij/rdv et le flux iCalendar. */
export const SELECT_RDV = `
  SELECT r.id,
         r.date::text       AS date,
         r.heure,
         r.duree_minutes    AS "dureeMinutes",
         r.nom, r.prenom, r.telephone, r.objet, r.lieu, r.notes, r.statut,
         r.accueil_id       AS "accueilId",
         NULLIF(TRIM(COALESCE(a.prenom, '') || ' ' || COALESCE(a.nom, '')), '') AS "creePar",
         r.updated_at       AS "modifieLe",
         r.hub_id           AS "hubId"
  FROM pij_rdv r
  LEFT JOIN animateurs a ON a.id = r.created_by AND a.tenant_id = r.tenant_id
`;

/**
 * Rendez-vous non annulé de la commune qui chevauche `v` le même jour
 * (bornes [début, fin)), hors `idExclu` ; null s'il n'y en a pas. Les
 * rendez-vous recopiés de LE HUB comptent : une seule personne reçoit.
 *
 * À appeler dans la transaction de l'écriture, après `verrouillerAgendaPij` :
 * sinon deux saisies simultanées passeraient toutes les deux le contrôle.
 */
export async function rdvEnChevauchement(
  executeur: Executeur, tenantId: string, v: Pick<RdvPijSaisie, 'date' | 'heure' | 'dureeMinutes'>, idExclu: string | null,
): Promise<Pick<RdvPij, 'heure' | 'dureeMinutes' | 'prenom' | 'nom'> | null> {
  const { rows } = await executeur.query(`
    SELECT heure, duree_minutes AS "dureeMinutes", prenom, nom
    FROM pij_rdv
    WHERE tenant_id = $1 AND date = $2 AND statut <> 'annule' AND id IS DISTINCT FROM $3
      AND (split_part(heure, ':', 1)::int * 60 + split_part(heure, ':', 2)::int) < $5
      AND $4 < (split_part(heure, ':', 1)::int * 60 + split_part(heure, ':', 2)::int) + duree_minutes
    ORDER BY heure
    LIMIT 1
  `, [tenantId, v.date, idExclu, minutes(v.heure), minutes(v.heure) + v.dureeMinutes]);
  return rows[0] ?? null;
}
const minutes = (heure: string) => Number(heure.slice(0, 2)) * 60 + Number(heure.slice(3, 5));

/** Sérialise les écritures de l'agenda PIJ d'une commune (fin de transaction = libération). */
export async function verrouillerAgendaPij(executeur: Executeur, tenantId: string): Promise<void> {
  await executeur.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pij_rdv:${tenantId}`]);
}

/** Empreinte d'un jeton d'abonnement : seule valeur stockée en base. */
export const empreinteJeton = (jeton: string) => createHash('sha256').update(jeton).digest('hex');
