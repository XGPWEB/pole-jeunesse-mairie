import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createHash } from 'crypto';
import bcrypt from 'bcryptjs';

/**
 * Le courriel est le seul canal par lequel le jeton en clair sort du serveur :
 * on intercepte l'envoi pour récupérer le lien, comme le ferait le titulaire.
 */
const courriel = vi.hoisted(() => ({
  envois: [] as { email: string; username: string; lien: string; expireMinutes: number }[],
  echec: false,
}));
vi.mock('@/app/animateurs/emailService', () => ({
  envoyerLienReinitialisation: vi.fn(async (data: { email: string; username: string; lien: string; expireMinutes: number }) => {
    if (courriel.echec) return { success: false, error: 'SMTP indisponible' };
    courriel.envois.push(data);
    return { success: true };
  }),
}));

import pool from '@/lib/db';
import { type JWTPayload } from '@/lib/auth';
import { POST as forgot } from '@/app/api/auth/forgot-password/route';
import { POST as resetPassword } from '@/app/api/auth/reset-password/route';
import { POST as confirm } from '@/app/api/auth/reset-password/confirm/route';
import { POST as login } from '@/app/api/auth/login/route';
import { GET as me } from '@/app/api/animateurs/me/route';
import { GET as notifGet } from '@/app/api/notifications/route';
import { resetDb, cookieFor, jsonRequest } from './helpers';
import { MOT_DE_PASSE, billetProvisoire, etatCompte, seedCompte, seedNotification } from './securite-helpers';

afterAll(async () => { await pool.end(); });

beforeEach(async () => {
  await resetDb();
  courriel.envois.length = 0;
  courriel.echec = false;
});

let compteurIp = 0;
const ip = () => ({ 'x-real-ip': `192.0.2.${++compteurIp % 250}-${compteurIp}` });

const demander = (username: unknown, headers = ip()) =>
  forgot(jsonRequest('http://localhost/api/auth/forgot-password', { method: 'POST', headers, body: { username } }));
const confirmer = (token: string, newPassword: string) =>
  confirm(jsonRequest('http://localhost/api/auth/reset-password/confirm', { method: 'POST', headers: ip(), body: { token, newPassword } }));
const jetonDuLien = (lien: string) => decodeURIComponent(lien.split('#token=')[1]);
const jetons = async () => (await pool.query('SELECT * FROM password_reset_tokens ORDER BY created_at')).rows;
const motDePasseValide = async (id: string, mdp: string) => bcrypt.compare(mdp, (await etatCompte(id)).password_hash);

