import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'crypto';

import pool from '@/lib/db';
import { type JWTPayload } from '@/lib/auth';
import { consommerCodeTotp, genererSecretTotp } from '@/lib/totp';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as verifyTotp } from '@/app/api/auth/verify-totp/route';
import { GET as totpStatus, POST as totpSetup } from '@/app/api/auth/totp/setup/route';
import { resetDb, cookieFor, jsonRequest } from './helpers';
import { MOT_DE_PASSE, activerTotp, codeTotp, cookieDeReponse, etatCompte, seedCompte } from './securite-helpers';

afterAll(async () => { await pool.end(); });

let admin: JWTPayload;
let cookie: string;

beforeEach(async () => {
  await resetDb();
  admin = await seedCompte({ role: 'admin' });
  cookie = await cookieFor(admin);
});

const setup = (body: unknown, c: string = cookie) =>
  totpSetup(jsonRequest('http://localhost/api/auth/totp/setup', { method: 'POST', cookie: c, body }));

/** IP distincte par requête : on teste le TOTP, pas la limite par adresse. */
const ipUnique = () => ({ 'x-real-ip': `10.0.${Math.floor(Math.random() * 250)}.${randomUUID().slice(0, 6)}` });

async function billet(): Promise<string> {
  const res = await login(jsonRequest('http://localhost/api/auth/login', {
    method: 'POST', headers: ipUnique(), body: { username: admin.username, password: MOT_DE_PASSE },
  }));
  const corps = await res.json();
  expect(corps.requiresTOTP).toBe(true);
  // L'étape mot de passe ne pose AUCUN cookie de session.
  expect(cookieDeReponse(res)).toBeNull();
  return corps.pendingToken as string;
}
const verifier = (pendingToken: string, code: string) =>
  verifyTotp(jsonRequest('http://localhost/api/auth/verify-totp', {
    method: 'POST', headers: ipUnique(), body: { pendingToken, code },
  }));

describe('TOTP — activation initiale', () => {
  it('exige le mot de passe ; le secret provisoire reste côté serveur et n’active rien', async () => {
    expect((await setup({ action: 'start' })).status).toBe(400);
    expect((await setup({ action: 'start', password: 'Mauvais!Pass0' })).status).toBe(403);
    expect((await etatCompte(admin.id)).totp_pending_secret).toBeNull();

    const res = await setup({ action: 'start', password: MOT_DE_PASSE });
    expect(res.status).toBe(200);
    const { secret, rotation } = await res.json();
    expect(rotation).toBe(false);

    const etat = await etatCompte(admin.id);
    expect(etat.totp_pending_secret).toBe(secret);
    expect(etat.totp_enabled).toBe(false);
    expect(etat.totp_secret).toBeNull();
    expect((await (await totpStatus(jsonRequest('http://localhost/api/auth/totp/setup', { cookie }))).json()))
      .toEqual({ enabled: false, pending: true });
  });

  it('un secret FOURNI PAR LE CLIENT n’est jamais installé (ancien vecteur d’attaque)', async () => {
    const secretAttaquant = genererSecretTotp();
    const codeAttaquant = codeTotp(admin.username, secretAttaquant);

    // Sans activation en cours : rien à confirmer.
    const sansPending = await setup({ action: 'enable', secret: secretAttaquant, code: codeAttaquant });
    expect(sansPending.status).toBe(400);

    // Avec une activation en cours : le code est validé contre le secret du
    // SERVEUR, le champ `secret` du client est ignoré.
    const { secret: secretServeur } = await (await setup({ action: 'start', password: MOT_DE_PASSE })).json();
    const avecPending = await setup({ action: 'enable', secret: secretAttaquant, code: codeAttaquant });
    expect(avecPending.status).toBe(400);

    const etat = await etatCompte(admin.id);
    expect(etat.totp_enabled).toBe(false);
    expect(etat.totp_secret).toBeNull();
    expect(etat.totp_pending_secret).toBe(secretServeur);
  });

  it('active le facteur avec un code du secret provisoire, puis l’exige à la connexion', async () => {
    const { secret } = await (await setup({ action: 'start', password: MOT_DE_PASSE })).json();
    const code = codeTotp(admin.username, secret);
    expect((await setup({ action: 'enable', code })).status).toBe(200);

    const etat = await etatCompte(admin.id);
    expect(etat.totp_enabled).toBe(true);
    expect(etat.totp_secret).toBe(secret);
    expect(etat.totp_pending_secret).toBeNull();

    // Le code qui a servi à l'activation ne peut pas être rejoué pour se connecter.
    const pending = await billet();
    expect((await verifier(pending, code)).status).toBe(401);
    // Le code du pas suivant, lui, passe.
    expect((await verifier(pending, codeTotp(admin.username, secret, 1))).status).toBe(200);
  });

  it('refuse un secret provisoire expiré', async () => {
    const { secret } = await (await setup({ action: 'start', password: MOT_DE_PASSE })).json();
    await pool.query(`UPDATE animateurs SET totp_pending_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`, [admin.id]);
    expect((await setup({ action: 'enable', code: codeTotp(admin.username, secret) })).status).toBe(400);
    expect((await etatCompte(admin.id)).totp_enabled).toBe(false);
  });

  it('deux confirmations concurrentes du même code : une seule acceptée', async () => {
    const { secret } = await (await setup({ action: 'start', password: MOT_DE_PASSE })).json();
    const code = codeTotp(admin.username, secret);
    const statuts = (await Promise.all([1, 2, 3, 4].map(() => setup({ action: 'enable', code })))).map(r => r.status);
    expect(statuts.filter(s => s === 200)).toHaveLength(1);
    expect(statuts.filter(s => s === 400)).toHaveLength(3);
    expect((await etatCompte(admin.id)).totp_secret).toBe(secret);
  });
});

