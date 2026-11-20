/**
 * Contre-revue du 19 octobre 2026 (REVUE-CLAUDE-2026-10-19.md) : régressions
 * des constats C1 à C5, contre le vrai PostgreSQL jetable pole_jeunesse_test.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieCourant = vi.hoisted(() => ({ valeur: '' }));
const courriels = vi.hoisted(() => ({ liens: [] as { email: string; lien: string }[], identifiants: [] as Record<string, string>[] }));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => ({ value: cookieCourant.valeur }) }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/app/animateurs/emailService', () => ({
  envoyerLienReinitialisation: vi.fn(async (d: { email: string; lien: string }) => { courriels.liens.push(d); return { success: true }; }),
  envoyerIdentifiants: vi.fn(async (d: Record<string, string>) => { courriels.identifiants.push(d); return { success: true }; }),
  envoyerReinitialisationMdp: vi.fn(async (d: Record<string, string>) => { courriels.identifiants.push(d); return { success: true }; }),
}));

import bcrypt from 'bcryptjs';
import pool from '@/lib/db';
import { signJWT, type JWTPayload } from '@/lib/auth';
import { SQL_REVOQUER_SESSIONS } from '@/lib/revocation';
import { modifierAnimateur } from '@/app/animateurs/actions';
import { envoyerIdentifiants, envoyerReinitialisationMdp } from '@/app/animateurs/emailActions';
import { POST as motDePasseOublie } from '@/app/api/auth/forgot-password/route';
import { POST as confirmer } from '@/app/api/auth/reset-password/confirm/route';
import { GET as ficheAgora } from '@/app/api/jeunes/fiche-agora/route';
import { GET as statistiques } from '@/app/api/stats/route';
import { resetDb, jsonRequest } from './helpers';
import { seedCompte, MOT_DE_PASSE } from './securite-helpers';

beforeEach(async () => {
  await resetDb();
  cookieCourant.valeur = '';
  courriels.liens.length = 0;
  courriels.identifiants.length = 0;
});
afterAll(async () => { await pool.end(); });

async function enTantQue(compte: JWTPayload, rubriques: string[] | null = null): Promise<string> {
  await pool.query('UPDATE animateurs SET rubriques = $2 WHERE id = $1', [compte.id, rubriques]);
  cookieCourant.valeur = await signJWT({ ...compte, rubriques });
  return `pj_token=${cookieCourant.valeur}`;
}
const emailDe = async (id: string) => (await pool.query('SELECT email FROM animateurs WHERE id = $1', [id])).rows[0].email;
const jetonDuLien = (lien: string) => decodeURIComponent(lien.split('#token=')[1]);

describe('C1 — sa propre fiche : adresse et mot de passe exigent le mot de passe actuel', () => {
  it('refuse le changement de sa propre adresse sans mot de passe actuel', async () => {
    const admin = await seedCompte({ email: 'titulaire@example.test' });
    await enTantQue(admin);
    const res = await modifierAnimateur(admin.id, { email: 'intrus@example.test' });
    expect(res.success).toBe(false);
    expect(await emailDe(admin.id)).toBe('titulaire@example.test');
  });

  it('refuse un mot de passe actuel faux, puis bloque après 5 essais', async () => {
    const admin = await seedCompte({ email: 'titulaire@example.test' });
    await enTantQue(admin);
    for (let i = 0; i < 5; i++) {
      expect((await modifierAnimateur(admin.id, { email: 'intrus@example.test', motDePasseActuel: 'faux' })).success).toBe(false);
    }
    const bloque = await modifierAnimateur(admin.id, { email: 'intrus@example.test', motDePasseActuel: MOT_DE_PASSE });
    expect(bloque.error).toMatch(/Trop de tentatives/);
    expect(await emailDe(admin.id)).toBe('titulaire@example.test');
  });

  it('refuse de fixer son propre mot de passe sans le mot de passe actuel', async () => {
    const admin = await seedCompte();
    await enTantQue(admin);
    const res = await modifierAnimateur(admin.id, { password: 'NouveauMotDePasse-2026' });
    expect(res.success).toBe(false);
    const { password_hash } = (await pool.query('SELECT password_hash FROM animateurs WHERE id = $1', [admin.id])).rows[0];
    expect(await bcrypt.compare(MOT_DE_PASSE, password_hash)).toBe(true);
  });

  it('accepte avec le bon mot de passe et révoque les sessions', async () => {
    const admin = await seedCompte({ email: 'titulaire@example.test' });
    await enTantQue(admin);
    const res = await modifierAnimateur(admin.id, { email: 'nouvelle@example.test', motDePasseActuel: MOT_DE_PASSE });
    expect(res).toEqual({ success: true });
    expect(await emailDe(admin.id)).toBe('nouvelle@example.test');
    const { session_version } = (await pool.query('SELECT session_version FROM animateurs WHERE id = $1', [admin.id])).rows[0];
    expect(Number(session_version)).toBeGreaterThan(0);
  });

  it('la fiche d’un AUTRE compte reste modifiable sans ce mot de passe', async () => {
    const admin = await seedCompte();
    const anim = await seedCompte({ role: 'animateur', email: 'anim@example.test' });
    await enTantQue(admin);
    expect((await modifierAnimateur(anim.id, { email: 'anim2@example.test' })).success).toBe(true);
  });
});

/**
 * Attend qu'une session PostgreSQL soit bloquée par la transaction `pid`
 * (pg_blocking_pids) : preuve que la requête concurrente a bien atteint le
 * verrou, au lieu d'une attente fixe qui pourrait libérer le verrou trop tôt
 * sur une machine chargée (retour de revue du 20 octobre, point 3).
 */
