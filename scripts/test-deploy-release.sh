#!/usr/bin/env bash
# Banc d'essai LOCAL de scripts/deploy-release.sh (audit du 2026-10-07, A6).
# Aucun accès distant : tout se passe dans un répertoire temporaire, avec
#   - de fausses versions de l'application (un petit serveur Node qui répond à
#     /api/health, plante au démarrage, ou annonce une autre version) ;
#   - un faux PM2 (lance et remplace UN processus d'après la configuration) ;
#   - un serveur à l'ANCIENNE disposition (répertoire réel pole-jeunesse-admin).
#
# Ce que ce banc établit : préparation dans un répertoire distinct, bascule,
# vérification santé + version + commit, retour arrière automatique, version
# précédente complète conservée avec sa configuration, données partagées
# intactes, et aucun changement quand l'échec survient avant la bascule.
#
# Ce qu'il n'établit PAS : le comportement du vrai PM2, de systemd, de Nginx,
# ni celui du VPS. Voir SUIVI-AUDIT-2026-10-07.md.
#
# Usage : bash scripts/test-deploy-release.sh        (PJ_TEST_PORT pour changer de port)
# Compatible Bash 3.2.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# PJ_TEST_SCRIPT : pour rejouer ce banc contre une autre version du script (preuve de régression).
SCRIPT="${PJ_TEST_SCRIPT:-${DIR}/deploy-release.sh}"
T="$(mktemp -d)"
# Chemin réel : sous macOS, /var est un lien vers /private/var.
T="$(cd "${T}" && pwd -P)"
PORT="${PJ_TEST_PORT:-3197}"
RACINE="${T}/opt"
ARCH="${T}/tmp"
PM2_DIR="${T}/pm2"
mkdir -p "${RACINE}" "${ARCH}" "${PM2_DIR}"
# Le script reçoit la racine PAR UN LIEN symbolique : il ne doit pas confondre
# deux écritures du même répertoire (sinon il ne reconnaît plus la version
# précédente et la supprime au ménage — défaut trouvé en répétition sous
# macOS, où /var est un lien vers /private/var).
RACINE_PASSEE="${T}/opt-par-lien"
ln -s "${RACINE}" "${RACINE_PASSEE}"

command -v node >/dev/null 2>&1 || { echo "❌ node introuvable : banc d'essai non exécuté." >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "❌ python3 introuvable : banc d'essai non exécuté." >&2; exit 1; }
if curl -s -o /dev/null -m 2 "http://127.0.0.1:${PORT}/"; then
  echo "❌ Le port ${PORT} est déjà utilisé : relancer avec PJ_TEST_PORT=<port libre>." >&2; exit 1
fi

arreter() { [ -f "${PM2_DIR}/pid" ] && kill "$(cat "${PM2_DIR}/pid")" 2>/dev/null; true; }
nettoyer() { arreter; rm -rf "${T}"; }
trap nettoyer EXIT

# ── Faux PM2 ─────────────────────────────────────────────────────────────────
cat > "${T}/faux-pm2.js" << 'JS'
// Remplace UN processus d'après la configuration, comme `pm2 startOrRestart`.
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const dir = process.env.FAUX_PM2_DIR, [commande, fichier] = process.argv.slice(2);
const pidFile = path.join(dir, 'pid'), errLog = path.join(dir, 'err.log');
// Modes de panne (variables d'environnement) :
//   FAUX_PM2_BLOQUE=1        ne répond plus du tout (toutes commandes)
//   FAUX_PM2_REFUSE=1        refuse startOrRestart (code 1) SANS toucher au processus en cours
//   FAUX_PM2_PANNE_APRES=N   accepte N startOrRestart puis tombe en panne, selon
//   FAUX_PM2_PANNE_MODE      « refuse » (défaut) ou « bloque » ; compteur dans FAUX_PM2_COMPTEUR
let panne = null;
if (process.env.FAUX_PM2_BLOQUE) panne = 'bloque';
else if (commande === 'startOrRestart' && process.env.FAUX_PM2_REFUSE) panne = 'refuse';
else if (commande === 'startOrRestart' && process.env.FAUX_PM2_PANNE_APRES !== undefined) {
  const f = process.env.FAUX_PM2_COMPTEUR;
  const n = fs.existsSync(f) ? Number(fs.readFileSync(f, 'utf8')) : 0;
  fs.writeFileSync(f, String(n + 1));
  if (n >= Number(process.env.FAUX_PM2_PANNE_APRES)) panne = process.env.FAUX_PM2_PANNE_MODE || 'refuse';
}
if (panne === 'bloque') { setInterval(() => {}, 1000); }
else if (panne === 'refuse') { console.error('[PM2][ERROR] refus simulé'); process.exit(1); }
else if (commande === 'startOrRestart') {
  try { process.kill(Number(fs.readFileSync(pidFile, 'utf8'))); } catch {}
  // Laisse le port se libérer avant de relancer.
  const debut = Date.now(); while (Date.now() - debut < 400) {}
  delete require.cache[require.resolve(fichier)];
  const app = require(fichier).apps[0];
  const err = fs.openSync(errLog, 'a');
  const env = { PATH: process.env.PATH };
  for (const [k, v] of Object.entries(app.env)) env[k] = String(v);
  const enfant = spawn(process.execPath, [app.script], { cwd: app.cwd, env, detached: true, stdio: ['ignore', 'ignore', err] });
  fs.writeFileSync(pidFile, String(enfant.pid));
  fs.appendFileSync(path.join(dir, 'historique'), `startOrRestart ${fichier}\n`);
  enfant.unref();
} else if (commande === 'jlist') {
  console.log(JSON.stringify([{ name: 'pole-jeunesse-admin', pm2_env: { pm_err_log_path: errLog } }]));
} else if (commande === 'save') {
  fs.appendFileSync(path.join(dir, 'historique'), 'save\n');
}
JS
export FAUX_PM2_DIR="${PM2_DIR}"

