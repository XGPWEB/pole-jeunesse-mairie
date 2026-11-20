/**
 * Confidentialité du planning des congés.
 *
 * Le planning est visible de toute l'équipe, mais le MOTIF d'une absence — et
 * le type précis, qui peut révéler une donnée de santé (« Maladie ») — sont
 * sensibles au sens du RGPD. Un animateur ne doit pas connaître la raison de
 * l'absence d'un collègue.
 *
 * Règle appliquée :
 *   - un admin voit tout ;
 *   - un animateur voit le détail de SES propres congés ;
 *   - pour les congés des autres, le type est neutralisé en « absent » et le
 *     commentaire est retiré.
 *
 * Fonction pure et exportée exprès pour être testable indépendamment de la
 * couche HTTP.
 */
export interface CongeVisible {
  animateurId: string;
  type: string;
  motif: string | null;
  [key: string]: unknown;
}

export function maskCongesForViewer<T extends CongeVisible>(
  conges: T[],
  viewer: { id: string; role: string },
): T[] {
  if (viewer.role === 'admin') return conges;
  return conges.map(c =>
    c.animateurId === viewer.id ? c : { ...c, type: 'absent', motif: null },
  );
}
