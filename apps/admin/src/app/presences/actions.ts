'use server';

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';
import pool from '@/lib/db';
import { getTenantId, requireActionRubrique } from '@/lib/auth';

const PATHS = ['/statistiques', '/animateur/statistiques', '/presences', '/dashboard', '/animateur/dashboard'];

export async function ajouterPointage(data: {
  jeuneId: string;
  espaceId: string;
  date: string;
  heureArrivee: string;
  heureSortie?: string;
  type: 'accueil-libre' | 'activite';
  activiteId?: string | null;
  manuel: boolean;
  animateur?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    if (!await requireActionRubrique('presences', 'activites')) return { success: false, error: 'Non authentifié' };
    const tenant_id = await getTenantId();
    // Le jeune, l'espace et l'activité référencés doivent appartenir à la
    // structure de la session : sans ce contrôle, un identifiant connu d'une
    // autre commune créait un pointage croisé (constat 7 de l'audit 2026-10).
    const refs: Array<[string, string | null | undefined, string]> = [
      ['jeunes', data.jeuneId, 'Jeune'],
      ['espaces', data.espaceId, 'Espace'],
      ['activites', data.activiteId, 'Activité'],
    ];
    for (const [table, refId, libelle] of refs) {
      if (!refId) {
        if (table === 'activites') continue;
        return { success: false, error: `${libelle} requis` };
      }
      const r = await pool.query(`SELECT 1 FROM ${table} WHERE id = $1 AND tenant_id = $2`, [refId, tenant_id]);
      if (r.rowCount === 0) return { success: false, error: `${libelle} introuvable` };
    }
    if (data.type !== 'accueil-libre' && data.type !== 'activite') {
      return { success: false, error: 'Type de pointage invalide' };
    }

    const id = `pt-${randomUUID()}`;
    await pool.query(`
      INSERT INTO pointages (id, jeune_id, espace_id, date, heure_arrivee, heure_sortie, animateur, type, activite_id, manuel, source, tenant_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'web',$11)
    `, [id, data.jeuneId, data.espaceId, data.date, data.heureArrivee, data.heureSortie ?? null,
        data.animateur ?? 'admin', data.type, data.activiteId ?? null, data.manuel, tenant_id]);

    PATHS.forEach(p => revalidatePath(p));
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function modifierPointage(id: string, data: { heureSortie?: string }): Promise<{ success: boolean; error?: string }> {
  try {
    if (!await requireActionRubrique('presences', 'activites')) return { success: false, error: 'Non authentifié' };
    const tenant_id = await getTenantId();
    // Filtre tenant obligatoire : un id deviné ne doit pas atteindre une autre structure.
    const result = await pool.query(
      'UPDATE pointages SET heure_sortie=$2 WHERE id=$1 AND tenant_id=$3',
      [id, data.heureSortie ?? null, tenant_id],
    );
    if (result.rowCount === 0) return { success: false, error: 'Pointage introuvable' };

    PATHS.forEach(p => revalidatePath(p));
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function supprimerPointage(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!await requireActionRubrique('presences', 'activites')) return { success: false, error: 'Non authentifié' };
    const tenant_id = await getTenantId();
    const result = await pool.query('DELETE FROM pointages WHERE id=$1 AND tenant_id=$2', [id, tenant_id]);
    if (result.rowCount === 0) return { success: false, error: 'Pointage introuvable' };
    PATHS.forEach(p => revalidatePath(p));
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