# ── Fausse application ───────────────────────────────────────────────────────
cat > "${T}/server.js" << 'JS'
const http = require('http'), fs = require('fs'), path = require('path');
const meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'meta.json'), 'utf8'));
if (meta.plante) { console.error('plantage simulé au démarrage (' + meta.version + ')'); process.exit(1); }
// Écrit dans les données sur disque, comme les archives CAF de la vraie application.
fs.appendFileSync(path.join(process.cwd(), 'src/data/journal.txt'), meta.version + '\n');
http.createServer((req, res) => {
  if (req.url !== '/api/health') { res.writeHead(404); return res.end(); }
  res.writeHead(meta.codeSante || 200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    status: meta.codeSante ? 'degraded' : 'ok', version: meta.annonce || meta.version, commit: meta.commit,
    // Les builds d'avant le correctif n'annoncent pas leur release (sansRelease).
    ...(meta.sansRelease ? {} : { release: process.env.PJ_RELEASE_ID || null }),
    hostname: process.env.HOSTNAME || '', jwtLongueur: (process.env.JWT_SECRET || '').length,
    base: process.env.DATABASE_URL || '', smtp: process.env.SMTP_HOST || '', repertoire: __dirname,
    adresse: process.env.APP_BASE_URL || '', origine: process.env.ALLOWED_ORIGIN ?? '(absente)',
    exploitant: process.env.MONITORING_OWNER_TENANT ?? '(absente)',
  }));
}).listen(Number(process.env.PORT), process.env.HOSTNAME || '0.0.0.0');
JS

# construire <version> <commit> [clé=valeur JSON supplémentaires…]  → archives dans ${ARCH}
construire() {
  local version="$1" commit="$2"; shift 2
  local b="${T}/build"; rm -rf "${b}"
  mkdir -p "${b}/app/apps/admin/.next" "${b}/app/apps/admin/public" "${b}/app/node_modules/next" "${b}/static/static/chunks" "${b}/data/data"
  cp "${T}/server.js" "${b}/app/apps/admin/server.js"
  python3 - "${b}/app/apps/admin/meta.json" "${version}" "${commit}" "$@" << 'PY'
import json, sys
sortie, version, commit, *extras = sys.argv[1:]
meta = {'version': version, 'commit': commit}
for e in extras:
    k, _, v = e.partition('=')
    meta[k] = json.loads(v)
json.dump(meta, open(sortie, 'w'))
PY
  echo "build-${version}" > "${b}/app/apps/admin/.next/BUILD_ID"
  echo "{\"name\":\"@pole-jeunesse/admin\",\"version\":\"${version}\"}" > "${b}/app/apps/admin/package.json"
  echo "propre a ${version}" > "${b}/app/apps/admin/public/fichier-${version}.txt"
  echo '{"name":"next"}' > "${b}/app/node_modules/next/package.json"
  echo "// ${version}" > "${b}/static/static/chunks/app.js"
  echo '{"initial":true}' > "${b}/data/data/reglages.json"
  tar -czf "${ARCH}/pj-admin-deploy.tar.gz" -C "${b}/app" .
  tar -czf "${ARCH}/pj-admin-static.tar.gz" -C "${b}/static" static
  tar -czf "${ARCH}/pj-admin-data.tar.gz" -C "${b}/data" data
}

SECRET_JWT="jwt-d'essai-avec\\barre-et-\"guillemets\"-0123456789abcdef"
ecrire_secrets() {
  printf '%s\n' "# fichier d'essai" "JWT_SECRET=ancienne-valeur-ignoree" "IDFM_API_KEY='cle-idfm'" "DATABASE_URL=\"postgresql://u:p'w@localhost:5432/base\"" "JWT_SECRET=${SECRET_JWT}" "APP_BASE_URL=https://pj.exemple.test" "MONITORING_OWNER_TENANT=commune-test" > "${T}/secrets.env"
  printf '%s\n' "SMTP_HOST=smtp.exemple.test" "SMTP_PORT=587" > "${T}/smtp.env"
}
ecrire_secrets

