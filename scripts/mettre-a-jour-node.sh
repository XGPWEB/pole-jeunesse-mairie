#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  Changement de la branche majeure de Node.js sur le VPS — HORS livraison
# ═══════════════════════════════════════════════════════════════════════════
#
#  Exécuté SUR le serveur, en root, par l'opérateur (jamais par deploy.sh) :
#    ssh -i "$SSH_KEY" root@<VPS> "bash -s -- 24" < scripts/mettre-a-jour-node.sh
#  Procédure complète : PROCEDURE-NODE.md.
#
#  Pourquoi un script à part : changer de runtime PENDANT une livraison ferait
#  tourner son retour arrière (version précédente) sur une combinaison jamais
#  essayée (risque R5, REVUE-CLAUDE-2026-10-19.md). Ici, seule la version de
#  Node change ; l'application en service reste la même.
#
#  Étapes :
#    1. l'application doit répondre sainement AVANT (sinon rien n'est fait) ;
#    2. le dépôt APT NodeSource déjà configuré (clé déjà présente, référencée
#       par signed-by) passe de node_<ancienne>.x à node_<cible>.x — pas de
#       `curl | bash`, aucune nouvelle clé n'est importée ;
#    3. apt installe la VERSION EXACTE choisie (nodejs=<version>), sans que
#       needrestart relance de services, puis `pm2 update` relance le démon et
#       l'application sous le nouveau Node ;
#    4. aucune préférence APT n'est écrite : NodeSource en pose déjà une
#       (/etc/apt/preferences.d/nodejs, priorité 600) et apt n'applique que la
#       PREMIÈRE préférence qui correspond à un paquet ; une épingle ajoutée
#       était ignorée (intervention du 2026-10-20). La branche suivie se règle
#       par le seul dépôt (node_<branche>.x) ;
#    5. succès seulement si node, le processus PM2 et /api/health (même
#       version, même commit qu'avant) sont cohérents ; sinon retour
#       automatique à la branche de départ, contrôlé de la même façon.
#
#  Variables de test (banc local scripts/test-mettre-a-jour-node.sh) :
#    PJ_APT_SOURCES, PJ_APT_GET, PJ_APT_CACHE, PJ_DPKG_QUERY, PJ_NODE, PJ_PM2,
#    PJ_PORT, PJ_NOM_PM2, PJ_DELAI_SANTE, PJ_SANS_ROOT
#  Compatible Bash 3.2.
set -uo pipefail

CIBLE="${1:-}"
APT_SOURCES="${PJ_APT_SOURCES:-/etc/apt/sources.list.d}"
APT_GET="${PJ_APT_GET:-apt-get}"
APT_CACHE="${PJ_APT_CACHE:-apt-cache}"
DPKG_QUERY="${PJ_DPKG_QUERY:-dpkg-query}"
NODE="${PJ_NODE:-node}"
PM2="${PJ_PM2:-pm2}"
PORT="${PJ_PORT:-3000}"
NOM_PM2="${PJ_NOM_PM2:-pole-jeunesse-admin}"
DELAI_SANTE="${PJ_DELAI_SANTE:-90}"
URL_SANTE="http://127.0.0.1:${PORT}/api/health"
# Aucune question interactive, et needrestart ne relance AUCUN service pendant
# l'installation : le 2026-10-20 il a relancé pm2-root.service au milieu de
# l'opération, en concurrence avec `pm2 update`.
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1

echec() { echo "❌ $*" >&2; exit 1; }

case "${CIBLE}" in
  ''|*[!0-9]*) echec "Usage : bash mettre-a-jour-node.sh <branche majeure, ex. 24>" ;;
esac
[ "$(id -u)" = "0" ] || [ -n "${PJ_SANS_ROOT:-}" ] || echec "À exécuter en root sur le serveur."
command -v python3 >/dev/null 2>&1 || echec "python3 introuvable."
command -v curl >/dev/null 2>&1 || echec "curl introuvable."

majeure() { "${NODE}" --version 2>/dev/null | sed -n 's/^v\([0-9][0-9]*\)\..*/\1/p'; }

