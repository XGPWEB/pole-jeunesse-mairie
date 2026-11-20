import { deflateRawSync } from 'zlib';

/**
 * Fabrique un petit .xlsx (archive ZIP) pour les tests : une feuille par
 * entrée, cellules en chaînes partagées ou en nombres. Données fictives.
 */
type Cellule = string | number;

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colonne = (i: number) => (i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : '') + String.fromCharCode(65 + (i % 26));

function zip(fichiers: [string, string][], compresser: boolean): Buffer {
  const locaux: Buffer[] = [];
  const centraux: Buffer[] = [];
  let position = 0;
  for (const [nom, contenu] of fichiers) {
    const brut = Buffer.from(contenu, 'utf8');
    const donnees = compresser ? deflateRawSync(brut) : brut;
    const nomOctets = Buffer.from(nom, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(compresser ? 8 : 0, 8);
    local.writeUInt32LE(donnees.length, 18);
    local.writeUInt32LE(brut.length, 22);
    local.writeUInt16LE(nomOctets.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(compresser ? 8 : 0, 10);
    central.writeUInt32LE(donnees.length, 20);
    central.writeUInt32LE(brut.length, 24);
    central.writeUInt16LE(nomOctets.length, 28);
    central.writeUInt32LE(position, 42);
    locaux.push(local, nomOctets, donnees);
    centraux.push(central, nomOctets);
    position += 30 + nomOctets.length + donnees.length;
  }
  const repertoire = Buffer.concat(centraux);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(fichiers.length, 8);
  fin.writeUInt16LE(fichiers.length, 10);
  fin.writeUInt32LE(repertoire.length, 12);
  fin.writeUInt32LE(position, 16);
  return Buffer.concat([...locaux, repertoire, fin]);
}

export function xlsxFictif(feuilles: { nom: string; lignes: Cellule[][] }[], { compresser = true } = {}): Buffer {
  const chaines: string[] = [];
  const fichiers: [string, string][] = [];
  feuilles.forEach((feuille, f) => {
    const rangees = feuille.lignes.map((ligne, l) => {
      const cellules = ligne.map((c, i) => {
        if (c === '') return '';
        const ref = `${colonne(i)}${l + 1}`;
        if (typeof c === 'number') return `<c r="${ref}" s="1"><v>${c}</v></c>`;
        let index = chaines.indexOf(c);
        if (index < 0) index = chaines.push(c) - 1;
        return `<c r="${ref}" t="s"><v>${index}</v></c>`;
      }).join('');
      return `<row r="${l + 1}">${cellules}</row>`;
    }).join('');
    fichiers.push([`xl/worksheets/sheet${f + 1}.xml`, `<?xml version="1.0"?><worksheet><cols><col min="1" max="3" width="12"/></cols><sheetData>${rangees}</sheetData></worksheet>`]);
  });
  fichiers.unshift(
    ['xl/workbook.xml', `<?xml version="1.0"?><workbook><sheets>${feuilles.map((f, i) => `<sheet name="${xml(f.nom)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0"?><Relationships>${feuilles.map((_, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`],
    // Retour à la ligne écrit à la manière d'Excel, et un guide phonétique à ignorer.
    ['xl/sharedStrings.xml', `<?xml version="1.0"?><sst>${chaines.map(c => `<si><t xml:space="preserve">${xml(c).replace(/\n/g, '_x000D_\n')}</t><rPh><t>ignoré</t></rPh></si>`).join('')}</sst>`],
  );
  return zip(fichiers, compresser);
}
