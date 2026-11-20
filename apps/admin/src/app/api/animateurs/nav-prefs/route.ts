import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import pool from '@/lib/db';

// Entrées de menu autorisées (union admin + animateur) — empêche d'injecter des
// ids arbitraires. Chaque rôle n'affiche que les entrées pertinentes pour lui.
const NAV_IDS = new Set([
  // communes / animateur
  'dashboard', 'jeunes', 'activites', 'presences', 'statistiques',
  'frequentation', 'evenements', 'vehicules', 'projets', 'sorties', 'conges', 'pij', 'profil',
  // spécifiques admin
  'inscriptions', 'animateurs', 'notifications', 'actualites', 'espaces',
  'apparence', 'rgpd', 'parametres',
]);

/**
 * Enregistre les préférences PERSONNELLES de menu de l'animateur connecté :
 * l'ordre et la visibilité de ses entrées. Chacun ne modifie que les siennes.
 */
export async function PUT(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });

  try {
    const body = await req.json();
    const items = body?.items;
    if (!Array.isArray(items)) {
      return NextResponse.json({ error: 'Format invalide.' }, { status: 400 });
    }

    // Nettoyage : on ne garde que des entrées connues, dédupliquées, avec un
    // booléen `visible`. dashboard et profil restent toujours visibles (pour ne
    // pas se verrouiller hors de la navigation).
    const seen = new Set<string>();
    const clean = items
      .filter((it: any) => it && NAV_IDS.has(it.id) && !seen.has(it.id) && seen.add(it.id))
      .map((it: any) => ({
        id: it.id as string,
        visible: (it.id === 'dashboard' || it.id === 'profil') ? true : it.visible !== false,
      }));

    if (clean.length === 0) {
      return NextResponse.json({ error: 'Aucune entrée valide.' }, { status: 400 });
    }

    await pool.query('UPDATE animateurs SET nav_prefs = $2 WHERE id = $1', [session.id, JSON.stringify(clean)]);
    return NextResponse.json({ success: true, items: clean });
  } catch (err) {
    console.error('[api/animateurs/nav-prefs PUT]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

/** Réinitialise : supprime la personnalisation (retour au menu par défaut). */
export async function DELETE(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  try {
    await pool.query('UPDATE animateurs SET nav_prefs = NULL WHERE id = $1', [session.id]);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/animateurs/nav-prefs DELETE]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
