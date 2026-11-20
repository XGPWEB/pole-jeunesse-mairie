import { getDocumentProxy } from 'unpdf';
import type { ElementTexte } from '@/lib/fiches-agora-lecture';

/** Une édition AGORA tient sur une ou deux pages : au-delà, ce n'en est pas une. */
const PAGES_MAX = 4;
const ELEMENTS_MAX = 5000;
/** Décalage vertical entre pages, pour que la page 1 reste « au-dessus » de la page 2. */
const HAUTEUR_PAGE = 10000;

/**
 * Fragments de texte d'un PDF, avec leur position. Aucun rendu, aucun script
 * exécuté : seul le calque de texte est lu. Lève une exception si le fichier
 * est illisible ou protégé.
 */
export async function extraireTextePdf(octets: Buffer): Promise<ElementTexte[]> {
  const pdf = await getDocumentProxy(new Uint8Array(octets), { verbosity: 0 });
  try {
    const elements: ElementTexte[] = [];
    const pages = Math.min(pdf.numPages, PAGES_MAX);
    for (let p = 1; p <= pages; p++) {
      const contenu = await (await pdf.getPage(p)).getTextContent();
      for (const item of contenu.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        elements.push({
          x: item.transform[4],
          y: item.transform[5] + (pages - p) * HAUTEUR_PAGE,
          largeur: item.width,
          texte: item.str,
        });
        if (elements.length >= ELEMENTS_MAX) return elements;
      }
    }
    return elements;
  } finally {
    await pdf.destroy();
  }
}
