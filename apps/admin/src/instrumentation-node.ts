/**
 * Partie Node du branchement du monitoring (voir instrumentation.ts).
 * Importée uniquement quand NEXT_RUNTIME vaut 'nodejs'.
 */
export async function brancherMonitoringServeur(): Promise<void> {
  const { logMonitoringEvent, analyserAppelConsoleError } = await import('@/lib/monitoring');

  const drapeau = Symbol.for('pj.monitoring.console');
  const cible = console as unknown as Record<symbol, boolean>;
  if (!cible[drapeau]) {
    cible[drapeau] = true; // le module peut être réévalué en développement
    const origine = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      origine(...args);
      try {
        const evenement = analyserAppelConsoleError(args);
        if (evenement) void logMonitoringEvent(evenement);
      } catch { /* le monitoring ne doit jamais perturber la trace d'origine */ }
    };

    process.on('unhandledRejection', (raison: unknown) => {
      void logMonitoringEvent({
        source: 'serveur',
        type: 'Erreur serveur — promesse rejetée non gérée',
        message: raison instanceof Error ? raison.message : String(raison),
        detail: raison instanceof Error ? raison.stack : null,
      });
    });
    process.on('uncaughtExceptionMonitor', (erreur: Error) => {
      void logMonitoringEvent({
        source: 'serveur',
        type: 'Erreur serveur — exception non gérée',
        message: erreur.message,
        detail: erreur.stack,
      });
    });
  }
}
