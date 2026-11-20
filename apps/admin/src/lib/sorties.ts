import type { PoolClient } from 'pg';

/**
 * Règles communes aux chemins qui retirent un participant d'une sortie :
 * DELETE /api/sorties/participants et la suppression d'un jeune
 * (jeunes/actions.ts).
 *
 * Elles vivaient dans la seule route participants. La suppression d'un jeune
 * effaçait ses participations sans prendre le verrou de la sortie ni promouvoir
 * la file d'attente : une place libérée restait inoccupée. Les réunir ici
 * garantit que les deux chemins prennent le MÊME verrou et appliquent la MÊME
 * règle de promotion, au lieu de deux copies qui finiraient par diverger.
 */

export interface SortieVerrouillee {
  /** 0 ou NULL = capacité illimitée (aucune liste d'attente). */
  capacite: number | null;
}

/**
 * Verrouille la sortie (du tenant) pour la durée de la transaction. C'est le
 * verrou COMMUN à l'ajout, au retrait et au changement de capacité : toute
 * décision fondée sur « combien de confirmés / qui est le premier en attente »
 * doit être prise après l'avoir obtenu. Ordre imposé partout : sortie PUIS
 * participants. Renvoie null si la sortie n'existe pas dans ce tenant.
 */
export async function verrouillerSortie(
  client: PoolClient,
  sortieId: string,
  tenantId: string,
): Promise<SortieVerrouillee | null> {
  const res = await client.query<SortieVerrouillee>(
    'SELECT capacite FROM sorties WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
    [sortieId, tenantId],
  );
  return res.rows[0] ?? null;
}

/**
 * Vérifie que le jeune existe dans le tenant ET le protège contre la
 * suppression jusqu'à la fin de la transaction. À appeler APRÈS
 * `verrouillerSortie` (ordre commun : sortie puis jeune) et avant d'insérer
 * une participation.
 *
 * FOR KEY SHARE : c'est le verrou que pose aussi la clé étrangère
 * sorties_participants → jeunes à l'INSERT. Il bloque la suppression de la
 * fiche (supprimerJeune prend FOR UPDATE puis DELETE) sans gêner les simples
 * modifications de la fiche ni les autres inscriptions du même jeune.
 * Si une suppression est en cours, on attend son issue : validée, la ligne a
 * disparu et la fonction renvoie false ; annulée, le jeune est toujours là.
 */
export async function verrouillerJeunePourParticipation(
  client: PoolClient,
  jeuneId: string,
  tenantId: string,
): Promise<boolean> {
  const res = await client.query(
    'SELECT 1 FROM jeunes WHERE id = $1 AND tenant_id = $2 FOR KEY SHARE',
    [jeuneId, tenantId],
  );
  return res.rows.length === 1;
}

/**
 * Retire un participant d'une sortie DÉJÀ verrouillée par `verrouillerSortie`
 * (ce qui a aussi établi qu'elle appartient au tenant : la table
 * `sorties_participants` n'a pas de colonne tenant) et applique la promotion.
 *
 * Renvoie false si le jeune n'était pas inscrit : rien n'a alors été modifié.
 */
export async function retirerParticipant(
  client: PoolClient,
  sortieId: string,
  jeuneId: string,
  sortie: SortieVerrouillee,
): Promise<boolean> {
  // La promotion se décide UNIQUEMENT sur ce que le DELETE a réellement
  // supprimé (RETURNING), jamais sur une lecture antérieure.
  const del = await client.query<{ enAttente: boolean }>(
    'DELETE FROM sorties_participants WHERE sortie_id = $1 AND jeune_id = $2 RETURNING en_attente AS "enAttente"',
    [sortieId, jeuneId],
  );
  if (del.rows.length === 0) return false;

  // Auto-promotion du premier en attente si une place CONFIRMÉE vient
  // d'être libérée. Le recomptage sous verrou garantit que la capacité
  // reste respectée même si elle a été réduite entre-temps. La file suit
  // `ordre` (numéro monotone attribué à l'ajout) : premier arrivé, premier promu.
  const cap = sortie.capacite ?? 0;
  if (!del.rows[0].enAttente && cap > 0) {
    await client.query(`
          UPDATE sorties_participants
          SET en_attente = FALSE
          WHERE sortie_id = $1
            AND jeune_id = (
              SELECT jeune_id FROM sorties_participants
              WHERE sortie_id = $1 AND en_attente = TRUE
              ORDER BY ordre ASC
              LIMIT 1
            )
            AND (SELECT COUNT(*) FROM sorties_participants
                 WHERE sortie_id = $1 AND en_attente = FALSE) < $2
        `, [sortieId, cap]);
  }
  return true;
}
