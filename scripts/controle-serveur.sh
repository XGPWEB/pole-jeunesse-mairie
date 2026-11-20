#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Pôle Jeunesse — Contrôle du serveur EN LECTURE SEULE
#
#  Constate sur place ce que ni les tests locaux ni /api/health ne peuvent
#  établir (audit du 2026-10-07, point 4 ; revue du même jour) : écoute réseau
#  de l'application, pare-feu, disposition des versions et leur identité,
#  contraintes en base, sauvegardes.
#  Le NAS et sa synchronisation sont hors périmètre : port rsync 873,
#  règles associées et tâches NAS exclus des résultats affichés.
#
#  Ce script ne modifie RIEN : il lit des fichiers, interroge le système et
#  ouvre la base dans une transaction en lecture seule. Il n'affiche aucun
#  secret (ni DATABASE_URL, ni contenu des fichiers de configuration) et
#  aucune donnée personnelle — seulement des noms, des nombres et des états.
#
#  Usage, depuis le poste de développement :
#    ssh root@<serveur> 'bash -s' < scripts/controle-serveur.sh
#
#  Chaque ligne commence par ✅ (conforme), ⚠️ (à regarder) ou · (information).
#  Le script se termine toujours par 0 : c'est un constat, pas un test.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

RACINE="${PJ_RACINE:-/opt}"
SECRETS="${PJ_SECRETS:-/opt/pj-secrets.env}"
BACKUP_DIR="${PJ_BACKUP_DIR:-/opt/backups/pj-db}"
PORT="${PJ_PORT:-3000}"
APP="${RACINE}/pole-jeunesse-admin"

bien() { echo "  ✅ $1"; }
voir() { echo "  ⚠️  $1"; }
info() { echo "  ·  $1"; }
a() { command -v "$1" >/dev/null 2>&1; }

echo "1. Application"
SANTE="$(curl -s -m 5 "http://127.0.0.1:${PORT}/api/health" 2>/dev/null | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    print("%s|%s|%s|%s" % (d.get("status"), d.get("version"), d.get("commit"), d.get("release")))
except Exception:
    pass' 2>/dev/null)"
if [ -n "${SANTE}" ]; then
  info "/api/health : état ${SANTE%%|*}, version $(echo "${SANTE}" | cut -d'|' -f2), commit $(echo "${SANTE}" | cut -d'|' -f3), release $(echo "${SANTE}" | cut -d'|' -f4)"
else
  voir "/api/health ne répond pas sur 127.0.0.1:${PORT}"
fi

echo "2. Écoute réseau"
if a ss; then
  ECOUTE="$(ss -ltnH 2>/dev/null | awk -v p=":${PORT}" '$4 ~ p"$" {print $4}' | sort -u | tr '\n' ' ')"
  if [ -z "${ECOUTE}" ]; then voir "aucun processus n'écoute sur le port ${PORT}"
  elif echo "${ECOUTE}" | grep -qE '(^| )(0\.0\.0\.0|\*|\[::\]):'; then voir "le port ${PORT} écoute sur TOUTES les interfaces (${ECOUTE}) : il ne devrait être joignable que par Nginx"
  else bien "le port ${PORT} n'écoute que localement (${ECOUTE})"; fi
  PG="$(ss -ltnH 2>/dev/null | awk '$4 ~ /:5432$/ {print $4}' | sort -u | tr '\n' ' ')"
  if echo "${PG}" | grep -qE '(^| )(0\.0\.0\.0|\*|\[::\]):'; then voir "PostgreSQL écoute sur toutes les interfaces (${PG})"; elif [ -n "${PG}" ]; then bien "PostgreSQL n'écoute que localement (${PG})"; else info "PostgreSQL : aucune écoute TCP sur 5432 (socket local seulement, ou autre port)"; fi
  info "ports ouverts à toutes les interfaces (hors NAS/rsync 873) : $(ss -ltnH 2>/dev/null | awk '$4 ~ /^(0\.0\.0\.0|\*|\[::\]):/ {n=split($4, x, ":"); if (x[n] != 873) print x[n]}' | sort -un | tr '\n' ' ')"
