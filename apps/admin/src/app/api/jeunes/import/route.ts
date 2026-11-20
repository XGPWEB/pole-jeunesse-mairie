import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import pool from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { estDateCivile, todayLocal } from '@/lib/dates';
import { listerEspacesCommune, resoudreEspaceCsv, type EspaceCommune } from '@/lib/espaces';

const VALID_SEXE = ['M', 'F', ''];

interface CsvRow {
  nom: string;
  prenom: string;
  dateNaissance?: string;
  sexe?: string;
  espaceId?: string;
  etablissement?: string;
  classe?: string;
  adresse?: string;
  secteur?: string;
}

interface ImportError {
  line: number;
  data: string;
  message: string;
}

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  function parseLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if ((ch === ',' || ch === ';') && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  }

  const headers = parseLine(lines[0]).map(h =>
    h.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove accents
      .replace(/[^a-z0-9_]/g, ''),
  );
  const rows = lines.slice(1).map(l => parseLine(l));
  return { headers, rows };
}

function mapHeaders(headers: string[]): Record<string, number> {
  const ALIASES: Record<string, string[]> = {
    nom:          ['nom', 'name', 'lastname', 'family_name'],
    prenom:       ['prenom', 'firstname', 'first_name'],
    dateNaissance:['datenaissance', 'date_naissance', 'naissance', 'birthdate', 'birth_date'],
    sexe:         ['sexe', 'genre', 'sex', 'gender'],
    espaceId:     ['espaceid', 'espace', 'espace_id', 'space'],
    etablissement:['etablissement', 'ecole', 'school', 'college', 'lycee'],
    classe:       ['classe', 'class', 'grade'],
    adresse:      ['adresse', 'address'],
    secteur:      ['secteur', 'sector', 'zone'],
  };
  const map: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    for (const alias of aliases) {
      const idx = headers.indexOf(alias);
      if (idx !== -1) { map[field] = idx; break; }
    }
  }
  return map;
}

function validateRow(row: string[], map: Record<string, number>, espaces: EspaceCommune[], aujourdhui: string): { data: CsvRow; error?: string } {
  const get = (field: string) => map[field] !== undefined ? (row[map[field]] ?? '').trim() : '';

  const nom = get('nom');
  const prenom = get('prenom');
  if (!nom) return { data: {} as CsvRow, error: 'Colonne "nom" manquante ou vide' };
  if (!prenom) return { data: {} as CsvRow, error: 'Colonne "prenom" manquante ou vide' };

  const dateNaissance = get('dateNaissance');
  if (dateNaissance && !/^\d{4}-\d{2}-\d{2}$/.test(dateNaissance)) {
    return { data: {} as CsvRow, error: `Date de naissance invalide "${dateNaissance}" — format attendu : YYYY-MM-DD` };
  }
  // Le format ne suffit pas : « 2026-02-31 » le respecte, PostgreSQL le refuse,
  // et l'insertion en échec annulait alors TOUT l'import (audit 2026-10-07, A5).
  if (dateNaissance && !estDateCivile(dateNaissance)) {
    return { data: {} as CsvRow, error: `Date de naissance impossible "${dateNaissance}" — ce jour n'existe pas` };
  }
  if (dateNaissance && dateNaissance > aujourdhui) {
    return { data: {} as CsvRow, error: `Date de naissance dans le futur "${dateNaissance}"` };
  }

  // Espace : identifiant ou nom d'un espace DE LA COMMUNE (voir lib/espaces.ts).
  let espaceId = '';
  const espaceSaisi = get('espaceId');
  if (espaceSaisi) {
    const espace = resoudreEspaceCsv(espaceSaisi, espaces);
    if (!espace.ok) return { data: {} as CsvRow, error: espace.erreur };
    espaceId = espace.id;
  }

  const sexe = get('sexe').toUpperCase();
  if (sexe && !VALID_SEXE.includes(sexe)) {
    return { data: {} as CsvRow, error: `Sexe invalide "${sexe}" — valeurs valides : M, F` };
  }

  return {
    data: {
      nom,
      prenom,
      dateNaissance: dateNaissance || undefined,
      sexe: sexe || undefined,
      espaceId: espaceId || undefined,
      etablissement: get('etablissement') || undefined,
      classe: get('classe') || undefined,
      adresse: get('adresse') || undefined,
      secteur: get('secteur') || undefined,
    },
  };
}