async function attendreBlocagePar(pid: number, delaiMs = 10_000): Promise<void> {
  const fin = Date.now() + delaiMs;
  while (Date.now() < fin) {
    const { rows } = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [pid],
    );
    if (rows[0].n > 0) return;
    await new Promise(r => setTimeout(r, 5));
  }
  throw new Error(`Aucune requête n'a attendu le verrou de la session ${pid} en ${delaiMs} ms.`);
}

describe('C2 — lien de récupération : adresse lue sous le verrou de l’émission', () => {
  // PJ_REPETITIONS_C2=n rejoue le scénario n fois de plus (preuve de reproductibilité).
  it('un changement d’adresse concurrent ne laisse pas partir un lien valide vers l’ancienne',
    { repeats: Number(process.env.PJ_REPETITIONS_C2 ?? 0) }, async () => {
    await resetDb();
    courriels.liens.length = 0;
    const compte = await seedCompte({ email: 'ancienne@example.test' });
    const changement = await pool.connect();
    try {
      await changement.query('BEGIN');
      const { rows: [{ pid }] } = await changement.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      await changement.query(
        `UPDATE animateurs SET email = 'nouvelle@example.test', ${SQL_REVOQUER_SESSIONS} WHERE id = $1`, [compte.id],
      );
      // La demande lit l'adresse encore validée (l'ancienne), puis attend le verrou.
      let terminee = false;
      const demande = motDePasseOublie(jsonRequest('/api/auth/forgot-password', {
        method: 'POST', headers: { 'x-real-ip': '198.51.100.7' }, body: { username: compte.username },
      })).finally(() => { terminee = true; });
      await attendreBlocagePar(pid);
      // Elle est bien suspendue sur le verrou, pas terminée avant le changement.
      expect(terminee).toBe(false);
      await changement.query('COMMIT');
      expect((await demande).status).toBe(200);
    } finally {
      changement.release();
    }
    expect(courriels.liens).toHaveLength(1);
    expect(courriels.liens[0].email).toBe('nouvelle@example.test');
    // Le lien émis reste utilisable par la nouvelle adresse, et elle seule l'a reçu.
    const res = await confirmer(jsonRequest('/api/auth/reset-password/confirm', {
      method: 'POST', headers: { 'x-real-ip': '198.51.100.8' },
      body: { token: jetonDuLien(courriels.liens[0].lien), newPassword: 'NouveauMotDePasse-2026' },
    }));
    expect(res.status).toBe(200);
  });
});

