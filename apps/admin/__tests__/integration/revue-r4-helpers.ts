import { randomUUID } from 'crypto';
import pool from '@/lib/db';

/**
 * Jeux de données de la revue R4 (fiche détaillée d'un jeune pour le mobile).
 * Complète helpers.ts et securite-helpers.ts sans les modifier.
 * Toutes les identités sont fabriquées : aucune personne réelle.
 */

export interface JeuneComplet {
  tenantId: string;
  espaceId?: string | null;
  nom?: string;
  prenom?: string;
  dateNaissance?: string | null;
  secteur?: string | null;
  observations?: string | null;
  autorisationSortie?: boolean | null;
  autorisationPhoto?: boolean | null;
  autorisationSoinsBenins?: boolean | null;
}

/** Valeurs sentinelles des colonnes qui ne doivent JAMAIS sortir par la fiche mobile. */
export const SECRETS = {
  adresse: 'SECRET-ADRESSE 99 impasse Fictive',
  ficheAgora: 'data:application/pdf;base64,U0VDUkVULUFHT1JB',
  ficheAgoraNom: 'SECRET-AGORA-NOM.pdf',
  etablissement: 'SECRET-ETABLISSEMENT',
  classe: 'SECRET-CLASSE',
  sexe: 'SECRET-SEXE',
  emailContact: 'secret-contact@exemple.test',
} as const;

/** Jeune dont toutes les colonnes sont renseignées, y compris celles à ne pas exposer. */
export async function seedJeuneComplet(o: JeuneComplet): Promise<string> {
  const id = `j-${randomUUID()}`;
  const ou = <T,>(v: T | undefined, defaut: T): T => (v === undefined ? defaut : v);
  await pool.query(
    `INSERT INTO jeunes (id, nom, prenom, date_naissance, sexe, secteur, espace_id, etablissement, classe,
                         observations, autorisation_sortie, autorisation_photo, autorisation_soins_benins,
                         adresse, fiche_agora, fiche_agora_nom, tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [
      id, o.nom ?? 'TESTELLE', o.prenom ?? 'Alix', ou(o.dateNaissance, '2012-03-04'), SECRETS.sexe,
      ou(o.secteur, 'Centre'), o.espaceId ?? null, SECRETS.etablissement, SECRETS.classe,
      ou(o.observations, 'Allergie fictive aux arachides.'),
      ou(o.autorisationSortie, true), ou(o.autorisationPhoto, false), ou(o.autorisationSoinsBenins, true),
      SECRETS.adresse, SECRETS.ficheAgora, SECRETS.ficheAgoraNom, o.tenantId,
    ],
  );
  return id;
}

export async function seedContact(
  jeuneId: string,
  c: { nom?: string | null; lien?: string | null; telephone?: string | null; email?: string | null },
): Promise<void> {
  await pool.query(
    `INSERT INTO jeunes_contacts (jeune_id, nom, lien, telephone, email) VALUES ($1, $2, $3, $4, $5)`,
    [jeuneId, c.nom ?? null, c.lien ?? null, c.telephone ?? null, c.email === undefined ? SECRETS.emailContact : c.email],
  );
}

export async function nombreAudits(): Promise<number> {
  const { rows } = await pool.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM audit_log');
  return rows[0].n;
}