export async function POST(request: NextRequest) {
  const session = await requireAuth(request);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Admin uniquement' }, { status: 403 });

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Fichier CSV manquant' }, { status: 400 });
    if (!file.name.toLowerCase().endsWith('.csv')) {
      return NextResponse.json({ error: 'Le fichier doit être au format CSV (.csv)' }, { status: 400 });
    }
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: 'Fichier trop volumineux (max 2 Mo)' }, { status: 400 });
    }

    const text = await file.text();
    const { headers, rows } = parseCSV(text);

    if (headers.length === 0) {
      return NextResponse.json({ error: 'Fichier CSV vide ou mal formaté' }, { status: 400 });
    }

    const map = mapHeaders(headers);
    if (map.nom === undefined || map.prenom === undefined) {
      return NextResponse.json({
        error: `Colonnes obligatoires introuvables. En-têtes détectés : ${headers.join(', ')}. Attendu au minimum : nom, prenom`,
      }, { status: 400 });
    }

    const errors: ImportError[] = [];
    const toInsert: CsvRow[] = [];
    const espaces = await listerEspacesCommune(session.tenant_id);
    const aujourdhui = todayLocal();

    for (let i = 0; i < rows.length; i++) {
      if (rows[i].every(c => !c.trim())) continue; // skip empty lines
      const { data, error } = validateRow(rows[i], map, espaces, aujourdhui);
      if (error) {
        errors.push({ line: i + 2, data: rows[i].join(', '), message: error });
      } else {
        toInsert.push(data);
      }
    }

    if (toInsert.length === 0) {
      return NextResponse.json({ imported: 0, errors, doublons: [], message: 'Aucune ligne valide à importer' });
    }

    // Insérer par batch
    const client = await pool.connect();
    let imported = 0;
    const doublons: { nom: string; prenom: string; dateNaissance?: string }[] = [];
    try {
      await client.query('BEGIN');
      for (const row of toInsert) {
        const existant = await client.query(
          `SELECT id FROM jeunes
           WHERE tenant_id = $1 AND lower(nom) = lower($2) AND lower(prenom) = lower($3)
             AND date_naissance IS NOT DISTINCT FROM $4`,
          [session.tenant_id, row.nom, row.prenom, row.dateNaissance ?? null],
        );
        if (existant.rows.length > 0) {
          doublons.push({ nom: row.nom, prenom: row.prenom, dateNaissance: row.dateNaissance });
          continue;
        }

        const id = `j-${crypto.randomUUID()}`;
        await client.query(`
          INSERT INTO jeunes (id, nom, prenom, date_naissance, sexe, espace_id, etablissement, classe, adresse, secteur, tenant_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
          id,
          row.nom,
          row.prenom,
          row.dateNaissance ?? null,
          row.sexe ?? null,
          row.espaceId ?? null,
          row.etablissement ?? null,
          row.classe ?? null,
          row.adresse ?? null,
          row.secteur ?? null,
          session.tenant_id,
        ]);
        imported++;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await logAudit({
      action: 'JEUNES_IMPORT_CSV',
      animateurId: session.id,
      animateurUsername: session.username,
      details: { imported, errors: errors.length, doublons: doublons.length, filename: file.name },
    });

    return NextResponse.json({
      imported,
      errors,
      doublons,
      message: `${imported} jeune${imported > 1 ? 's' : ''} importé${imported > 1 ? 's' : ''}${errors.length > 0 ? `, ${errors.length} ligne${errors.length > 1 ? 's' : ''} ignorée${errors.length > 1 ? 's' : ''}` : ''}${doublons.length > 0 ? `, ${doublons.length} doublon${doublons.length > 1 ? 's' : ''} ignoré${doublons.length > 1 ? 's' : ''}` : ''}`,
    });
  } catch (err) {
    console.error('[api/jeunes/import]', err);
    return NextResponse.json({ error: 'Erreur serveur lors de l\'import' }, { status: 500 });
  }
}