describe('C3 — envoi d’identifiants : destinataire et contenu fixés par le serveur', () => {
  const motDePasse = 'MotDePasseEnvoye-2026';
  async function cibleAvecMotDePasse(opts: Parameters<typeof seedCompte>[0] = {}) {
    const cible = await seedCompte({ role: 'animateur', email: 'fiche@example.test', ...opts });
    await pool.query('UPDATE animateurs SET password_hash = $2 WHERE id = $1', [cible.id, await bcrypt.hash(motDePasse, 4)]);
    return cible;
  }
  const base = { prenom: 'X', nom: 'Y', espaceAssigne: 'PIJ' };

  it('ignore l’adresse fournie par le navigateur et échappe le texte', async () => {
    const admin = await seedCompte();
    const cible = await cibleAvecMotDePasse();
    await enTantQue(admin);
    const res = await envoyerIdentifiants({
      ...base, email: 'victime@exterieur.test', username: cible.username, password: motDePasse,
      subject: 'Objet\r\nBcc: autre@exterieur.test', introText: '<a href="https://piege.test">Connexion</a><img src=x onerror=alert(1)>',
    });
    expect(res.success).toBe(true);
    expect(courriels.identifiants).toHaveLength(1);
    const envoi = courriels.identifiants[0];
    expect(envoi.email).toBe('fiche@example.test');
    expect(envoi.subject).not.toMatch(/[\r\n]/);
    expect(envoi.introText).not.toMatch(/<a |<img/);
    expect(envoi.introText).toContain('Connexion');
  });

  it('refuse un mot de passe qui n’est pas celui du compte', async () => {
    const admin = await seedCompte();
    const cible = await cibleAvecMotDePasse();
    await enTantQue(admin);
    const res = await envoyerReinitialisationMdp({ ...base, email: 'fiche@example.test', username: cible.username, password: 'pas-le-bon' });
    expect(res.success).toBe(false);
    expect(courriels.identifiants).toHaveLength(0);
  });

  it('refuse un compte d’une autre commune, le gestionnaire des droits et un compte plus large', async () => {
    const admin = await seedCompte();
    await enTantQue(admin, ['animateurs']);
    const ailleurs = await cibleAvecMotDePasse({ tenantId: 'autre-commune' });
    const gestionnaire = await cibleAvecMotDePasse({ role: 'admin' });
    await pool.query('UPDATE animateurs SET gere_droits = TRUE WHERE id = $1', [gestionnaire.id]);
    const large = await cibleAvecMotDePasse();
    for (const cible of [ailleurs, gestionnaire, large]) {
      const res = await envoyerIdentifiants({ ...base, email: 'x@example.test', username: cible.username, password: motDePasse });
      expect(res.success).toBe(false);
    }
    expect(courriels.identifiants).toHaveLength(0);
  });
});

describe('C4 — les handlers appliquent eux-mêmes les rubriques (sans le proxy)', () => {
  it('la fiche AGORA d’un jeune est refusée à un admin sans la rubrique Jeunes', async () => {
    // (La route de fiche détaillée de l'application mobile, testée ici avant
    // la 2.14.0, n'existe plus ; même règle sur la fiche AGORA du web.)
    const admin = await seedCompte();
    await pool.query("INSERT INTO jeunes (id, nom, prenom, tenant_id) VALUES ('revue-jeune', 'Fictif', 'Jeune', $1)", [admin.tenant_id]);
    const url = '/api/jeunes/fiche-agora?id=revue-jeune';
    const refuse = await ficheAgora(jsonRequest(url, { cookie: await enTantQue(admin, ['activites']) }));
    expect(refuse.status).toBe(401);
    // Rubrique accordée : la garde laisse passer ; ce jeune n'a pas de fiche.
    const autorise = await ficheAgora(jsonRequest(url, { cookie: await enTantQue(admin, ['jeunes']) }));
    expect(autorise.status).toBe(404);
  });

  it('les statistiques sont refusées sans la rubrique Statistiques', async () => {
    const admin = await seedCompte();
    const res = await statistiques(jsonRequest('/api/stats', { cookie: await enTantQue(admin, ['jeunes']) }));
    expect(res.status).toBe(401);
  });
});