describe('TOTP — rotation et désactivation d’un facteur actif', () => {
  let secretActuel: string;

  beforeEach(async () => {
    secretActuel = await activerTotp(admin.id);
  });

  it('rotation SANS le facteur actuel : refusée, le facteur en place n’est pas touché', async () => {
    // Session (cookie) + mot de passe, mais pas de code : insuffisant.
    const sansCode = await setup({ action: 'start', password: MOT_DE_PASSE });
    expect(sansCode.status).toBe(400);
    // Code faux.
    const codeFaux = await setup({ action: 'start', password: MOT_DE_PASSE, currentCode: '000000' });
    expect(codeFaux.status).toBe(400);
    // Code d'un secret choisi par l'attaquant.
    const autre = genererSecretTotp();
    const codeAutre = await setup({ action: 'start', password: MOT_DE_PASSE, currentCode: codeTotp(admin.username, autre) });
    expect(codeAutre.status).toBe(400);
    // Tentative de confirmation directe, à l'ancienne, avec son propre secret.
    const direct = await setup({ action: 'enable', secret: autre, code: codeTotp(admin.username, autre) });
    expect(direct.status).toBe(400);

    const etat = await etatCompte(admin.id);
    expect(etat.totp_secret).toBe(secretActuel);
    expect(etat.totp_enabled).toBe(true);
    expect(etat.totp_pending_secret).toBeNull();
  });

  it('rotation SANS mot de passe : refusée même avec un code valide du facteur actuel', async () => {
    const res = await setup({ action: 'start', currentCode: codeTotp(admin.username, secretActuel) });
    expect(res.status).toBe(400);
    expect((await etatCompte(admin.id)).totp_pending_secret).toBeNull();
    // Le code n'a pas été consommé par la tentative refusée.
    expect((await etatCompte(admin.id)).last_totp_step).toBeNull();
  });

  it('rotation complète : mot de passe + facteur actuel, puis code du nouveau ; l’ancien facteur ne vaut plus rien', async () => {
    const start = await setup({ action: 'start', password: MOT_DE_PASSE, currentCode: codeTotp(admin.username, secretActuel) });
    expect(start.status).toBe(200);
    const { secret: nouveau, rotation } = await start.json();
    expect(rotation).toBe(true);
    expect(nouveau).not.toBe(secretActuel);

    // Tant que la rotation n'est pas confirmée, l'ancien facteur reste actif.
    expect((await etatCompte(admin.id)).totp_secret).toBe(secretActuel);

    expect((await setup({ action: 'enable', code: codeTotp(admin.username, nouveau) })).status).toBe(200);
    expect((await etatCompte(admin.id)).totp_secret).toBe(nouveau);

    const pending = await billet();
    expect((await verifier(pending, codeTotp(admin.username, secretActuel, 1))).status).toBe(401);
    expect((await verifier(pending, codeTotp(admin.username, nouveau, 1))).status).toBe(200);
  });

  it('désactivation : exige mot de passe ET code du facteur actuel', async () => {
    const code = codeTotp(admin.username, secretActuel);
    expect((await setup({ action: 'disable', code })).status).toBe(400);
    expect((await setup({ action: 'disable', password: 'Mauvais!Pass0', code })).status).toBe(403);
    expect((await setup({ action: 'disable', password: MOT_DE_PASSE })).status).toBe(400);
    expect((await setup({ action: 'disable', password: MOT_DE_PASSE, code: '000000' })).status).toBe(400);
    expect((await etatCompte(admin.id)).totp_enabled).toBe(true);

    expect((await setup({ action: 'disable', password: MOT_DE_PASSE, code })).status).toBe(200);
    const etat = await etatCompte(admin.id);
    expect(etat.totp_enabled).toBe(false);
    expect(etat.totp_secret).toBeNull();
  });

  it('la réauthentification est limitée par compte (pas d’oracle de mot de passe pour une session volée)', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await setup({ action: 'start', password: `Faux!Pass${i}`, currentCode: '000000' })).status).toBe(403);
    }
    // 6e tentative : bloquée même avec le BON mot de passe et le bon code.
    const res = await setup({ action: 'start', password: MOT_DE_PASSE, currentCode: codeTotp(admin.username, secretActuel) });
    expect(res.status).toBe(429);
    expect((await etatCompte(admin.id)).totp_pending_secret).toBeNull();
  });

  it('un animateur ne peut pas gérer le TOTP (403), un billet provisoire non plus (401)', async () => {
    const animateur = await seedCompte({ role: 'animateur' });
    expect((await setup({ action: 'start', password: MOT_DE_PASSE }, await cookieFor(animateur))).status).toBe(403);
    expect((await setup({ action: 'disable', password: MOT_DE_PASSE, code: codeTotp(admin.username, secretActuel) }, `pj_token=${await billet()}`)).status).toBe(401);
    expect((await etatCompte(admin.id)).totp_enabled).toBe(true);
  });
});

