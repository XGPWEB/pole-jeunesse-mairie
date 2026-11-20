import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';
import { proxy } from '@/proxy';
import {
  aAccesComplet, aRubrique, famillesReglables, memesRubriques, normaliserRubriques,
  rubriquesDuRole, rubriquesEffectives, rubriquesExigees, satisfaitExigence,
} from '@/lib/rubriques';
import { ADMINISTRATION, FAMILLES_ADMIN, FAMILLES_ANIMATEUR } from '@/lib/rubriques';

/**
 * Rubriques du menu accordées compte par compte : règles pures (lib/rubriques.ts)
 * et filtrage du proxy à partir du jeton. Le contrôle contre la base est dans
 * __tests__/integration/rubriques.test.ts.
 */

describe('rubriques réglables', () => {
  it('une case par entrée du menu, sauf le tableau de bord', () => {
    const admin = [...FAMILLES_ADMIN.flatMap(f => f.entrees), ...ADMINISTRATION].map(e => e.id).filter(id => id !== 'dashboard');
    expect(rubriquesDuRole('admin')).toEqual(admin);
    expect(rubriquesDuRole('animateur')).toEqual(FAMILLES_ANIMATEUR.flatMap(f => f.entrees).map(e => e.id).filter(id => id !== 'dashboard'));
    expect(rubriquesDuRole('admin')).toHaveLength(20);
    expect(rubriquesDuRole('animateur')).toHaveLength(11);
    expect(famillesReglables('admin').some(f => f.entrees.some(e => e.id === 'dashboard'))).toBe(false);
  });

  it('chaque rubrique animateur existe aussi côté admin (un admin limité peut l’accorder)', () => {
    const admin = new Set(rubriquesDuRole('admin'));
    expect(rubriquesDuRole('animateur').every(id => admin.has(id))).toBe(true);
  });
});

describe('droits d’un compte', () => {
  it('null = accès complet au menu de son rôle (comptes existants)', () => {
    expect(aAccesComplet({ role: 'admin', rubriques: null })).toBe(true);
    expect(aAccesComplet({ role: 'animateur' })).toBe(true);
    expect([...rubriquesEffectives({ role: 'animateur', rubriques: null })]).toEqual(rubriquesDuRole('animateur'));
  });

  it('liste = seulement ces rubriques, limitées à celles du rôle', () => {
    const t = { role: 'animateur', rubriques: ['pij', 'inscriptions', 'inconnue'] };
    expect([...rubriquesEffectives(t)]).toEqual(['pij']);
    expect(aRubrique(t, 'pij')).toBe(true);
    expect(aRubrique(t, 'jeunes')).toBe(false);
    expect(aAccesComplet(t)).toBe(false);
  });

  it('le tableau de bord et « Mon profil » restent toujours accessibles', () => {
    const rien = { role: 'animateur', rubriques: [] };
    expect(aRubrique(rien, 'dashboard')).toBe(true);
    expect(aRubrique(rien, 'profil')).toBe(true);
  });

  it('un superadmin (traité en animateur) suit le menu animateur', () => {
    expect([...rubriquesEffectives({ role: 'superadmin', rubriques: null })]).toEqual(rubriquesDuRole('animateur'));
  });

  it('exigence « l’une de » : seules les rubriques du rôle comptent', () => {
    const animateur = { role: 'animateur', rubriques: ['sorties'] };
    expect(satisfaitExigence(animateur, ['inscriptions', 'activites', 'sorties'])).toBe(true);
    expect(satisfaitExigence(animateur, ['inscriptions', 'activites'])).toBe(false);
    // Rubrique propre au menu admin : pas de restriction par rubrique pour un
    // animateur, ce sont les contrôles de rôle des routes qui décident.
    expect(satisfaitExigence(animateur, ['actualites'])).toBe(true);
    expect(satisfaitExigence({ role: 'admin', rubriques: ['jeunes'] }, ['actualites'])).toBe(false);
  });

  it('forme canonique et comparaison', () => {
    expect(normaliserRubriques('animateur', ['pij', 'jeunes', 'pij', 'animateurs', 3])).toEqual(['jeunes', 'pij']);
    expect(normaliserRubriques('admin', null)).toBeNull();
    expect(memesRubriques({ role: 'animateur', rubriques: null }, { role: 'animateur', rubriques: [...rubriquesDuRole('animateur')] })).toBe(true);
    expect(memesRubriques({ role: 'animateur', rubriques: ['pij'] }, { role: 'animateur', rubriques: null })).toBe(false);
    expect(memesRubriques({ role: 'admin', rubriques: null }, { role: 'animateur', rubriques: null })).toBe(false);
  });
});

