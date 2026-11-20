#!/usr/bin/env bash
# Banc d'essai LOCAL de scripts/mettre-a-jour-node.sh.
# Aucun accès distant : faux apt-get, faux dpkg-query, faux node, faux PM2 et
# une fausse application (petit serveur Node qui répond à /api/health) dans un
# répertoire temporaire.
#
# Ce que ce banc établit : rien n'est modifié si l'application est malade
# avant, si le dépôt NodeSource ou sa clé manquent ; passage de branche avec
# épingle APT ; vérification node + processus PM2 + santé identique ; retour
# automatique à la branche de départ si l'application ne répond plus, si apt
# échoue ou si node n'annonce pas la bonne branche.
#
# Ce qu'il n'établit PAS : le comportement du vrai apt, du dépôt NodeSource,
# du vrai PM2 ni du VPS.
#
# Usage : bash scripts/test-mettre-a-jour-node.sh   (PJ_TEST_PORT pour changer de port)
# Compatible Bash 3.2.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# PJ_TEST_SCRIPT : pour rejouer ce banc contre une autre version du script (preuve de régression).
SCRIPT="${PJ_TEST_SCRIPT:-${DIR}/mettre-a-jour-node.sh}"
PORT="${PJ_TEST_PORT:-3198}"
VRAI_NODE="$(command -v node || true)"
[ -n "${VRAI_NODE}" ] || { echo "❌ node introuvable : banc d'essai non exécuté." >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "❌ python3 introuvable : banc d'essai non exécuté." >&2; exit 1; }
if curl -s -o /dev/null -m 2 "http://127.0.0.1:${PORT}/"; then
  echo "❌ Le port ${PORT} est déjà utilisé : relancer avec PJ_TEST_PORT=<port libre>." >&2; exit 1
fi

T="$(mktemp -d)"
T="$(cd "${T}" && pwd -P)"
arreter() { [ -f "${T}/etat/pid" ] && kill "$(cat "${T}/etat/pid")" 2>/dev/null; rm -f "${T}/etat/pid"; true; }
trap 'arreter; rm -rf "${T}"' EXIT
mkdir -p "${T}/bin"

# ── Fausse application : /api/health ; mode « casse » = 500 sous la branche 24 ─
cat > "${T}/app.js" << 'JS'
const http = require('http');
const majeure = process.env.NODE_SIMULE.replace(/^v/, '').split('.')[0];
const casse = process.env.MODE_APP === 'casse' && majeure === '24';
http.createServer((req, res) => {
  if (casse) { res.writeHead(500); return res.end('{"status":"error"}'); }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', version: '2.10.1', commit: 'd1c9488' }));
}).listen(Number(process.env.PORT), '127.0.0.1');
JS

# ── Faux node : annonce la version installée par le faux apt ─────────────────
cat > "${T}/bin/node" << 'SH'
#!/usr/bin/env bash
[ "${1:-}" = "--version" ] && { cat "${ETAT}/node" 2>/dev/null || exit 1; exit 0; }
exit 1
SH

cat > "${T}/bin/dpkg-query" << 'SH'
#!/usr/bin/env bash
tr -d '\n' < "${ETAT}/paquet"
SH

# ── Faux apt-get / apt-cache : fidèles au comportement relevé sur le VPS ─────
# Le dépôt suivi (node_<n>.x dans le fichier NodeSource) propose ses versions ;
# `install nodejs` sans version ne redescend jamais sous la version installée
# (règle d'apt, quelles que soient les préférences) ; `nodejs=<version>` exige
# une version du dépôt, et --allow-downgrades pour redescendre.
cat > "${T}/bin/apt-cache" << 'SH'
#!/usr/bin/env bash
branche="$(sed -n 's/.*deb\.nodesource\.com\/node_\([0-9]*\)\.x.*/\1/p' "${SOURCES}"/nodesource.* | head -n 1)"
case "${branche}" in
  20) versions="20.20.2-1nodesource1 20.20.1-1nodesource1" ;;
  22) versions="22.21.0-1nodesource1" ;;
  24) versions="24.22.0-1nodesource1 24.11.1-1nodesource1" ;;
esac
[ "${1:-}" = "madison" ] || exit 1
for v in ${versions}; do echo "    nodejs | ${v} | https://deb.nodesource.com/node_${branche}.x nodistro/main amd64 Packages"; done
SH
cat > "${T}/bin/apt-get" << 'SH'
#!/usr/bin/env bash
echo "apt-get $*" >> "${ETAT}/journal"
[ -n "${NEEDRESTART_SUSPEND:-}" ] || echo "needrestart actif" >> "${ETAT}/journal"
[ "${1:-}" = "update" ] && exit 0
demande="${@: -1}"
case "${demande}" in
  nodejs=*) version="${demande#nodejs=}" ;;
  *) echo "nodejs is already the newest version" >&2; exit 0 ;;
