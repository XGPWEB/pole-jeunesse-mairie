import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

/**
 * Rubriques du menu accordées compte par compte (animateurs.rubriques), contre
 * le vrai PostgreSQL. Même montage que securite-actions.test.ts : le cookie
 * des server actions est fourni par un mock de next/headers.
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
import { signJWT, getAuthUser, type JWTPayload } from '@/lib/auth';
import { proxy } from '@/proxy';
import { creerAnimateur, modifierAnimateur, changerStatut, supprimerAnimateur } from '@/app/animateurs/actions';
import { creerJeune, supprimerJeune } from '@/app/jeunes/actions';
import { POST as login } from '@/app/api/auth/login/route';
import { GET as me } from '@/app/api/animateurs/me/route';
import { rubriquesDuRole } from '@/lib/rubriques';
import { resetDb, jsonRequest } from './helpers';
import { MOT_DE_PASSE, cookieDeReponse, seedCompte, seedJeune } from './securite-helpers';

afterAll(async () => { await pool.end(); });

/** Session des server actions, avec les rubriques ACTUELLES du compte (comme à la connexion). */
async function enTantQue(compte: JWTPayload) {
  cookieCourant.valeur = await signJWT({ ...compte, rubriques: await rubriquesEnBase(compte.id) });
}
async function rubriquesEnBase(id: string): Promise<string[] | null> {
  return (await pool.query('SELECT rubriques FROM animateurs WHERE id = $1', [id])).rows[0]?.rubriques ?? null;
}
/** Pose la marque du compte qui règle les droits (posée par la migration sur celui de Xavier). */
async function gereDroits(id: string) {
  await pool.query('UPDATE animateurs SET gere_droits = TRUE WHERE id = $1', [id]);
}
async function limiter(id: string, rubriques: string[] | null) {
  await pool.query('UPDATE animateurs SET rubriques = $2 WHERE id = $1', [id, rubriques]);
}
async function connexion(compte: JWTPayload): Promise<string> {
  const res = await login(jsonRequest('http://localhost/api/auth/login', {
    method: 'POST', body: { username: compte.username, password: MOT_DE_PASSE },
  }));
  expect(res.status).toBe(200);
  return cookieDeReponse(res) as string;
}
/** Requête passée au proxy avec le cookie d'une vraie connexion. */
const viaProxy = (chemin: string, cookie: string, method = 'GET') =>
  proxy(jsonRequest(`http://localhost${chemin}`, { cookie, method }));
const passe = (res: Response) => res.headers.get('x-middleware-next') === '1';

// L'identifiant est tiré du prénom et du nom (lettres seules) : un nom différent à chaque création.
let suffixe = 0;
const donnees = () => ({ nom: `Martin${'abcdefghijklmnopqrstuvwxyz'[suffixe++ % 26]}`, prenom: 'Léa', email: 'lea@example.org', espaceAssigne: 'PIJ' });

describe('valeur par défaut : les comptes existants gardent leur accès', () => {
  beforeEach(async () => { await resetDb(); });

  it('rubriques NULL en base : session complète, rien n’est refusé', async () => {
    const admin = await seedCompte({ role: 'admin' });
    const animateur = await seedCompte({ role: 'animateur' });
    expect(await rubriquesEnBase(admin.id)).toBeNull();

    const cookieAdmin = await connexion(admin);
    expect(passe(await viaProxy('/admin/parametres', cookieAdmin))).toBe(true);
    expect(passe(await viaProxy('/api/pij/dossiers', cookieAdmin))).toBe(true);
    const cookieAnim = await connexion(animateur);
    expect(passe(await viaProxy('/animateur/pij', cookieAnim))).toBe(true);
  });
});

