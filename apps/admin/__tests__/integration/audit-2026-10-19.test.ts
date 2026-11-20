import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieCourant = vi.hoisted(() => ({ valeur: '' }));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => ({ value: cookieCourant.valeur }) }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/app/animateurs/emailService', () => ({ envoyerLienReinitialisation: vi.fn(async () => ({ success: true })) }));

import pool from '@/lib/db';
import { signJWT, type JWTPayload } from '@/lib/auth';
import { creerAnimateur, modifierAnimateur } from '@/app/animateurs/actions';
import { POST as enregistrerSortie } from '@/app/api/sorties/route';
import { GET as lireBon } from '@/app/api/sorties/bon-commande/route';
import { PATCH as profil } from '@/app/api/animateurs/profil/route';
import { POST as resetAdmin } from '@/app/api/auth/reset-password/route';
import { POST as creerLienAgenda } from '@/app/api/pij/agenda/lien/route';
import { GET as fluxAgenda } from '@/app/api/pij/agenda/flux/[jeton]/route';
import { POST as envoyerNotification } from '@/app/api/notifications/route';
import { creerJetonReinitialisation, consommerJetonEtChangerMotDePasse } from '@/lib/password-reset';
import { resetDb, cookieFor, jsonRequest } from './helpers';
import { seedCompte, MOT_DE_PASSE, hash } from './securite-helpers';

beforeEach(async () => { await resetDb(); cookieCourant.valeur = ''; });
afterAll(async () => { await pool.end(); });

async function enTantQue(compte: JWTPayload, rubriques: string[] | null = null) {
  await pool.query('UPDATE animateurs SET rubriques = $2 WHERE id = $1', [compte.id, rubriques]);
  cookieCourant.valeur = await signJWT({ ...compte, rubriques });
  return `pj_token=${cookieCourant.valeur}`;
}
const piece = (type: string, contenu: string) => `data:${type};base64,${Buffer.from(contenu).toString('base64')}`;
const nouveauCompte = { nom: 'Audit', prenom: 'Test', email: 'test@example.test', espaceAssigne: 'PIJ' };

