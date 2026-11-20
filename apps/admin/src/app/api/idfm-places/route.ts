import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

const IDFM_API_KEY = process.env.IDFM_API_KEY ?? '';
const BASE_URL = 'https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia';
const TIMEOUT_MS = 8000;

export async function GET(request: NextRequest) {
  const user = await requireAuth(request);
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const q     = searchParams.get('q')?.trim() ?? '';
  const count = parseInt(searchParams.get('count') ?? '6');

  if (!q || q.length < 2) return NextResponse.json([]);
  if (!IDFM_API_KEY)       return NextResponse.json([]);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const url = `${BASE_URL}/places?q=${encodeURIComponent(q)}&count=${count}`;
    const res = await fetch(url, {
      headers: { apikey: IDFM_API_KEY },
      cache: 'no-store',
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (res.status === 429) {
      console.warn('[IDFM /places] Rate limit atteint (429)');
      return NextResponse.json([]);
    }
    if (!res.ok) {
      console.warn(`[IDFM /places] Erreur HTTP ${res.status}`);
      return NextResponse.json([]);
    }

    const data = await res.json();

    const places = (data.places ?? []).map((p: any) => {
      const type = p.embedded_type ?? 'unknown';
      let label = p.name;
      let icon  = 'address';

      if (type === 'address') {
        const a = p.address;
        const num  = a?.house_number ? `${a.house_number} ` : '';
        const rue  = a?.name ?? p.name;
        const city = a?.administrative_regions?.[0]?.name ?? '';
        label = city ? `${num}${rue}, ${city}` : `${num}${rue}`;
        icon  = 'address';
      } else if (type === 'stop_area') {
        const city = p.stop_area?.administrative_regions?.[0]?.name ?? '';
        label = city ? `${p.name} — ${city}` : p.name;
        icon  = 'stop';
      } else if (type === 'poi') {
        const city = p.poi?.administrative_regions?.[0]?.name ?? '';
        label = city ? `${p.name}, ${city}` : p.name;
        icon  = 'poi';
      } else if (type === 'administrative_region') {
        const zip = p.administrative_region?.zip_code ?? '';
        label = zip ? `${p.name} (${zip})` : p.name;
        icon  = 'city';
      }

      return { id: p.id, label, type: icon };
    });

    return NextResponse.json(places);
  } catch (e: any) {
    clearTimeout(timer);
    if (e?.name === 'AbortError') {
      console.warn('[IDFM /places] Timeout après', TIMEOUT_MS, 'ms');
    } else {
      console.error('[IDFM /places]', e?.message ?? e);
    }
    return NextResponse.json([]);
  }
}
