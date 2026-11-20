/**
 * Fragments de texte de deux éditions AGORA FICTIVES (« Fiche enfant » et
 * « Fiche santé ») : mise en page relevée sur de vraies éditions, toutes les
 * données personnelles remplacées. Chaque fragment : [x, y, largeur, texte].
 */
import type { ElementTexte } from '@/lib/fiches-agora-lecture';

type Brut = [number, number, number, string];
const enElements = (bruts: Brut[]): ElementTexte[] => bruts.map(([x, y, largeur, texte]) => ({ x, y, largeur, texte }));

export const FICHE_ENFANT_FICTIVE: ElementTexte[] = enElements([
  [370, 790, 103, "FICHE ENFANT"],
  [45, 489, 20, "Fixe"],
  [36, 518, 67, "01 23 45 67 89"],
  [30, 597, 84, "12 Rue des Lilas"],
  [30, 585, 112, "94130 Nogent Sur Marne"],
  [219, 531, 66, "Professionnel"],
  [30, 609, 168, "Madame DURAND Claire ( MARTIN )"],
  [30, 547, 156, "Email : claire.durand@exemple.fr"],
  [134, 531, 40, "Portable"],
  [128, 518, 67, "06 12 34 56 78"],
  [48, 531, 20, "Fixe"],
  [281, 646, 33, "Foyer"],
  [280, 751, 39, "Scolaire"],
  [322, 751, 3, ":"],
  [280, 739, 16, "null"],
  [280, 728, 33, "Niveau"],
  [316, 728, 21, ": null"],
  [280, 716, 32, "Classe"],
  [315, 716, 21, ": null"],
  [35, 716, 84, "12 Rue des Lilas"],
  [35, 704, 112, "94130 Nogent Sur Marne"],
  [35, 751, 115, "Sacha DURAND-LEROY"],
  [35, 740, 101, "Garçon, 14 ans 6 mois"],
  [35, 728, 169, "Né le 03/04/2012 à Nogent Sur Marne"],
  [268, 461, 59, "Contact(s)"],
  [30, 446, 172, "PETIT Marc (concubin /concubine)"],
  [45, 430, 67, "07 00 00 00 01"],
  [31, 416, 53, "Email : N.C"],
  [429, 392, 78, "Autorisation(s)"],
  [185, 392, 30, "Santé"],
  [380, 376, 72, "Hospitalisation"],
  [454, 376, 23, ": N.C"],
  [380, 364, 181, "Droit de sortir avec mineur de + 11ans"],
  [380, 353, 24, ": Non"],
  [380, 341, 174, "Droit de sortir seul non accompagné"],
  [557, 341, 3, ":"],
  [380, 329, 16, "Oui"],
  [380, 318, 69, "Droit à l'image"],
  [451, 318, 21, ": Oui"],
  [380, 306, 85, "Mesure d'urgence"],
  [468, 306, 21, ": Oui"],
  [155, 373, 49, "Maladie(s)"],
  [30, 374, 48, "Regime(s)"],
  [30, 361, 17, "N.C"],
  [155, 361, 17, "N.C"],
  [185, 217, 225, "Inscription(s) périscolaire(s) de l’enfant"],
  [302, 201, 69, "Date d’inscription"],
  [387, 201, 63, "Fin d’inscription"],
  [495, 201, 18, "Tarif"],
  [30, 189, 165, "Adhésion Annuelle - Espace Jeunesse"],
  [318, 189, 45, "01/09/2026"],
  [396, 189, 45, "31/08/2027"],
  [489, 189, 30, "50,00 €"],
  [281, 373, 38, "Autre(s)"],
  [280, 362, 69, "Autres allergies"],
  [280, 351, 82, "(poussière, pollen,"],
  [280, 339, 12, "...)"],
  [13, 43, 128, "Edité le 01/09/2026 10:00:00"],
  [487, 26, 57, "Page 1 sur 1"],
]);