esac
apt-cache madison nodejs | grep -q "| ${version} |" || { echo "E: Version '${version}' for 'nodejs' was not found" >&2; exit 100; }
case "${version}" in 24.*) [ "${MODE_APT:-}" = "echec" ] && exit 100 ;; esac
plus_ancienne="$(printf '%s\n%s\n' "${version}" "$(cat "${ETAT}/paquet")" | sort -t. -k1,1n -k2,2n -k3,3n | head -n 1)"
if [ "${plus_ancienne}" = "${version}" ] && [ "${version}" != "$(cat "${ETAT}/paquet")" ]; then
  case " $* " in *" --allow-downgrades "*) ;; *) echo "E: downgrade refusé" >&2; exit 100 ;; esac
fi
case "${version}" in 24.*) [ "${MODE_APT:-}" = "mauvaise-branche" ] && version="22.21.0-1nodesource1" ;; esac
echo "${version}" > "${ETAT}/paquet"
echo "v${version%%-*}" > "${ETAT}/node"
SH

# ── Faux PM2 : update relance l'application sous le Node « installé » ───────
cat > "${T}/bin/pm2" << SH
#!/usr/bin/env bash
case "\${1:-}" in
  update)
    echo "pm2 update" >> "\${ETAT}/journal"
    [ -f "\${ETAT}/pid" ] && kill "\$(cat "\${ETAT}/pid")" 2>/dev/null
    cp "\${ETAT}/node" "\${ETAT}/node-processus"
    NODE_SIMULE="\$(cat "\${ETAT}/node")" PORT="${PORT}" "${VRAI_NODE}" "${T}/app.js" >/dev/null 2>&1 &
    echo \$! > "\${ETAT}/pid"; sleep 0.3 ;;
  jlist)
    printf '[{"name":"pole-jeunesse-admin","pm2_env":{"node_version":"%s"}}]' "\$(sed 's/^v//' "\${ETAT}/node-processus")" ;;
  save) echo "pm2 save" >> "\${ETAT}/journal" ;;
esac
SH
chmod +x "${T}/bin/"*

REUSSIS=0; ECHOUES=0
ok()  { echo "  ✓ $1"; REUSSIS=$((REUSSIS + 1)); }
ko()  { echo "  ✗ $1" >&2; ECHOUES=$((ECHOUES + 1)); }
verifier() { if eval "$2"; then ok "$1"; else ko "$1"; fi; }

# Prépare un serveur Node 20 sain, dépôt NodeSource node_20.x signé par une clé présente.
preparer() {
  arreter
  rm -rf "${T}/etat" "${T}/sources" "${T}/prefs" "${T}/keyrings"
  mkdir -p "${T}/etat" "${T}/sources" "${T}/prefs" "${T}/keyrings"
  export ETAT="${T}/etat" SOURCES="${T}/sources" PREFS="${T}/prefs"
  echo v20.20.1 > "${ETAT}/node"
  echo 20.20.1-1nodesource1 > "${ETAT}/paquet"
  printf 'Package: nodejs\nPin: origin deb.nodesource.com\nPin-Priority: 600\n' > "${PREFS}/nodejs"
  : > "${T}/keyrings/nodesource.gpg"
  echo "deb [arch=amd64 signed-by=${T}/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > "${SOURCES}/nodesource.list"
  : > "${ETAT}/journal"
  PATH="${T}/bin:${PATH}" pm2 update >/dev/null
  : > "${ETAT}/journal"
}

lancer() {  # <branche cible>
  PATH="${T}/bin:${PATH}" PJ_SANS_ROOT=1 PJ_APT_SOURCES="${SOURCES}" \
    PJ_PORT="${PORT}" PJ_DELAI_SANTE=4 bash "${SCRIPT}" "$1" > "${T}/sortie" 2>&1
  CODE=$?
}

echo "mettre-a-jour-node : banc d'essai local"

echo "1. Passage 20 → 24 réussi"
preparer; MODE_APP=normal; export MODE_APP MODE_APT=; lancer 24
verifier "code 0" '[ "${CODE}" -eq 0 ]'
verifier "node en 24" 'grep -q "^v24" "${ETAT}/node"'
verifier "processus PM2 sous 24" 'grep -q "^v24" "${ETAT}/node-processus"'
verifier "dépôt node_24.x, même clé" 'grep -q "node_24.x" "${SOURCES}/nodesource.list" && grep -q "signed-by=${T}/keyrings/nodesource.gpg" "${SOURCES}/nodesource.list"'
verifier "version la plus récente de la branche" 'grep -qx "24.22.0-1nodesource1" "${ETAT}/paquet"'
verifier "aucune préférence APT ajoutée" '[ "$(ls "${PREFS}")" = "nodejs" ]'
verifier "needrestart neutralisé" '! grep -q "needrestart actif" "${ETAT}/journal"'
verifier "pm2 save après succès" 'grep -q "pm2 save" "${ETAT}/journal"'
verifier "application saine" 'curl -s "http://127.0.0.1:${PORT}/api/health" | grep -q "\"ok\""'

