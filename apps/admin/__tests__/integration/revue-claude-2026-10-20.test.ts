/**
 * Retour de revue du 20 octobre 2026 (RETOUR-REVUE-CLAUDE-2026-10-20.md,
 * REVUE-CLAUDE-2026-10-20.md), contre le vrai PostgreSQL jetable
 * pole_jeunesse_test.
 *
 * Point 1 — l'envoi d'identifiants compare le mot de passe fourni au hash du
 * compte destinataire : c'est une preuve du mot de passe de ce compte, limitée
 * sur le même compteur que les autres (cleReauth), quel que soit le point
 * d'entrée. Aucun courriel réel : le service d'envoi est simulé.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieCourant = vi.hoisted(() => ({ valeur: '' }));
const envois = vi.hoisted(() => ({ identifiants: 0, reinitialisations: 0 }));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => ({ value: cookieCourant.valeur }) }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/app/animateurs/emailService', () => ({
  envoyerIdentifiants: vi.fn(async () => { envois.identifiants++; return { success: true }; }),
  envoyerReinitialisationMdp: vi.fn(async () => { envois.reinitialisations++; return { success: true }; }),
  envoyerLienReinitialisation: vi.fn(async () => ({ success: true })),
}));

import pool from '@/lib/db';
import { signJWT, type JWTPayload } from '@/lib/auth';
import { modifierAnimateur } from '@/app/animateurs/actions';
import { envoyerIdentifiants, envoyerReinitialisationMdp } from '@/app/animateurs/emailActions';
import { PATCH as profil } from '@/app/api/animateurs/profil/route';
import { resetDb, jsonRequest } from './helpers';
import { seedCompte, MOT_DE_PASSE } from './securite-helpers';

beforeEach(async () => {
  await resetDb();
  cookieCourant.valeur = '';
  envois.identifiants = 0;
  envois.reinitialisations = 0;
});
afterAll(async () => { await pool.end(); });

async function enTantQue(compte: JWTPayload): Promise<string> {
  cookieCourant.valeur = await signJWT(compte);
  return `pj_token=${cookieCourant.valeur}`;
}
const marquerGereDroits = (id: string) => pool.query('UPDATE animateurs SET gere_droits = TRUE WHERE id = $1', [id]);
const envoiIdentifiants = (username: string, password: string) =>
  envoyerIdentifiants({ prenom: '', nom: '', email: '', espaceAssigne: '', username, password });
const envoiReinitialisation = (username: string, password: string) =>
  envoyerReinitialisationMdp({ prenom: '', nom: '', email: '', username, password });
const emailDe = async (id: string) => (await pool.query('SELECT email FROM animateurs WHERE id = $1', [id])).rows[0].email;

describe('Point 1 — vérification du mot de passe de l’envoi d’identifiants', () => {
  it('reproduction Codex : après six erreurs, le bon mot de passe du compte gere_droits est refusé et rien ne part', async () => {
    const titulaire = await seedCompte({ email: 'titulaire@example.test' });
    await marquerGereDroits(titulaire.id);
    await enTantQue(titulaire);
    for (let i = 0; i < 6; i++) {
      expect((await envoiIdentifiants(titulaire.username, `faux-${i}`)).success).toBe(false);
    }
    const res = await envoiIdentifiants(titulaire.username, MOT_DE_PASSE);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Trop de tentatives/);
    expect(envois.identifiants).toBe(0);
  });

  it('alterner les deux actions d’envoi ne donne pas d’essais supplémentaires', async () => {
    const admin = await seedCompte();
    const cible = await seedCompte({ role: 'animateur', email: 'cible@example.test' });
    await enTantQue(admin);
    for (let i = 0; i < 3; i++) expect((await envoiIdentifiants(cible.username, `faux-${i}`)).success).toBe(false);
    for (let i = 0; i < 2; i++) expect((await envoiReinitialisation(cible.username, `autre-${i}`)).success).toBe(false);
    expect((await envoiIdentifiants(cible.username, MOT_DE_PASSE)).error).toMatch(/Trop de tentatives/);
    expect((await envoiReinitialisation(cible.username, MOT_DE_PASSE)).error).toMatch(/Trop de tentatives/);
    expect(envois.identifiants + envois.reinitialisations).toBe(0);
  });

  it('les erreurs de l’envoi bloquent ensuite la réauthentification de Mon profil (même compteur)', async () => {
    const titulaire = await seedCompte({ email: 'titulaire@example.test' });
    await marquerGereDroits(titulaire.id);
    const cookie = await enTantQue(titulaire);
    for (let i = 0; i < 5; i++) expect((await envoiIdentifiants(titulaire.username, `faux-${i}`)).success).toBe(false);
    const res = await profil(jsonRequest('/api/animateurs/profil', {
      method: 'PATCH', cookie, body: { email: 'intrus@example.test', currentPassword: MOT_DE_PASSE },
    }));
    expect(res.status).toBe(429);
    expect(await emailDe(titulaire.id)).toBe('titulaire@example.test');
  });

  it('les erreurs de la fiche (sa propre adresse) bloquent ensuite l’envoi, et inversement', async () => {
    const titulaire = await seedCompte({ email: 'titulaire@example.test' });
    await marquerGereDroits(titulaire.id);
    await enTantQue(titulaire);
    for (let i = 0; i < 3; i++) {
      expect((await modifierAnimateur(titulaire.id, { email: 'intrus@example.test', motDePasseActuel: `faux-${i}` })).success).toBe(false);
    }
    for (let i = 0; i < 2; i++) expect((await envoiReinitialisation(titulaire.username, `faux-${i}`)).success).toBe(false);
    expect((await modifierAnimateur(titulaire.id, { email: 'intrus@example.test', motDePasseActuel: MOT_DE_PASSE })).error)
      .toMatch(/Trop de tentatives/);
    expect((await envoiIdentifiants(titulaire.username, MOT_DE_PASSE)).error).toMatch(/Trop de tentatives/);
    expect(await emailDe(titulaire.id)).toBe('titulaire@example.test');
    expect(envois.identifiants + envois.reinitialisations).toBe(0);
  });

  it('une réussite intermédiaire n’efface pas les échecs précédents', async () => {
    const admin = await seedCompte();
    const cible = await seedCompte({ role: 'animateur', email: 'cible@example.test' });
    await enTantQue(admin);
    for (let i = 0; i < 4; i++) expect((await envoiIdentifiants(cible.username, `faux-${i}`)).success).toBe(false);
    expect((await envoiIdentifiants(cible.username, MOT_DE_PASSE)).success).toBe(true);
    expect((await envoiIdentifiants(cible.username, 'faux-5')).success).toBe(false);
    // 5 échecs comptés : même le bon mot de passe est maintenant refusé.
    expect((await envoiIdentifiants(cible.username, MOT_DE_PASSE)).error).toMatch(/Trop de tentatives/);
    expect(envois.identifiants).toBe(1);
  });

  it('les envois légitimes répétés ne consomment pas d’essai', async () => {
    const admin = await seedCompte();
    const cible = await seedCompte({ role: 'animateur', email: 'cible@example.test' });
    await enTantQue(admin);
    for (let i = 0; i < 8; i++) {
      expect((await (i % 2 ? envoiReinitialisation : envoiIdentifiants)(cible.username, MOT_DE_PASSE)).success).toBe(true);
    }
    expect(envois.identifiants + envois.reinitialisations).toBe(8);
  });

  it('le compteur est propre à chaque compte destinataire', async () => {
    const admin = await seedCompte();
    const bloquee = await seedCompte({ role: 'animateur', email: 'bloquee@example.test' });
    const autre = await seedCompte({ role: 'animateur', email: 'autre@example.test' });
    await enTantQue(admin);
    for (let i = 0; i < 5; i++) await envoiIdentifiants(bloquee.username, `faux-${i}`);
    expect((await envoiIdentifiants(bloquee.username, MOT_DE_PASSE)).error).toMatch(/Trop de tentatives/);
    expect((await envoiIdentifiants(autre.username, MOT_DE_PASSE)).success).toBe(true);
  });
});
