import { randomUUID } from 'crypto';
import pool from '@/lib/db';

/**
 * Journal de monitoring — même principe que celui de LE HUB.
 *
 * Point d'entrée UNIQUE pour toute source (erreur serveur, erreur du
 * navigateur, tâche d'exploitation, quota de connexion épuisé) : chaque
 * occurrence est journalisée, et un courriel part au maximum une fois par
 * `type` toutes les 30 minutes — sinon une panne généralisée enverrait des
 * dizaines de messages identiques.
 *
 * Règle absolue : cette fonction ne lève JAMAIS et n'attend rien du réseau
 * avant de rendre la main à l'appelant pour le courriel. Un journal en panne
 * (table absente, base injoignable, SMTP en erreur) ne doit pas transformer
 * une requête réussie en échec, ni masquer l'erreur d'origine.
 */
export const ALERT_THROTTLE_MINUTES = 30;
export const RETENTION_JOURS = 180;
export const MAX_EVENEMENTS = 5000;

export type SourceMonitoring = 'serveur' | 'navigateur' | 'exploitation' | 'securite';

export interface EvenementMonitoring {
  source: SourceMonitoring;
  type: string;
  message: string;
  detail?: string | null;
  path?: string | null;
}

export interface EvenementEnregistre extends EvenementMonitoring {
  id: string;
  at: string;
}

export function tronquer(valeur: unknown, max: number): string {
  const texte = String(valeur ?? '');
  return texte.length > max ? `${texte.slice(0, max)}…` : texte;
}

/**
 * Sortie d'erreur d'origine, capturée AVANT que instrumentation.ts n'enveloppe
 * console.error : le journal l'utilise pour ses propres pannes, ce qui évite
 * qu'un échec d'écriture du journal ne se rejournalise lui-même sans fin.
 */
const erreurBrute: (...args: unknown[]) => void = console.error.bind(console);

/** Vrai si les événements de ce type doivent déclencher un courriel maintenant. */
async function reserverAlerte(type: string): Promise<boolean> {
  // Une seule requête atomique : deux processus qui journalisent le même type
  // au même instant ne peuvent pas tous deux « gagner » l'envoi.
  const res = await pool.query(
    `INSERT INTO monitoring_alerts (type, last_alert_at) VALUES ($1, NOW())
     ON CONFLICT (type) DO UPDATE SET last_alert_at = NOW()
       WHERE monitoring_alerts.last_alert_at < NOW() - make_interval(mins => $2)
     RETURNING type`,
    [type, ALERT_THROTTLE_MINUTES],
  );
  return res.rowCount === 1;
}

async function purger(): Promise<void> {
  await pool.query(`DELETE FROM monitoring_events WHERE at < NOW() - make_interval(days => $1)`, [RETENTION_JOURS]);
  await pool.query(
    `DELETE FROM monitoring_events
      WHERE id IN (SELECT id FROM monitoring_events ORDER BY at DESC OFFSET $1)`,
    [MAX_EVENEMENTS],
  );
}

export async function logMonitoringEvent(evenement: EvenementMonitoring): Promise<EvenementEnregistre | null> {
  try {
    const entree: EvenementEnregistre = {
      id: `mevt-${randomUUID()}`,
      at: new Date().toISOString(),
      source: evenement.source,
      type: tronquer(evenement.type, 200),
      message: tronquer(evenement.message || '(sans message)', 500),
      detail: evenement.detail ? tronquer(evenement.detail, 3000) : null,
      path: evenement.path ? tronquer(evenement.path, 300) : null,
    };
    await pool.query(
      `INSERT INTO monitoring_events (id, at, source, type, message, detail, path)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [entree.id, entree.at, entree.source, entree.type, entree.message, entree.detail, entree.path],
    );

    // Purge occasionnelle : inutile de la payer à chaque événement.
    if (Math.random() < 0.02) await purger();

    if (await reserverAlerte(entree.type)) {
      // Courriel lancé sans être attendu : un SMTP lent ne doit pas ralentir
      // la requête qui a signalé l'erreur. Import dynamique pour ne charger
      // nodemailer que lorsqu'une alerte part réellement.
      void import('@/app/animateurs/emailService')
        .then(({ envoyerAlerteMonitoring }) => envoyerAlerteMonitoring(entree))
        .catch((e: unknown) => erreurBrute('[monitoring] échec envoi alerte', e instanceof Error ? e.message : e));
    }
    return entree;
  } catch (e) {
    erreurBrute('[monitoring] échec écriture du journal', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Commune dont les administrateurs voient le journal. Les événements ne sont
 * pas rattachés à une commune (une erreur serveur concerne l'instance), et
 * leurs chemins ou messages peuvent se rapporter à n'importe quelle structure :
 * ils ne sont donc montrés qu'à l'exploitant de l'instance.
 */
export function tenantExploitant(): string {
  return process.env.MONITORING_OWNER_TENANT?.trim() || 'nogent';
}

/**
 * Vrai si l'« erreur » de rendu n'est que le navigateur qui a coupé la
 * connexion avant la fin de la page (onglet fermé, rechargement, clic sur un
 * autre lien) : React interrompt alors le rendu avec ce message exact. Rien
 * n'est en panne côté serveur et personne n'a vu de page d'erreur.
 */
export function estAbandonClient(erreur: unknown): boolean {
  const message = (erreur as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message.includes('The destination stream closed early');
}

// ─── Capture des erreurs serveur déjà tracées par console.error ──────────────

/**
 * Les ~50 routes et actions attrapent leurs erreurs et les tracent ainsi :
 *   console.error('[api/projets]', err)
 * avant de répondre 500. Elles ne remontent donc jamais jusqu'au gestionnaire
 * global de Next. Plutôt que de modifier chaque `catch`, instrumentation.ts
 * enveloppe console.error et confie ici chaque appel : s'il suit cette
 * convention (premier argument = étiquette entre crochets), il devient un
 * événement de monitoring.
 */
export function analyserAppelConsoleError(args: unknown[]): EvenementMonitoring | null {
  const [premier, ...reste] = args;
  if (typeof premier !== 'string') return null;
  const m = /^\[([^\]]{1,80})\]\s*([\s\S]*)$/.exec(premier);
  if (!m) return null;
  const etiquette = m[1];
  // Le journal ne se journalise pas lui-même ; le navigateur a son propre canal.
  if (/^(monitoring|error-boundary)\b/i.test(etiquette)) return null;

  const erreur = reste.find((a): a is Error => a instanceof Error);
  const textes = [m[2], ...reste.filter((a) => typeof a === 'string')].filter(Boolean) as string[];
  const message = erreur?.message || textes.join(' ') || '(sans message)';
  const code = erreur && typeof (erreur as { code?: unknown }).code === 'string' ? ` [${(erreur as { code?: string }).code}]` : '';
  const estRoute = /^(api|API)[ /]/.test(etiquette);
  return {
    source: 'serveur',
    type: `Erreur serveur — ${etiquette.replace(/^API\s+/, '').replace(/^api\//, '/api/')}`,
    message: `${message}${code}`,
    detail: erreur?.stack ?? (textes.length > 1 ? textes.join('\n') : null),
    path: estRoute ? etiquette.replace(/^API\s+/, '').replace(/^api\//, '/api/') : null,
  };
}