echo "2. Déjà sur 24 : rien à faire"
: > "${ETAT}/journal"; lancer 24
verifier "code 0" '[ "${CODE}" -eq 0 ]'
verifier "aucun appel apt ni pm2" '[ ! -s "${ETAT}/journal" ]'

echo "3. L'application ne répond plus sous 24 : retour automatique à 20"
preparer; export MODE_APP=casse; lancer 24
verifier "code non nul" '[ "${CODE}" -ne 0 ]'
verifier "node revenu en 20" 'grep -q "^v20" "${ETAT}/node"'
verifier "processus PM2 revenu en 20" 'grep -q "^v20" "${ETAT}/node-processus"'
verifier "dépôt revenu à node_20.x" 'grep -q "node_20.x" "${SOURCES}/nodesource.list"'
verifier "paquet de départ exact restauré" 'grep -qx "20.20.1-1nodesource1" "${ETAT}/paquet"'
verifier "application saine après retour" 'curl -s "http://127.0.0.1:${PORT}/api/health" | grep -q "\"ok\""'
verifier "message de retour effectué" 'grep -q "retour à v20" "${T}/sortie"'

echo "4. apt échoue : retour à 20 sans toucher au processus"
preparer; export MODE_APP=normal MODE_APT=echec; lancer 24
verifier "code non nul" '[ "${CODE}" -ne 0 ]'
verifier "node resté en 20" 'grep -q "^v20" "${ETAT}/node"'
verifier "dépôt revenu à node_20.x" 'grep -q "node_20.x" "${SOURCES}/nodesource.list"'
verifier "application saine" 'curl -s "http://127.0.0.1:${PORT}/api/health" | grep -q "\"ok\""'

echo "5. node n'annonce pas la branche demandée : retour à 20"
preparer; export MODE_APT=mauvaise-branche; lancer 24
verifier "code non nul" '[ "${CODE}" -ne 0 ]'
verifier "node revenu en 20" 'grep -q "^v20" "${ETAT}/node"'
export MODE_APT=

echo "6. Application malade AVANT : rien n'est modifié"
preparer; arreter; lancer 24
verifier "code non nul" '[ "${CODE}" -ne 0 ]'
verifier "aucun appel apt" '! grep -q apt-get "${ETAT}/journal"'
verifier "dépôt inchangé" 'grep -q "node_20.x" "${SOURCES}/nodesource.list"'
verifier "préférences inchangées" '[ "$(ls "${PREFS}")" = "nodejs" ]'

echo "7. Clé signed-by absente : rien n'est modifié"
preparer; rm -f "${T}/keyrings/nodesource.gpg"; lancer 24
verifier "code non nul" '[ "${CODE}" -ne 0 ]'
verifier "aucun appel apt" '! grep -q apt-get "${ETAT}/journal"'
verifier "dépôt inchangé" 'grep -q "node_20.x" "${SOURCES}/nodesource.list"'

echo "8. Aucun dépôt NodeSource : rien n'est modifié"
preparer; rm -f "${SOURCES}/nodesource.list"; lancer 24
verifier "code non nul" '[ "${CODE}" -ne 0 ]'
verifier "aucun appel apt" '! grep -q apt-get "${ETAT}/journal"'

echo "9. Dépôt au format deb822 (.sources), comme sur le VPS : passage puis retour"
preparer; rm -f "${SOURCES}/nodesource.list"
printf 'Types: deb\nURIs: https://deb.nodesource.com/node_20.x\nSuites: nodistro\nComponents: main\nArchitectures: amd64\nSigned-By: %s\n' "${T}/keyrings/nodesource.gpg" > "${SOURCES}/nodesource.sources"
export MODE_APP=normal; lancer 24
verifier "code 0" '[ "${CODE}" -eq 0 ]'
verifier "node en 24" 'grep -q "^v24" "${ETAT}/node"'
verifier "URIs node_24.x, Signed-By inchangé" 'grep -q "^URIs: https://deb.nodesource.com/node_24.x$" "${SOURCES}/nodesource.sources" && grep -q "^Signed-By: ${T}/keyrings/nodesource.gpg$" "${SOURCES}/nodesource.sources"'
lancer 20
verifier "retour volontaire à 20 : code 0" '[ "${CODE}" -eq 0 ]'
verifier "node en 20" 'grep -q "^v20" "${ETAT}/node"'
verifier "URIs node_20.x" 'grep -q "^URIs: https://deb.nodesource.com/node_20.x$" "${SOURCES}/nodesource.sources"'
verifier "redescente effective (version la plus récente de 20)" 'grep -qx "20.20.2-1nodesource1" "${ETAT}/paquet"'

echo "10. Argument invalide"
preparer; lancer "24.x"
verifier "code non nul" '[ "${CODE}" -ne 0 ]'

echo ""
echo "mettre-a-jour-node : ${REUSSIS} réussis, ${ECHOUES} échoués"
[ "${ECHOUES}" -eq 0 ]
