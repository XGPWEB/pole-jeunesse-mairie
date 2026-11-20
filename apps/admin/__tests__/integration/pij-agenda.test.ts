import { describe, it, expect, beforeEach, afterAll } from 'vitest';

import pool from '@/lib/db';
import * as rdv from '@/app/api/pij/rdv/route';
import * as lien from '@/app/api/pij/agenda/lien/route';
import { GET as flux } from '@/app/api/pij/agenda/flux/[jeton]/route';
import { POST as creerAccueil } from '@/app/api/pij/accueils/route';
import { resetDb, seedAnimateur, cookieFor, jsonRequest } from './helpers';
import type { JWTPayload } from '@/lib/auth';

/**
 * Agenda PIJ : droits de saisie, et flux iCalendar public protégé par un
 * jeton personnel. Vrais handlers, vrai PostgreSQL.
 */
const URL_RDV = 'http://localhost/api/pij/rdv';
const URL_LIEN = 'http://localhost/api/pij/agenda/lien';
const RDV = { date: '2099-06-15', heure: '14:00', dureeMinutes: 45, nom: 'Durand', prenom: 'Léa', telephone: '06 00 00 00 00', objet: 'BAFA', lieu: 'PIJ', notes: 'Notes privées' };

describe('Agenda PIJ', () => {
  let informateur: JWTPayload;
  let cInformateur: string;
  let cCollege: string;

  beforeEach(async () => {
    await resetDb();
    informateur = await seedAnimateur({ role: 'animateur', espaceAssigne: 'PIJ' });
    cInformateur = await cookieFor(informateur);
    cCollege = await cookieFor(await seedAnimateur({ role: 'animateur', espaceAssigne: 'Collégiens' }));
  });
  afterAll(async () => {
    await pool.end();
  });

  const creer = (cookie: string, body: unknown = RDV) => rdv.POST(jsonRequest(URL_RDV, { method: 'POST', cookie, body }));
  const lireFlux = (jeton: string) =>
    flux(jsonRequest(`http://localhost/api/pij/agenda/flux/${jeton}.ics`), { params: Promise.resolve({ jeton: `${jeton}.ics` }) });
  const creerLien = async (cookie: string) =>
    (await (await lien.POST(jsonRequest(URL_LIEN, { method: 'POST', cookie }))).json()).jeton as string;

  it('un informateur PIJ crée, modifie et supprime un rendez-vous', async () => {
    const res = await creer(cInformateur);
    expect(res.status).toBe(200);
    const { rdv: cree } = await res.json();
    expect(cree).toMatchObject({ date: '2099-06-15', heure: '14:00', dureeMinutes: 45, statut: 'prevu', creePar: 'Utilisateur Test' });

    // Pointé « honoré » : seulement une fois le rendez-vous commencé (date passée).
    const maj = await rdv.PUT(jsonRequest(URL_RDV, { method: 'PUT', cookie: cInformateur, body: { ...RDV, id: cree.id, date: '2020-06-15', heure: '15:30', statut: 'honore' } }));
    expect((await maj.json()).rdv).toMatchObject({ date: '2020-06-15', heure: '15:30', statut: 'honore' });

    expect((await rdv.DELETE(jsonRequest(`${URL_RDV}?id=${cree.id}`, { method: 'DELETE', cookie: cInformateur }))).status).toBe(200);
    expect((await pool.query('SELECT 1 FROM pij_rdv')).rowCount).toBe(0);
  });

  it('un rendez-vous à venir ne peut être ni créé ni modifié « honoré » ou « absent »', async () => {
    for (const statut of ['honore', 'absent']) expect((await creer(cInformateur, { ...RDV, statut })).status).toBe(400);
    const { rdv: cree } = await (await creer(cInformateur)).json();
    expect((await rdv.PUT(jsonRequest(URL_RDV, { method: 'PUT', cookie: cInformateur, body: { ...RDV, id: cree.id, statut: 'honore' } }))).status).toBe(400);
    expect((await rdv.PUT(jsonRequest(URL_RDV, { method: 'PUT', cookie: cInformateur, body: { ...RDV, id: cree.id, statut: 'annule' } }))).status).toBe(200);
  });

  it('un animateur d’un autre espace consulte l’agenda mais ne peut rien écrire ni créer de lien', async () => {
    const { rdv: cree } = await (await creer(cInformateur)).json();

    const lecture = await (await rdv.GET(jsonRequest(URL_RDV, { cookie: cCollege }))).json();
    expect(lecture.peutSaisir).toBe(false);
    expect(lecture.rdvs).toHaveLength(1);

    expect((await creer(cCollege)).status).toBe(403);
    expect((await rdv.PUT(jsonRequest(URL_RDV, { method: 'PUT', cookie: cCollege, body: { ...RDV, id: cree.id } }))).status).toBe(403);
    expect((await rdv.DELETE(jsonRequest(`${URL_RDV}?id=${cree.id}`, { method: 'DELETE', cookie: cCollege }))).status).toBe(403);
    expect((await lien.POST(jsonRequest(URL_LIEN, { method: 'POST', cookie: cCollege }))).status).toBe(403);
    expect((await creer('')).status).toBe(401);
  });

  it('refuse un rendez-vous invalide ou lié à une fiche d’une autre commune (400)', async () => {
    expect((await creer(cInformateur, { ...RDV, heure: '' })).status).toBe(400);

    const adminB = await cookieFor(await seedAnimateur({ role: 'admin', tenantId: 'commune-b' }));
    const { accueil } = await (await creerAccueil(jsonRequest('http://localhost/api/pij/accueils', {
      method: 'POST', cookie: adminB, body: { dateVisite: '2026-01-09', nom: 'X', prenom: 'Y', objets: ['bafa'] },
    }))).json();
    expect((await creer(cInformateur, { ...RDV, accueilId: accueil.id })).status).toBe(400);
    expect((await pool.query('SELECT 1 FROM pij_rdv')).rowCount).toBe(0);
  });

  it('flux iCalendar : lisible avec le jeton, sans identité complète ni notes', async () => {
    await creer(cInformateur);
    const jeton = await creerLien(cInformateur);

    const res = await lireFlux(jeton);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar');
    const ics = await res.text();
    expect(ics).toContain('DTSTART;TZID=Europe/Paris:20990615T140000');
    expect(ics).toContain('SUMMARY:RDV PIJ — Léa D.');
    expect(ics).not.toContain('Durand');
    expect(ics).not.toContain('Notes privées');
    expect(ics).not.toContain('06 00');
  });

  it('le jeton n’est pas stocké en clair, et un jeton inconnu ou mal formé répond 404', async () => {
    const jeton = await creerLien(cInformateur);
    const { rows } = await pool.query('SELECT jeton_hash FROM pij_agenda_liens');
    expect(rows).toHaveLength(1);
    expect(rows[0].jeton_hash).not.toBe(jeton);

    expect((await lireFlux(jeton.split('').reverse().join(''))).status).toBe(404);
    expect((await lireFlux('court')).status).toBe(404);
  });

  it('régénérer le lien invalide l’ancien ; le supprimer coupe le flux', async () => {
    const ancien = await creerLien(cInformateur);
    const nouveau = await creerLien(cInformateur);
    expect((await lireFlux(ancien)).status).toBe(404);
    expect((await lireFlux(nouveau)).status).toBe(200);

    await lien.DELETE(jsonRequest(URL_LIEN, { method: 'DELETE', cookie: cInformateur }));
    expect((await lireFlux(nouveau)).status).toBe(404);
    expect((await (await lien.GET(jsonRequest(URL_LIEN, { cookie: cInformateur }))).json()).actif).toBe(false);
  });

  it('le flux se ferme si le compte est suspendu ou quitte le PIJ', async () => {
    const jeton = await creerLien(cInformateur);
    await pool.query(`UPDATE animateurs SET espace_assigne = 'Lycéens' WHERE id = $1`, [informateur.id]);
    expect((await lireFlux(jeton)).status).toBe(404);
    await pool.query(`UPDATE animateurs SET espace_assigne = 'PIJ', statut = 'suspendu' WHERE id = $1`, [informateur.id]);
    expect((await lireFlux(jeton)).status).toBe(404);
    await pool.query(`UPDATE animateurs SET statut = 'actif' WHERE id = $1`, [informateur.id]);
    expect((await lireFlux(jeton)).status).toBe(200);
  });

  it('le flux ne contient que les rendez-vous de la commune du compte', async () => {
    await creer(cInformateur);
    const adminB = await cookieFor(await seedAnimateur({ role: 'admin', tenantId: 'commune-b' }));
    const ics = await (await lireFlux(await creerLien(adminB))).text();
    expect(ics).not.toContain('BEGIN:VEVENT');
    expect((await (await rdv.GET(jsonRequest(URL_RDV, { cookie: adminB }))).json()).rdvs).toEqual([]);
  });
});