# Lit /api/health : « <état> <version> <commit> », ou « injoignable ».
sante() {
  local corps
  corps="$(curl -s -m 5 "${URL_SANTE}" 2>/dev/null)" || { echo "injoignable"; return; }
  printf '%s' "${corps}" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get("status", "?"), d.get("version", "?"), d.get("commit", "?"))
except Exception:
    print("illisible")
' 2>/dev/null || echo "illisible"
}

# Version de Node du processus applicatif selon PM2 (vide si inconnue).
node_du_processus() {
  "${PM2}" jlist 2>/dev/null | python3 -c '
import json, sys
try:
    for p in json.load(sys.stdin):
        if p.get("name") == sys.argv[1]:
            print(p.get("pm2_env", {}).get("node_version", "")); break
except Exception:
    pass
' "${NOM_PM2}" 2>/dev/null
}

# Attend que tout soit cohérent : node, processus PM2 et /api/health identique
# à l'état de départ. Retourne 0 si c'est le cas avant DELAI_SANTE secondes.
attendre_coherence() {  # <majeure attendue>
  local attendue="$1" fin=$(( $(date +%s) + DELAI_SANTE )) etat proc
  while :; do
    etat="$(sante)"
    proc="$(node_du_processus)"
    if [ "$(majeure)" = "${attendue}" ] && [ "${proc%%.*}" = "${attendue}" ] && [ "${etat}" = "${SANTE_AVANT}" ]; then
      return 0
    fi
    [ "$(date +%s)" -ge "${fin}" ] && break
    sleep 2
  done
  echo "   node : $("${NODE}" --version 2>/dev/null || echo absent) ; processus PM2 : ${proc:-inconnu} ; santé : ${etat}" >&2
  return 1
}

# ── 1. État de départ ────────────────────────────────────────────────────────
MAJ_AVANT="$(majeure)"
[ -n "${MAJ_AVANT}" ] || echec "node introuvable : ce script change de branche, il n'installe pas un serveur neuf."
PAQUET_AVANT="$("${DPKG_QUERY}" -W -f='${Version}' nodejs 2>/dev/null || true)"
echo "Node actuel : $("${NODE}" --version) (paquet ${PAQUET_AVANT:-inconnu}) ; cible : branche ${CIBLE}"
if [ "${MAJ_AVANT}" = "${CIBLE}" ]; then
  echo "✅ Déjà sur Node ${CIBLE} : rien à faire."
  exit 0
fi

SANTE_AVANT="$(sante)"
case "${SANTE_AVANT}" in
  ok\ *) echo "Application avant intervention : ${SANTE_AVANT}" ;;
  *) echec "L'application ne répond pas sainement AVANT l'intervention (${SANTE_AVANT}) : rien n'a été modifié." ;;
esac

# ── 2. Dépôt NodeSource déjà configuré, clé déjà présente ────────────────────
SOURCE=""
for f in "${APT_SOURCES}"/*.list "${APT_SOURCES}"/*.sources; do
  [ -f "${f}" ] || continue
  if grep -q 'deb\.nodesource\.com' "${f}"; then
    [ -z "${SOURCE}" ] || echec "Plusieurs fichiers APT désignent NodeSource (${SOURCE}, ${f}) : à clarifier à la main."
    SOURCE="${f}"
  fi
done
[ -n "${SOURCE}" ] || echec "Aucun dépôt NodeSource dans ${APT_SOURCES} : rien n'a été modifié."
grep -q "node_${MAJ_AVANT}\.x" "${SOURCE}" || echec "${SOURCE} ne désigne pas node_${MAJ_AVANT}.x : à vérifier à la main."
CLE="$(sed -n 's/.*signed-by=\([^] ]*\).*/\1/p; s/^Signed-By: *\(.*\)$/\1/p' "${SOURCE}" | head -n 1)"
[ -n "${CLE}" ] && [ -f "${CLE}" ] || echec "${SOURCE} ne référence pas de clé signed-by existante : rien n'a été modifié."
echo "Dépôt : ${SOURCE} ; clé : ${CLE}"
if command -v gpg >/dev/null 2>&1; then
  gpg --show-keys --with-fingerprint "${CLE}" 2>/dev/null | sed 's/^/   /' || true