describe('création d’un compte avec ses rubriques (compte qui gère les droits)', () => {
  let admin: JWTPayload;
  beforeEach(async () => {
    await resetDb();
    admin = await seedCompte({ role: 'admin' });
    await gereDroits(admin.id);
    await enTantQue(admin);
  });

  const creeRubriques = async (r: Awaited<ReturnType<typeof creerAnimateur>>) => {
    expect(r.success).toBe(true);
    return rubriquesEnBase(r.id!);
  };

  it('tout coché par un admin complet : accès complet (NULL)', async () => {
    expect(await creeRubriques(await creerAnimateur({ ...donnees(), role: 'animateur' }))).toBeNull();
    expect(await creeRubriques(await creerAnimateur({ ...donnees(), role: 'admin', rubriques: [...rubriquesDuRole('admin')] }))).toBeNull();
  });

  it('cases choisies : liste enregistrée, limitée aux rubriques du rôle', async () => {
    expect(await creeRubriques(await creerAnimateur({ ...donnees(), role: 'animateur', rubriques: ['pij', 'jeunes', 'inscriptions'] })))
      .toEqual(['jeunes', 'pij']);
    expect(await creeRubriques(await creerAnimateur({ ...donnees(), role: 'admin', rubriques: ['inscriptions'] })))
      .toEqual(['inscriptions']);
    expect(await creeRubriques(await creerAnimateur({ ...donnees(), role: 'animateur', rubriques: [] }))).toEqual([]);
  });

  it('rubriques mal formées : refusé', async () => {
    expect((await creerAnimateur({ ...donnees(), rubriques: 'pij' as unknown as string[] })).success).toBe(false);
  });

  it('le compte limité ne voit que ses rubriques, côté pages comme côté API', async () => {
    const r = await creerAnimateur({ ...donnees(), role: 'animateur', rubriques: ['jeunes'], password: MOT_DE_PASSE });
    const username = (await pool.query('SELECT username FROM animateurs WHERE id = $1', [r.id])).rows[0].username;
    const cookie = await connexion({ id: r.id!, username } as JWTPayload);

    const page = await viaProxy('/animateur/pij', cookie);
    expect(page.status).toBe(307);
    expect(page.headers.get('location')).toContain('/animateur/dashboard');
    expect((await viaProxy('/api/pij/dossiers', cookie)).status).toBe(403);
    expect((await viaProxy('/api/vehicules', cookie, 'POST')).status).toBe(403);
    expect(passe(await viaProxy('/animateur/jeunes', cookie))).toBe(true);
    expect(passe(await viaProxy('/animateur/dashboard', cookie))).toBe(true);
    // La session renvoyée par la garde porte les rubriques de la base.
    cookieCourant.valeur = cookie.replace('pj_token=', '');
    expect((await getAuthUser())?.rubriques).toEqual(['jeunes']);
  });
});

describe('seul le compte qui gère les droits règle rôle et rubriques', () => {
  let admin: JWTPayload;
  let xavier: JWTPayload;
  beforeEach(async () => {
    await resetDb();
    xavier = await seedCompte({ role: 'admin' });
    await gereDroits(xavier.id);
    admin = await seedCompte({ role: 'admin' }); // admin complet, sans la marque
    await enTantQue(admin);
  });

  it('un autre admin crée un animateur au menu complet, sans choisir ni rôle ni rubriques', async () => {
    const r = await creerAnimateur(donnees());
    expect(r.success).toBe(true);
    const ligne = (await pool.query('SELECT role, rubriques, gere_droits FROM animateurs WHERE id = $1', [r.id])).rows[0];
    expect(ligne).toEqual({ role: 'animateur', rubriques: null, gere_droits: false });

    const nb = async () => (await pool.query('SELECT count(*)::int AS n FROM animateurs')).rows[0].n;
    const avant = await nb();
    expect((await creerAnimateur({ ...donnees(), role: 'admin' })).success).toBe(false);
    expect((await creerAnimateur({ ...donnees(), rubriques: ['jeunes'] })).success).toBe(false);
    expect(await nb()).toBe(avant);
  });

  it('il modifie une fiche, mais ni le rôle ni les rubriques', async () => {
    const anim = await seedCompte({ role: 'animateur' });
    expect((await modifierAnimateur(anim.id, { adresse: '3 rue Haute' })).success).toBe(true);
    expect((await modifierAnimateur(anim.id, { rubriques: ['jeunes'] })).success).toBe(false);
    expect((await modifierAnimateur(anim.id, { role: 'admin' })).success).toBe(false);
    // Rubriques renvoyées inchangées avec la fiche : accepté.
    expect((await modifierAnimateur(anim.id, { adresse: '4 rue Haute', role: 'animateur', rubriques: [...rubriquesDuRole('animateur')] })).success).toBe(true);
    const ligne = (await pool.query('SELECT role, rubriques FROM animateurs WHERE id = $1', [anim.id])).rows[0];
    expect(ligne).toEqual({ role: 'animateur', rubriques: null });
  });

  it('il ne touche pas au compte qui gère les droits', async () => {
    expect((await modifierAnimateur(xavier.id, { adresse: 'x' })).success).toBe(false);
    expect((await changerStatut(xavier.id, 'suspendu')).success).toBe(false);
    expect((await modifierAnimateur(xavier.id, { password: 'Pirate!Pass9' })).success).toBe(false);
    expect((await supprimerAnimateur(xavier.id)).success).toBe(false);
    const ligne = (await pool.query('SELECT statut, gere_droits FROM animateurs WHERE id = $1', [xavier.id])).rows[0];
    expect(ligne).toEqual({ statut: 'actif', gere_droits: true });
  });

  it('un admin limité ne modifie ni ne supprime un compte qui a plus d’accès que lui', async () => {
    await limiter(admin.id, ['animateurs', 'jeunes']);
    await enTantQue(admin);
    const complet = await seedCompte({ role: 'animateur' });
    expect((await modifierAnimateur(complet.id, { adresse: 'x' })).success).toBe(false);
    expect((await changerStatut(complet.id, 'suspendu')).success).toBe(false);
    expect((await supprimerAnimateur(complet.id)).success).toBe(false);
  });

  it('sans la rubrique Animateurs : aucune gestion de compte', async () => {
    await limiter(admin.id, ['jeunes']);
    await enTantQue(admin);
    const cible = await seedCompte({ role: 'animateur' });
    expect((await creerAnimateur(donnees())).success).toBe(false);
    expect((await modifierAnimateur(cible.id, { adresse: 'x' })).success).toBe(false);
    expect((await supprimerAnimateur(cible.id)).success).toBe(false);
  });

  it('la session expose la marque, lue en base', async () => {
    await enTantQue(xavier);
    expect((await getAuthUser())?.gereDroits).toBe(true);
    await enTantQue(admin);
    expect((await getAuthUser())?.gereDroits).toBe(false);
  });
});