describe('TOTP — antirejeu atomique sous concurrence (vrai PostgreSQL)', () => {
  let secret: string;

  beforeEach(async () => {
    secret = await activerTotp(admin.id);
  });

  it('consommerCodeTotp : 20 validations simultanées du même pas → une seule acceptée', async () => {
    const code = codeTotp(admin.username, secret);
    const resultats = await Promise.all(
      Array.from({ length: 20 }, () => consommerCodeTotp(admin.id, admin.username, secret, code)),
    );
    expect(resultats.filter(r => r === 'ok')).toHaveLength(1);
    expect(resultats.filter(r => r === 'rejoue')).toHaveLength(19);
  });

  it('verify-totp : validations concurrentes du même code → une seule session émise', async () => {
    const pending = await billet();
    const code = codeTotp(admin.username, secret);
    const reponses = await Promise.all([1, 2, 3, 4].map(() => verifier(pending, code)));
    const ok = reponses.filter(r => r.status === 200);
    expect(ok).toHaveLength(1);
    expect(reponses.filter(r => r.status === 401)).toHaveLength(3);
    // Un seul cookie de session a été posé.
    expect(reponses.filter(r => cookieDeReponse(r) !== null)).toHaveLength(1);
  });

  it('setup (disable) et verify-totp partagent l’antirejeu : le même code ne sert qu’une fois, tous flux confondus', async () => {
    const pending = await billet();
    const code = codeTotp(admin.username, secret);
    const [connexion, desactivation] = await Promise.all([
      verifier(pending, code),
      setup({ action: 'disable', password: MOT_DE_PASSE, code }),
    ]);
    const acceptes = [connexion.status === 200, desactivation.status === 200].filter(Boolean);
    expect(acceptes).toHaveLength(1);
  });

  it('rejeu séquentiel : un code accepté est refusé la seconde fois', async () => {
    const code = codeTotp(admin.username, secret);
    expect((await verifier(await billet(), code)).status).toBe(200);
    const rejeu = await verifier(await billet(), code);
    expect(rejeu.status).toBe(401);
    expect((await rejeu.json()).error).toMatch(/déjà utilisé/);
  });

  it('les essais de code sont limités par compte, et réussir l’étape mot de passe ne remet pas le compteur à zéro', async () => {
    for (let i = 0; i < 5; i++) {
      // Nouveau login réussi (mot de passe) avant chaque essai, depuis une IP différente.
      expect((await verifier(await billet(), '000000')).status).toBe(401);
    }
    const bloque = await verifier(await billet(), codeTotp(admin.username, secret));
    expect(bloque.status).toBe(429);
    expect(cookieDeReponse(bloque)).toBeNull();
  });

  it('un billet provisoire émis avant une révocation n’est plus recevable', async () => {
    const pending = await billet();
    await pool.query('UPDATE animateurs SET session_version = session_version + 1 WHERE id = $1', [admin.id]);
    expect((await verifier(pending, codeTotp(admin.username, secret))).status).toBe(401);
  });

  it('la session émise après 2FA prend rôle et tenant en base, pas dans le billet', async () => {
    const pending = await billet();
    await pool.query(`UPDATE animateurs SET role = 'animateur' WHERE id = $1`, [admin.id]);
    const res = await verifier(pending, codeTotp(admin.username, secret));
    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe('animateur');
  });
});
