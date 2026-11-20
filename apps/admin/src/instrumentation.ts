/**
 * Point d'accroche serveur de Next (appelé une fois au démarrage).
 * Branche le journal de monitoring sur toutes les erreurs serveur :
 *
 *  1. `onRequestError` — erreurs NON attrapées pendant le rendu d'une page,
 *     une route ou une Server Action ;
 *  2. console.error enveloppé — les routes attrapent presque toutes leurs
 *     erreurs et les tracent par `console.error('[api/…]', err)` avant de
 *     répondre 500 : sans cela elles n'apparaîtraient nulle part ailleurs que
 *     dans les journaux PM2 (voir lib/monitoring.ts, analyserAppelConsoleError) ;
 *  3. rejets de promesse et exceptions non gérés du processus.
 *
 * Tout est limité au runtime Node (le journal écrit en base via `pg`).
 */
export async function register(): Promise<void> {
  // Le code propre à Node (process.on, écriture en base) vit dans un module
  // séparé, importé seulement sur ce runtime : ce fichier est aussi compilé
  // pour le runtime Edge, qui ne connaît pas ces API.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { brancherMonitoringServeur } = await import('./instrumentation-node');
    await brancherMonitoringServeur();
  }
}

export async function onRequestError(
  erreur: unknown,
  requete: { path: string; method: string },
  contexte: { routePath?: string; routeType?: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { logMonitoringEvent, estAbandonClient } = await import('@/lib/monitoring');
  const e = erreur as { message?: string; stack?: string; digest?: string };
  // Les redirections et « introuvable » de Next passent par des exceptions
  // internes : ce ne sont pas des pannes.
  if (typeof e?.digest === 'string' && /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK)/.test(e.digest)) return;
  // Session expirée ou révoquée pendant le rendu d'une page : le layout
  // redirige vers la connexion, ce n'est pas une panne (voir lib/auth.ts).
  if ((erreur as { name?: string })?.name === 'SessionInvalideError') return;
  // Page quittée ou rechargée avant la fin du rendu : ce n'est pas une panne.
  if (estAbandonClient(erreur)) return;
  await logMonitoringEvent({
    source: 'serveur',
    type: `Erreur serveur — ${contexte.routeType === 'action' ? 'action' : 'rendu'} ${contexte.routePath ?? ''}`.trim(),
    message: e?.message ?? String(erreur),
    detail: e?.stack ?? null,
    // Chemin sans la chaîne de requête : elle peut contenir des identifiants.
    path: `${requete.method} ${requete.path.split('?')[0]}`,
  });
}
