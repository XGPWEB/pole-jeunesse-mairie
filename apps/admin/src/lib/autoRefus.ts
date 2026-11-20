/**
 * Auto-refus des inscriptions en liste d'attente sur les activités passées.
 * Exécute un UPDATE direct en base — plus rapide et atomique que l'ancienne version JSON.
 */
import pool from './db';

export async function autoRefuserListeAttente(): Promise<{ transformed: number }> {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  try {
    const result = await pool.query(`
      UPDATE inscriptions
      SET statut = 'refusee',
          auto_refus = true,
          date_refus = a.date
      FROM activites a
      WHERE inscriptions.activite_id = a.id
        AND inscriptions.statut IN ('en-attente', 'liste-attente')
        AND a.date < $1::date
    `, [today]);

    return { transformed: result.rowCount ?? 0 };
  } catch (e) {
    console.error('[autoRefuserListeAttente]', e);
    return { transformed: 0 };
  }
}