CODE=0
livrer() {  # livrer <version> <commit>  → CODE, sortie dans ${T}/sortie
  CODE=0
  PJ_RACINE="${RACINE_PASSEE}" PJ_TMP="${ARCH}" PJ_PORT="${PORT}" PJ_PM2="node ${T}/faux-pm2.js" \
  PJ_SECRETS="${T}/secrets.env" PJ_SMTP="${T}/smtp.env" PJ_DELAI_SANTE=5 \
    bash "${SCRIPT}" "$1" "$2" > "${T}/sortie" 2>&1 || CODE=$?
}
sante() { curl -s -m 3 "http://127.0.0.1:${PORT}/api/health" 2>/dev/null | python3 -c "import json,sys
try: d=json.load(sys.stdin); print(d.get('$1',''))
except Exception: print('')"; }
cible() { (cd "${RACINE}/pole-jeunesse-admin" 2>/dev/null && pwd -P) || echo ""; }
versions_gardees() { ls -1 "${RACINE}/pj-releases" 2>/dev/null | sed -e 's/-[0-9]\{8\}-[0-9]\{6\}//' | sort | tr '\n' ' ' | sed 's/ $//'; }

# Modifie le meta.json d'une version installée : modifier_meta <répertoire> clé=valeurJSON… (clé= supprime)
modifier_meta() {
  local dir="$1"; shift
  python3 - "${dir}/apps/admin/meta.json" "$@" << 'PY'
import json, sys
f, *extras = sys.argv[1:]
m = json.load(open(f))
for e in extras:
    k, _, v = e.partition('=')
    if v == '':
        m.pop(k, None)
    else:
        m[k] = json.loads(v)
json.dump(m, open(f, 'w'))
PY
}
# Le lien, la configuration en service et le processus désignent-ils tous la même version ?
coherent_avec() {  # <répertoire de version>
  [ "$(cible)" = "$1" ] && cmp -s "${RACINE}/pj-ecosystem.config.js" "$1/.pj/ecosystem.config.js" && [ "$(sante repertoire)" = "$1/apps/admin" ]
}
existe() { [ -f "$1/apps/admin/server.js" ] && [ -f "$1/.pj/ecosystem.config.js" ]; }

PASS=0; FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
ko() { FAIL=$((FAIL + 1)); echo "  ❌ $1"; [ -f "${T}/sortie" ] && sed 's/^/        | /' "${T}/sortie" | tail -n 12; }
egal() { if [ "$2" = "$3" ]; then ok "$1"; else ko "$1 — attendu « $2 », obtenu « $3 »"; fi; }
vrai() { if eval "$2"; then ok "$1"; else ko "$1"; fi; }

# ═════════════════════════════════════════════════════════════════════════════
echo "0. Serveur à l'ancienne disposition : répertoire réel, version 1.0.0 en service"
construire 1.0.0 aaaaaaa
mkdir -p "${RACINE}/pole-jeunesse-admin"
tar -xzf "${ARCH}/pj-admin-deploy.tar.gz" -C "${RACINE}/pole-jeunesse-admin"
tar -xzf "${ARCH}/pj-admin-static.tar.gz" -C "${RACINE}/pole-jeunesse-admin/apps/admin/.next"
mkdir -p "${RACINE}/pole-jeunesse-admin/apps/admin/src/data/caf-archives"
echo '{"annee":2025,"total":1234}' > "${RACINE}/pole-jeunesse-admin/apps/admin/src/data/caf-archives/2025.json"
cat > "${RACINE}/pj-ecosystem.config.js" << JS
module.exports = { apps: [{ name: 'pole-jeunesse-admin', script: '${RACINE}/pole-jeunesse-admin/apps/admin/server.js', cwd: '${RACINE}/pole-jeunesse-admin/apps/admin',
  env: { NODE_ENV: 'production', PORT: ${PORT}, JWT_SECRET: 'secret-de-l-ancienne-configuration', DATABASE_URL: 'postgresql://ancienne' } }] };
JS
node "${T}/faux-pm2.js" startOrRestart "${RACINE}/pj-ecosystem.config.js"
sleep 1
egal "la version 1.0.0 répond" "1.0.0" "$(sante version)"

echo "1. Première livraison avec releases (2.0.0) depuis l'ancienne disposition"
construire 2.0.0 bbbbbbb
livrer 2.0.0 bbbbbbb
egal "code de sortie 0" "0" "${CODE}"
egal "la version 2.0.0 est en service" "2.0.0 bbbbbbb" "$(sante version) $(sante commit)"
vrai "pole-jeunesse-admin est devenu un lien" "[ -L '${RACINE}/pole-jeunesse-admin' ]"
vrai "l'application tourne depuis le répertoire de la version 2.0.0" "case \"\$(sante repertoire)\" in ${RACINE}/pj-releases/2.0.0-bbbbbbb-*) true ;; *) false ;; esac"
ANCIENNE="$(ls -d "${RACINE}"/pj-releases/avant-releases-* 2>/dev/null | head -n 1)"
vrai "l'ancienne version est conservée COMPLÈTE (server.js, node_modules, .next, public)" \
  "[ -f '${ANCIENNE}/apps/admin/server.js' ] && [ -f '${ANCIENNE}/node_modules/next/package.json' ] && [ -f '${ANCIENNE}/apps/admin/.next/BUILD_ID' ] && [ -f '${ANCIENNE}/apps/admin/public/fichier-1.0.0.txt' ]"
vrai "avec SA configuration PM2" "grep -q 'secret-de-l-ancienne-configuration' '${ANCIENNE}/.pj/ecosystem.config.js'"
egal "archive CAF intacte dans les données partagées" '{"annee":2025,"total":1234}' "$(cat "${RACINE}/pj-shared/data/caf-archives/2025.json" 2>/dev/null)"
egal "les deux versions ont écrit dans les MÊMES données" "1.0.0 2.0.0" "$(tr '\n' ' ' < "${RACINE}/pj-shared/data/journal.txt" | sed 's/ $//')"
vrai "fichier de données initial ajouté car absent" "[ -f '${RACINE}/pj-shared/data/reglages.json' ]"
vrai "l'ancienne copie des données n'est pas supprimée" "[ -f '${ANCIENNE}/apps/admin/src/data.avant-partage/caf-archives/2025.json' ]"
CONF2="$(cible)/.pj/ecosystem.config.js"
egal "configuration lisible par son seul propriétaire" "600" "$(python3 -c 'import os, sys; print(oct(os.stat(sys.argv[1]).st_mode & 0o777)[2:])' "${CONF2}")"
egal "secret avec apostrophe, barre oblique et guillemets transmis intact (dernière occurrence du fichier)" "${#SECRET_JWT}" "$(sante jwtLongueur)"
egal "DATABASE_URL avec apostrophe transmise intacte" "postgresql://u:p'w@localhost:5432/base" "$(sante base)"
egal "variables SMTP transmises" "smtp.exemple.test" "$(sante smtp)"
# Sans APP_BASE_URL, l'application refuse d'envoyer les liens de réinitialisation
# et les identifiants (lib/adresse.ts) : elle doit être transmise depuis
# /opt/pj-secrets.env, comme ALLOWED_ORIGIN et MONITORING_OWNER_TENANT.
egal "adresse du site (APP_BASE_URL) transmise" "https://pj.exemple.test" "$(sante adresse)"
egal "ALLOWED_ORIGIN transmise, vide si absente du fichier" "" "$(sante origine)"
egal "commune exploitante du monitoring transmise" "commune-test" "$(sante exploitant)"
egal "écoute sur la boucle locale uniquement" "127.0.0.1" "$(sante hostname)"
vrai "aucun secret dans la sortie du script" "! grep -q -e 'jwt-d' -e 'postgresql://' '${T}/sortie'"
egal "versions gardées : celle en service et la précédente" "2.0.0-bbbbbbb avant-releases" "$(versions_gardees)"

echo "2. Version qui plante au démarrage (3.0.0) : retour arrière automatique"
V2="$(cible)"; PID_AVANT="$(cat "${PM2_DIR}/pid")"
construire 3.0.0 ccccccc plante=true
livrer 3.0.0 ccccccc
egal "code de sortie 2 (retour arrière effectué)" "2" "${CODE}"
egal "la version 2.0.0 est de nouveau en service" "2.0.0 bbbbbbb" "$(sante version) $(sante commit)"
egal "le lien pointe de nouveau sur la version 2.0.0" "${V2}" "$(cible)"
vrai "la configuration en service est celle de la version 2.0.0" "cmp -s '${RACINE}/pj-ecosystem.config.js' '${V2}/.pj/ecosystem.config.js'"
vrai "la version défaillante est gardée pour examen" "ls -d '${RACINE}'/pj-releases/3.0.0-ccccccc-*.echec >/dev/null 2>&1"
vrai "l'ancienne version de secours n'a PAS été supprimée par cet essai" "[ -f '${ANCIENNE}/apps/admin/server.js' ]"
vrai "le message cite l'erreur de l'application" "grep -q 'plantage simulé' '${T}/sortie'"
egal "archive CAF toujours intacte" '{"annee":2025,"total":1234}' "$(cat "${RACINE}/pj-shared/data/caf-archives/2025.json" 2>/dev/null)"

echo "3. Version qui démarre mais annonce une AUTRE version : retour arrière"
construire 3.0.1 ddddddd 'annonce="2.9.9"'
livrer 3.0.1 ddddddd
egal "code de sortie 2" "2" "${CODE}"
egal "la version 2.0.0 est de nouveau en service" "2.0.0" "$(sante version)"
vrai "le message dit ce qui était annoncé et attendu" "grep -q 'version 2.9.9' '${T}/sortie' && grep -q 'version 3.0.1, commit ddddddd' '${T}/sortie'"
vrai "une seule version en échec est gardée" "[ \"\$(ls -d '${RACINE}'/pj-releases/*.echec | wc -l | tr -d ' ')\" = 1 ]"

echo "4. Version qui répond 500 sur /api/health : retour arrière"
construire 3.0.2 eeeeeee codeSante=500
livrer 3.0.2 eeeeeee
egal "code de sortie 2" "2" "${CODE}"
egal "la version 2.0.0 est de nouveau en service" "2.0.0" "$(sante version)"

echo "5. Échecs AVANT la bascule : rien ne change"
PID_AVANT="$(cat "${PM2_DIR}/pid")"; HISTO_AVANT="$(wc -l < "${PM2_DIR}/historique" | tr -d ' ')"
construire 3.1.0 fffffff
printf '%s\n' "DATABASE_URL=postgresql://seule" > "${T}/secrets.env"
livrer 3.1.0 fffffff
egal "JWT_SECRET absent : code de sortie 1" "1" "${CODE}"
ecrire_secrets
printf 'ceci n est pas une archive' > "${ARCH}/pj-admin-deploy.tar.gz"
livrer 3.1.0 fffffff
egal "archive corrompue : code de sortie 1" "1" "${CODE}"
construire 3.1.0 fffffff; rm -f "${ARCH}/pj-admin-static.tar.gz"
livrer 3.1.0 fffffff
egal "archive des fichiers statiques absente : code de sortie 1" "1" "${CODE}"
construire 3.1.0 fffffff
tar -czf "${ARCH}/pj-admin-deploy.tar.gz" -C "${T}/build/app" --exclude="server.js" .
livrer 3.1.0 fffffff
egal "archive sans server.js : code de sortie 1" "1" "${CODE}"
livrer "3.1.0;rm" fffffff
egal "version au format inattendu : code de sortie 1" "1" "${CODE}"
egal "le lien n'a pas bougé" "${V2}" "$(cible)"
egal "le processus en service n'a pas été redémarré" "${PID_AVANT}" "$(cat "${PM2_DIR}/pid")"
egal "PM2 n'a pas été sollicité" "${HISTO_AVANT}" "$(wc -l < "${PM2_DIR}/historique" | tr -d ' ')"
egal "la version 2.0.0 répond toujours" "2.0.0" "$(sante version)"
vrai "aucun répertoire de préparation laissé" "! ls -d '${RACINE}'/pj-releases/*.preparation >/dev/null 2>&1"

echo "6. Livraison saine (3.2.0), build fait avec des fichiers non commités"
construire 3.2.0 9999999 'commit="9999999-modifié"'
livrer 3.2.0 9999999
egal "code de sortie 0 (le suffixe « -modifié » ne déclenche pas de retour arrière)" "0" "${CODE}"
egal "la version 3.2.0 est en service" "3.2.0" "$(sante version)"
egal "versions gardées : 3.2.0 et la précédente 2.0.0 ; l'ancienne et l'échec sont purgés" "2.0.0-bbbbbbb 3.2.0-9999999" "$(versions_gardees)"
vrai "la précédente (2.0.0) est complète, avec sa configuration" "[ -f '${V2}/apps/admin/server.js' ] && [ -f '${V2}/.pj/ecosystem.config.js' ] && [ -f '${V2}/apps/admin/.next/static/chunks/app.js' ]"
vrai "le fichier public propre à 2.0.0 n'a pas fui dans 3.2.0" "[ ! -e \"\$(cible)/apps/admin/public/fichier-2.0.0.txt\" ] && [ -f \"\$(cible)/apps/admin/public/fichier-3.2.0.txt\" ]"
vrai "données existantes non écrasées par celles du build" "[ \"\$(cat '${RACINE}/pj-shared/data/reglages.json')\" = '{\"initial\":true}' ]"

echo "6 bis. Retour arrière MANUEL d'une version saine mais jugée mauvaise à l'usage"
V32="$(cible)"
retour() {
  CODE=0
  PJ_RACINE="${RACINE_PASSEE}" PJ_TMP="${ARCH}" PJ_PORT="${PORT}" PJ_PM2="node ${T}/faux-pm2.js" PJ_DELAI_SANTE=5 \
    bash "${SCRIPT}" --retour-arriere > "${T}/sortie" 2>&1 || CODE=$?
}
retour
egal "code de sortie 0" "0" "${CODE}"
egal "la version 2.0.0 est de nouveau en service" "2.0.0 bbbbbbb" "$(sante version) $(sante commit)"
egal "le lien pointe sur la version 2.0.0" "${V2}" "$(cible)"
vrai "avec la configuration de la version 2.0.0" "cmp -s '${RACINE}/pj-ecosystem.config.js' '${V2}/.pj/ecosystem.config.js'"
vrai "la version quittée (3.2.0) est conservée" "[ -f '${V32}/apps/admin/server.js' ]"
retour
egal "second retour arrière : revient à la 3.2.0 (les deux versions restent échangeables)" "3.2.0" "$(sante version)"
egal "le lien pointe de nouveau sur la version 3.2.0" "${V32}" "$(cible)"
# La version précédente est cassée : le retour arrière manuel ne doit pas laisser le site en panne.
python3 - "${V2}/apps/admin/meta.json" << 'PY'
import json, sys
m = json.load(open(sys.argv[1])); m['plante'] = True; json.dump(m, open(sys.argv[1], 'w'))
PY
retour
egal "version précédente cassée : code de sortie 1, retour arrière abandonné" "1" "${CODE}"
egal "la version 3.2.0 est remise en service" "3.2.0" "$(sante version)"
egal "le lien pointe sur la version 3.2.0" "${V32}" "$(cible)"

echo "6 ter. PM2 ne répond plus pendant une livraison : pas de blocage, l'ancienne version reste en service"
construire 3.3.0 b330000
CODE=0; DEBUT="$(date +%s)"
FAUX_PM2_BLOQUE=1 PJ_DELAI_PM2=2 PJ_RACINE="${RACINE_PASSEE}" PJ_TMP="${ARCH}" PJ_PORT="${PORT}" PJ_PM2="node ${T}/faux-pm2.js" \
  PJ_SECRETS="${T}/secrets.env" PJ_SMTP="${T}/smtp.env" PJ_DELAI_SANTE=3 bash "${SCRIPT}" 3.3.0 b330000 > "${T}/sortie" 2>&1 || CODE=$?
DUREE=$(( $(date +%s) - DEBUT ))
egal "code de sortie 2 (la nouvelle version n'a jamais été démarrée, l'ancienne répond)" "2" "${CODE}"
vrai "le script rend la main au lieu d'attendre PM2 indéfiniment (${DUREE} s)" "[ ${DUREE} -lt 40 ]"
vrai "le message signale que PM2 n'a pas répondu" "grep -q \"PM2 n'a pas répondu\" '${T}/sortie'"
egal "la version 3.2.0 est toujours en service" "3.2.0" "$(sante version)"
egal "le lien est revenu sur la version 3.2.0" "${V32}" "$(cible)"
vrai "la version jamais démarrée est rangée en .echec (preuve : c'est l'ancienne qui répond)" "ls -d '${RACINE}'/pj-releases/3.3.0-b330000-*.echec >/dev/null 2>&1"
vrai "lien, configuration et processus désignent tous la version 3.2.0" "coherent_avec '${V32}'"

# ═════════════════════════════════════════════════════════════════════════════
# Revue du 2026-10-07, R1 : un lien déplacé et « une » réponse saine ne prouvent
# pas une bascule. Chaque scénario vérifie le code de sortie, la version
# RÉELLEMENT servie, la cohérence lien / configuration / processus, et qu'aucune
# version n'a été renommée ni supprimée à tort.
modifier_meta "${V2}" plante=   # la version 2.0.0 redevient saine

echo "R1-a. Retour manuel, PM2 BLOQUÉ, processus actuel toujours vivant (reproduction de la revue)"
FAUX_PM2_BLOQUE=1 PJ_DELAI_PM2=2 retour
vrai "code de sortie NON nul (1) : pas de faux succès" "[ '${CODE}' = 1 ]"
egal "c'est toujours la version 3.2.0 qui répond" "3.2.0" "$(sante version)"
vrai "lien, configuration et processus désignent tous la version 3.2.0" "coherent_avec '${V32}'"
vrai "les deux versions sont conservées" "existe '${V2}' && existe '${V32}'"
vrai "le message dit que le retour n'est PAS effectué" "grep -q 'NON effectué' '${T}/sortie' && ! grep -q 'Retour arrière vérifié' '${T}/sortie'"

echo "R1-b. Retour manuel, PM2 REFUSE la commande sans arrêter le processus"
FAUX_PM2_REFUSE=1 retour
vrai "code de sortie NON nul (1)" "[ '${CODE}' = 1 ]"
egal "c'est toujours la version 3.2.0 qui répond" "3.2.0" "$(sante version)"
vrai "lien, configuration et processus désignent tous la version 3.2.0" "coherent_avec '${V32}'"
vrai "les deux versions sont conservées" "existe '${V2}' && existe '${V32}'"
vrai "le message cite le refus de PM2" "grep -q 'PM2 a refusé' '${T}/sortie'"

echo "R1-c. Retour manuel : la version visée démarre mais annonce le MAUVAIS COMMIT"
modifier_meta "${V2}" 'commit="0badc0d"'
retour
vrai "code de sortie NON nul (1) : une réponse saine du mauvais commit ne vaut pas bascule" "[ '${CODE}' = 1 ]"
egal "la version de départ (3.2.0) est remise en service" "3.2.0" "$(sante version)"
vrai "lien, configuration et processus désignent tous la version 3.2.0" "coherent_avec '${V32}'"
vrai "le message dit ce qui a été annoncé" "grep -q '0badc0d' '${T}/sortie'"
modifier_meta "${V2}" 'commit="bbbbbbb"'

echo "R1-d. Retour manuel : la version visée démarre mais annonce la MAUVAISE VERSION"
modifier_meta "${V2}" 'annonce="2.0.1"'
retour
vrai "code de sortie NON nul (1)" "[ '${CODE}' = 1 ]"
egal "la version de départ (3.2.0) est remise en service" "3.2.0" "$(sante version)"
vrai "lien, configuration et processus désignent tous la version 3.2.0" "coherent_avec '${V32}'"
modifier_meta "${V2}" annonce=

echo "R1-e. Retour manuel : bonne version, bon commit, mais pas la bonne RELEASE"
modifier_meta "${V2}" sansRelease=true
retour
vrai "code de sortie NON nul (1)" "[ '${CODE}' = 1 ]"
vrai "lien, configuration et processus désignent tous la version 3.2.0" "coherent_avec '${V32}'"
modifier_meta "${V2}" sansRelease=

echo "R1-f. Les retours manuels sains fonctionnent toujours, identité vérifiée"
retour
egal "code de sortie 0" "0" "${CODE}"
egal "la version 2.0.0 répond" "2.0.0 bbbbbbb" "$(sante version) $(sante commit)"
vrai "lien, configuration et processus désignent tous la version 2.0.0" "coherent_avec '${V2}'"
vrai "le message annonce un retour VÉRIFIÉ" "grep -q 'Retour arrière vérifié' '${T}/sortie'"
retour
egal "retour à la 3.2.0 : code de sortie 0" "0" "${CODE}"
vrai "lien, configuration et processus désignent tous la version 3.2.0" "coherent_avec '${V32}'"

echo "R1-g. Retour AUTOMATIQUE : la nouvelle version tourne (mauvaise version annoncée) et PM2 REFUSE de relancer l'ancienne"
construire 3.4.0 c340000 'annonce="9.9.9"'
: > "${T}/compteur"; rm -f "${T}/compteur"
FAUX_PM2_PANNE_APRES=1 FAUX_PM2_PANNE_MODE=refuse FAUX_PM2_COMPTEUR="${T}/compteur" livrer 3.4.0 c340000
egal "code de sortie 3 (intervention requise), pas 2" "3" "${CODE}"
egal "c'est bien la version défaillante qui répond encore" "9.9.9" "$(sante version)"
V34="$(ls -d "${RACINE}"/pj-releases/3.4.0-c340000-* 2>/dev/null | head -n 1)"
vrai "la version défaillante n'a PAS été renommée en .echec : son processus tourne" "[ -n '${V34}' ] && case '${V34}' in *.echec) false ;; *) true ;; esac"
vrai "lien, configuration et processus désignent tous la version qui tourne" "coherent_avec '${V34}'"
vrai "la version précédente (3.2.0) est conservée intacte" "existe '${V32}'"
vrai "le message dit que la version défaillante répond toujours" "grep -q 'répond toujours' '${T}/sortie' && grep -q 'INTERVENTION REQUISE' '${T}/sortie'"
# Reprise par l'opérateur, PM2 revenu : le retour manuel ramène la version précédente.
retour
egal "reprise par retour manuel : code de sortie 0" "0" "${CODE}"
egal "la version 3.2.0 est de nouveau en service" "3.2.0" "$(sante version)"
vrai "lien, configuration et processus désignent tous la version 3.2.0" "coherent_avec '${V32}'"

echo "R1-h. Retour AUTOMATIQUE : même situation, PM2 BLOQUÉ au lieu de refuser"
construire 3.4.1 c341000 'annonce="9.9.8"'
rm -f "${T}/compteur"
FAUX_PM2_PANNE_APRES=1 FAUX_PM2_PANNE_MODE=bloque FAUX_PM2_COMPTEUR="${T}/compteur" PJ_DELAI_PM2=2 livrer 3.4.1 c341000
egal "code de sortie 3" "3" "${CODE}"
egal "c'est la version défaillante qui répond encore" "9.9.8" "$(sante version)"
V341="$(ls -d "${RACINE}"/pj-releases/3.4.1-c341000-* 2>/dev/null | head -n 1)"
vrai "elle n'a pas été renommée en .echec" "[ -n '${V341}' ] && case '${V341}' in *.echec) false ;; *) true ;; esac"
vrai "lien, configuration et processus désignent tous la version qui tourne" "coherent_avec '${V341}'"
vrai "la version précédente (3.2.0) est conservée intacte" "existe '${V32}'"
# Remise en état par « l'opérateur » : lien et configuration d'abord, redémarrage ensuite.
python3 -c 'import os, sys; os.symlink(sys.argv[1], sys.argv[2] + ".t"); os.replace(sys.argv[2] + ".t", sys.argv[2])' "${V32}" "${RACINE}/pole-jeunesse-admin"
cp "${V32}/.pj/ecosystem.config.js" "${RACINE}/pj-ecosystem.config.js"
node "${T}/faux-pm2.js" startOrRestart "${RACINE}/pj-ecosystem.config.js"; sleep 1
egal "(remise en état pour la suite : 3.2.0 en service)" "3.2.0" "$(sante version)"

echo "R1-i. Retour AUTOMATIQUE : la nouvelle version plante et PM2 refuse de relancer l'ancienne — plus rien ne répond"
construire 3.5.0 c350000 plante=true
rm -f "${T}/compteur"
FAUX_PM2_PANNE_APRES=1 FAUX_PM2_PANNE_MODE=refuse FAUX_PM2_COMPTEUR="${T}/compteur" livrer 3.5.0 c350000
egal "code de sortie 3, pas 2 : aucun retour arrière n'est annoncé" "3" "${CODE}"
egal "rien ne répond" "" "$(sante version)"
V35="$(ls -d "${RACINE}"/pj-releases/3.5.0-c350000-* 2>/dev/null | head -n 1)"
vrai "la version défaillante n'a pas été renommée (sa mise hors service n'est pas prouvée)" "[ -n '${V35}' ] && case '${V35}' in *.echec) false ;; *) true ;; esac"
egal "le lien désigne la version précédente, à relancer" "${V32}" "$(cible)"
vrai "la configuration en service est celle de la version précédente" "cmp -s '${RACINE}/pj-ecosystem.config.js' '${V32}/.pj/ecosystem.config.js'"
vrai "la version précédente est conservée intacte" "existe '${V32}'"
vrai "le message ne parle pas de retour arrière vérifié" "grep -q 'INTERVENTION REQUISE' '${T}/sortie' && ! grep -q 'Retour arrière vérifié' '${T}/sortie'"
node "${T}/faux-pm2.js" startOrRestart "${V32}/.pj/ecosystem.config.js"; sleep 1
egal "(remise en état pour la suite : 3.2.0 en service)" "3.2.0" "$(sante version)"

echo "R1-j. LIVRAISON du même commit que la version en service, PM2 refuse : l'ancien processus ne passe pas pour le nouveau"
construire 3.2.0 9999999 'commit="9999999-modifié"'
FAUX_PM2_REFUSE=1 livrer 3.2.0 9999999
egal "code de sortie 2 : livraison NON confirmée malgré une réponse saine de même version et même commit" "2" "${CODE}"
vrai "lien, configuration et processus désignent tous l'ancienne version 3.2.0" "coherent_avec '${V32}'"
vrai "le message montre que la release annoncée n'était pas la bonne" "grep -q 'Livraison non confirmée' '${T}/sortie'"
vrai "une seule version en échec est gardée" "[ \"\$(ls -d '${RACINE}'/pj-releases/*.echec | wc -l | tr -d ' ')\" = 1 ]"

echo "7. Nouvelle version défaillante ET version précédente elle aussi cassée : alerte, pas de faux succès"
V3="$(cible)"
python3 - "${V3}/apps/admin/meta.json" << 'PY'
import json, sys
m = json.load(open(sys.argv[1])); m['plante'] = True; json.dump(m, open(sys.argv[1], 'w'))
PY
construire 4.0.0 abcdef0 plante=true
livrer 4.0.0 abcdef0
egal "code de sortie 3 (intervention requise)" "3" "${CODE}"
vrai "le message demande une intervention" "grep -q 'INTERVENTION REQUISE' '${T}/sortie'"
egal "le lien pointe sur la version précédente (dernier état connu)" "${V3}" "$(cible)"

echo "8. Serveur neuf, sans aucune version"
arreter; rm -rf "${RACINE}" "${PM2_DIR}"; mkdir -p "${RACINE}" "${PM2_DIR}"
construire 1.0.0 aaaaaaa plante=true
livrer 1.0.0 aaaaaaa
egal "première livraison défaillante : code de sortie 3 (aucune version vers laquelle revenir)" "3" "${CODE}"
construire 1.0.1 aaaaaab
livrer 1.0.1 aaaaaab
egal "livraison saine sur serveur neuf : code de sortie 0" "0" "${CODE}"
egal "la version 1.0.1 est en service" "1.0.1" "$(sante version)"
vrai "pole-jeunesse-admin est un lien" "[ -L '${RACINE}/pole-jeunesse-admin' ]"

echo "10. Serveur dans sa disposition ACTUELLE : deux versions installées avant le correctif, sans identité ni identifiant de release"
arreter; rm -rf "${RACINE}" "${PM2_DIR}"; mkdir -p "${RACINE}/pj-releases" "${RACINE}/pj-shared/data" "${PM2_DIR}"
# installer_a_la_main <répertoire> : version posée comme l'a fait le script d'avant le correctif.
installer_a_la_main() {
  mkdir -p "$1/apps/admin/.next" "$1/.pj" "$1/apps/admin/src"
  tar -xzf "${ARCH}/pj-admin-deploy.tar.gz" -C "$1"
  tar -xzf "${ARCH}/pj-admin-static.tar.gz" -C "$1/apps/admin/.next"
  ln -s "${RACINE}/pj-shared/data" "$1/apps/admin/src/data"
  cat > "$1/.pj/ecosystem.config.js" << JS
module.exports = { apps: [{ name: 'pole-jeunesse-admin', script: '${RACINE}/pole-jeunesse-admin/apps/admin/server.js', cwd: '${RACINE}/pole-jeunesse-admin/apps/admin',
  env: { NODE_ENV: 'production', PORT: ${PORT}, HOSTNAME: '127.0.0.1', JWT_SECRET: 'secret-$(basename "$1")', DATABASE_URL: 'postgresql://x' } }] };
JS
}
HIST="${RACINE}/pj-releases/avant-releases-20261007-140407"
COUR="${RACINE}/pj-releases/2.1.7-d6ef6c8-20261007-140405"
construire 2.1.6 62f196c sansRelease=true; installer_a_la_main "${HIST}"
construire 2.1.7 d6ef6c8 sansRelease=true; installer_a_la_main "${COUR}"
ln -s "${COUR}" "${RACINE}/pole-jeunesse-admin"
cp "${COUR}/.pj/ecosystem.config.js" "${RACINE}/pj-ecosystem.config.js"
node "${T}/faux-pm2.js" startOrRestart "${RACINE}/pj-ecosystem.config.js"; sleep 1
egal "état de départ : 2.1.7 en service, aucune identité enregistrée" "2.1.7 0" "$(sante version) $(ls "${RACINE}"/pj-releases/*/.pj/identite 2>/dev/null | wc -l | tr -d ' ')"

retour
egal "retour manuel vers la version historique : code 0" "0" "${CODE}"
egal "la version 2.1.6 répond" "2.1.6" "$(sante version)"
vrai "lien, configuration et processus désignent tous la version historique" "coherent_avec '${HIST}'"
egal "identité de la 2.1.7 reconstituée d'après le nom de son répertoire" "2.1.7 d6ef6c8 nom-du-repertoire" "$(sed -n 's/^version=//p;s/^commit=//p;s/^origine=//p' "${COUR}/.pj/identite" | tr '\n' ' ' | sed 's/ $//')"
egal "identité de la version historique : version lue dans son package.json, commit inconnu" "2.1.6 ? package-json" "$(sed -n 's/^version=//p;s/^commit=//p;s/^origine=//p' "${HIST}/.pj/identite" | tr '\n' ' ' | sed 's/ $//')"
retour
egal "retour à la 2.1.7 : code 0" "0" "${CODE}"
vrai "lien, configuration et processus désignent tous la version 2.1.7" "coherent_avec '${COUR}'"

FAUX_PM2_BLOQUE=1 PJ_DELAI_PM2=2 retour
vrai "PM2 bloqué : code de sortie NON nul (1), même sans identifiant de release" "[ '${CODE}' = 1 ]"
egal "c'est toujours la 2.1.7 qui répond" "2.1.7" "$(sante version)"
vrai "lien, configuration et processus désignent tous la version 2.1.7" "coherent_avec '${COUR}'"

# La version historique annonce par erreur la même version que la courante : indiscernables.
modifier_meta "${HIST}" 'annonce="2.1.7"'; printf 'version=2.1.7\ncommit=?\nrelease=x\nsante_release=0\norigine=essai\n' > "${HIST}/.pj/identite"
retour
vrai "deux versions indiscernables : refus AVANT toute bascule (code 1)" "[ '${CODE}' = 1 ] && grep -q 'même identité' '${T}/sortie'"
vrai "rien n'a bougé" "coherent_avec '${COUR}'"
modifier_meta "${HIST}" annonce=; rm -f "${HIST}/.pj/identite"

construire 2.1.8 a218000
livrer 2.1.8 a218000
egal "première livraison du script corrigé sur ce serveur : code 0" "0" "${CODE}"
egal "la version 2.1.8 répond, avec son identifiant de release" "2.1.8 $(basename "$(cible)")" "$(sante version) $(sante release)"
egal "versions gardées : la 2.1.8 et la 2.1.7 ; la version historique est purgée" "2.1.7-d6ef6c8 2.1.8-a218000" "$(versions_gardees)"
V218="$(cible)"
construire 2.1.9 a219000 plante=true
livrer 2.1.9 a219000
egal "livraison suivante défaillante : retour arrière vérifié (code 2)" "2" "${CODE}"
vrai "lien, configuration et processus désignent tous la version 2.1.8" "coherent_avec '${V218}'"
retour
egal "retour manuel 2.1.8 → 2.1.7 (version d'avant le correctif) : code 0" "0" "${CODE}"
vrai "lien, configuration et processus désignent tous la version 2.1.7" "coherent_avec '${COUR}'"

# ═════════════════════════════════════════════════════════════════════════════
# Optionnel : mêmes bascules avec le VRAI PM2 (PJ_TEST_PM2_REEL=/chemin/vers/pm2).
# Le faux PM2 ci-dessus ne prouve pas que le vrai relit bien le lien de la
# version en service à chaque redémarrage : cette section le vérifie. Son
# démon tourne dans un répertoire temporaire (PM2_HOME) et est arrêté à la fin.
if [ -n "${PJ_TEST_PM2_REEL:-}" ]; then
  # PM2_HOME d'abord : la moindre commande pm2 (même --version) démarre un
  # démon, qui s'installerait sinon dans le ~/.pm2 de la personne qui teste.
  export PM2_HOME="${T}/pm2-home"
  echo "9. Avec le vrai PM2 ($("${PJ_TEST_PM2_REEL}" --version 2>/dev/null | tail -n 1))"
  arreter; rm -rf "${RACINE}"; mkdir -p "${RACINE}"
  arreter_pm2_reel() { "${PJ_TEST_PM2_REEL}" kill >/dev/null 2>&1; true; }
  trap 'arreter_pm2_reel; nettoyer' EXIT
  # Le vrai PM2, derrière un relais qui peut REFUSER un redémarrage sans rien
  # toucher (PM2_CAPRICE=refuse) : le processus reste alors géré, et vivant,
  # par le vrai PM2 — c'est le cas de la revue R1 en conditions plus proches du réel.
  cat > "${T}/pm2-relais.sh" << RELAIS
#!/usr/bin/env bash
if [ "\${PM2_CAPRICE:-}" = "refuse" ] && [ "\$1" = "startOrRestart" ]; then echo "[PM2][ERROR] refus simulé" >&2; exit 1; fi
exec "${PJ_TEST_PM2_REEL}" "\$@"
RELAIS
  chmod +x "${T}/pm2-relais.sh"
  livrer_reel() {
    CODE=0
    PJ_RACINE="${RACINE_PASSEE}" PJ_TMP="${ARCH}" PJ_PORT="${PORT}" PJ_PM2="${T}/pm2-relais.sh" \
    PJ_SECRETS="${T}/secrets.env" PJ_SMTP="${T}/smtp.env" PJ_DELAI_SANTE=12 \
      bash "${SCRIPT}" "$1" "$2" > "${T}/sortie" 2>&1 || CODE=$?
  }
  construire 5.0.0 a500000; livrer_reel 5.0.0 a500000
  egal "vrai PM2 — première livraison : code 0" "0" "${CODE}"
  egal "vrai PM2 — 5.0.0 en service" "5.0.0" "$(sante version)"
  R5="$(cible)"
  egal "vrai PM2 — le processus tourne depuis le répertoire de la 5.0.0" "${R5}/apps/admin" "$(sante repertoire)"
  egal "vrai PM2 — écoute sur la boucle locale" "127.0.0.1" "$(sante hostname)"

  construire 5.1.0 a510000 plante=true; livrer_reel 5.1.0 a510000
  egal "vrai PM2 — version qui plante : code 2" "2" "${CODE}"
  egal "vrai PM2 — retour arrière : 5.0.0 de nouveau en service" "5.0.0" "$(sante version)"
  egal "vrai PM2 — le processus tourne de nouveau depuis le répertoire de la 5.0.0" "${R5}/apps/admin" "$(sante repertoire)"

  construire 5.1.1 a511000 'annonce="0.0.0"'; livrer_reel 5.1.1 a511000
  egal "vrai PM2 — mauvaise version annoncée : code 2" "2" "${CODE}"
  egal "vrai PM2 — retour arrière : 5.0.0 de nouveau en service" "5.0.0" "$(sante version)"

  construire 5.2.0 a520000; livrer_reel 5.2.0 a520000
  egal "vrai PM2 — livraison saine suivante : code 0" "0" "${CODE}"
  egal "vrai PM2 — 5.2.0 en service" "5.2.0" "$(sante version)"
  vrai "vrai PM2 — le processus tourne depuis le NOUVEAU répertoire, pas l'ancien" "[ \"\$(sante repertoire)\" = \"\$(cible)/apps/admin\" ] && [ \"\$(cible)\" != '${R5}' ]"
  egal "vrai PM2 — un seul processus géré" "1" "$("${PJ_TEST_PM2_REEL}" jlist 2>/dev/null | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' 2>/dev/null)"

  R52="$(cible)"
  retour_reel() {
    CODE=0
    PJ_RACINE="${RACINE_PASSEE}" PJ_TMP="${ARCH}" PJ_PORT="${PORT}" PJ_PM2="${T}/pm2-relais.sh" PJ_DELAI_SANTE=12 \
      bash "${SCRIPT}" --retour-arriere > "${T}/sortie" 2>&1 || CODE=$?
  }
  PM2_CAPRICE=refuse retour_reel
  vrai "vrai PM2 — retour manuel refusé par PM2 : code NON nul (1)" "[ '${CODE}' = 1 ]"
  vrai "vrai PM2 — lien, configuration et processus désignent toujours la 5.2.0" "coherent_avec '${R52}'"
  retour_reel
  egal "vrai PM2 — retour manuel sain : code 0" "0" "${CODE}"
  vrai "vrai PM2 — lien, configuration et processus désignent la 5.0.0" "coherent_avec '${R5}'"
  retour_reel
  egal "vrai PM2 — et retour à la 5.2.0 : code 0" "0" "${CODE}"
  vrai "vrai PM2 — lien, configuration et processus désignent la 5.2.0" "coherent_avec '${R52}'"

  # Nouvelle version qui tourne en annonçant une autre version, puis PM2 refuse de relancer l'ancienne.
  construire 5.3.0 a530000 'annonce="0.0.1"'
  cat > "${T}/pm2-relais.sh" << RELAIS
#!/usr/bin/env bash
if [ "\$1" = "startOrRestart" ]; then
  n=\$(cat "${T}/compteur-reel" 2>/dev/null || echo 0); echo \$((n + 1)) > "${T}/compteur-reel"
  if [ "\$n" -ge 1 ]; then echo "[PM2][ERROR] refus simulé" >&2; exit 1; fi
fi
exec "${PJ_TEST_PM2_REEL}" "\$@"
RELAIS
  rm -f "${T}/compteur-reel"
  livrer_reel 5.3.0 a530000
  egal "vrai PM2 — retour automatique impossible (PM2 refuse) : code 3, pas 2" "3" "${CODE}"
  egal "vrai PM2 — la version défaillante répond encore" "0.0.1" "$(sante version)"
  R53="$(ls -d "${RACINE}"/pj-releases/5.3.0-a530000-* 2>/dev/null | head -n 1)"
  vrai "vrai PM2 — elle n'est pas renommée en .echec, et lien/configuration/processus la désignent" "case '${R53}' in *.echec) false ;; *) coherent_avec '${R53}' ;; esac"
  vrai "vrai PM2 — la version précédente est conservée" "existe '${R52}'"
  arreter_pm2_reel
else
  echo "9. Vrai PM2 : non exécuté (définir PJ_TEST_PM2_REEL=/chemin/vers/pm2 pour l'inclure)"
fi

echo ""
echo "deploy-release : ${PASS} réussi(s), ${FAIL} échec(s)"
[ "${FAIL}" -eq 0 ]
