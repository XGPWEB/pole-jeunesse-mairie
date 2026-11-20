#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Pôle Jeunesse — Couverture des sauvegardes, EN LECTURE SEULE
#
#  L'essai de reprise isolée (scripts/test-reprise-isolee.sh) prouve que la
#  base se restaure et que l'application tourne dessus. Reconstruire un serveur
#  demande davantage : les fichiers écrits sur disque (archives CAF), les
#  secrets, la configuration Nginx, les certificats, la configuration de
#  démarrage. Ce script constate, pour chacun, s'il EXISTE sur le serveur et
#  s'il figure dans une SAUVEGARDE.
#
#  Il ne modifie RIEN et n'extrait rien : il liste des noms de fichiers, des
#  tailles, des dates et des droits. Il n'affiche JAMAIS le contenu d'un secret
#  ni d'une sauvegarde — pour un fichier de secrets, seulement le NOM des clés.
#  Le contenu des scripts de sauvegarde est résumé à ce qu'ils archivent, les
#  valeurs sensibles étant masquées.
#
#  Le NAS et sa synchronisation sont hors périmètre : ce script ne les examine
#  pas et ne dit rien de la copie hors du serveur.
#
#  Usage : ssh root@<serveur> 'bash -s' < scripts/controle-couverture-sauvegardes.sh
#  Se termine toujours par 0 : c'est un constat, pas un test.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

RACINE="${PJ_RACINE:-/opt}"
SAUVEGARDES="${PJ_SAUVEGARDES:-/opt/backups}"
SCRIPTS="${PJ_SCRIPTS:-/opt/scripts}"
TMP="$(mktemp -d)"; trap 'rm -rf "${TMP}"' EXIT

bien() { echo "  ✅ $1"; }
voir() { echo "  ⚠️  $1"; }
info() { echo "  ·  $1"; }
# Masque la valeur qui suit un nom évoquant un secret (entre guillemets ou non)
# et le mot de passe d'une URL « protocole://compte:motdepasse@hôte ».
masquer() { sed -E 's/((PASS|PASSWORD|SECRET|TOKEN|KEY|PWD)[A-Za-z_]*[=:][[:space:]]*["'"'"']?)[^[:space:]"'"'"']+/\1***/g; s/((pass|password|secret|token|key|pwd)[A-Za-z_]*[=:][[:space:]]*["'"'"']?)[^[:space:]"'"'"']+/\1***/g; s#(://[^:/@[:space:]]+:)[^@[:space:]]+@#\1***@#g'; }
age_h() { echo $(( ( $(date +%s) - $(stat -c %Y "$1" 2>/dev/null || echo 0) ) / 3600 )); }