describe('forgot-password — demande anonyme, non destructive', () => {
  it('compte admin : le hash N’EST PAS modifié ; un lien à usage unique part à l’adresse de la fiche', async () => {
    const admin = await seedCompte({ role: 'admin', email: 'admin@example.test' });
    const avant = await etatCompte(admin.id);

    const res = await demander(admin.username);
    expect(res.status).toBe(200);

    // Rien n'a changé sur le compte : mot de passe et sessions intacts.
    expect(await etatCompte(admin.id)).toEqual(avant);
    expect(await motDePasseValide(admin.id, MOT_DE_PASSE)).toBe(true);

    expect(courriel.envois).toHaveLength(1);
    expect(courriel.envois[0].email).toBe('admin@example.test');
    expect(courriel.envois[0].lien).toMatch(/\/reinitialisation#token=.{40,}$/);
  });

  it('le jeton est stocké haché (SHA-256), jamais en clair, avec une expiration courte', async () => {
    const admin = await seedCompte({ role: 'admin', email: 'admin@example.test' });
    await demander(admin.username);
    const jeton = jetonDuLien(courriel.envois[0].lien);

    const [ligne] = await jetons();
    expect(ligne.token_hash).toBe(createHash('sha256').update(jeton).digest('hex'));
    expect(JSON.stringify(ligne)).not.toContain(jeton);
    expect(ligne.used_at).toBeNull();
    expect(ligne.tenant_id).toBe('nogent');
    const dureeMin = (new Date(ligne.expires_at).getTime() - Date.now()) / 60_000;
    expect(dureeMin).toBeGreaterThan(25);
    expect(dureeMin).toBeLessThanOrEqual(30);
  });

  it('réponse strictement identique : compte admin, animateur, inconnu, suspendu, champ absent', async () => {
    const admin = await seedCompte({ role: 'admin', email: 'a@example.test' });
    const animateur = await seedCompte({ role: 'animateur' });
    const suspendu = await seedCompte({ role: 'admin', statut: 'suspendu', email: 's@example.test' });

    const corps = async (u: unknown) => {
      const res = await demander(u);
      return JSON.stringify([res.status, await res.json()]);
    };
    const reference = await corps('personne.inconnue');
    expect(await corps(admin.username)).toBe(reference);
    expect(await corps(animateur.username)).toBe(reference);
    expect(await corps(suspendu.username)).toBe(reference);
    expect(await corps(undefined)).toBe(reference);
    expect(JSON.parse(reference)[0]).toBe(200);

    // Compte suspendu : ni lien, ni notification.
    expect(courriel.envois.map(e => e.email)).toEqual(['a@example.test']);
  });

  it('échec d’envoi : même réponse, aucun jeton utilisable ne reste en base, hash intact', async () => {
    const admin = await seedCompte({ role: 'admin', email: 'admin@example.test' });
    courriel.echec = true;
    const res = await demander(admin.username);
    expect(res.status).toBe(200);
    expect(await jetons()).toHaveLength(0);
    expect(await motDePasseValide(admin.id, MOT_DE_PASSE)).toBe(true);
  });

  it('rate-limit conservé : 4e demande depuis la même adresse → 429', async () => {
    const meme = { 'x-real-ip': '198.51.100.7' };
    for (let i = 0; i < 3; i++) expect((await demander('quelquun', meme)).status).toBe(200);
    expect((await demander('quelquun', meme)).status).toBe(429);
  });

  it('une demande répétée n’invalide pas le lien que le titulaire vient de recevoir', async () => {
    const admin = await seedCompte({ role: 'admin', email: 'admin@example.test' });
    await demander(admin.username);
    await demander(admin.username); // un tiers insiste
    expect(courriel.envois).toHaveLength(1);
    expect((await confirmer(jetonDuLien(courriel.envois[0].lien), 'Nouveau!Pass2')).status).toBe(200);
  });
});

describe('forgot-password — notification rattachée au tenant du compte', () => {
  it('animateur sans adresse d’une autre commune : la demande arrive chez SES admins, pas chez ceux de Nogent', async () => {
    const adminNogent = await seedCompte({ role: 'admin', tenantId: 'nogent' });
    const adminVincennes = await seedCompte({ role: 'admin', tenantId: 'vincennes' });
    const animateur = await seedCompte({ role: 'animateur', tenantId: 'vincennes' });

    expect((await demander(animateur.username)).status).toBe(200);

    const { rows } = await pool.query(`SELECT tenant_id, type, cible, from_animateur_id FROM notifications`);
    expect(rows).toEqual([{ tenant_id: 'vincennes', type: 'reset-request', cible: 'admin', from_animateur_id: animateur.id }]);

    const vues = async (admin: JWTPayload) => {
      const res = await notifGet(jsonRequest('http://localhost/api/notifications', { cookie: await cookieFor(admin) }));
      return (await res.json()).notifications as { fromAnimateurEmail: string }[];
    };
    expect(await vues(adminNogent)).toHaveLength(0);
    const chezVincennes = await vues(adminVincennes);
    expect(chezVincennes).toHaveLength(1);

    // Pas d'adresse sur la fiche : aucun lien n'est émis sans un admin.
    expect(courriel.envois).toHaveLength(0);
    expect(await jetons()).toHaveLength(0);
    expect(await motDePasseValide(animateur.id, MOT_DE_PASSE)).toBe(true);
  });

  it('animateur AVEC adresse : le lien part directement à SA fiche, sans notification ni changement du mot de passe', async () => {
    const animateur = await seedCompte({ role: 'animateur', tenantId: 'vincennes', email: 'anim@vincennes.test' });
    const avant = await etatCompte(animateur.id);

    expect((await demander(animateur.username)).status).toBe(200);

    expect(await etatCompte(animateur.id)).toEqual(avant);
    expect(courriel.envois.map(e => e.email)).toEqual(['anim@vincennes.test']);
    expect(courriel.envois[0].expireMinutes).toBe(30);
    const [ligne] = await jetons();
    expect(ligne.tenant_id).toBe('vincennes');
    expect((await pool.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n).toBe(0);

    // Même temporisation que pour un admin, puis le lien sert jusqu'au bout.
    await demander(animateur.username);
    expect(courriel.envois).toHaveLength(1);
    expect((await confirmer(jetonDuLien(courriel.envois[0].lien), 'Anim!Pass42')).status).toBe(200);
    expect(await motDePasseValide(animateur.id, 'Anim!Pass42')).toBe(true);
  });

  it('une seule demande en attente par compte (pas d’inondation du tableau de bord)', async () => {
    const animateur = await seedCompte({ role: 'animateur' });
    await demander(animateur.username);
    await demander(animateur.username);
    expect((await pool.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n).toBe(1);
  });
});

describe('forgot-password — compte superadmin (tenant system)', () => {
  const audits = async (id: string) =>
    (await pool.query(`SELECT action, tenant_id, details FROM audit_log WHERE animateur_id = $1`, [id])).rows;

  it('avec adresse : lien envoyé à l’adresse de SA fiche, pas de notification perdue, même réponse', async () => {
    const reference = JSON.stringify(await (await demander('personne.inconnue')).json());
    const superadmin = await seedCompte({ role: 'superadmin', tenantId: 'system', email: 'super@example.test' });
    const avant = await etatCompte(superadmin.id);

    const res = await demander(superadmin.username);
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toBe(reference);

    expect(await etatCompte(superadmin.id)).toEqual(avant);
    expect(courriel.envois).toHaveLength(1);
    expect(courriel.envois[0].email).toBe('super@example.test');
    expect(courriel.envois[0].expireMinutes).toBe(30);
    const [ligne] = await jetons();
    expect(ligne.tenant_id).toBe('system');
    expect(ligne.created_by).toBeNull();
    expect((await pool.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n).toBe(0);
    expect(await audits(superadmin.id)).toEqual([
      { action: 'PASSWORD_RESET_REQUESTED', tenant_id: 'system', details: { envoye: true } },
    ]);

    // Même temporisation que pour un admin : une seconde demande ne renvoie rien.
    await demander(superadmin.username);
    expect(courriel.envois).toHaveLength(1);

    // Le lien fonctionne jusqu'au bout.
    expect((await confirmer(jetonDuLien(courriel.envois[0].lien), 'Super!Pass9')).status).toBe(200);
    expect(await motDePasseValide(superadmin.id, 'Super!Pass9')).toBe(true);
  });

  it('sans adresse : aucun lien (pas de repli sur MAIL_ADMIN), aucune notification morte, trace d’audit, même réponse', async () => {
    vi.stubEnv('MAIL_ADMIN', 'repli@example.test');
    const erreurs = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const reference = JSON.stringify(await (await demander('personne.inconnue')).json());
      const superadmin = await seedCompte({ role: 'superadmin', tenantId: 'system' });

      const res = await demander(superadmin.username);
      expect(res.status).toBe(200);
      expect(JSON.stringify(await res.json())).toBe(reference);

      expect(courriel.envois).toHaveLength(0);
      expect(await jetons()).toHaveLength(0);
      expect((await pool.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n).toBe(0);
      expect(await motDePasseValide(superadmin.id, MOT_DE_PASSE)).toBe(true);
      expect(await audits(superadmin.id)).toEqual([
        { action: 'PASSWORD_RESET_REQUESTED', tenant_id: 'system', details: { envoye: false, motif: 'sans_adresse' } },
      ]);
      expect(erreurs.mock.calls.some(([m]) => String(m).includes('superadmin sans adresse'))).toBe(true);
    } finally {
      erreurs.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});

describe('reset-password/confirm — jeton à usage unique', () => {
  let admin: JWTPayload;
  let jeton: string;

  beforeEach(async () => {
    admin = await seedCompte({ role: 'admin', email: 'admin@example.test' });
    await demander(admin.username);
    jeton = jetonDuLien(courriel.envois[0].lien);
  });

  it('change le mot de passe, révoque les sessions existantes, et ne sert qu’une fois', async () => {
    const copie = await cookieFor(admin);
    expect((await me(jsonRequest('http://localhost/api/animateurs/me', { cookie: copie }))).status).toBe(200);

    expect((await confirmer(jeton, 'Nouveau!Pass2')).status).toBe(200);
    expect(await motDePasseValide(admin.id, 'Nouveau!Pass2')).toBe(true);
    expect(await motDePasseValide(admin.id, MOT_DE_PASSE)).toBe(false);

    // Révocation : la session ouverte avant le changement est refusée, y
    // compris après reconnexion avec le nouveau mot de passe.
    expect((await me(jsonRequest('http://localhost/api/animateurs/me', { cookie: copie }))).status).toBe(401);
    const relog = await login(jsonRequest('http://localhost/api/auth/login', {
      method: 'POST', headers: ip(), body: { username: admin.username, password: 'Nouveau!Pass2' },
    }));
    expect(relog.status).toBe(200);
    expect((await me(jsonRequest('http://localhost/api/animateurs/me', { cookie: copie }))).status).toBe(401);

    // Second usage du même lien.
    const rejeu = await confirmer(jeton, 'Encore!Pass3');
    expect(rejeu.status).toBe(400);
    expect(await motDePasseValide(admin.id, 'Nouveau!Pass2')).toBe(true);
  });

  it('deux consommations CONCURRENTES du même jeton : une seule réussit, et c’est son mot de passe qui est en base', async () => {
    const candidats = ['Premier!Pass1', 'Second!Pass2', 'Troisieme!Pass3', 'Quatrieme!Pass4'];
    const reponses = await Promise.all(candidats.map((mdp) => confirmer(jeton, mdp)));
    const statuts = reponses.map(r => r.status);
    expect(statuts.filter(s => s === 200)).toHaveLength(1);
    expect(statuts.filter(s => s === 400)).toHaveLength(3);

    const gagnant = candidats[statuts.indexOf(200)];
    expect(await motDePasseValide(admin.id, gagnant)).toBe(true);
    // Une seule révocation a eu lieu.
    expect((await etatCompte(admin.id)).session_version).toBe(1);
  });

  it('jeton expiré : refusé, hash et sessions intacts', async () => {
    await pool.query(`UPDATE password_reset_tokens SET expires_at = NOW() - INTERVAL '1 second'`);
    const avant = await etatCompte(admin.id);
    expect((await confirmer(jeton, 'Nouveau!Pass2')).status).toBe(400);
    expect(await etatCompte(admin.id)).toEqual(avant);
  });

  it('jeton inconnu ou altéré : refusé avec le même message qu’un jeton expiré', async () => {
    const inconnu = await confirmer(`${jeton}x`, 'Nouveau!Pass2');
    await pool.query(`UPDATE password_reset_tokens SET expires_at = NOW() - INTERVAL '1 second'`);
    const expire = await confirmer(jeton, 'Nouveau!Pass2');
    expect(inconnu.status).toBe(400);
    expect(await inconnu.json()).toEqual(await expire.json());
    expect(await motDePasseValide(admin.id, MOT_DE_PASSE)).toBe(true);
  });

  it('mot de passe trop faible : refusé SANS consommer le jeton', async () => {
    expect((await confirmer(jeton, 'faible')).status).toBe(400);
    expect((await confirmer(jeton, 'sansmajuscule!1')).status).toBe(400);
    expect((await jetons())[0].used_at).toBeNull();
    expect((await confirmer(jeton, 'Correct!Pass2')).status).toBe(200);
  });

  it('compte suspendu entre l’émission et l’usage : refusé, hash intact', async () => {
    await pool.query(`UPDATE animateurs SET statut = 'suspendu' WHERE id = $1`, [admin.id]);
    expect((await confirmer(jeton, 'Nouveau!Pass2')).status).toBe(400);
    expect(await motDePasseValide(admin.id, MOT_DE_PASSE)).toBe(true);
  });

  it('un nouveau lien neutralise le précédent', async () => {
    await pool.query(`UPDATE password_reset_tokens SET created_at = NOW() - INTERVAL '10 minutes'`);
    await demander(admin.username);
    expect(courriel.envois).toHaveLength(2);
    expect((await confirmer(jeton, 'Nouveau!Pass2')).status).toBe(400);
    expect((await confirmer(jetonDuLien(courriel.envois[1].lien), 'Nouveau!Pass2')).status).toBe(200);
  });
});

describe('reset-password — déclenché par un admin', () => {
  let admin: JWTPayload;
  let animateur: JWTPayload;

  beforeEach(async () => {
    admin = await seedCompte({ role: 'admin' });
    animateur = await seedCompte({ role: 'animateur', email: 'anim@example.test' });
  });

  const declencher = (cookie: string | undefined, body: unknown) =>
    resetPassword(jsonRequest('http://localhost/api/auth/reset-password', { method: 'POST', cookie, body }));

  it('billet 2FA provisoire d’un admin : 401, aucun hash modifié, aucun courriel (constat 2)', async () => {
    const avant = await etatCompte(animateur.id);
    const res = await declencher(`pj_token=${await billetProvisoire(admin)}`, { animateurId: animateur.id });
    expect(res.status).toBe(401);
    expect(await etatCompte(animateur.id)).toEqual(avant);
    expect(courriel.envois).toHaveLength(0);
    expect(await jetons()).toHaveLength(0);
  });

  it('admin valide : envoie un lien à l’animateur SANS toucher à son mot de passe, et retire la demande', async () => {
    const notifId = await seedNotification({ tenantId: 'nogent', type: 'reset-request', cible: 'admin', fromAnimateurId: animateur.id });
    const avant = await etatCompte(animateur.id);

    const res = await declencher(await cookieFor(admin), { animateurId: animateur.id, notifId });
    expect(res.status).toBe(200);
    const corps = await res.json();
    // La réponse ne contient ni mot de passe ni jeton.
    expect(Object.keys(corps).sort()).toEqual(['message', 'success']);

    expect(await etatCompte(animateur.id)).toEqual(avant);
    expect(courriel.envois).toHaveLength(1);
    expect(courriel.envois[0].email).toBe('anim@example.test');
    expect(JSON.stringify(corps)).not.toContain(jetonDuLien(courriel.envois[0].lien));
    expect((await pool.query('SELECT count(*)::int AS n FROM notifications WHERE id = $1', [notifId])).rows[0].n).toBe(0);

    // Le lien permet ensuite à l'animateur de choisir son mot de passe.
    expect((await confirmer(jetonDuLien(courriel.envois[0].lien), 'Choisi!Pass5')).status).toBe(200);
    expect(await motDePasseValide(animateur.id, 'Choisi!Pass5')).toBe(true);
  });

  it('animateur d’une autre structure : 404, rien n’est émis', async () => {
    const etranger = await seedCompte({ role: 'animateur', tenantId: 'vincennes', email: 'x@vincennes.test' });
    const res = await declencher(await cookieFor(admin), { animateurId: etranger.id });
    expect(res.status).toBe(404);
    expect(courriel.envois).toHaveLength(0);
    expect(await jetons()).toHaveLength(0);
  });

  it('notifId d’une autre structure, ou d’un autre type : la notification n’est PAS supprimée (constat 17)', async () => {
    const etrangere = await seedNotification({ tenantId: 'vincennes', type: 'reset-request', cible: 'admin', fromAnimateurId: animateur.id });
    const autreType = await seedNotification({ tenantId: 'nogent', type: 'notification', cible: 'Tous' });
    const autreCompte = await seedNotification({ tenantId: 'nogent', type: 'reset-request', cible: 'admin', fromAnimateurId: admin.id });

    for (const notifId of [etrangere, autreType, autreCompte]) {
      const res = await declencher(await cookieFor(admin), { animateurId: animateur.id, notifId });
      expect(res.status).toBe(200);
    }
    const restantes = (await pool.query('SELECT id FROM notifications ORDER BY id')).rows.map(r => r.id);
    expect(restantes).toEqual([etrangere, autreType, autreCompte].sort());
  });

  it('échec d’envoi : 502, mot de passe intact, demande conservée, aucun jeton en base', async () => {
    const notifId = await seedNotification({ tenantId: 'nogent', type: 'reset-request', cible: 'admin', fromAnimateurId: animateur.id });
    courriel.echec = true;
    const res = await declencher(await cookieFor(admin), { animateurId: animateur.id, notifId });
    expect(res.status).toBe(502);
    expect(await motDePasseValide(animateur.id, MOT_DE_PASSE)).toBe(true);
    expect(await jetons()).toHaveLength(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM notifications WHERE id = $1', [notifId])).rows[0].n).toBe(1);
  });

  it('fiche sans adresse e-mail : 409 explicite plutôt qu’un mot de passe changé sans que personne le connaisse', async () => {
    const sansMail = await seedCompte({ role: 'animateur' });
    const res = await declencher(await cookieFor(admin), { animateurId: sansMail.id });
    expect(res.status).toBe(409);
    expect(await motDePasseValide(sansMail.id, MOT_DE_PASSE)).toBe(true);
  });
});