describe('personne ne s’enferme dehors', () => {
  let admin: JWTPayload;
  beforeEach(async () => {
    await resetDb();
    admin = await seedCompte({ role: 'admin' });
    await gereDroits(admin.id);
    await enTantQue(admin);
  });

  it('un admin ne change ni ses rubriques, ni son rôle, ni son statut, et ne se supprime pas', async () => {
    expect((await modifierAnimateur(admin.id, { rubriques: ['jeunes'] })).success).toBe(false);
    expect((await modifierAnimateur(admin.id, { rubriques: rubriquesDuRole('admin').filter(id => id !== 'animateurs') })).success).toBe(false);
    expect((await modifierAnimateur(admin.id, { role: 'animateur' })).success).toBe(false);
    expect((await changerStatut(admin.id, 'suspendu')).success).toBe(false);
    expect((await supprimerAnimateur(admin.id)).success).toBe(false);
    const etat = (await pool.query('SELECT role, statut, rubriques FROM animateurs WHERE id = $1', [admin.id])).rows[0];
    expect(etat).toEqual({ role: 'admin', statut: 'actif', rubriques: null });
  });

  it('il peut toujours enregistrer sa fiche sans rien changer à ses accès', async () => {
    expect((await modifierAnimateur(admin.id, {
      adresse: '1 rue de la Paix', role: 'admin', statut: 'actif', rubriques: [...rubriquesDuRole('admin')],
    })).success).toBe(true);
  });

  it('un admin complet peut limiter un autre admin', async () => {
    const autre = await seedCompte({ role: 'admin' });
    expect((await modifierAnimateur(autre.id, { rubriques: ['jeunes'] })).success).toBe(true);
    expect(await rubriquesEnBase(autre.id)).toEqual(['jeunes']);
  });
});

