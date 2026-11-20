'use server';

import { revalidatePath } from 'next/cache';
import pool from '@/lib/db';
import { requireActionRubrique } from '@/lib/auth';
import { verrouillerActivite, compterConfirmes, estViolationUnicite } from '@/lib/inscriptions';

/**
 * Change le statut d'une inscription (confirmation ou refus depuis la page
 * Inscriptions) et resynchronise les places de l'activité concernée.
 *
 * Cette action était la seule à écrire `inscriptions.statut` sans recalculer
 * `activites.places_disponibles` : confirmer un jeune sur une activité complète
 * créait un surbooking silencieux, et laissait la colonne désynchronisée du
 * nombre réel d'inscrits confirmés.
 */
export async function updateStatutInscription(
  id: string,
  statut: 'confirmee' | 'refusee',
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await requireActionRubrique('inscriptions', 'activites');
    if (!user) return { success: false, error: 'Non authentifié' };
    // Le type TypeScript ne protège pas à l'exécution : une Server Action
    // reçoit ce que le client envoie.
    if (statut !== 'confirmee' && statut !== 'refusee') {
      return { success: false, error: 'Statut invalide' };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Ordre de verrouillage commun à tous les chemins d'écriture des
      // inscriptions : activité PUIS inscription. On lit donc d'abord (sans
      // verrou) l'activité concernée. L'ordre inverse — inscription puis
      // activité — s'interbloquait avec un désistement concurrent, qui tient
      // l'activité et veut promouvoir cette même inscription.
      const pre = await client.query<{ activiteId: string | null }>(
        'SELECT activite_id AS "activiteId" FROM inscriptions WHERE id = $1 AND tenant_id = $2',
        [id, user.tenant_id],
      );
      if (pre.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Inscription introuvable' };
      }
      const activiteId = pre.rows[0].activiteId;

      // Verrouille l'activité : sans ce verrou, deux confirmations simultanées
      // liraient la même capacité et dépasseraient toutes deux le quota.
      const activite = activiteId
        ? await verrouillerActivite(client, activiteId, user.tenant_id)
        : null;

      // Relit l'inscription en la verrouillant : c'est CET état qui fait foi
      // (elle a pu être promue, refusée ou supprimée entre-temps).
      const insRes = await client.query<{ statut: string }>(
        `SELECT statut
         FROM inscriptions
         WHERE id = $1 AND tenant_id = $2
         FOR UPDATE`,
        [id, user.tenant_id],
      );
      if (insRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Inscription introuvable' };
      }

      const inscription = insRes.rows[0];
      if (inscription.statut === statut) {
        await client.query('ROLLBACK');
        return { success: true };
      }

      if (statut === 'confirmee' && activiteId && activite) {
        const placesTotal = activite.placesTotal ?? 0;
        const confirmes = await compterConfirmes(client, activiteId, user.tenant_id);
        if (placesTotal > 0 && confirmes >= placesTotal) {
          await client.query('ROLLBACK');
          return { success: false, error: 'Activité complète — impossible de confirmer cette inscription.' };
        }
      }

      await client.query(
        'UPDATE inscriptions SET statut = $2 WHERE id = $1 AND tenant_id = $3',
        [id, statut, user.tenant_id],
      );

      // Recalcule les places à partir du nombre réel de confirmés, plutôt que
      // par décrément : la valeur ne peut plus dériver, quel que soit le chemin
      // d'écriture emprunté.
      if (activiteId) {
        await client.query(
          `UPDATE activites a
           SET places_disponibles = GREATEST(0, a.places_total - COALESCE((
                 SELECT COUNT(*) FROM inscriptions i
                 WHERE i.activite_id = a.id AND i.tenant_id = a.tenant_id AND i.statut = 'confirmee'), 0)),
               statut = CASE
                 WHEN a.places_total > 0 AND COALESCE((
                   SELECT COUNT(*) FROM inscriptions i
                   WHERE i.activite_id = a.id AND i.tenant_id = a.tenant_id AND i.statut = 'confirmee'), 0) >= a.places_total
                 THEN 'complet'
                 WHEN a.statut = 'complet' THEN 'ouvert'
                 ELSE a.statut
               END
           WHERE a.id = $1 AND a.tenant_id = $2`,
          [activiteId, user.tenant_id],
        );
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      // Réactiver une inscription refusée alors que le jeune a entre-temps une
      // autre inscription active sur la même activité : l'index unique refuse.
      if (estViolationUnicite(e)) {
        return { success: false, error: 'Ce jeune a déjà une autre inscription active sur cette activité.' };
      }
      throw e;
    } finally {
      client.release();
    }

    revalidatePath('/inscriptions');
    revalidatePath('/admin/inscriptions');
    revalidatePath('/dashboard');
    revalidatePath('/admin/dashboard');
    revalidatePath('/admin/activites');
    revalidatePath('/animateur/activites');

    return { success: true };
  } catch (e: unknown) {
    console.error('[updateStatutInscription]', e);
    return { success: false, error: e instanceof Error && e.message ? e.message : 'Erreur inconnue' };
  }
}
