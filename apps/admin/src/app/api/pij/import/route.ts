import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import pool from '@/lib/db';
import { cleDoublon, convertirFeuille, type FeuilleImport } from '@/lib/pij-import';
import { insererAccueil, insererDossier } from '@/lib/pij-db';
import type { AccueilPijSaisie, DossierPijSaisie } from '@/lib/pij';

/**
 * Reprise du tableur PIJ : feuille « Accueil » ou « Permis de conduire »,
 * collée depuis Excel ou lue d'un CSV. ADMIN uniquement.
 *
 * Deux temps, même requête : sans `confirmer`, rien n'est écrit et la réponse
 * décrit ce qui serait importé (aperçu) ; avec `confirmer: true`, les lignes
 * valides et nouvelles sont insérées dans UNE transaction.
 *
 * Relancer un import ne crée pas de doublon : une ligne dont le jeune (nom,
 * prénom) et la date (visite ou commission) existent déjà est ignorée.
 */
const TAILLE_MAX = 500_000;

export async function POST(req: NextRequest) {
  const session = await requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Accès refusé — rôle admin requis' }, { status: 403 });
  }
  const { tenant_id } = session;
  try {
    const { feuille, texte, confirmer } = await req.json();
    if (feuille !== 'accueil' && feuille !== 'permis') {
      return NextResponse.json({ error: 'Feuille inconnue.' }, { status: 400 });
    }
    if (typeof texte !== 'string' || texte.trim() === '') {
      return NextResponse.json({ error: 'Collez le contenu de la feuille.' }, { status: 400 });
    }
    if (texte.length > TAILLE_MAX) {
      return NextResponse.json({ error: 'Contenu trop volumineux.' }, { status: 400 });
    }

    const conversion = convertirFeuille(feuille as FeuilleImport, texte);
    if ('erreur' in conversion) return NextResponse.json({ error: conversion.erreur }, { status: 400 });

    const dateDe = (v: AccueilPijSaisie | DossierPijSaisie) =>
      'dateVisite' in v ? v.dateVisite : v.dateRef;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Verrou par commune : deux imports simultanés ne se doublonnent pas.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pij-import:${tenant_id}`]);

      const existants = await client.query<{ nom: string; prenom: string; date: string | null }>(
        feuille === 'accueil'
          ? `SELECT nom, prenom, date_visite::text AS date FROM pij_accueils WHERE tenant_id = $1`
          : `SELECT nom, prenom, date_ref::text AS date FROM pij_dossiers WHERE tenant_id = $1 AND type = 'permis'`,
        [tenant_id],
      );
      const connus = new Set(existants.rows.map(r => cleDoublon(r.nom, r.prenom, r.date)));

      const nouveaux: (AccueilPijSaisie | DossierPijSaisie)[] = [];
      const doublons: number[] = [];
      for (const { ligne, valeurs } of conversion.valides) {
        const cle = cleDoublon(valeurs.nom, valeurs.prenom, dateDe(valeurs));
        if (connus.has(cle)) { doublons.push(ligne); continue; }
        connus.add(cle);
        nouveaux.push(valeurs);
      }

      if (confirmer === true) {
        for (const v of nouveaux) {
          if ('dateVisite' in v) await insererAccueil(v, tenant_id, session.id, client);
          else await insererDossier(v, tenant_id, session.id, client);
        }
      }
      await client.query('COMMIT');

      return NextResponse.json({
        success: true,
        importe: confirmer === true,
        nouveaux: nouveaux.length,
        doublons,
        refus: conversion.refus,
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[api/pij/import POST]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