fi

SAUVE="$(mktemp -d)"
trap 'rm -rf "${SAUVE}"' EXIT
cp -p "${SOURCE}" "${SAUVE}/source"

# Versions proposées par le dépôt configuré, de la plus récente à la plus ancienne.
versions_du_depot() {
  "${APT_CACHE}" madison nodejs 2>/dev/null | awk -F'|' '/nodesource/ { gsub(/ /, "", $2); print $2 }'
}

# Version exacte : apt n'installe jamais une version plus ancienne que celle en
# place sans qu'on la lui désigne (retour arrière), quelles que soient les
# préférences APT du serveur.
installer() {  # <version exacte du paquet>
  "${APT_GET}" install -y -q --allow-downgrades "nodejs=$1"
}

retour_arriere() {
  echo "↩️  Retour à Node ${MAJ_AVANT}..." >&2
  cp -p "${SAUVE}/source" "${SOURCE}"
  "${APT_GET}" update -q >/dev/null 2>&1 || true
  local version="${PAQUET_AVANT}"
  versions_du_depot | grep -qx "${version}" || version="$(versions_du_depot | grep "^${MAJ_AVANT}\." | head -n 1)"
  if [ -z "${version}" ] || ! installer "${version}" >&2 || [ "$(majeure)" != "${MAJ_AVANT}" ]; then
    echec "INTERVENTION REQUISE : réinstallation de Node ${MAJ_AVANT} en échec (paquet de départ : ${PAQUET_AVANT:-inconnu} ; node annonce $("${NODE}" --version 2>/dev/null || echo rien))."
  fi
  "${PM2}" update >/dev/null 2>&1 || true
  if attendre_coherence "${MAJ_AVANT}"; then
    "${PM2}" save >/dev/null 2>&1 || true
    echec "Passage à Node ${CIBLE} annulé : retour à $("${NODE}" --version) effectué, application saine (${SANTE_AVANT})."
  fi
  echec "INTERVENTION REQUISE : retour à Node ${MAJ_AVANT} effectué mais l'application ne répond pas comme avant (pm2 status, pm2 logs)."
}

# ── 3-4. Changement de branche ───────────────────────────────────────────────
sed -i.pj-tmp "s/node_${MAJ_AVANT}\\.x/node_${CIBLE}.x/g" "${SOURCE}" && rm -f "${SOURCE}.pj-tmp"
"${APT_GET}" update -q >/dev/null 2>&1 || { echo "❌ apt-get update en échec." >&2; retour_arriere; }
VERSION_CIBLE="$(versions_du_depot | grep "^${CIBLE}\." | head -n 1)"
[ -n "${VERSION_CIBLE}" ] || { echo "❌ Le dépôt node_${CIBLE}.x ne propose aucune version ${CIBLE}." >&2; retour_arriere; }
echo "Installation de nodejs ${VERSION_CIBLE}..."
installer "${VERSION_CIBLE}" || { echo "❌ apt n'a pas installé nodejs ${VERSION_CIBLE}." >&2; retour_arriere; }
[ "$(majeure)" = "${CIBLE}" ] || { echo "❌ node annonce $("${NODE}" --version 2>/dev/null) après installation." >&2; retour_arriere; }

echo "Relance de PM2 et de l'application sous $("${NODE}" --version)..."
"${PM2}" update >/dev/null 2>&1 || echo "⚠️  pm2 update a renvoyé une erreur : vérification de l'état réel." >&2

# ── 5. Vérification ──────────────────────────────────────────────────────────
if attendre_coherence "${CIBLE}"; then
  "${PM2}" save >/dev/null 2>&1 || true
  echo "✅ Node $("${NODE}" --version) en service ; application inchangée et saine (${SANTE_AVANT})."
  echo "   Retour arrière manuel si besoin : bash -s -- ${MAJ_AVANT} < scripts/mettre-a-jour-node.sh"
  exit 0
fi
echo "❌ L'application ne répond pas comme avant sous Node ${CIBLE}." >&2
retour_arriere
