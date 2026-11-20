import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { APP_VERSION, APP_COMMIT } from '@/lib/version';

export const dynamic = 'force-dynamic';

export async function GET() {
  const start = Date.now();
  try {
    await pool.query('SELECT 1');
    return NextResponse.json({
      status: 'ok',
      db: 'ok',
      version: APP_VERSION,
      commit: APP_COMMIT,
      // Identifiant de la version installée, fixé par sa configuration PM2
      // (scripts/deploy-release.sh). Il sert à VÉRIFIER une bascule : après un
      // redémarrage, c'est bien cette version-ci qui répond, et non le
      // processus de la précédente resté en place. `null` hors production.
      release: process.env.PJ_RELEASE_ID || null,
      latency_ms: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { status: 'error', db: 'unreachable', timestamp: new Date().toISOString() },
      { status: 503 },
    );
  }
}