echo "1. Ce qu'il faudrait pour reconstruire le serveur : présence sur place"
present() {  # present <libellé> <chemin>
  if [ -e "$2" ]; then
    if [ -d "$2" ]; then info "$1 : présent — $(find "$2" -type f 2>/dev/null | wc -l | tr -d ' ') fichier(s), $(du -sh "$2" 2>/dev/null | cut -f1)"
    else info "$1 : présent — $(stat -c '%A %U' "$2" 2>/dev/null), $(stat -c %s "$2" 2>/dev/null) octets"; fi
  else voir "$1 : ABSENT ($2)"; fi
}
present "données sur disque de l'application (dont archives CAF)" "${RACINE}/pj-shared/data"
[ -d "${RACINE}/pj-shared/data/caf-archives" ] && info "  dont archives CAF : $(find "${RACINE}/pj-shared/data/caf-archives" -type f 2>/dev/null | wc -l | tr -d ' ') fichier(s), la plus récente modifiée il y a $(age_h "$(ls -1t "${RACINE}/pj-shared/data/caf-archives"/* 2>/dev/null | head -n 1)") h"
present "secrets de l'application" "${RACINE}/pj-secrets.env"
[ -r "${RACINE}/pj-secrets.env" ] && info "  clés définies (noms seulement) : $(grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "${RACINE}/pj-secrets.env" | tr -d '=' | sort -u | tr '\n' ' ')"
present "secrets d'envoi de courriel" "${RACINE}/pj-smtp.env"
[ -r "${RACINE}/pj-smtp.env" ] && info "  clés définies (noms seulement) : $(grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "${RACINE}/pj-smtp.env" | tr -d '=' | sort -u | tr '\n' ' ')"
present "configuration PM2 en service" "${RACINE}/pj-ecosystem.config.js"
present "liste des processus PM2 relancés au démarrage" "/root/.pm2/dump.pm2"
if systemctl is-enabled pm2-root >/dev/null 2>&1; then bien "service de démarrage pm2-root activé"; else voir "service pm2-root non activé"; fi
present "configuration Nginx du site" "/etc/nginx/sites-available/pole-jeunesse"
present "inclusions Nginx des autres applications" "/etc/nginx/extra-locations"
present "certificats TLS" "/etc/letsencrypt/live"
if [ -d /etc/letsencrypt/live ]; then
  for c in /etc/letsencrypt/live/*/fullchain.pem; do
    [ -f "${c}" ] || continue
    info "  certificat $(basename "$(dirname "${c}")") : expire le $(openssl x509 -enddate -noout -in "${c}" 2>/dev/null | cut -d= -f2)"
  done
  if systemctl is-enabled certbot.timer >/dev/null 2>&1 || crontab -l 2>/dev/null | grep -q certbot; then bien "renouvellement automatique des certificats en place"; else voir "aucun renouvellement automatique des certificats trouvé"; fi
fi
present "scripts d'exploitation" "${SCRIPTS}"
info "tâches planifiées (hors NAS) : $(crontab -l 2>/dev/null | grep -v '^[[:space:]]*#' | grep -viE 'nas|rsync' | grep -c .) ligne(s)"

echo "2. Ce que font les scripts de sauvegarde (hors NAS)"
for s in "${SCRIPTS}"/backup-*.sh; do
  [ -f "${s}" ] || continue
  planif="$(crontab -l 2>/dev/null | grep -F "${s}" | grep -v '^[[:space:]]*#' | awk '{print $1, $2, $3, $4, $5}' | head -n 1)"
  info "$(basename "${s}") — planifié : ${planif:-NON planifié} — $(wc -l < "${s}" | tr -d ' ') ligne(s)"
  # Seules les lignes qui disent QUOI est archivé et OÙ, valeurs sensibles masquées.
  grep -nE '(^|[[:space:]])(tar|pg_dump|pg_dumpall|mysqldump|cp|zip|gzip|find)[[:space:]]|^[A-Z_]+=.*(/|\.gz|\.tar)' "${s}" 2>/dev/null \
    | grep -viE 'nas|rsync' | masquer | cut -c1-190 | sed 's/^/       /' | head -n 25
done

echo "3. Ce que contiennent les sauvegardes présentes sur le serveur"
if [ ! -d "${SAUVEGARDES}" ]; then
  voir "répertoire ${SAUVEGARDES} absent"
else
  for d in "${SAUVEGARDES}"/*/; do
    [ -d "${d}" ] || continue
    dernier="$(ls -1t "${d}" 2>/dev/null | head -n 1)"
    if [ -z "${dernier}" ]; then info "$(basename "${d}") : vide"; continue; fi
    info "$(basename "${d}") — $(ls -1 "${d}" | wc -l | tr -d ' ') fichier(s), $(du -sh "${d}" 2>/dev/null | cut -f1) — dernier : ${dernier} ($(age_h "${d}${dernier}") h, $(du -h "${d}${dernier}" 2>/dev/null | cut -f1))"
  done
fi

echo "4. Chaque élément nécessaire figure-t-il dans une sauvegarde ?"
# On cherche chaque élément PAR SON NOM dans la liste des fichiers des archives
# les plus récentes (tar -t : aucune extraction, aucun contenu lu).
: > "${TMP}/contenu"
for archive in $(find "${SAUVEGARDES}" -maxdepth 2 -type f \( -name '*.tar.gz' -o -name '*.tgz' -o -name '*.tar' \) -mtime -8 2>/dev/null | sort | tail -n 40); do
  echo "# ${archive}" >> "${TMP}/liste_archives"
  tar -tf "${archive}" 2>/dev/null | sed "s#^#$(basename "${archive}") :: #" >> "${TMP}/contenu"
done
if [ ! -s "${TMP}/contenu" ]; then
  voir "aucune archive de fichiers (.tar, .tar.gz) de moins de 8 jours dans ${SAUVEGARDES} : seuls des dumps de base y figurent"
else
  info "$(grep -c . "${TMP}/liste_archives" 2>/dev/null || echo 0) archive(s) de fichiers examinée(s), $(wc -l < "${TMP}/contenu" | tr -d ' ') entrée(s) listée(s)"
fi
couvert() {  # couvert <libellé> <motif recherché dans les noms de fichiers archivés>
  local n dans
  n="$(grep -cE "$2" "${TMP}/contenu" 2>/dev/null || true)"
  if [ "${n:-0}" -gt 0 ]; then
    dans="$(grep -E "$2" "${TMP}/contenu" | sed 's/ :: .*//' | sort -u | tail -n 1)"
    bien "$1 : dans une sauvegarde (${n} entrée(s), ex. ${dans})"
  else
    voir "$1 : dans AUCUNE archive examinée"
  fi
}
couvert "données sur disque / archives CAF" 'pj-shared/data|caf-archives|src/data'
couvert "secrets de l'application (pj-secrets.env)" 'pj-secrets\.env'
couvert "secrets de courriel (pj-smtp.env)" 'pj-smtp\.env'
couvert "configuration PM2 (pj-ecosystem.config.js)" 'pj-ecosystem\.config\.js'
couvert "liste PM2 de démarrage (dump.pm2)" 'dump\.pm2'
couvert "configuration Nginx" 'nginx/(sites-available|sites-enabled|nginx\.conf|extra-locations)'
couvert "certificats TLS" 'letsencrypt'
couvert "scripts d'exploitation" '(^|/| )opt/scripts/|scripts/(backup|check)-'
couvert "tâches planifiées (crontab)" 'crontab|cron'
DUMP="$(ls -1t "${SAUVEGARDES}"/pj-db/*.sql.gz 2>/dev/null | head -n 1)"
if [ -n "${DUMP}" ]; then bien "base de données : dump $(basename "${DUMP}") ($(age_h "${DUMP}") h) — restauration essayée par ailleurs"; else voir "base de données : aucun dump trouvé"; fi

echo ""
echo "Constat terminé : rien n'a été modifié, aucune archive n'a été extraite, aucun secret n'a été affiché."
echo "(La copie de ces sauvegardes HORS du serveur n'est pas examinée ici.)"
exit 0
