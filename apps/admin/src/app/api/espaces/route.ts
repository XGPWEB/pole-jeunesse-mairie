import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAuth } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';

const SELECT = `
  SELECT id, nom, description,
         tranche_age      AS "trancheAge",
         adresse, horaires,
         animateur_ref    AS "animateurRef",
         couleur, icon, capacite,
         COALESCE(telephone, '') AS telephone,
         COALESCE(email, '')     AS email,
         COALESCE(statut, 'actif') AS statut
  FROM espaces
`;

export async function GET(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  const { tenant_id } = user;
  try {
    const rows = await query(`${SELECT} WHERE tenant_id = $1 ORDER BY nom`, [tenant_id]);
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[api/espaces]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

function slugify(nom: string): string {
  return nom
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30);
}

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Accès refusé — rôle admin requis' }, { status: 403 });
  }
  const { tenant_id } = user;
  try {
    const body = await req.json();
    const { nom, description, trancheAge, adresse, horaires, animateurRef, couleur, icon, capacite, telephone, email } = body;
    if (!nom?.trim()) return NextResponse.json({ error: 'Le nom est requis' }, { status: 400 });

    const id = `${slugify(nom)}-${randomUUID().slice(0, 8)}`;

    const existing = await queryOne('SELECT id FROM espaces WHERE id = $1', [id]);
    if (existing) return NextResponse.json({ error: 'Un espace avec cet identifiant existe déjà' }, { status: 409 });

    const row = await queryOne(`
      INSERT INTO espaces (id, nom, description, tranche_age, adresse, horaires, animateur_ref, couleur, icon, capacite, telephone, email, statut, tenant_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'actif',$13)
      RETURNING id, nom, description, tranche_age AS "trancheAge", adresse, horaires,
                animateur_ref AS "animateurRef", couleur, icon, capacite,
                COALESCE(telephone,'') AS telephone,
                COALESCE(email,'')     AS email,
                COALESCE(statut,'actif') AS statut
    `, [
      id, nom.trim(), description || null, trancheAge || null,
      adresse || null, horaires || null, animateurRef || null,
      couleur || '#6B1A6E', icon || '🏠', Number(capacite) || 0,
      telephone || null, email || null, tenant_id,
    ]);

    return NextResponse.json({ success: true, espace: row }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Erreur serveur' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const user = await requireAuth(req);
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Accès refusé — rôle admin requis' }, { status: 403 });
  }
  const { tenant_id } = user;
  try {
    const body = await req.json();
    const { id, ...updates } = body;
    if (!id) return NextResponse.json({ error: 'ID requis' }, { status: 400 });

    const existing = await queryOne('SELECT id FROM espaces WHERE id = $1 AND tenant_id = $2', [id, tenant_id]);
    if (!existing) return NextResponse.json({ error: 'Espace introuvable' }, { status: 404 });

    const fieldMap: Record<string, string> = {
      nom: 'nom', description: 'description', trancheAge: 'tranche_age',
      adresse: 'adresse', horaires: 'horaires', animateurRef: 'animateur_ref',
      couleur: 'couleur', icon: 'icon', capacite: 'capacite',
      telephone: 'telephone', email: 'email', statut: 'statut',
    };

    const setClauses: string[] = [];
    const params: unknown[] = [id];

    for (const [camel, snake] of Object.entries(fieldMap)) {
      if (updates[camel] !== undefined) {
        params.push(updates[camel]);
        setClauses.push(`${snake} = $${params.length}`);
      }
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'Aucun champ à mettre à jour' }, { status: 400 });
    }

    // Défense en profondeur : le contrôle d'existence ci-dessus filtre déjà
    // par tenant_id, mais l'UPDATE lui-même doit aussi porter le filtre — sans
    // quoi une modification concurrente du même `id` (peu probable mais pas
    // impossible vu la génération d'id) pourrait s'appliquer hors tenant.
    params.push(tenant_id);
    const tenantParamIndex = params.length;

    const row = await queryOne(
      `UPDATE espaces SET ${setClauses.join(', ')} WHERE id = $1 AND tenant_id = $${tenantParamIndex}
       RETURNING id, nom, description, tranche_age AS "trancheAge", adresse, horaires,
                 animateur_ref AS "animateurRef", couleur, icon, capacite,
                 COALESCE(telephone,'') AS telephone,
                 COALESCE(email,'')     AS email,
                 COALESCE(statut,'actif') AS statut`,
      params,
    );
    return NextResponse.json({ success: true, espace: row });
  } catch (err) {
    console.error('[api/espaces]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
