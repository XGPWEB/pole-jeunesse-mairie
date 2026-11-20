/**
 * Règles de signalement côté navigateur, sans dépendance au DOM pour pouvoir
 * être testées (voir components/MonitoringReporter.tsx, qui les applique).
 */
export const SEUIL_CHARGEMENT_LENT_MS = 4000;

/** Sous-ensemble de PerformanceNavigationTiming utilisé ici. */
export interface MesureNavigation {
  fetchStart: number;
  loadEventEnd: number;
  domContentLoadedEventEnd: number;
}

/**
 * Durée de chargement imputable AU SITE : de la requête de la page finale
 * (`fetchStart`, postérieur aux redirections) à la fin du chargement.
 *
 * Les instants de PerformanceNavigationTiming sont comptés depuis le tout
 * début de la navigation, redirections comprises. Le 2026-10-07, un robot a
 * ainsi « chargé » /login en 14,5 s alors que le serveur répondait en quelques
 * millisecondes : il avait attendu 11 s entre la redirection http → https et
 * la requête suivante. Ce délai est le sien, pas celui du site.
 */
export function dureeChargementMs(nav: MesureNavigation | undefined): number {
  if (!nav) return 0;
  const fin = nav.loadEventEnd || nav.domContentLoadedEventEnd;
  if (!fin || fin <= nav.fetchStart) return 0;
  return Math.round(fin - nav.fetchStart);
}

/**
 * Navigateur piloté par un programme (robot d'indexation, scanner, test
 * automatisé) : ses lenteurs et ses erreurs ne disent rien de ce que vit un
 * utilisateur, et il n'a pas à remplir le journal ni à déclencher un courriel.
 *
 * `navigator.webdriver` est le signal standard ; la liste d'agents couvre les
 * robots qui ne le posent pas. Un robot qui se déguise parfaitement passera :
 * c'est acceptable, le quota par adresse du serveur borne ce qu'il peut écrire.
 */
export function estNavigateurAutomatise(agent: string | undefined, webdriver: boolean | undefined): boolean {
  if (webdriver === true) return true;
  if (!agent) return true;
  return /bot\b|crawl|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|scan|curl|wget|python|phantom|puppeteer|playwright|selenium/i.test(agent)
    // Agent des sondes vues le 2026-10-07 : un « iPhone13,2; U; … Version/10.0 »
    // qu'aucun vrai Safari n'envoie (la mention « U; » a disparu depuis iOS 4).
    || /\((iPhone|iPad)[^)]*;\s*U;/i.test(agent);
}

/**
 * Message d'une requête interrompue EN ROUTE (Wi-Fi qui saute, sortie de
 * veille, onglet rechargé, serveur en cours de redémarrage) et non d'une
 * réponse en erreur du site.
 *
 * Le 2026-10-07, un « network error » a ainsi remplacé le tableau de bord par
 * la page 500 : le rafraîchissement automatique avait été coupé en plein
 * transfert. Ce n'est pas un bug à journaliser, et l'interface doit s'en
 * remettre seule (voir app/error.tsx).
 */
export function estCoupureReseau(message: string | null | undefined): boolean {
  if (!message) return false;
  return /network ?error|failed to fetch|load failed|connection (was )?(closed|lost)|err_(network|internet)/i.test(message);
}
