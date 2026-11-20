import { query, queryOne } from '@/lib/db';

/**
 * Fiche de terrain d'UN jeune, telle que servie à l'application mobile par
 * `GET /api/jeunes/[id]/fiche` (revue R4).
 *
 * Minimisation : uniquement ce que l'écran de terrain affiche — identité déjà
 * présente dans la liste, contacts familiaux (nom, lien, téléphone),
 * autorisations et observations. Volontairement ABSENTS : fiche Agora
 * (`fiche_agora*`), adresse postale, e-mail des contacts, sexe, établissement,
 * classe, identifiant de commune et colonnes techniques.
 *
 * Cloisonnement : toute lecture est bornée par `tenant_id`. `jeunes_contacts`
 * n'a pas de colonne `tenant_id` : ses lignes ne sont lues qu'à travers une
 * jointure sur le jeune parent, lui-même filtré par commune.
 *
 * Périmètre animateur : identique au web. La fiche web d'un animateur
 * (`app/(animateur)/animateur/jeunes/[id]/page.tsx`) ne filtre que par
 * commune, pas par espace assigné ; cette lecture fait de même.
 */

export interface ContactFiche {
  nom: string;
  lien: string;
  telephone: string;
}

export interface FicheJeune {
  id: string;
  nom: string;
  prenom: string;
  /** Date civile AAAA-MM-JJ, ou null si non renseignée. */
  dateNaissance: string | null;
  espaceId: string | null;
  secteur: string;
  contacts: ContactFiche[];
  autorisations: {
    sortie: boolean;
    photo: boolean;
    soinsBenins: boolean;
  };
  observations: string;
}

interface LigneJeune {
  id: string;
  nom: string;
  prenom: string;
  dateNaissance: string | null;
  espaceId: string | null;
  secteur: string;
  observations: string;
  sortie: boolean;
  photo: boolean;
  soinsBenins: boolean;
}

/**
 * Rend la fiche du jeune `id` s'il appartient à la commune `tenantId`, sinon
 * `null` — sans distinguer « inexistant » de « autre commune ».
 */
export async function lireFicheJeune(tenantId: string, id: string): Promise<FicheJeune | null> {
  const jeune = await queryOne<LigneJeune>(
    `SELECT id, nom, prenom,
            date_naissance::text AS "dateNaissance",
            espace_id AS "espaceId",
            COALESCE(secteur, '') AS secteur,
            COALESCE(observations, '') AS observations,
            COALESCE(autorisation_sortie, FALSE) AS sortie,
            COALESCE(autorisation_photo, FALSE) AS photo,
            COALESCE(autorisation_soins_benins, FALSE) AS "soinsBenins"
       FROM jeunes
      WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId],
  );
  if (!jeune) return null;

  const contacts = await query<ContactFiche>(
    `SELECT COALESCE(jc.nom, '') AS nom,
            COALESCE(jc.lien, '') AS lien,
            COALESCE(jc.telephone, '') AS telephone
       FROM jeunes_contacts jc
       JOIN jeunes j ON j.id = jc.jeune_id
      WHERE jc.jeune_id = $1 AND j.tenant_id = $2
      ORDER BY jc.id`,
    [id, tenantId],
  );

  return {
    id: jeune.id,
    nom: jeune.nom,
    prenom: jeune.prenom,
    dateNaissance: jeune.dateNaissance,
    espaceId: jeune.espaceId,
    secteur: jeune.secteur,
    contacts: contacts.map((c) => ({ nom: c.nom, lien: c.lien, telephone: c.telephone })),
    autorisations: { sortie: jeune.sortie, photo: jeune.photo, soinsBenins: jeune.soinsBenins },
    observations: jeune.observations,
  };
}