describe('chemin → rubriques exigées', () => {
  it('pages des menus admin et animateur', () => {
    expect(rubriquesExigees('/admin/pij')).toEqual(['pij']);
    expect(rubriquesExigees('/admin/jeunes/abc/modifier')).toEqual(['jeunes']);
    expect(rubriquesExigees('/animateur/sorties/s1')).toEqual(['sorties']);
    expect(rubriquesExigees('/admin/dashboard')).toBeNull();
    expect(rubriquesExigees('/animateur/profil')).toBeNull();
  });

  it('pages d’impression (groupe standalone) et pages racine', () => {
    expect(rubriquesExigees('/animateur/sorties/s1/fiches-sanitaires')).toEqual(['sorties']);
    expect(rubriquesExigees('/animateur/projets/p1/print')).toEqual(['projets']);
    expect(rubriquesExigees('/animateurs/anim-1')).toEqual(['animateurs']);
    expect(rubriquesExigees('/rgpd')).toEqual(['rgpd']);
    expect(rubriquesExigees('/animateur')).toBeNull();
    expect(rubriquesExigees('/securite')).toBeNull();
  });

  it('routes API : écriture et lecture', () => {
    expect(rubriquesExigees('/api/pij/dossiers', 'GET')).toEqual(['pij']);
    expect(rubriquesExigees('/api/jeunes', 'POST')).toEqual(['jeunes']);
    expect(rubriquesExigees('/api/jeunes', 'GET')).toContain('activites');
    expect(rubriquesExigees('/api/jeunes/import', 'POST')).toEqual(['jeunes']);
    expect(rubriquesExigees('/api/jeunes/fiche-agora', 'GET')).toEqual(['jeunes', 'sorties']);
    expect(rubriquesExigees('/api/conges', 'GET')).toBeNull();
    expect(rubriquesExigees('/api/conges', 'POST')).toEqual(['conges']);
    expect(rubriquesExigees('/api/sorties/demande-modif', 'POST')).toBeNull();
    expect(rubriquesExigees('/api/sorties/participants', 'POST')).toEqual(['sorties']);
    expect(rubriquesExigees('/api/theme', 'GET')).toBeNull();
    expect(rubriquesExigees('/api/theme', 'PUT')).toEqual(['apparence']);
    expect(rubriquesExigees('/api/notifications', 'POST')).toEqual(['notifications']);
    expect(rubriquesExigees('/api/notifications', 'GET')).toBeNull();
    expect(rubriquesExigees('/api/notifications', 'PATCH')).toBeNull();
    expect(rubriquesExigees('/api/animateurs/nav-prefs', 'PUT')).toBeNull();
  });
});

describe('proxy — rubriques portées par le jeton', () => {
  const SECRET = new TextEncoder().encode(process.env.JWT_SECRET);
  async function jeton(claims: Record<string, unknown>): Promise<string> {
    return new SignJWT({ id: 'u1', username: 'u', role: 'animateur', espaceAssigne: 'x', tenant_id: 'nogent', ...claims })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(SECRET);
  }
  async function requete(chemin: string, claims: Record<string, unknown>, method = 'GET') {
    const headers = new Headers({ cookie: `pj_token=${await jeton(claims)}` });
    return proxy(new NextRequest(new URL(chemin, 'http://localhost:3000'), { headers, method }));
  }
  const passe = (res: Response) => res.headers.get('x-middleware-next') === '1';

  it('jeton sans rubriques (antérieur, ou accès complet) : tout le menu du rôle', async () => {
    expect(passe(await requete('/animateur/pij', {}))).toBe(true);
    expect(passe(await requete('/api/pij/dossiers', { rubriques: null }))).toBe(true);
  });

  it('page d’une rubrique retirée : retour au tableau de bord', async () => {
    const res = await requete('/animateur/pij', { rubriques: ['jeunes'] });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3000/animateur/dashboard');
    const admin = await requete('/admin/parametres', { role: 'admin', rubriques: ['jeunes'] });
    expect(admin.headers.get('location')).toBe('http://localhost:3000/admin/dashboard');
  });

  it('API d’une rubrique retirée : 403', async () => {
    expect((await requete('/api/pij/dossiers', { rubriques: ['jeunes'] })).status).toBe(403);
    expect((await requete('/api/jeunes', { rubriques: ['pij'] }, 'POST')).status).toBe(403);
    expect((await requete('/api/parametres', { role: 'admin', rubriques: ['animateurs'] })).status).toBe(403);
  });

  it('rubrique accordée, et pages hors rubrique : laissé passer', async () => {
    expect(passe(await requete('/animateur/jeunes/j1', { rubriques: ['jeunes'] }))).toBe(true);
    expect(passe(await requete('/animateur/dashboard', { rubriques: [] }))).toBe(true);
    expect(passe(await requete('/api/notifications', { rubriques: [] }))).toBe(true);
    // Recherche de jeunes depuis une activité : la rubrique Activités suffit en lecture.
    expect(passe(await requete('/api/jeunes', { rubriques: ['activites'] }))).toBe(true);
  });

  it('admin sur une page d’impression animateur : sa rubrique décide', async () => {
    expect(passe(await requete('/animateur/sorties/s1/print', { role: 'admin', rubriques: null }))).toBe(true);
    expect((await requete('/animateur/sorties/s1/print', { role: 'admin', rubriques: ['jeunes'] })).status).toBe(307);
  });
});
