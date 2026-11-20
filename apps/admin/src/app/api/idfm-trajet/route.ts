import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

const IDFM_API_KEY = process.env.IDFM_API_KEY ?? '';
const BASE_URL = 'https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia';
const TIMEOUT_MS = 12000;

function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

/** Géocode une adresse texte → ID navitia */
async function geocodeToId(address: string): Promise<string | null> {
  if (!IDFM_API_KEY) return null;
  try {
    const url = `${BASE_URL}/places?q=${encodeURIComponent(address)}&count=1`;
    const res = await fetchWithTimeout(url, { headers: { apikey: IDFM_API_KEY }, cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.places?.[0]?.id ?? null;
  } catch (err) {
    console.error('[api/idfm-trajet]', err);
    return null;
  }
}

/** Formate une date Navitia "20260410T143000" → "14:30" */
function parseNavitiaTime(dt: string): string {
  try {
    const clean = dt.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6');
    return new Date(clean).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    console.error('[api/idfm-trajet]', err);
    return dt;
  }
}

function friendlyError(status: number, msg?: string): string {
  if (status === 429) return 'Limite de requêtes atteinte. Veuillez patienter quelques secondes et réessayer.';
  if (status === 401 || status === 403) return 'Clé API Île-de-France Mobilités invalide. Contactez l\'administrateur.';
  if (status === 503 || status === 502) return 'Le service Île-de-France Mobilités est temporairement indisponible. Réessayez dans un instant.';
  if (status === 404) return 'Itinéraire introuvable pour ces adresses.';
  return msg ?? `Erreur du service (code ${status}).`;
}

export async function POST(request: NextRequest) {
  const user = await requireAuth(request);
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const { depart, destination, departId, destinationId, datetime } = await request.json().catch(() => ({}));

  if (!depart || !destination) {
    return NextResponse.json({ success: false, error: 'Adresse de départ et destination requises.' }, { status: 400 });
  }

  const mapsUrl = `https://www.google.com/maps/dir/${encodeURIComponent(depart)}/${encodeURIComponent(destination)}`;

  if (!IDFM_API_KEY) {
    return NextResponse.json({
      success: false,
      fallbackUrl: mapsUrl,
      error: 'Clé API IDFM non configurée. Configurez IDFM_API_KEY dans votre .env.local ou sur le VPS.',
    });
  }

  try {
    // Utiliser les IDs IDFM directement ou géocoder
    let fromId = departId ?? await geocodeToId(depart);
    let toId   = destinationId ?? await geocodeToId(destination);

    if (!fromId || !toId) {
      return NextResponse.json({
        success: false,
        fallbackUrl: mapsUrl,
        error: 'Adresse non trouvée dans la base IDFM. Sélectionnez une adresse dans la liste de suggestions.',
      });
    }

    let dt = datetime;
    if (!dt) {
      dt = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
    }

    const journeyUrl =
      `${BASE_URL}/journeys` +
      `?from=${encodeURIComponent(fromId)}` +
      `&to=${encodeURIComponent(toId)}` +
      `&datetime=${dt}` +
      `&count=3` +
      `&min_nb_transfers=0`;

    const res = await fetchWithTimeout(journeyUrl, { headers: { apikey: IDFM_API_KEY }, cache: 'no-store' });

    if (!res.ok) {
      let body: any = {};
      try { body = await res.json(); } catch {}
      return NextResponse.json({
        success: false,
        fallbackUrl: mapsUrl,
        error: friendlyError(res.status, body?.message),
      });
    }

    const data = await res.json();

    if (!data.journeys?.length) {
      return NextResponse.json({
        success: false,
        fallbackUrl: mapsUrl,
        error: 'Aucun trajet en commun trouvé. Vérifiez les adresses ou consultez Google Maps.',
      });
    }

    const journeys = (data.journeys as any[]).slice(0, 3).map((j: any) => {
      const sections = (j.sections ?? [])
        .filter((s: any) => s.type === 'public_transport')
        .map((s: any) => ({
          mode:      s.display_informations?.physical_mode ?? s.type,
          ligne:     s.display_informations?.code ?? '',
          direction: s.display_informations?.direction ?? '',
          departure: s.departure_date_time ? parseNavitiaTime(s.departure_date_time) : '',
        }));

      return {
        duree:   Math.round(j.duration / 60),
        depart:  j.departure_date_time ? parseNavitiaTime(j.departure_date_time) : '',
        arrivee: j.arrival_date_time ? parseNavitiaTime(j.arrival_date_time) : '',
        sections,
        texte: sections.length
          ? sections.map((s: any) => `${s.mode} ${s.ligne}${s.direction ? ` → ${s.direction}` : ''}`).join(' + ')
          : 'Trajet à pied',
      };
    });

    return NextResponse.json({ success: true, journeys, mapsUrl });

  } catch (e: any) {
    const isTimeout = e?.name === 'AbortError';
    console.error('[API /api/idfm-trajet]', isTimeout ? 'Timeout' : e?.message ?? e);
    return NextResponse.json({
      success: false,
      fallbackUrl: mapsUrl,
      error: isTimeout
        ? 'Le service Île-de-France Mobilités met trop de temps à répondre. Réessayez ou utilisez Google Maps.'
        : `Erreur réseau : ${e?.message ?? 'inconnue'}`,
    });
  }
}