else
  info "commande ss absente : écoute non constatée"
fi

echo "3. Pare-feu"
if a ufw; then
  ETAT="$(ufw status 2>/dev/null | head -n 1)"
  if echo "${ETAT}" | grep -qi 'active' && ! echo "${ETAT}" | grep -qi 'inactive'; then
    bien "ufw actif"
    ufw status 2>/dev/null | sed -n '4,$p' | grep -viE '(^|[^0-9])873([^0-9]|$)|nas|rsync' | head -n 27 | sed 's/^/       /'
  else voir "ufw installé mais inactif (${ETAT})"; fi
elif a nft && [ -n "$(nft list ruleset 2>/dev/null | head -n 1)" ]; then
  info "nftables : $(nft list ruleset 2>/dev/null | grep -c 'chain') chaîne(s) définie(s) — règles à lire avec « nft list ruleset »"
elif a iptables; then
  info "iptables : politique INPUT $(iptables -S INPUT 2>/dev/null | head -n 1), $(iptables -S INPUT 2>/dev/null | wc -l | tr -d ' ') règle(s)"
else
  voir "aucun pare-feu local trouvé (ufw, nftables, iptables) — un pare-feu peut exister chez l'hébergeur"
fi
if a fail2ban-client; then info "fail2ban : $(fail2ban-client status 2>/dev/null | sed -n 's/.*Jail list:[[:space:]]*//p')"; else info "fail2ban : absent"; fi

echo "4. Versions installées"
if [ -L "${APP}" ]; then
  CIBLE="$(cd "${APP}" 2>/dev/null && pwd -P)"
  bien "${APP} est un lien vers $(basename "${CIBLE}")"
else
  voir "${APP} n'est pas un lien : ancienne disposition"
