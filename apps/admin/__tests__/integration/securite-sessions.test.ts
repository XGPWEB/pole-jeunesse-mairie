import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// Aucun courriel réel : la route reset-password envoie un lien par SMTP.
vi.mock('@/app/animateurs/emailService', () => ({
  envoyerLienReinitialisation: vi.fn(async () => ({ success: true })),
}));

import pool from '@/lib/db';
import { signJWT, verifyJWT, type JWTPayload } from '@/lib/auth';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { POST as resetPassword } from '@/app/api/auth/reset-password/route';
import { GET as totpStatus, POST as totpSetup } from '@/app/api/auth/totp/setup/route';
import { GET as me } from '@/app/api/animateurs/me/route';
import { PATCH as profil } from '@/app/api/animateurs/profil/route';
import { GET as pointagesGet, DELETE as pointagesDelete } from '@/app/api/pointages/route';
import { POST as notifPost, PATCH as notifPatch } from '@/app/api/notifications/route';
import { GET as parametresGet, PUT as parametresPut } from '@/app/api/parametres/route';
import { resetDb, cookieFor, jsonRequest } from './helpers';
import {
  MOT_DE_PASSE, billetProvisoire, cookieDeReponse, etatCompte, seedCompte,
  seedJeune, seedNotification, seedPointage,
} from './securite-helpers';

afterAll(async () => { await pool.end(); });

type Appel = (cookie: string | undefined) => Promise<Response>;

/**
 * Opérations sensibles soumises à la matrice. `admin: true` = réservée au rôle
 * admin. Chaque opération reçoit des identifiants de ressources EXISTANTES du
 * tenant, pour qu'un refus ne puisse pas être confondu avec un 404.
 */
interface Operation { nom: string; admin: boolean; appel: Appel }

async function operations(cibleId: string, pointageId: string, notifId: string): Promise<Operation[]> {
  const req = (url: string, method: string, cookie: string | undefined, body?: unknown) =>
    jsonRequest(`http://localhost${url}`, { method, cookie, body });
  return [
    { nom: 'POST /api/auth/reset-password', admin: true,
      appel: (c) => resetPassword(req('/api/auth/reset-password', 'POST', c, { animateurId: cibleId })) },
    { nom: 'GET /api/auth/totp/setup', admin: true,
      appel: (c) => totpStatus(req('/api/auth/totp/setup', 'GET', c)) },
    { nom: 'POST /api/auth/totp/setup (start)', admin: true,
      appel: (c) => totpSetup(req('/api/auth/totp/setup', 'POST', c, { action: 'start', password: MOT_DE_PASSE })) },
    { nom: 'POST /api/notifications', admin: true,
      appel: (c) => notifPost(req('/api/notifications', 'POST', c, { titre: 'T', message: 'M' })) },
    { nom: 'GET /api/parametres', admin: true,
      appel: (c) => parametresGet(req('/api/parametres', 'GET', c)) },
    { nom: 'PUT /api/parametres', admin: true,
      appel: (c) => parametresPut(req('/api/parametres', 'PUT', c, { cle: 'valeur' })) },
    { nom: 'GET /api/animateurs/me', admin: false,
      appel: (c) => me(req('/api/animateurs/me', 'GET', c)) },
    { nom: 'PATCH /api/animateurs/profil', admin: false,
      appel: (c) => profil(req('/api/animateurs/profil', 'PATCH', c, { poste: 'Référent' })) },
    { nom: 'GET /api/pointages', admin: false,
      appel: (c) => pointagesGet(req('/api/pointages?date=2026-10-06', 'GET', c)) },
    { nom: 'PATCH /api/notifications', admin: false,
      appel: (c) => notifPatch(req('/api/notifications', 'PATCH', c, { id: notifId, action: 'lu' })) },
    { nom: 'DELETE /api/pointages?id=', admin: false,
      appel: (c) => pointagesDelete(req(`/api/pointages?id=${pointageId}`, 'DELETE', c)) },
  ];
}

