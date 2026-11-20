import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ default: { query: vi.fn() } }));

import { analyserAppelConsoleError, estAbandonClient, tronquer } from '@/lib/monitoring';
import { dureeChargementMs, estCoupureReseau, estNavigateurAutomatise, SEUIL_CHARGEMENT_LENT_MS } from '@/lib/monitoring-navigateur';

describe('tronquer', () => {
  it('laisse un texte court intact et coupe un texte long avec une ellipse', () => {
    expect(tronquer('abc', 10)).toBe('abc');
    expect(tronquer('a'.repeat(20), 10)).toBe(`${'a'.repeat(10)}…`);
    expect(tronquer(null, 10)).toBe('');
    expect(tronquer(42, 10)).toBe('42');
  });
});

describe('analyserAppelConsoleError — convention console.error(\'[étiquette]\', err)', () => {
  it('route API avec une Error : type par route, message et pile repris', () => {
    const err = Object.assign(new Error('invalid input syntax for type date: ""'), { code: '22007' });
    const e = analyserAppelConsoleError(['[api/projets]', err]);
    expect(e).toMatchObject({
      source: 'serveur',
      type: 'Erreur serveur — /api/projets',
      message: 'invalid input syntax for type date: "" [22007]',
      path: '/api/projets',
    });
    expect(e?.detail).toContain('Error: invalid input syntax');
  });

  it('variante « [API /api/pointages] » : même normalisation', () => {
    const e = analyserAppelConsoleError(['[API /api/pointages]', new Error('boom')]);
    expect(e?.type).toBe('Erreur serveur — /api/pointages');
    expect(e?.path).toBe('/api/pointages');
  });

  it('étiquette hors API (action, base) : journalisée sans chemin', () => {
    const e = analyserAppelConsoleError(['[supprimerJeune]', new Error('deadlock detected')]);
    expect(e).toMatchObject({ type: 'Erreur serveur — supprimerJeune', message: 'deadlock detected', path: null });
  });

  it('message texte après l\'étiquette, sans Error', () => {
    const e = analyserAppelConsoleError(['[DB] Erreur inattendue sur une connexion inactive du pool :', 'ECONNRESET']);
    expect(e?.type).toBe('Erreur serveur — DB');
    expect(e?.message).toContain('Erreur inattendue');
    expect(e?.message).toContain('ECONNRESET');
  });

  it('ignore ce qui ne suit pas la convention', () => {
    expect(analyserAppelConsoleError([new Error('sans étiquette')])).toBeNull();
    expect(analyserAppelConsoleError(['Missing `origin` header from a forwarded Server Actions request.'])).toBeNull();
    expect(analyserAppelConsoleError([])).toBeNull();
    expect(analyserAppelConsoleError([{ objet: true }])).toBeNull();
  });

  it('ne se journalise pas lui-même, ni les erreurs déjà signalées par le navigateur', () => {
    expect(analyserAppelConsoleError(['[monitoring] échec écriture du journal', 'x'])).toBeNull();
    expect(analyserAppelConsoleError(['[error-boundary]', new Error('x')])).toBeNull();
  });
});

describe('estAbandonClient — rendu interrompu parce que le navigateur est parti', () => {
  it('cas du 2026-10-08 sur /admin/presences : écarté', () => {
    expect(estAbandonClient(new Error('The destination stream closed early.'))).toBe(true);
  });

  it('ne masque pas une vraie erreur de rendu', () => {
    expect(estAbandonClient(new Error('relation "pointages" does not exist'))).toBe(false);
    expect(estAbandonClient('The destination stream closed early.')).toBe(false);
    expect(estAbandonClient(null)).toBe(false);
  });
});

describe('dureeChargementMs — lenteur imputable au site, redirections exclues', () => {
  it('cas du 2026-10-07 : 11 s d\'attente dans la redirection, page servie en 0,4 s → non lent', () => {
    // Instants comptés depuis le début de la navigation (redirection comprise).
    const d = dureeChargementMs({ fetchStart: 14100, loadEventEnd: 14521, domContentLoadedEventEnd: 14400 });
    expect(d).toBe(421);
    expect(d).toBeLessThan(SEUIL_CHARGEMENT_LENT_MS);
  });

  it('page réellement lente à charger : signalée', () => {
    expect(dureeChargementMs({ fetchStart: 20, loadEventEnd: 6020, domContentLoadedEventEnd: 5000 })).toBe(6000);
  });

  it('chargement inachevé : repli sur DOMContentLoaded ; mesure absente ou incohérente → 0', () => {
    expect(dureeChargementMs({ fetchStart: 10, loadEventEnd: 0, domContentLoadedEventEnd: 310 })).toBe(300);
    expect(dureeChargementMs(undefined)).toBe(0);
    expect(dureeChargementMs({ fetchStart: 500, loadEventEnd: 0, domContentLoadedEventEnd: 0 })).toBe(0);
    expect(dureeChargementMs({ fetchStart: 500, loadEventEnd: 400, domContentLoadedEventEnd: 300 })).toBe(0);
  });
});

describe('estNavigateurAutomatise', () => {
  const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';
  const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const FIREFOX_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';

  it('laisse passer les vrais navigateurs', () => {
    for (const agent of [CHROME_MAC, SAFARI_IPHONE, FIREFOX_WIN]) {
      expect(estNavigateurAutomatise(agent, false), agent).toBe(false);
      expect(estNavigateurAutomatise(agent, undefined), agent).toBe(false);
    }
  });

  it('écarte la sonde vue le 2026-10-07 (faux iPhone « U; »)', () => {
    expect(estNavigateurAutomatise(
      'Mozilla/5.0 (iPhone13,2; U; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/602.1.50 (KHTML, like Gecko) Version/10.0 Mobile/15E148 Safari/602.1', false,
    )).toBe(true);
  });

  it('écarte les navigateurs pilotés et les robots déclarés', () => {
    expect(estNavigateurAutomatise(CHROME_MAC, true)).toBe(true);
    for (const agent of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
      'masscan/1.0 (https://github.com/robertdavidgraham/masscan)',
      'curl/8.5.0', 'python-requests/2.31', '', undefined,
    ]) expect(estNavigateurAutomatise(agent, false), String(agent)).toBe(true);
  });
});

describe('estCoupureReseau', () => {
  it('reconnaît une requête coupée en route, quel que soit le navigateur', () => {
    for (const message of [
      'network error', // Chrome, vu le 2026-10-07 sur /admin/dashboard
      'Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.',
      'Connection closed.', 'The network connection was lost.', 'net::ERR_NETWORK_CHANGED',
    ]) {
      expect(estCoupureReseau(message), message).toBe(true);
    }
  });

  it('ne masque pas une vraie erreur de rendu', () => {
    for (const message of [
      "Cannot read properties of undefined (reading 'map')",
      'An error occurred in the Server Components render.',
      'Minified React error #418', '', null, undefined,
    ]) {
      expect(estCoupureReseau(message), String(message)).toBe(false);
    }
  });
});
