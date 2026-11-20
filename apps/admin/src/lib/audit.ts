import type { PoolClient } from 'pg';
import pool from '@/lib/db';

export interface EvenementAudit {
  action: string;
  tableName?: string;
  recordId?: string;
  animateurId?: string;
  animateurUsername?: string;
  tenant_id?: string;
  details?: Record<string, unknown>;
}

const INSERTION_AUDIT = `INSERT INTO audit_log (action, table_name, record_id, animateur_id, animateur_username, tenant_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`;

function valeursAudit(params: EvenementAudit) {
  return [
    params.action,
    params.tableName ?? null,
    params.recordId ?? null,
    params.animateurId ?? null,
    params.animateurUsername ?? null,
    // Tenant inconnu (ex. LOGIN_FAILED sur un identifiant inexistant) → NULL.
    // Le repli sur 'nogent' attribuait à cette structure les événements de
    // toutes les autres dès qu'un appelant omettait le tenant.
    params.tenant_id ?? null,
    params.details ? JSON.stringify(params.details) : null,
  ];
}

/**
 * Journal d'audit « au mieux » : écrit hors de toute transaction et NE LÈVE
 * JAMAIS. À utiliser pour les événements dont l'absence de trace est
 * préférable à l'échec de la requête (connexion, consultation…).
 *
 * Pour une action dont la trace est exigée — une suppression, par exemple —
 * utiliser `ecrireAuditDansTransaction`.
 */
export async function logAudit(params: EvenementAudit) {
  try {
    await pool.query(INSERTION_AUDIT, valeursAudit(params));
  } catch (e) {
    // Ne jamais faire échouer la requête appelante à cause d'un problème
    // d'audit — mais logger l'erreur au lieu de l'avaler silencieusement.
    console.error('[audit] échec écriture audit_log', e);
  }
}

/**
 * Écrit l'événement avec le client PostgreSQL de la transaction EN COURS, et
 * laisse remonter toute erreur.
 *
 * L'événement et l'action qu'il décrit sont alors validés ensemble ou annulés
 * ensemble : si le journal ne peut pas être écrit, l'appelant annule sa
 * transaction et l'action n'a pas lieu. C'est ce qui garantit qu'une action
 * sensible ne peut pas réussir sans laisser de trace — et, à l'inverse, qu'une
 * action annulée ne laisse pas de trace de réussite.
 */
export async function ecrireAuditDansTransaction(client: Pick<PoolClient, 'query'>, params: EvenementAudit): Promise<void> {
  await client.query(INSERTION_AUDIT, valeursAudit(params));
}