describe('matrice de permissions — opérations sensibles', () => {
  let admin: JWTPayload;
  let cible: JWTPayload;
  let ops: Operation[];
  let pointageId: string;

  /** Instantané de tout ce qu'une opération refusée ne doit pas avoir modifié. */
  async function instantane() {
    const [comptes, pointages, notifs, params, jetons] = await Promise.all([
      pool.query('SELECT id, role, statut, password_hash, poste, session_version, totp_pending_secret FROM animateurs ORDER BY id'),
      pool.query('SELECT id FROM pointages ORDER BY id'),
      pool.query('SELECT id, lu_par, dismissed_par FROM notifications ORDER BY id'),
      pool.query('SELECT id, data FROM parametres ORDER BY id'),
      pool.query('SELECT count(*)::int AS n FROM password_reset_tokens'),
    ]);
    return JSON.stringify([comptes.rows, pointages.rows, notifs.rows, params.rows, jetons.rows]);
  }

  beforeEach(async () => {
    await resetDb();
    admin = await seedCompte({ role: 'admin' });
    cible = await seedCompte({ role: 'animateur', email: 'cible@example.test' });
    const jeuneId = await seedJeune('nogent');
    pointageId = await seedPointage({ tenantId: 'nogent', jeuneId });
    const notifId = await seedNotification({ tenantId: 'nogent', cible: 'Tous' });
    ops = await operations(cible.id, pointageId, notifId);
  });

  async function attendreRefusSansEffet(cookie: string | undefined, statutsAttendus: (op: Operation) => number) {
    const avant = await instantane();
    for (const op of ops) {
      const res = await op.appel(cookie);
      expect(res.status, op.nom).toBe(statutsAttendus(op));
    }
    expect(await instantane(), 'aucune écriture ne doit avoir eu lieu').toBe(avant);
  }

  it('anonyme : 401 partout, rien n’est modifié', async () => {
    await attendreRefusSansEffet(undefined, () => 401);
  });

  it('billet 2FA provisoire présenté comme cookie de session : 401 partout, rien n’est modifié', async () => {
    const billet = await billetProvisoire(admin);
    // Le billet est bien un JWT valide et signé — c'est son TYPE qui le disqualifie.
    expect((await verifyJWT(billet))?.type).toBe('totp-pending');
    await attendreRefusSansEffet(`pj_token=${billet}`, () => 401);
  });

  it('jeton expiré : 401 partout', async () => {
    const expire = await signJWT(admin, -10);
    await attendreRefusSansEffet(`pj_token=${expire}`, () => 401);
  });

  it('session révoquée (version de session incrémentée) : 401 partout, rien n’est modifié', async () => {
    const cookie = await cookieFor(admin);
    await pool.query('UPDATE animateurs SET session_version = session_version + 1, session_invalidated_at = NOW() WHERE id = $1', [admin.id]);
    await attendreRefusSansEffet(cookie, () => 401);
  });

  it.each(['suspendu', 'inactif'])('compte %s : 401 partout, rien n’est modifié', async (statut) => {
    const cookie = await cookieFor(admin);
    await pool.query('UPDATE animateurs SET statut = $2 WHERE id = $1', [admin.id, statut]);
    await attendreRefusSansEffet(cookie, () => 401);
  });

  it('compte supprimé : 401 partout', async () => {
    const cookie = await cookieFor(admin);
    await pool.query('DELETE FROM animateurs WHERE id = $1', [admin.id]);
    await attendreRefusSansEffet(cookie, () => 401);
  });

  it('admin rétrogradé SANS révocation : le rôle en base fait foi, pas celui du JWT', async () => {
    const cookie = await cookieFor(admin);
    // Rétrogradation hors de l'application (psql, script…) : aucune révocation.
    // Le jeton reste valide et affirme toujours role=admin.
    await pool.query(`UPDATE animateurs SET role = 'animateur' WHERE id = $1`, [admin.id]);
    expect((await verifyJWT(cookie.replace('pj_token=', '')))?.role).toBe('admin');

    const avant = await instantane();
    for (const op of ops.filter(o => o.admin)) {
      const res = await op.appel(cookie);
      expect(res.status, op.nom).toBe(403);
    }
    expect(await instantane()).toBe(avant);

    // Il garde en revanche ses droits d'animateur.
    const moi = await me(jsonRequest('http://localhost/api/animateurs/me', { cookie }));
    expect(moi.status).toBe(200);
    expect((await moi.json()).role).toBe('animateur');
  });

  it('animateur : 403 sur les opérations admin, accès aux opérations communes', async () => {
    const cookie = await cookieFor(cible);
    const avant = await instantane();
    for (const op of ops.filter(o => o.admin)) {
      expect((await op.appel(cookie)).status, op.nom).toBe(403);
    }
    expect(await instantane()).toBe(avant);
    for (const op of ops.filter(o => !o.admin)) {
      expect((await op.appel(cookie)).status, op.nom).toBe(200);
    }
  });

  it('session admin valide : chaque opération est autorisée (témoin de la matrice)', async () => {
    const cookie = await cookieFor(admin);
    for (const op of ops) {
      expect((await op.appel(cookie)).status, op.nom).toBe(200);
    }
  });

  it('le tenant et l’espace viennent de la base, pas du JWT', async () => {
    // Jeton forgé « légitimement » avant un changement d'affectation.
    const cookie = await cookieFor({ ...admin, tenant_id: 'autre-commune', espaceAssigne: 'Ailleurs' });
    const res = await me(jsonRequest('http://localhost/api/animateurs/me', { cookie }));
    expect(res.status).toBe(200);
    const corps = await res.json();
    expect(corps.tenantId).toBe('nogent');
    expect(corps.espaceAssigne).toBe('Collégiens');
  });

  it('logout avec un billet provisoire ne révoque rien', async () => {
    const billet = await billetProvisoire(admin);
    const avant = await etatCompte(admin.id);
    const res = await logout(jsonRequest('http://localhost/api/auth/logout', { method: 'POST', cookie: `pj_token=${billet}` }));
    expect(res.status).toBe(200);
    const apres = await etatCompte(admin.id);
    expect(apres.session_version).toBe(avant.session_version);
    expect(apres.session_invalidated_at).toBeNull();
  });
});