describe('audit 19 octobre — bons de commande', () => {
  it.each(['text/html', 'image/svg+xml', 'image/png'])('refuse du HTML annoncé %s à l’enregistrement', async type => {
    const cookie = await cookieFor(await seedCompte({ role: 'animateur' }));
    const res = await enregistrerSortie(jsonRequest('/api/sorties', { method: 'POST', cookie,
      body: { titre: 'Pièce malveillante', date: '2026-10-19', bonCommande: piece(type, '<script>alert(document.domain)</script>') } }));
    expect(res.status).toBe(400);
    expect((await pool.query('SELECT count(*)::int AS n FROM sorties')).rows[0].n).toBe(0);
  });

  it('neutralise une pièce HTML historique et conserve le contenu en téléchargement', async () => {
    const compte = await seedCompte();
    await pool.query('INSERT INTO sorties (id, titre, tenant_id, bon_commande) VALUES ($1,$2,$3,$4)',
      ['sortie-audit', 'Historique', compte.tenant_id, piece('text/html', '<script>alert(1)</script>')]);
    const res = await lireBon(jsonRequest('/api/sorties/bon-commande?id=sortie-audit', { cookie: await cookieFor(compte) }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
  });

  it('un PDF conserve l’affichage et son type réel malgré un type annoncé différent', async () => {
    const compte = await seedCompte();
    const cookie = await cookieFor(compte);
    const res = await enregistrerSortie(jsonRequest('/api/sorties', { method: 'POST', cookie,
      body: { titre: 'PDF', date: '2026-10-19', bonCommande: piece('image/png', '%PDF-1.7\ncontenu'), bonCommandeNom: 'Commande été.pdf' } }));
    expect(res.status).toBe(200);
    const { sortie } = await res.json();
    const lu = await lireBon(jsonRequest(`/api/sorties/bon-commande?id=${sortie.id}`, { cookie }));
    expect(lu.headers.get('content-type')).toBe('application/pdf');
    expect(lu.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(await lu.text()).toBe('%PDF-1.7\ncontenu');
  });
});

describe('audit 19 octobre — gestion des comptes', () => {
  it('un admin sans la rubrique Notifications ne peut pas envoyer de notification', async () => {
    const admin = await seedCompte();
    const cookie = await enTantQue(admin, []);
    const res = await envoyerNotification(jsonRequest('/api/notifications', { method: 'POST', cookie,
      body: { titre: 'Non autorisé', message: 'Message' } }));
    // requireAuth applique désormais les rubriques du chemin (contre-revue,
    // constat C4) : le refus arrive avant le contrôle propre du handler (403).
    expect(res.status).toBe(401);
    expect((await pool.query('SELECT * FROM notifications')).rowCount).toBe(0);
  });

  it('la création et les changements de droits sont tracés sans secret dans la même transaction', async () => {
    const admin = await seedCompte();
    await pool.query('UPDATE animateurs SET gere_droits = TRUE WHERE id = $1', [admin.id]);
    await enTantQue(admin);
    const creation = await creerAnimateur({ ...nouveauCompte, password: MOT_DE_PASSE });
    expect(creation.success).toBe(true);
    expect((await modifierAnimateur(creation.id!, { role: 'admin', password: 'Nouveau!Pass1' })).success).toBe(true);
    const { rows } = await pool.query('SELECT action, record_id, tenant_id, details FROM audit_log ORDER BY id');
    expect(rows.map(r => r.action)).toEqual(['ACCOUNT_CREATED', 'ACCOUNT_UPDATED']);
    expect(rows.every(r => r.record_id === creation.id && r.tenant_id === admin.tenant_id)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(MOT_DE_PASSE);
    expect(JSON.stringify(rows)).not.toContain('Nouveau!Pass1');
    expect(rows[1].details.roleChange).toBe(true);
  });

  it('une panne de journalisation annule la modification du compte', async () => {
    const admin = await seedCompte();
    await enTantQue(admin);
    const cible = await seedCompte({ role: 'animateur' });
    await pool.query("ALTER TABLE audit_log ADD CONSTRAINT audit_test_refus CHECK (action <> 'ACCOUNT_UPDATED')");
    try {
      expect((await modifierAnimateur(cible.id, { statut: 'suspendu' })).success).toBe(false);
      const compte = (await pool.query('SELECT statut, session_version FROM animateurs WHERE id = $1', [cible.id])).rows[0];
      expect(compte).toEqual({ statut: 'actif', session_version: 0 });
    } finally {
      await pool.query('ALTER TABLE audit_log DROP CONSTRAINT audit_test_refus');
    }
  });

  it('retirer la rubrique PIJ coupe aussi le lien public de calendrier déjà émis', async () => {
    const compte = await seedCompte();
    const lien = await creerLienAgenda(jsonRequest('/api/pij/agenda/lien', { method: 'POST', cookie: await cookieFor(compte) }));
    expect(lien.status).toBe(200);
    const { jeton } = await lien.json();
    const lire = () => fluxAgenda(jsonRequest(`/api/pij/agenda/flux/${jeton}.ics`), { params: Promise.resolve({ jeton: `${jeton}.ics` }) });
    expect((await lire()).status).toBe(200);
    await pool.query('UPDATE animateurs SET rubriques = $2 WHERE id = $1', [compte.id, []]);
    expect((await lire()).status).toBe(404);
  });

  it('un admin limité sans gere_droits ne crée pas un animateur plus ouvert que lui', async () => {
    const admin = await seedCompte();
    await enTantQue(admin, ['animateurs', 'jeunes']);
    const res = await creerAnimateur(nouveauCompte);
    expect(res.success).toBe(true);
    const cible = (await pool.query('SELECT rubriques FROM animateurs WHERE id = $1', [res.id])).rows[0];
    expect(cible.rubriques).toEqual(['jeunes']);
  });

  it('la création et la modification appliquent la politique de mot de passe côté serveur', async () => {
    const admin = await seedCompte();
    await enTantQue(admin);
    const cible = await seedCompte({ role: 'animateur' });
    expect((await creerAnimateur({ ...nouveauCompte, password: 'a' })).success).toBe(false);
    expect((await modifierAnimateur(cible.id, { password: 'a' })).success).toBe(false);
  });

  it('modifier une sortie avec du HTML est refusé sans toucher au titre existant', async () => {
    const compte = await seedCompte();
    const cookie = await cookieFor(compte);
    const creation = await enregistrerSortie(jsonRequest('/api/sorties', { method: 'POST', cookie,
      body: { titre: 'Titre initial', date: '2026-10-19' } }));
    const { sortie } = await creation.json();
    const res = await enregistrerSortie(jsonRequest('/api/sorties', { method: 'POST', cookie,
      body: { id: sortie.id, titre: 'Titre altéré', bonCommande: piece('text/html', '<script>alert(1)</script>') } }));
    expect(res.status).toBe(400);
    expect((await pool.query('SELECT titre FROM sorties WHERE id = $1', [sortie.id])).rows[0].titre).toBe('Titre initial');
  });

  it('le reset administratif respecte la rubrique Animateurs même sous /api/auth/', async () => {
    const admin = await seedCompte();
    const cookie = await enTantQue(admin, ['jeunes']);
    const cible = await seedCompte({ email: 'cible@example.test' });
    const res = await resetAdmin(jsonRequest('/api/auth/reset-password', { method: 'POST', cookie, body: { animateurId: cible.id } }));
    expect(res.status).toBe(403);
    expect((await pool.query('SELECT * FROM password_reset_tokens')).rowCount).toBe(0);
  });

  it('le reset administratif protège aussi le compte qui gère les droits', async () => {
    const admin = await seedCompte();
    const cible = await seedCompte({ email: 'responsable@example.test' });
    await pool.query('UPDATE animateurs SET gere_droits = TRUE WHERE id = $1', [cible.id]);
    const res = await resetAdmin(jsonRequest('/api/auth/reset-password', { method: 'POST', cookie: await cookieFor(admin), body: { animateurId: cible.id } }));
    expect(res.status).toBe(403);
  });

  it('le reset administratif ne vise pas un compte ayant plus de rubriques que son auteur', async () => {
    const admin = await seedCompte();
    const cookie = await enTantQue(admin, ['animateurs']);
    const cible = await seedCompte({ email: 'cible@example.test' });
    const res = await resetAdmin(jsonRequest('/api/auth/reset-password', { method: 'POST', cookie, body: { animateurId: cible.id } }));
    expect(res.status).toBe(403);
  });
});

describe('audit 19 octobre — récupération de compte', () => {
  it('changer l’adresse de récupération exige le mot de passe actuel', async () => {
    const compte = await seedCompte({ email: 'titulaire@example.test' });
    const cookie = await cookieFor(compte);
    const res = await profil(jsonRequest('/api/animateurs/profil', { method: 'PATCH', cookie, body: { email: 'intrus@example.test' } }));
    expect(res.status).toBe(400);
    expect((await pool.query('SELECT email FROM animateurs WHERE id=$1', [compte.id])).rows[0].email).toBe('titulaire@example.test');
  });

  it('modifier les autres champs en conservant l’adresse ne demande pas de réauthentification', async () => {
    const compte = await seedCompte({ email: 'titulaire@example.test' });
    const res = await profil(jsonRequest('/api/animateurs/profil', { method: 'PATCH', cookie: await cookieFor(compte),
      body: { email: 'titulaire@example.test', telephone: '0102030405' } }));
    expect(res.status).toBe(200);
  });

  it('le changement d’adresse avec mot de passe neutralise le lien envoyé à l’ancienne boîte', async () => {
    const compte = await seedCompte({ email: 'ancienne@example.test' });
    const lien = await creerJetonReinitialisation({ animateurId: compte.id, tenantId: compte.tenant_id, ttlMinutes: 30, creePar: null });
    const res = await profil(jsonRequest('/api/animateurs/profil', { method: 'PATCH', cookie: await cookieFor(compte),
      body: { email: 'nouvelle@example.test', currentPassword: MOT_DE_PASSE } }));
    expect(res.status).toBe(200);
    expect((await consommerJetonEtChangerMotDePasse(lien.jeton, await hash('Intrus!Pass1'))).ok).toBe(false);
  });

  it('un changement de mot de passe neutralise aussi les anciens liens de récupération', async () => {
    const compte = await seedCompte();
    const lien = await creerJetonReinitialisation({ animateurId: compte.id, tenantId: compte.tenant_id, ttlMinutes: 30, creePar: null });
    const res = await profil(jsonRequest('/api/animateurs/profil', { method: 'PATCH', cookie: await cookieFor(compte),
      body: { newPassword: 'Nouveau!Pass1', currentPassword: MOT_DE_PASSE } }));
    expect(res.status).toBe(200);
    expect((await consommerJetonEtChangerMotDePasse(lien.jeton, await hash('Intrus!Pass1'))).ok).toBe(false);
  });

  it('deux émissions simultanées ne laissent qu’un seul lien actif', async () => {
    const compte = await seedCompte();
    await Promise.all(Array.from({ length: 4 }, () => creerJetonReinitialisation({
      animateurId: compte.id, tenantId: compte.tenant_id, ttlMinutes: 30, creePar: null,
    })));
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM password_reset_tokens WHERE used_at IS NULL');
    expect(rows[0].n).toBe(1);
  });

  it('un nouveau lien émis après le changement de mot de passe reste utilisable', async () => {
    const compte = await seedCompte();
    const res = await profil(jsonRequest('/api/animateurs/profil', { method: 'PATCH', cookie: await cookieFor(compte),
      body: { newPassword: 'Nouveau!Pass1', currentPassword: MOT_DE_PASSE } }));
    expect(res.status).toBe(200);
    const lien = await creerJetonReinitialisation({ animateurId: compte.id, tenantId: compte.tenant_id, ttlMinutes: 30, creePar: null });
    expect((await consommerJetonEtChangerMotDePasse(lien.jeton, await hash('Recupere!Pass1'))).ok).toBe(true);
  });
});
