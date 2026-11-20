import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

/**
 * Les server actions lisent la session via cookies() de next/headers, qui
 * n'existe que dans une requête Next. On fournit le cookie par ce mock et on
 * appelle les VRAIES actions contre le vrai PostgreSQL.
 */
const cookieCourant = vi.hoisted(() => ({ valeur: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (nom: string) =>
      nom === 'pj_token' && cookieCourant.valeur ? { name: nom, value: cookieCourant.valeur } : undefined,
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import pool from '@/lib/db';
import bcrypt from 'bcryptjs';
import { signJWT, getAuthUser, type JWTPayload } from '@/lib/auth';
import { getSession } from '@/lib/session';
import { modifierAnimateur, changerStatut, creerAnimateur, supprimerAnimateur } from '@/app/animateurs/actions';
import { GET as me } from '@/app/api/animateurs/me/route';
import { GET as parametresGet } from '@/app/api/parametres/route';
import { POST as login } from '@/app/api/auth/login/route';
import { resetDb, cookieFor, jsonRequest } from './helpers';
import { MOT_DE_PASSE, billetProvisoire, cookieDeReponse, etatCompte, seedCompte } from './securite-helpers';

afterAll(async () => { await pool.end(); });

/** Place la session utilisée par les server actions. */
async function enTantQue(session: JWTPayload | null) {
  cookieCourant.valeur = session ? await signJWT(session) : undefined;
}
const statutApi = async (cookie: string, handler: typeof me = me) =>
  (await handler(jsonRequest('http://localhost/api/x', { cookie }))).status;

describe('server actions animateurs — matrice de permissions', () => {
  let admin: JWTPayload;
  let cible: JWTPayload;

  beforeEach(async () => {
    await resetDb();
    admin = await seedCompte({ role: 'admin' });
    cible = await seedCompte({ role: 'animateur' });
  });

  async function refuseSansEffet() {
    const avant = await etatCompte(cible.id);
    const nb = async () => (await pool.query('SELECT count(*)::int AS n FROM animateurs')).rows[0].n;
    const total = await nb();

    expect((await modifierAnimateur(cible.id, { role: 'admin' })).success).toBe(false);
    expect((await modifierAnimateur(cible.id, { password: 'Pirate!Pass9' })).success).toBe(false);
    expect((await changerStatut(cible.id, 'suspendu')).success).toBe(false);
    expect((await supprimerAnimateur(cible.id)).success).toBe(false);
    expect((await creerAnimateur({ nom: 'X', prenom: 'Y', email: '', espaceAssigne: 'Collégiens', role: 'admin' })).success).toBe(false);

    expect(await etatCompte(cible.id)).toEqual(avant);
    expect(await nb()).toBe(total);
  }

  it('anonyme', async () => {
    await enTantQue(null);
    await refuseSansEffet();
  });

  it('billet 2FA provisoire d’un admin', async () => {
    cookieCourant.valeur = await billetProvisoire(admin);
    // Le même billet était accepté par getSession (layouts) avant la remédiation.
    expect(await getSession()).toBeNull();
    expect(await getAuthUser()).toBeNull();
    await refuseSansEffet();
  });

  it('session admin révoquée', async () => {
    await enTantQue(admin);
    await pool.query('UPDATE animateurs SET session_version = session_version + 1 WHERE id = $1', [admin.id]);
    await refuseSansEffet();
  });

  it('compte admin suspendu', async () => {
    await enTantQue(admin);
    await pool.query(`UPDATE animateurs SET statut = 'suspendu' WHERE id = $1`, [admin.id]);
    await refuseSansEffet();
  });

  it('admin rétrogradé en base, jeton encore étiqueté admin', async () => {
    await enTantQue(admin);
    await pool.query(`UPDATE animateurs SET role = 'animateur' WHERE id = $1`, [admin.id]);
    expect((await getSession())?.role).toBe('animateur');
    await refuseSansEffet();
  });

  it('animateur', async () => {
    await enTantQue(await seedCompte({ role: 'animateur' }));
    await refuseSansEffet();
  });

  it('admin d’une AUTRE structure : compte introuvable, rien n’est modifié', async () => {
    await enTantQue(await seedCompte({ role: 'admin', tenantId: 'vincennes' }));
    const avant = await etatCompte(cible.id);
    expect(await modifierAnimateur(cible.id, { role: 'admin' })).toEqual({ success: false, error: 'Animateur introuvable' });
    expect(await modifierAnimateur(cible.id, { password: 'Pirate!Pass9' })).toEqual({ success: false, error: 'Animateur introuvable' });
    expect((await supprimerAnimateur(cible.id)).success).toBe(false);
    expect(await etatCompte(cible.id)).toEqual(avant);
  });

  it('refuse un rôle ou un statut hors liste (pas d’élévation en superadmin)', async () => {
    await enTantQue(admin);
    const avant = await etatCompte(cible.id);
    expect((await modifierAnimateur(cible.id, { role: 'superadmin' })).success).toBe(false);
    expect((await modifierAnimateur(cible.id, { statut: 'root' })).success).toBe(false);
    expect((await creerAnimateur({ nom: 'X', prenom: 'Y', email: '', espaceAssigne: 'Collégiens', role: 'superadmin' })).success).toBe(false);
    expect(await etatCompte(cible.id)).toEqual(avant);
  });
});

describe('modifierAnimateur — révocation des accès sur changement sensible', () => {
  let admin: JWTPayload;
  let autreAdmin: JWTPayload;
  let cookieAutre: string;

  beforeEach(async () => {
    await resetDb();
    admin = await seedCompte({ role: 'admin' });
    autreAdmin = await seedCompte({ role: 'admin' });
    cookieAutre = await cookieFor(autreAdmin);
    // Changer un rôle est réservé au compte qui gère les droits (rubriques.test.ts).
    await pool.query('UPDATE animateurs SET gere_droits = TRUE WHERE id = $1', [admin.id]);
    await enTantQue(admin);
  });

  it('témoin : la session de l’autre admin est valide et donne les droits admin', async () => {
    expect(await statutApi(cookieAutre)).toBe(200);
    expect(await statutApi(cookieAutre, parametresGet)).toBe(200);
  });

  it('rétrogradation : l’ancien jeton admin est refusé partout ; après reconnexion, plus de droits admin', async () => {
    expect(await modifierAnimateur(autreAdmin.id, { role: 'animateur' })).toEqual({ success: true });

    expect(await statutApi(cookieAutre)).toBe(401);
    expect(await statutApi(cookieAutre, parametresGet)).toBe(401);

    const relog = await login(jsonRequest('http://localhost/api/auth/login', {
      method: 'POST', body: { username: autreAdmin.username, password: MOT_DE_PASSE },
    }));
    const nouveau = cookieDeReponse(relog) as string;
    expect(await statutApi(nouveau)).toBe(200);
    expect(await statutApi(nouveau, parametresGet)).toBe(403);
    // L'ancien jeton (role=admin) ne revient pas à la vie avec la reconnexion.
    expect(await statutApi(cookieAutre, parametresGet)).toBe(401);
  });

  it('suspension puis réactivation : l’ancien jeton ne redevient pas valide', async () => {
    expect((await changerStatut(autreAdmin.id, 'suspendu')).success).toBe(true);
    expect(await statutApi(cookieAutre)).toBe(401);
    expect((await changerStatut(autreAdmin.id, 'actif')).success).toBe(true);
    expect(await statutApi(cookieAutre)).toBe(401);
  });

  it('changement de mot de passe par l’admin : sessions du compte révoquées, nouveau mot de passe effectif', async () => {
    expect((await modifierAnimateur(autreAdmin.id, { password: 'Change!Pass7' })).success).toBe(true);
    expect(await statutApi(cookieAutre)).toBe(401);
    const etat = await etatCompte(autreAdmin.id);
    expect(await bcrypt.compare('Change!Pass7', etat.password_hash)).toBe(true);
    expect(etat.session_version).toBe(1);
  });

  it('modification sans incidence sur les droits : la session du compte reste valide', async () => {
    // Le formulaire renvoie toute la fiche, rôle et statut INCHANGÉS compris.
    expect((await modifierAnimateur(autreAdmin.id, {
      adresse: '1 rue de la Paix', poste: 'Direction', role: 'admin', statut: 'actif',
    })).success).toBe(true);
    expect(await statutApi(cookieAutre)).toBe(200);
    expect((await etatCompte(autreAdmin.id)).session_version).toBe(0);
  });

  it('changement d’espace : pas de révocation, mais le nouvel espace est effectif immédiatement', async () => {
    expect((await modifierAnimateur(autreAdmin.id, { espaceAssigne: 'Lycéens' })).success).toBe(true);
    const res = await me(jsonRequest('http://localhost/api/animateurs/me', { cookie: cookieAutre }));
    expect(res.status).toBe(200);
    expect((await res.json()).espaceAssigne).toBe('Lycéens');
  });
});

describe('suppression d\'un compte — trace au journal d\'audit', () => {
  // Le 2026-10-07, cinq comptes supprimés dans la journée n'avaient laissé
  // aucune trace : la suppression n'écrivait rien au journal d'audit.
  const audits = async () => (await pool.query(
    `SELECT action, table_name, record_id, animateur_id, animateur_username, tenant_id, details FROM audit_log WHERE action = 'ANIMATEUR_SUPPRIME' ORDER BY id`,
  )).rows;

  beforeEach(async () => { await resetDb(); });

  it('une suppression réussie écrit UNE ligne : auteur, compte supprimé, rôle, commune', async () => {
    const admin = await seedCompte({ role: 'admin' });
    const cible = await seedCompte({ role: 'animateur' });
    await enTantQue(admin);

    expect(await supprimerAnimateur(cible.id)).toEqual({ success: true });

    expect((await pool.query('SELECT 1 FROM animateurs WHERE id = $1', [cible.id])).rowCount).toBe(0);
    const lignes = await audits();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      action: 'ANIMATEUR_SUPPRIME', table_name: 'animateurs', record_id: cible.id,
      animateur_id: admin.id, animateur_username: admin.username, tenant_id: admin.tenant_id,
    });
    const details = typeof lignes[0].details === 'string' ? JSON.parse(lignes[0].details) : lignes[0].details;
    expect(details).toEqual({ compteSupprime: cible.username, role: 'animateur' });
  });

  it('si le journal d\'audit ne peut pas être écrit, le compte n\'est PAS supprimé', async () => {
    const admin = await seedCompte({ role: 'admin' });
    const cible = await seedCompte({ role: 'animateur' });
    await pool.query(`INSERT INTO sorties (id, titre, animateur_id, tenant_id) VALUES ('s-audit', 'Sortie', $1, $2)`, [cible.id, cible.tenant_id]);
    await enTantQue(admin);
    const avant = await etatCompte(cible.id);
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Panne PostgreSQL à l'écriture de CET événement seulement.
    await pool.query(`CREATE FUNCTION test_audit_panne() RETURNS trigger AS $$
      BEGIN IF NEW.action = 'ANIMATEUR_SUPPRIME' THEN RAISE EXCEPTION 'journal d''audit indisponible (simulé)'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER test_audit_panne BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION test_audit_panne()`);
    try {
      const res = await supprimerAnimateur(cible.id);

      expect(res.success).toBe(false);
      // Tout est annulé : le compte, ses droits, et le rattachement de sa sortie.
      expect(await etatCompte(cible.id)).toEqual(avant);
      expect((await pool.query(`SELECT animateur_id FROM sorties WHERE id = 's-audit'`)).rows[0].animateur_id).toBe(cible.id);
      expect(await audits()).toEqual([]);
      expect(journal.mock.calls.some(c => c[0] === '[supprimerAnimateur]')).toBe(true);
    } finally {
      await pool.query('DROP TRIGGER test_audit_panne ON audit_log');
      await pool.query('DROP FUNCTION test_audit_panne()');
      journal.mockRestore();
    }
    // Le journal revenu, la suppression aboutit et laisse sa trace.
    expect(await supprimerAnimateur(cible.id)).toEqual({ success: true });
    expect(await audits()).toHaveLength(1);
  });

  it('si la suppression échoue après l\'écriture du journal, aucune trace de réussite ne subsiste', async () => {
    const admin = await seedCompte({ role: 'admin' });
    const cible = await seedCompte({ role: 'animateur' });
    await enTantQue(admin);
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Le COMMIT échoue : contrainte différée violée au moment de valider.
    await pool.query(`CREATE FUNCTION test_commit_panne() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'validation impossible (simulé)'; END $$ LANGUAGE plpgsql`);
    await pool.query(`CREATE CONSTRAINT TRIGGER test_commit_panne AFTER DELETE ON animateurs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION test_commit_panne()`);
    try {
      expect((await supprimerAnimateur(cible.id)).success).toBe(false);
      expect((await pool.query('SELECT 1 FROM animateurs WHERE id = $1', [cible.id])).rowCount).toBe(1);
      expect(await audits()).toEqual([]);
    } finally {
      await pool.query('DROP TRIGGER test_commit_panne ON animateurs');
      await pool.query('DROP FUNCTION test_commit_panne()');
      journal.mockRestore();
    }
  });

  it('une suppression refusée ou sans effet n\'écrit rien', async () => {
    const admin = await seedCompte({ role: 'admin' });
    const simple = await seedCompte({ role: 'animateur' });
    const autreCommune = await seedCompte({ role: 'animateur', tenantId: 'autre-commune' });

    await enTantQue(simple);                       // pas administrateur
    expect((await supprimerAnimateur(admin.id)).success).toBe(false);
    await enTantQue(null);                         // pas de session
    expect((await supprimerAnimateur(simple.id)).success).toBe(false);
    await enTantQue(admin);
    expect((await supprimerAnimateur(autreCommune.id)).success).toBe(false);  // autre commune
    expect((await supprimerAnimateur('compte-inexistant')).success).toBe(false);

    expect(await audits()).toEqual([]);
    expect((await pool.query('SELECT count(*)::int AS n FROM animateurs')).rows[0].n).toBe(3);
  });
});