describe('révocation durable des sessions', () => {
  let compte: JWTPayload;

  beforeEach(async () => {
    await resetDb();
    compte = await seedCompte({ role: 'animateur' });
  });
  afterEach(() => { vi.useRealTimers(); });

  async function seConnecter(): Promise<string> {
    const res = await login(jsonRequest('http://localhost/api/auth/login', {
      method: 'POST', body: { username: compte.username, password: MOT_DE_PASSE },
    }));
    expect(res.status).toBe(200);
    const cookie = cookieDeReponse(res);
    expect(cookie).not.toBeNull();
    return cookie as string;
  }
  const statutMe = async (cookie: string) =>
    (await me(jsonRequest('http://localhost/api/animateurs/me', { cookie }))).status;

  it('copie de JWT avant logout, puis reconnexion DANS LA MÊME SECONDE : la copie reste refusée', async () => {
    // Horloge figée : l'ancien et le nouveau jeton ont exactement le même `iat`.
    // C'est le cas que l'horodatage session_invalidated_at ne pouvait pas trancher.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date());

    const copie = await seConnecter();
    expect(await statutMe(copie)).toBe(200);

    await logout(jsonRequest('http://localhost/api/auth/logout', { method: 'POST', cookie: copie }));
    expect(await statutMe(copie)).toBe(401);

    const nouveau = await seConnecter();
    const iat = async (c: string) => (await verifyJWT(c.replace('pj_token=', '')))?.iat;
    expect(await iat(nouveau)).toBe(await iat(copie));

    expect(await statutMe(nouveau)).toBe(200);
    expect(await statutMe(copie), 'la reconnexion ne doit pas réactiver la copie').toBe(401);
  });

  it('la reconnexion ne remet jamais session_invalidated_at à NULL', async () => {
    const cookie = await seConnecter();
    await logout(jsonRequest('http://localhost/api/auth/logout', { method: 'POST', cookie }));
    const apresLogout = await etatCompte(compte.id);
    expect(apresLogout.session_invalidated_at).not.toBeNull();
    expect(apresLogout.session_version).toBe(1);

    await seConnecter();
    const apresLogin = await etatCompte(compte.id);
    expect(apresLogin.session_invalidated_at).not.toBeNull();
    expect(apresLogin.session_version).toBe(1);
  });

  it('copie de JWT avant changement de mot de passe, puis reconnexion : la copie reste refusée', async () => {
    const copie = await seConnecter();
    const nouveauMdp = 'Nouveau!Pass2';
    const res = await profil(jsonRequest('http://localhost/api/animateurs/profil', {
      method: 'PATCH', cookie: copie, body: { currentPassword: MOT_DE_PASSE, newPassword: nouveauMdp },
    }));
    expect(res.status).toBe(200);
    expect(await statutMe(copie)).toBe(401);

    const relog = await login(jsonRequest('http://localhost/api/auth/login', {
      method: 'POST', body: { username: compte.username, password: nouveauMdp },
    }));
    const nouveau = cookieDeReponse(relog) as string;
    expect(await statutMe(nouveau)).toBe(200);
    expect(await statutMe(copie)).toBe(401);
  });

  it('ancien jeton sans `sv` (émis avant la migration) : refusé après une révocation, même après reconnexion', async () => {
    const { sv: _sv, ...sansVersion } = compte;
    const ancien = `pj_token=${await signJWT(sansVersion)}`;
    // Compatibilité : tant qu'aucune révocation n'a eu lieu, il est accepté.
    expect(await statutMe(ancien)).toBe(200);

    const courant = await seConnecter();
    await logout(jsonRequest('http://localhost/api/auth/logout', { method: 'POST', cookie: courant }));
    expect(await statutMe(ancien)).toBe(401);
    await seConnecter();
    expect(await statutMe(ancien)).toBe(401);
  });

  it('ancien jeton sans `sv` : refusé par l’horodatage posé par la migration (session_version encore à 0)', async () => {
    const { sv: _sv, ...sansVersion } = compte;
    const ancien = `pj_token=${await signJWT(sansVersion)}`;
    // Ce que fait la migration à sa première exécution.
    await pool.query('UPDATE animateurs SET session_invalidated_at = NOW() + INTERVAL \'1 second\' WHERE id = $1', [compte.id]);
    expect(await statutMe(ancien)).toBe(401);
    // Un jeton versionné émis ensuite n'est pas concerné par cet horodatage.
    expect(await statutMe(await seConnecter())).toBe(200);
  });

  it('un jeton portant une version future ou forgée différente de la base est refusé', async () => {
    const cookie = await cookieFor({ ...compte, sv: 5 });
    expect(await statutMe(cookie)).toBe(401);
  });
});