export const FICHE_SANTE_FICTIVE: ElementTexte[] = enElements([
  [368, 795, 93, "FICHE SANTÉ"],
  [373, 780, 84, "N°Famille : 1000"],
  [33, 597, 168, "Madame DURAND Claire ( MARTIN )"],
  [33, 535, 156, "Email : claire.durand@exemple.fr"],
  [33, 585, 84, "12 Rue des Lilas"],
  [33, 573, 112, "94130 Nogent Sur Marne"],
  [48, 477, 88, "Fixe professionnel"],
  [222, 519, 66, "Professionnel"],
  [131, 506, 67, "06 12 34 56 78"],
  [39, 506, 67, "01 23 45 67 89"],
  [137, 519, 40, "Portable"],
  [51, 519, 20, "Fixe"],
  [253, 634, 89, "Responsable(s)"],
  [35, 704, 39, "Adresse"],
  [77, 704, 3, ":"],
  [35, 693, 84, "12 Rue des Lilas"],
  [35, 681, 136, "94130 NOGENT SUR MARNE"],
  [35, 739, 115, "DURAND-LEROY Sacha"],
  [35, 728, 107, "Masculin ,14 ans 6 mois"],
  [35, 716, 169, "Né le 03/04/2012 à Nogent Sur Marne"],
  [276, 739, 51, "Allocataire"],
  [330, 739, 115, ": Madame DURAND Claire"],
  [276, 727, 65, "N° Allocataire"],
  [344, 727, 44, ": 0000001"],
  [276, 716, 90, "Régime Allocataire"],
  [369, 716, 95, ": Caisse d'Allocations"],
  [276, 704, 45, "Familiales"],
  [276, 692, 91, "N° Securité Sociale"],
  [370, 692, 89, ": 200000000000000"],
  [268, 438, 59, "Contact(s)"],
  [30, 421, 172, "PETIT Marc (concubin /concubine)"],
  [45, 405, 67, "07 00 00 00 01"],
  [269, 384, 59, "Maladie(s)"],
  [36, 370, 17, "N.C"],
  [94, 326, 32, "Vaccin"],
  [199, 332, 89, "Dates des derniers"],
  [226, 320, 36, "rappels"],
  [220, 350, 155, "Renseignements médicaux"],
  [466, 332, 89, "Dates des derniers"],
  [493, 320, 36, "rappels"],
  [361, 326, 32, "Vaccin"],
  [34, 307, 92, "Diphtérie, tétanos, la"],
  [218, 307, 50, "01/02/2018"],
  [301, 307, 107, "Haemophilus influenzae"],
  [485, 307, 50, "01/02/2018"],
  [34, 292, 47, "Hépatite B"],
  [218, 292, 50, "15/06/2013"],
  [301, 292, 123, "Infections à Pneumocoques"],
  [485, 292, 50, "10/01/2013"],
  [34, 277, 133, "Méningocoque de sérogroupe"],
  [218, 277, 50, "15/06/2013"],
  [301, 277, 125, "Rougeole Oreillons Rubéole"],
  [485, 277, 50, "10/01/2013"],
  [189, 254, 217, "Assurance - Médecin - Hospitalisation"],
  [303, 240, 72, "Hospitalisation"],
  [377, 240, 23, ": N.C"],
  [303, 228, 102, "Lieu d'hospitalisation"],
  [408, 228, 23, ": N.C"],
  [35, 240, 115, "Compagnie d'assurance"],
  [153, 240, 87, ": Assurance Fictive"],
  [35, 228, 41, "N°Police"],
  [78, 228, 61, ": 000000-00X"],
  [35, 217, 77, "Médecin traitant"],
  [114, 217, 147, ": BERNARD Paul (01 98 76 54 32)"],
  [35, 171, 181, "Autres allergies (poussière, pollen, ...)"],
  [218, 171, 3, ":"],
  [231, 185, 130, "Autre(s) information(s)"],
  [12, 42, 133, "Editée le 01/09/2026 10:00:30"],
  [31, 33, 459, "« Conformément à la loi « informatique et libertés » du 6 janvier 1978, vous bénéficiez d’un droit d’accès et de rectification aux informations qui vous"],
  [31, 24, 301, "concernent. Si vous souhaitez exercer ce droit et obtenir la communication des informations vous"],
]);

/**
 * PDF minimal d'une page (Helvetica, 10 points) portant les fragments donnés :
 * de quoi faire passer la vraie extraction de texte, sans fichier de test.
 */
export function pdfFictif(fragments: { x: number; y: number; texte: string }[]): Buffer {
  const echapper = (t: string) => t.replace(/[\\()]/g, c => `\\${c}`);
  const contenu = fragments.map(f => `BT /F1 10 Tf ${f.x} ${f.y} Td (${echapper(f.texte)}) Tj ET`).join('\n');
  const objets = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(contenu, 'latin1')} >>\nstream\n${contenu}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let pdf = '%PDF-1.4\n';
  const positions: number[] = [];
  objets.forEach((o, i) => {
    positions.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`
    + positions.map(p => `${String(p).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** Fiche enfant réduite à l'essentiel, lisible une fois passée par `pdfFictif`. */
export const MINI_FICHE_ENFANT = [
  { x: 370, y: 790, texte: 'FICHE ENFANT' },
  { x: 35, y: 751, texte: 'Sacha DURAND-LEROY' },
  { x: 35, y: 740, texte: 'Garçon, 14 ans 6 mois' },
  { x: 35, y: 728, texte: 'Né le 03/04/2012 à Nogent Sur Marne' },
  { x: 35, y: 716, texte: '12 Rue des Lilas' },
  { x: 281, y: 646, texte: 'Foyer' },
];
