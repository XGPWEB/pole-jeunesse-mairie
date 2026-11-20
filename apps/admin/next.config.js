/** @type {import('next').NextConfig} */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Version affichée (pied de menu, page Monitoring, /api/health) : lue dans le
// fichier VERSION à la racine du dépôt, source de vérité unique (voir
// scripts/version.mjs). Le commit Git du build l'accompagne, suffixé de
// « -modifié » si le build a été fait avec des modifications non commitées :
// il ne correspond alors à aucun commit et ne doit pas être pris pour une
// version publiée.
function versionDuBuild() {
  const racine = path.join(__dirname, '..', '..');
  let version = '0.0.0';
  try { version = fs.readFileSync(path.join(racine, 'VERSION'), 'utf8').trim(); } catch { /* build hors dépôt */ }
  let commit = '';
  try {
    const git = (args) => execFileSync('git', args, { cwd: racine, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    commit = git(['rev-parse', '--short', 'HEAD']);
    if (git(['status', '--porcelain']) !== '') commit += '-modifié';
  } catch { /* pas de git disponible : version seule */ }
  return { version, commit };
}
const { version: APP_VERSION, commit: APP_COMMIT } = versionDuBuild();

const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: APP_VERSION,
    NEXT_PUBLIC_APP_COMMIT: APP_COMMIT,
  },
  output: 'standalone',
  experimental: {
    serverActions: {
      // La fiche d'un jeune est enregistrée par une action serveur, pièce AGORA
      // comprise (5 Mo maximum, soit ~6,7 Mo une fois en base64). Avec la
      // limite par défaut de Next (1 Mo), une pièce de plus de ~750 Ko
      // aboutissait à une page d'erreur. La taille réelle reste contrôlée
      // côté serveur par lib/fiche-agora.ts ; nginx plafonne à 10 Mo.
      bodySizeLimit: '8mb',
    },
  },
  // Force l'inclusion de nodemailer dans le build standalone
  outputFileTracingIncludes: {
    '/api/**': ['./node_modules/nodemailer/**/*'],
  },
  async headers() {
    const csp = [
      "default-src 'self'",
      // L'évaluation de chaînes n'est utile qu'au serveur de développement.
      process.env.NODE_ENV === 'production'
        ? "script-src 'self' 'unsafe-inline'"
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self' https://api-iv.ile-de-france-mobilites.fr https://api.open-meteo.com",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; ');

    return [
      {
        // Toutes les réponses SAUF la pièce AGORA : cette route pose elle-même
        // sa politique (bac à sable pour une pièce non conforme, voir
        // lib/fiche-agora.ts). Un en-tête défini ici écraserait le sien.
        source: '/((?!api/jeunes/fiche-agora|api/sorties/bon-commande).*)',
        headers: [{ key: 'Content-Security-Policy', value: csp }],
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
