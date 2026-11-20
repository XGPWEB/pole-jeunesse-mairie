import type { PoolClient } from 'pg';
import pool from '@/lib/db';

/**
 * Espaces d'une commune, et contrôle d'appartenance (audit 2026-10-07, A4/A5).
 *
 * `jeunes.espace_id` référence `espaces(id)` : la clé étrangère garantit que
 * l'espace existe, pas qu'il appartient à la commune du jeune. Toute écriture
 * d'un rattachement passe donc par `espaceDeLaCommune`, et la base porte en
 * complément une clé étrangère composite (commune, espace).
 */
export interface EspaceCommune {
  id: string;
  nom: string;
  trancheAge: string | null;
}

export async function listerEspacesCommune(tenantId: string): Promise<EspaceCommune[]> {
  const { rows } = await pool.query<EspaceCommune>(
    `SELECT id, nom, tranche_age AS "trancheAge" FROM espaces WHERE tenant_id = $1 ORDER BY nom, id`,
    [tenantId],
  );
  return rows;
}

/** Vrai si l'espace `espaceId` existe ET appartient à la commune `tenantId`. */
export async function espaceDeLaCommune(client: PoolClient, espaceId: unknown, tenantId: string): Promise<boolean> {
  if (typeof espaceId !== 'string' || espaceId === '') return false;
  const res = await client.query('SELECT 1 FROM espaces WHERE id = $1 AND tenant_id = $2', [espaceId, tenantId]);
  return (res.rowCount ?? 0) > 0;
}

export const ERREUR_ESPACE_INCONNU = 'Espace inconnu dans votre structure : choisissez un espace de la liste.';

/** Minuscules, sans accents ni espaces superflus : comparaison tolérante des noms. */
const normaliser = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Convention de la colonne « espace » d'un import CSV :
 *   1. l'IDENTIFIANT de l'espace (ex. `collegiens`), sans tenir compte de la casse ;
 *   2. à défaut son NOM tel qu'affiché (ex. `Espace Collégiens`), sans tenir
 *      compte de la casse ni des accents.
 * Seuls les espaces de la commune sont reconnus. Un nom porté par deux espaces
 * est refusé : il faut alors utiliser l'identifiant.
 */
export function resoudreEspaceCsv(
  valeur: string,
  espaces: EspaceCommune[],
): { ok: true; id: string } | { ok: false; erreur: string } {
  const brut = valeur.trim();
  const parId = espaces.find(e => e.id.toLowerCase() === brut.toLowerCase());
  if (parId) return { ok: true, id: parId.id };
  const parNom = espaces.filter(e => normaliser(e.nom) === normaliser(brut));
  if (parNom.length === 1) return { ok: true, id: parNom[0].id };
  if (parNom.length > 1) {
    return { ok: false, erreur: `Espace ambigu "${brut}" : plusieurs espaces portent ce nom — utilisez l'identifiant (${parNom.map(e => e.id).join(', ')})` };
  }
  const connus = espaces.length
    ? espaces.map(e => `${e.nom} (${e.id})`).join(', ')
    : 'aucun espace n\'est encore créé dans votre structure';
  return { ok: false, erreur: `Espace inconnu "${brut}" — espaces de votre structure : ${connus}` };
}