fi
for v in "${RACINE}"/pj-releases/*; do
  [ -d "${v}" ] || continue
  marque=""; [ "${v}" = "${CIBLE:-}" ] && marque=" ← en service"
  if [ -f "${v}/.pj/identite" ]; then
    id="version $(sed -n 's/^version=//p' "${v}/.pj/identite"), commit $(sed -n 's/^commit=//p' "${v}/.pj/identite"), origine $(sed -n 's/^origine=//p' "${v}/.pj/identite")"
  else id="sans identité enregistrée"; fi
  conf="configuration présente"; [ -f "${v}/.pj/ecosystem.config.js" ] || conf="SANS configuration"
  info "$(basename "${v}") — ${id} — ${conf} — $(du -sh "${v}" 2>/dev/null | cut -f1)${marque}"
done
if [ -n "${CIBLE:-}" ] && [ -f "${RACINE}/pj-ecosystem.config.js" ] && [ -f "${CIBLE}/.pj/ecosystem.config.js" ]; then
  if cmp -s "${RACINE}/pj-ecosystem.config.js" "${CIBLE}/.pj/ecosystem.config.js"; then bien "la configuration en service est celle de la version en service"; else voir "la configuration en service diffère de celle de la version en service"; fi
fi
if a pm2; then
  pm2 jlist 2>/dev/null | python3 -c '
import json, sys
try:
    for p in json.load(sys.stdin):
        e = p.get("pm2_env", {})
        print("  ·  PM2 : %s — état %s — mode %s — %s redémarrage(s) — HOSTNAME=%s — identifiant de release %s" % (
            p.get("name"), e.get("status"), e.get("exec_mode"), e.get("restart_time"),
            e.get("HOSTNAME", "(non fixé)"), "fixé" if e.get("PJ_RELEASE_ID") else "non fixé"))
except Exception:
    print("  ·  PM2 : liste illisible")' 2>/dev/null
  if systemctl is-enabled pm2-root >/dev/null 2>&1; then bien "PM2 est relancé au démarrage du serveur (pm2-root activé)"; else voir "service pm2-root non activé : l'application ne redémarrerait pas seule après un redémarrage du serveur"; fi
fi
info "données partagées : $(ls -1A "${RACINE}/pj-shared/data" 2>/dev/null | wc -l | tr -d ' ') entrée(s) dans ${RACINE}/pj-shared/data"
info "espace disque : $(df -h "${RACINE}" 2>/dev/null | awk 'NR==2 {print $4 " libres sur " $2 " (" $5 " utilisés)"}')"

echo "5. Base de données (lecture seule)"
URL=""
[ -r "${SECRETS}" ] && URL="$(grep -E '^DATABASE_URL=' "${SECRETS}" | tail -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
if [ -z "${URL}" ] || ! a psql; then
  info "DATABASE_URL ou psql indisponible : base non constatée"
else
  q() { PGOPTIONS='-c default_transaction_read_only=on' psql -X -Atq "${URL}" -c "$1" 2>/dev/null; }
  ATTENDUES="reservations_dates_coherentes reservations_heure_depart_valide reservations_heure_retour_valide reservations_heures_ordonnees fk_jeunes_espace_commune"
  for c in ${ATTENDUES}; do
    etat="$(q "SELECT CASE WHEN convalidated THEN 'validee' ELSE 'NON_VALIDEE' END FROM pg_constraint WHERE conname = '${c}'")"
    case "${etat}" in
      validee) bien "contrainte ${c} présente et validée" ;;
      NON_VALIDEE) voir "contrainte ${c} présente mais NON validée : des lignes existantes la violent" ;;
      *) voir "contrainte ${c} absente : migration reservations-espaces non appliquée ?" ;;
    esac
  done
  autres="$(q "SELECT string_agg(conname, ', ' ORDER BY conname) FROM pg_constraint WHERE NOT convalidated")"
  if [ -z "${autres}" ]; then bien "aucune contrainte non validée dans la base"; else info "contraintes non validées : ${autres}"; fi
  info "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'") tables — taille de la base : $(q "SELECT pg_size_pretty(pg_database_size(current_database()))")"
  info "communes : $(q "SELECT count(*) FROM tenants") — pièces AGORA enregistrées : $(q "SELECT count(*) FROM jeunes WHERE fiche_agora IS NOT NULL")"
fi

echo "6. Sauvegardes"
DERNIERE="$(ls -1t "${BACKUP_DIR}"/*.sql.gz 2>/dev/null | head -n 1)"
if [ -z "${DERNIERE}" ]; then
  voir "aucune sauvegarde dans ${BACKUP_DIR}"
else
  AGE="$(( ( $(date +%s) - $(stat -c %Y "${DERNIERE}" 2>/dev/null || echo 0) ) / 3600 ))"
  N="$(ls -1 "${BACKUP_DIR}"/*.sql.gz 2>/dev/null | wc -l | tr -d ' ')"
  if [ "${AGE}" -le 26 ]; then bien "dernière sauvegarde : $(basename "${DERNIERE}"), ${AGE} h, $(du -h "${DERNIERE}" | cut -f1)"; else voir "dernière sauvegarde vieille de ${AGE} h : $(basename "${DERNIERE}")"; fi
  info "${N} sauvegarde(s) conservée(s), $(du -sh "${BACKUP_DIR}" 2>/dev/null | cut -f1) au total"
fi
[ -f /var/log/pj-backup.log ] && info "journal des sauvegardes, 3 dernières lignes :" && tail -n 3 /var/log/pj-backup.log | sed 's/^/       /'
CRON="$(crontab -l 2>/dev/null | grep -v '^[[:space:]]*#' | grep -E 'backup|check-health' | grep -viE 'nas|rsync' | sed 's/^/       /')"
if [ -n "${CRON}" ]; then info "tâches planifiées :"; echo "${CRON}"; else voir "aucune tâche planifiée de sauvegarde ou de supervision trouvée"; fi

echo ""
echo "Constat terminé : rien n'a été modifié."
exit 0
