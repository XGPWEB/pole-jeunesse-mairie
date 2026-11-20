/**
 * Lecture minimale d'un classeur Excel (.xlsx), sans bibliothèque.
 *
 * Un .xlsx est une archive ZIP de fichiers XML. Ce module en extrait le texte
 * des cellules, feuille par feuille — rien d'autre (ni formules, ni styles, ni
 * macros). Il s'exécute dans le NAVIGATEUR de la personne qui importe : le
 * fichier n'est jamais envoyé au serveur, qui ne reçoit que du texte tabulé,
 * validé ensuite ligne par ligne (lib/pij-import.ts).
 *
 * Pourquoi pas la bibliothèque `xlsx` déjà présente pour les exports : sa
 * lecture de fichiers a des vulnérabilités connues sans correctif.
 *
 * Les dates restent des numéros de série Excel : `dateTableur` les convertit.
 */

export interface FeuilleXlsx { nom: string; lignes: string[][] }

const TAILLE_MAX_FICHIER = 10 * 1024 * 1024;
const TAILLE_MAX_ENTREE = 30 * 1024 * 1024;

export class ErreurXlsx extends Error {}

interface Entree { methode: number; tailleCompressee: number; taille: number; position: number }

/** Répertoire central de l'archive : nom de fichier → emplacement. */
function lireRepertoire(vue: DataView): Map<string, Entree> {
  // Enregistrement de fin d'archive : cherché depuis la fin (commentaire possible).
  let fin = -1;
  for (let i = vue.byteLength - 22; i >= Math.max(0, vue.byteLength - 65_557); i--) {
    if (vue.getUint32(i, true) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new ErreurXlsx('Ce fichier n’est pas un classeur Excel (.xlsx).');
  const nombre = vue.getUint16(fin + 10, true);
  let p = vue.getUint32(fin + 16, true);
  const decodeur = new TextDecoder();
  const entrees = new Map<string, Entree>();
  for (let n = 0; n < nombre; n++) {
    if (p + 46 > vue.byteLength || vue.getUint32(p, true) !== 0x02014b50) throw new ErreurXlsx('Classeur Excel illisible (archive endommagée).');
    const longueurNom = vue.getUint16(p + 28, true);
    const nom = decodeur.decode(new Uint8Array(vue.buffer, vue.byteOffset + p + 46, longueurNom));
    entrees.set(nom, {
      methode: vue.getUint16(p + 10, true),
      tailleCompressee: vue.getUint32(p + 20, true),
      taille: vue.getUint32(p + 24, true),
      position: vue.getUint32(p + 42, true),
    });
    p += 46 + longueurNom + vue.getUint16(p + 30, true) + vue.getUint16(p + 32, true);
  }
  return entrees;
}

async function lireEntree(vue: DataView, entree: Entree | undefined): Promise<string | null> {
  if (!entree) return null;
  if (entree.taille > TAILLE_MAX_ENTREE) throw new ErreurXlsx('Classeur Excel trop volumineux.');
  const p = entree.position;
  if (p + 30 > vue.byteLength || vue.getUint32(p, true) !== 0x04034b50) throw new ErreurXlsx('Classeur Excel illisible (archive endommagée).');
  const debut = p + 30 + vue.getUint16(p + 26, true) + vue.getUint16(p + 28, true);
  if (debut + entree.tailleCompressee > vue.byteLength) throw new ErreurXlsx('Classeur Excel illisible (archive endommagée).');
  const donnees = (vue.buffer as ArrayBuffer).slice(vue.byteOffset + debut, vue.byteOffset + debut + entree.tailleCompressee);
  if (entree.methode === 0) return new TextDecoder().decode(donnees);
  if (entree.methode !== 8) throw new ErreurXlsx('Classeur Excel illisible (compression non prise en charge).');
  const flux = new Blob([donnees]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(flux).text();
}

// ── XML ──────────────────────────────────────────────────────────────────────

const ENTITES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decoder = (s: string) => s
  .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (tout, e: string) => {
    if (e[0] !== '#') return ENTITES[e.toLowerCase()] ?? tout;
    const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : tout;
  })
  // Excel écrit un retour chariot « _x000D_ » dans les cellules multi-lignes.
  .replace(/_x000D_/g, '')
  .replace(/\r\n?/g, '\n');

function attributs(balise: string): Record<string, string> {
  const res: Record<string, string> = {};
  for (const m of balise.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) res[m[1]] = decoder(m[2]);
  return res;
}

/** Texte d'un bloc <si> ou <is> : ses <t>, hors guides phonétiques <rPh>. */
const texteRiche = (xml: string) =>
  [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => decoder(m[1])).join('');

/** « B12 » → colonne 1 (base 0), ligne 12. */
function reference(ref: string): { colonne: number; ligne: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  let colonne = 0;
  for (const lettre of m[1]) colonne = colonne * 26 + (lettre.charCodeAt(0) - 64);
  return { colonne: colonne - 1, ligne: Number(m[2]) };
}

function lireFeuille(xml: string, chaines: string[]): string[][] {
  const lignes = new Map<number, string[]>();
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attr = attributs(m[1]);
    const ref = reference(attr.r ?? '');
    const contenu = m[2] ?? '';
    if (!ref || ref.colonne > 255) continue;
    const brut = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(contenu)?.[1];
    let valeur = '';
    if (attr.t === 's') valeur = chaines[Number(brut)] ?? '';
    else if (attr.t === 'inlineStr') valeur = texteRiche(contenu);
    else if (brut !== undefined) valeur = decoder(brut);
    if (valeur === '') continue;
    const ligne = lignes.get(ref.ligne) ?? [];
    ligne[ref.colonne] = valeur;
    lignes.set(ref.ligne, ligne);
  }
  return [...lignes.keys()].sort((a, b) => a - b).map(n => Array.from(lignes.get(n) as string[], c => c ?? ''));
}

/** Feuilles du classeur, dans l'ordre des onglets, avec le texte de leurs cellules. */
export async function lireXlsx(fichier: ArrayBuffer): Promise<FeuilleXlsx[]> {
  if (fichier.byteLength > TAILLE_MAX_FICHIER) throw new ErreurXlsx('Classeur Excel trop volumineux (10 Mo au maximum).');
  if (fichier.byteLength < 22) throw new ErreurXlsx('Ce fichier n’est pas un classeur Excel (.xlsx).');
  const vue = new DataView(fichier);
  const entrees = lireRepertoire(vue);

  const classeur = await lireEntree(vue, entrees.get('xl/workbook.xml'));
  const liens = await lireEntree(vue, entrees.get('xl/_rels/workbook.xml.rels'));
  if (!classeur || !liens) throw new ErreurXlsx('Ce fichier n’est pas un classeur Excel (.xlsx).');

  const cibles = new Map<string, string>();
  for (const m of liens.matchAll(/<Relationship\b([^>]*)>/g)) {
    const a = attributs(m[1]);
    if (a.Id && a.Target) cibles.set(a.Id, a.Target.startsWith('/') ? a.Target.slice(1) : `xl/${a.Target}`);
  }
  const chainesXml = await lireEntree(vue, entrees.get('xl/sharedStrings.xml'));
  const chaines = chainesXml ? [...chainesXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map(m => texteRiche(m[1] ?? '')) : [];

  const feuilles: FeuilleXlsx[] = [];
  for (const m of classeur.matchAll(/<sheet\b([^>]*)>/g)) {
    const a = attributs(m[1]);
    const xml = await lireEntree(vue, entrees.get(cibles.get(a['r:id'] ?? '') ?? ''));
    if (a.name && xml) feuilles.push({ nom: a.name, lignes: lireFeuille(xml, chaines) });
  }
  if (feuilles.length === 0) throw new ErreurXlsx('Aucune feuille lisible dans ce classeur.');
  return feuilles;
}

/** Lignes → texte tabulé, comme un copier-coller d'Excel (cellules multi-lignes entre guillemets). */
export function versTexteTabule(lignes: string[][]): string {
  const cellule = (c: string) => (/[\t\n"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return lignes.map(l => l.map(cellule).join('\t')).join('\n');
}