describe('changement de rubriques : effet immédiat', () => {
  let admin: JWTPayload;
  let anim: JWTPayload;
  let cookieAnim: string;
  beforeEach(async () => {
    await resetDb();
    admin = await seedCompte({ role: 'admin' });
    anim = await seedCompte({ role: 'animateur' });
    cookieAnim = await connexion(anim);
    await gereDroits(admin.id);
    await enTantQue(admin);
  });

  const statutMe = async (cookie: string) =>
    (await me(jsonRequest('http://localhost/api/animateurs/me', { cookie }))).status;

  it('l’ancien jeton (menu complet) est refusé ; la reconnexion donne le nouveau menu', async () => {
    expect(await statutMe(cookieAnim)).toBe(200);
    expect((await modifierAnimateur(anim.id, { rubriques: ['jeunes'] })).success).toBe(true);

    expect(await statutMe(cookieAnim)).toBe(401);
    const nouveau = await connexion(anim);
    expect(await statutMe(nouveau)).toBe(200);
    expect((await viaProxy('/api/pij/dossiers', nouveau)).status).toBe(403);
  });

  it('un jeton dont les rubriques ne sont plus celles de la base est refusé, même sans révocation', async () => {
    await limiter(anim.id, ['jeunes']); // écrit directement en base, sans passer par l'action
    expect(await statutMe(cookieAnim)).toBe(401);
  });

  it('modification sans incidence sur les accès : la session reste valide', async () => {
    expect((await modifierAnimateur(anim.id, { adresse: '2 rue Neuve', rubriques: [...rubriquesDuRole('animateur')] })).success).toBe(true);
    expect(await statutMe(cookieAnim)).toBe(200);
  });

  it('le filtre de structure (tenant) est conservé', async () => {
    const ailleurs = await seedCompte({ role: 'animateur', tenantId: 'vincennes' });
    expect(await modifierAnimateur(ailleurs.id, { rubriques: [] })).toEqual({ success: false, error: 'Animateur introuvable' });
    expect(await rubriquesEnBase(ailleurs.id)).toBeNull();
  });
});

describe('server actions rattachées à une rubrique', () => {
  beforeEach(async () => { await resetDb(); });

  it('sans la rubrique Fiches jeunes : ni création ni suppression de fiche', async () => {
    const anim = await seedCompte({ role: 'animateur' });
    const jeune = await seedJeune(anim.tenant_id);
    await limiter(anim.id, ['pij']);
    await enTantQue(anim);

    expect((await creerJeune({ nom: 'X', prenom: 'Y' } as Parameters<typeof creerJeune>[0])).success).toBe(false);
    expect((await supprimerJeune(jeune)).success).toBe(false);
    expect((await pool.query('SELECT 1 FROM jeunes WHERE id = $1', [jeune])).rowCount).toBe(1);
  });

  it('avec la rubrique : l’action s’exécute', async () => {
    const anim = await seedCompte({ role: 'animateur' });
    const jeune = await seedJeune(anim.tenant_id);
    await limiter(anim.id, ['jeunes']);
    await enTantQue(anim);
    expect((await supprimerJeune(jeune)).success).toBe(true);
  });
});

describe('changement de rôle depuis « Gestion du compte »', () => {
  beforeEach(async () => { await resetDb(); });

  it('le compte qui gère les droits passe un animateur limité administrateur (menu admin complet), puis le repasse animateur', async () => {
    const xavier = await seedCompte({ role: 'admin' });
    await gereDroits(xavier.id);
    const anim = await seedCompte({ role: 'animateur' });
    await limiter(anim.id, ['pij']);
    await enTantQue(xavier);

    // Même appel que le bouton « Passer administrateur ».
    expect((await modifierAnimateur(anim.id, { role: 'admin', rubriques: null })).success).toBe(true);
    let ligne = (await pool.query('SELECT role, rubriques FROM animateurs WHERE id = $1', [anim.id])).rows[0];
    expect(ligne).toEqual({ role: 'admin', rubriques: null });

    expect((await modifierAnimateur(anim.id, { role: 'animateur', rubriques: null })).success).toBe(true);
    ligne = (await pool.query('SELECT role, rubriques FROM animateurs WHERE id = $1', [anim.id])).rows[0];
    expect(ligne).toEqual({ role: 'animateur', rubriques: null });
  });

  it('un autre admin ne peut pas changer un rôle', async () => {
    const admin = await seedCompte({ role: 'admin' });
    const anim = await seedCompte({ role: 'animateur' });
    await enTantQue(admin);
    expect((await modifierAnimateur(anim.id, { role: 'admin', rubriques: null })).success).toBe(false);
    expect((await pool.query('SELECT role FROM animateurs WHERE id = $1', [anim.id])).rows[0].role).toBe('animateur');
  });
});
