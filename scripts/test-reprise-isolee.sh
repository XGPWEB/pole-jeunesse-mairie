#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Pôle Jeunesse — Essai de REPRISE sur une instance ISOLÉE
#
#  scripts/test-restauration-sauvegarde.sh prouve qu'une sauvegarde se recharge
#  sur le serveur de production. Il ne dit pas si l'on saurait REPARTIR
#  ailleurs : rejouer les migrations manquantes, obtenir un schéma que le code
#  accepte, et faire tourner l'application dessus. C'est l'objet de cet essai.
#
#  Il se lance sur une machine AUTRE que le serveur de production (poste de
#  développement, machine de recette), avec son propre PostgreSQL. Il n'ouvre
#  aucune connexion vers la production et n'y installe rien.
#
#  Déroulé, chaque étape étant chronométrée :
#    1. contrôle du fichier de sauvegarde (lisible, complet, âge) ;
#    2. restauration dans une base JETABLE locale ;
#    3. rejeu des migrations d'octobre 2026, dans l'ordre documenté — elles
#       sont idempotentes ; le script dit lesquelles ont réellement changé
#       quelque chose, donc lesquelles manquaient à la sauvegarde ;
#    4. contrôle du schéma par scripts/check-deploy-schema.sh, celui-là même
#       qui conditionne un déploiement ;
#    5. contrôles d'intégrité qui ne sont pas de simples comptages : contraintes
#       non validées, références croisées entre communes, doublons, intervalles
#       inversés, pointages rattachés à une ligne absente ;
#    6. démarrage du build de production de l'application sur cette base, puis
#       parcours représentatifs avec un compte TEMPORAIRE créé dans la copie
#       (jamais en production) : connexion, tableau de bord, listes, fiche d'un
#       jeune, et concordance entre ce que l'API renvoie et ce que contient la base ;
#    7. bilan : temps de reprise mesuré, âge de la sauvegarde (= travail perdu).
#
#  La sauvegarde contient des données personnelles : la base jetable est
#  supprimée en fin de script, rien n'est copié ailleurs, et le script
#  n'affiche que des noms de tables, des nombres et des codes HTTP.
#
#  Usage : bash scripts/test-reprise-isolee.sh <fichier.sql.gz>
#  Prérequis : PostgreSQL local, build fait (cd apps/admin && npm run build).
#  Variables : PJ_PORT_REPRISE (défaut 3190), PJ_SANS_APPLICATION=1 pour
#  s'arrêter après l'étape 5.
#  Code de sortie : 0 si tout est réussi, 1 sinon. Compatible Bash 3.2.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RACINE="$(cd "${DIR}/.." && pwd)"
ADMIN="${RACINE}/apps/admin"
SQL_DIR="${ADMIN}/scripts"
FICHIER="${1:-}"
PORT="${PJ_PORT_REPRISE:-3190}"
BASE="pole_jeunesse_reprise_$(date +%Y%m%d%H%M%S)"
TMP="$(mktemp -d)"
PID_APP=""

# Ordre documenté (SUIVI-AUDIT-2026-10-06.md et -07.md, scripts/check-deploy-schema.sh).
MIGRATIONS="migration-securite-2026-10.sql migration-integrite-2026-10.sql migration-participants-fk-2026-10.sql migration-monitoring-2026-10.sql migration-reservations-espaces-2026-10.sql migration-pij-2026-10.sql migration-pij-agenda-2026-10.sql migration-pij-missions-2026-10.sql migration-fiche-sante-2026-10.sql"

PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ✅ $1"; }
ko()   { FAIL=$((FAIL + 1)); echo "  ❌ $1"; }
note() { echo "  ·  $1"; }
maintenant() { python3 -c 'import time; print(time.time())'; }
ecoule() { python3 -c 'import sys; print("%.1f" % (float(sys.argv[2]) - float(sys.argv[1])))' "$1" "$2"; }

nettoyer() {
  [ -n "${PID_APP}" ] && kill "${PID_APP}" 2>/dev/null
  case "${BASE}" in
    pole_jeunesse_reprise_*) dropdb --if-exists "${BASE}" >/dev/null 2>&1 ;;
  esac
  rm -rf "${TMP}"
}
trap nettoyer EXIT
bilan() {
  echo ""
  echo "Reprise isolée : ${PASS} réussi(s), ${FAIL} échec(s)"
  [ "${FAIL}" -eq 0 ]
  exit $?
}

# Garde-fous : jamais contre un serveur distant.
case "${PGHOST:-localhost}" in
  localhost|127.0.0.1|::1|/*) ;;
  *) echo "❌ REFUS : PGHOST='${PGHOST}' n'est pas local. Cet essai ne se fait que sur une instance isolée." >&2; exit 1 ;;
esac
for outil in psql createdb dropdb gunzip node python3 curl; do
  command -v "${outil}" >/dev/null 2>&1 || { echo "❌ ${outil} introuvable : essai non exécuté." >&2; exit 1; }
done
if [ -z "${FICHIER}" ] || [ ! -f "${FICHIER}" ]; then
  echo "Usage : bash scripts/test-reprise-isolee.sh <fichier.sql.gz>" >&2; exit 1
fi
q() { psql -X -Atq -d "${BASE}" -c "$1" 2>/dev/null; }
DEBUT_TOTAL="$(maintenant)"

# ── 1. La sauvegarde ─────────────────────────────────────────────────────────
echo "1. Sauvegarde"
# Âge de la SAUVEGARDE, pas de sa copie : une copie fraîche d'une vieille
# sauvegarde aurait une date de fichier récente. Les sauvegardes du serveur
# portent leur date dans leur nom (pj-AAAAMMJJ-HHMMSS.sql.gz) ; à défaut, la
# date du fichier est utilisée et signalée comme telle.
AGE_H="$(python3 -c '
import os, re, sys, time
m = re.search(r"(\d{8})-(\d{6})", os.path.basename(sys.argv[1]))
try:
    t = time.mktime(time.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S"))
    print(int((time.time() - t) / 3600), "nom")
except Exception:
    print(int((time.time() - os.path.getmtime(sys.argv[1])) / 3600), "fichier")
' "${FICHIER}")"
SOURCE_AGE="${AGE_H##* }"; AGE_H="${AGE_H%% *}"
if [ "${SOURCE_AGE}" = "nom" ]; then PRECISION="d'après la date inscrite dans son nom"; else PRECISION="d'après la date du fichier, qui peut être celle de sa copie"; fi
note "fichier : $(basename "${FICHIER}") — $(wc -c < "${FICHIER}" | tr -d ' ') octets — âge : ${AGE_H} h (${PRECISION})"
if gunzip -t "${FICHIER}" 2>/dev/null; then ok "l'archive se décompresse sans erreur"; else ko "archive gzip corrompue"; bilan; fi
if gunzip -c "${FICHIER}" 2>/dev/null | tail -n 5 | grep -q 'PostgreSQL database dump complete'; then ok "le dump est complet (marqueur de fin présent)"; else ko "le dump semble tronqué (marqueur de fin absent)"; fi

# ── 2. Restauration ──────────────────────────────────────────────────────────
echo "2. Restauration dans la base jetable locale ${BASE}"
createdb "${BASE}" 2>"${TMP}/err" || { ko "création de la base jetable impossible : $(head -n 1 "${TMP}/err")"; bilan; }
T0="$(maintenant)"
if gunzip -c "${FICHIER}" 2>/dev/null \
   | grep -v -E '^(ALTER .* OWNER TO |GRANT |REVOKE |ALTER DEFAULT PRIVILEGES )' \
   | psql -X -q -v ON_ERROR_STOP=1 -d "${BASE}" >/dev/null 2>"${TMP}/restore.err"; then
  D_RESTAURATION="$(ecoule "${T0}" "$(maintenant)")"
  ok "restauration sans erreur en ${D_RESTAURATION} s"
else
  D_RESTAURATION="$(ecoule "${T0}" "$(maintenant)")"
  ko "restauration interrompue : $(grep -m 1 -E 'ERROR|ERREUR' "${TMP}/restore.err" | cut -c1-160)"; bilan
fi
note "$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'") tables, $(q "SELECT pg_size_pretty(pg_database_size(current_database()))")"

# ── 3. Migrations à rejouer ──────────────────────────────────────────────────
# Empreinte du schéma (colonnes, contraintes et leur validation, index) : si
# elle change après une migration, c'est que la sauvegarde ne la contenait pas.
empreinte_schema() {
  q "SELECT md5(string_agg(l, '|' ORDER BY l)) FROM (
       SELECT 'c:' || table_name || '.' || column_name || ':' || data_type AS l FROM information_schema.columns WHERE table_schema = 'public'
       UNION ALL SELECT 'k:' || conrelid::regclass || '.' || conname || ':' || convalidated FROM pg_constraint WHERE connamespace = 'public'::regnamespace
       UNION ALL SELECT 'i:' || indexname FROM pg_indexes WHERE schemaname = 'public') x"
}
echo "3. Migrations d'octobre 2026, rejouées dans l'ordre documenté"
T0="$(maintenant)"
MANQUANTES=""
for m in ${MIGRATIONS}; do
  if [ ! -f "${SQL_DIR}/${m}" ]; then ko "migration introuvable dans le dépôt : ${m}"; continue; fi
  avant="$(empreinte_schema)"
  if psql -X -q -v ON_ERROR_STOP=1 -d "${BASE}" -f "${SQL_DIR}/${m}" >/dev/null 2>"${TMP}/migration.err"; then
    if [ "$(empreinte_schema)" = "${avant}" ]; then
      ok "${m} : déjà contenue dans la sauvegarde (aucun changement)"
    else
      MANQUANTES="${MANQUANTES} ${m}"
      ok "${m} : MANQUAIT à la sauvegarde — rejouée sans erreur"
    fi
    if grep -qi 'warning\|attention' "${TMP}/migration.err"; then note "avertissement de ${m} : $(grep -i -m 1 'warning\|attention' "${TMP}/migration.err" | cut -c1-150)"; fi
  else
    ko "${m} : échec — $(grep -m 1 -E 'ERROR|ERREUR' "${TMP}/migration.err" | cut -c1-150)"
  fi
done
D_MIGRATIONS="$(ecoule "${T0}" "$(maintenant)")"
if [ -z "${MANQUANTES}" ]; then note "la sauvegarde contenait déjà toutes les migrations"; else note "migrations à rejouer après restauration de cette sauvegarde, dans cet ordre :${MANQUANTES}"; fi

# ── 4. Schéma accepté par le code ────────────────────────────────────────────
echo "4. Schéma : contrôle de déploiement (scripts/check-deploy-schema.sh)"
printf 'DATABASE_URL=postgresql://%s@localhost:%s/%s\n' "${PGUSER:-${USER}}" "${PGPORT:-5432}" "${BASE}" > "${TMP}/secrets.env"
if (cd "${RACINE}" && bash scripts/check-deploy-schema.sh "${TMP}/secrets.env") > "${TMP}/schema.out" 2>&1; then
  ok "schéma compatible avec le code : un déploiement sur cette base serait accepté"
else
  ko "schéma refusé par le contrôle de déploiement : $(grep -m 1 '❌' "${TMP}/schema.out" | cut -c1-150)"
fi

# ── 5. Intégrité des données ─────────────────────────────────────────────────
echo "5. Intégrité (au-delà du comptage)"
NON_VALIDEES="$(q "SELECT string_agg(conname, ', ' ORDER BY conname) FROM pg_constraint WHERE NOT convalidated")"
if [ -z "${NON_VALIDEES}" ]; then ok "toutes les contraintes sont validées"; else note "contraintes non validées : ${NON_VALIDEES}"; fi
zero() {  # zero <libellé> <requête rendant un nombre>
  local n; n="$(q "$2")"
  if [ "${n}" = "0" ]; then ok "$1 : aucune"; elif [ -z "${n}" ]; then ko "$1 : requête impossible"; else ko "$1 : ${n}"; fi
}
zero "pointages rattachés à un jeune absent ou d'une autre commune" "SELECT count(*) FROM pointages p WHERE p.jeune_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jeunes j WHERE j.id = p.jeune_id AND j.tenant_id = p.tenant_id)"
zero "pointages rattachés à une activité absente ou d'une autre commune" "SELECT count(*) FROM pointages p WHERE p.activite_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM activites a WHERE a.id = p.activite_id AND a.tenant_id = p.tenant_id)"
zero "jeunes rattachés à l'espace d'une autre commune" "SELECT count(*) FROM jeunes j JOIN espaces e ON e.id = j.espace_id WHERE e.tenant_id <> j.tenant_id"
zero "inscriptions actives en double" "SELECT count(*) FROM (SELECT 1 FROM inscriptions WHERE jeune_id IS NOT NULL AND statut NOT IN ('annulee', 'refusee') GROUP BY activite_id, jeune_id HAVING count(*) > 1) x"
zero "inscriptions rattachées à un jeune ou une activité d'une autre commune" "SELECT count(*) FROM inscriptions i LEFT JOIN jeunes j ON j.id = i.jeune_id LEFT JOIN activites a ON a.id = i.activite_id WHERE (j.id IS NOT NULL AND j.tenant_id <> i.tenant_id) OR (a.id IS NOT NULL AND a.tenant_id <> i.tenant_id)"
zero "contacts sans jeune" "SELECT count(*) FROM jeunes_contacts c WHERE NOT EXISTS (SELECT 1 FROM jeunes j WHERE j.id = c.jeune_id)"
zero "réservations de véhicule à dates ou heures inversées" "SELECT count(*) FROM reservations_vehicules WHERE date_fin < date_debut OR (date_debut = date_fin AND COALESCE(heure_retour, '') <> '' AND heure_retour <= heure_depart)"
zero "congés finissant avant de commencer" "SELECT count(*) FROM conges WHERE date_fin < date_debut"
# Le compte superadmin est rattaché à la commune technique « system », qui n'est
# pas dans la table tenants : c'est voulu (superadmin-migration.sql).
zero "comptes sans commune (hors superadmin)" "SELECT count(*) FROM animateurs a WHERE COALESCE(a.role, '') <> 'superadmin' AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = a.tenant_id)"
zero "pièces AGORA d'un type autre que PDF, PNG, JPEG, WEBP" "SELECT count(*) FROM jeunes WHERE fiche_agora IS NOT NULL AND fiche_agora !~ '^data:(application/pdf|image/png|image/jpeg|image/webp);base64,'"
COMMUNE="$(q "SELECT tenant_id FROM animateurs WHERE statut = 'actif' AND role = 'admin' GROUP BY tenant_id ORDER BY count(*) DESC LIMIT 1")"
if [ -n "${COMMUNE}" ]; then ok "au moins un compte administrateur actif existe"; else ko "aucun compte administrateur actif : personne ne pourrait se connecter après reprise"; fi

if [ "${PJ_SANS_APPLICATION:-}" = "1" ]; then note "étape 6 (application) sautée à la demande"; bilan; fi

# ── 6. L'application sur la base restaurée ───────────────────────────────────
echo "6. Application sur la base restaurée (port local ${PORT})"
SERVEUR="${ADMIN}/.next/standalone/apps/admin/server.js"
if [ ! -f "${SERVEUR}" ]; then
  ko "build de production absent (${SERVEUR}) : lancer « cd apps/admin && npm run build », puis relancer"
  bilan
fi
# Compte TEMPORAIRE, créé dans la copie jetable uniquement, avec un mot de passe
# aléatoire qui n'est ni affiché ni écrit sur disque.
MDP="$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')"
HASH="$(cd "${RACINE}" && MDP="${MDP}" node -e 'require("bcryptjs").hash(process.env.MDP, 10).then(h => process.stdout.write(h))' 2>/dev/null)"
[ -n "${COMMUNE}" ] || COMMUNE="$(q "SELECT id FROM tenants ORDER BY id LIMIT 1")"
if [ -z "${HASH}" ] || [ -z "${COMMUNE}" ]; then ko "préparation du compte temporaire impossible"; bilan; fi
psql -X -q -v ON_ERROR_STOP=1 -d "${BASE}" -v h="${HASH}" -v t="${COMMUNE}" >/dev/null 2>"${TMP}/err" << 'SQL' || { ko "création du compte temporaire : $(head -n 1 "${TMP}/err")"; bilan; }
INSERT INTO animateurs (id, nom, prenom, username, statut, role, tenant_id, password_hash)
VALUES ('reprise-temporaire', 'Reprise', 'Essai', 'reprise.essai.temporaire', 'actif', 'admin', :'t', :'h');
SQL
# Fichiers statiques à côté du serveur, comme le fait le déploiement.
mkdir -p "${ADMIN}/.next/standalone/apps/admin/.next"
[ -d "${ADMIN}/.next/standalone/apps/admin/.next/static" ] || cp -R "${ADMIN}/.next/static" "${ADMIN}/.next/standalone/apps/admin/.next/static"
T0="$(maintenant)"
( cd "$(dirname "${SERVEUR}")" && exec env -i PATH="${PATH}" HOME="${HOME}" NODE_ENV=production TZ=Europe/Paris PORT="${PORT}" HOSTNAME=127.0.0.1 \
    JWT_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')" PJ_RELEASE_ID="reprise-isolee" \
    DATABASE_URL="postgresql://${PGUSER:-${USER}}@localhost:${PGPORT:-5432}/${BASE}" node "${SERVEUR}" ) > "${TMP}/app.log" 2>&1 &
PID_APP=$!
URL="http://127.0.0.1:${PORT}"
SANTE=""
for essai in $(seq 1 40); do
  SANTE="$(curl -s -m 3 "${URL}/api/health" 2>/dev/null | python3 -c 'import json,sys
try: d=json.load(sys.stdin); print(d.get("status"), d.get("db"), d.get("version"), d.get("release"))
except Exception: pass' 2>/dev/null)"
  [ "${SANTE%% *}" = "ok" ] && break
  sleep 0.5
done
D_APPLICATION="$(ecoule "${T0}" "$(maintenant)")"
if [ "${SANTE%% *}" = "ok" ]; then ok "l'application démarre sur la base restaurée en ${D_APPLICATION} s (/api/health : ${SANTE})"; else ko "l'application ne démarre pas sur la base restaurée : $(tail -n 3 "${TMP}/app.log" | tr '\n' ' ' | cut -c1-200)"; bilan; fi

COOKIES="${TMP}/cookies"
code() { curl -s -o "${TMP}/corps" -m 20 -b "${COOKIES}" -w '%{http_code}' "${URL}$1" 2>/dev/null; }
attendu() {  # attendu <libellé> <chemin> <code attendu>
  local c; c="$(code "$2")"
  if [ "${c}" = "$3" ]; then ok "$1 (HTTP ${c})"; else ko "$1 : HTTP ${c}, attendu $3"; fi
}
attendu "sans session, une page protégée renvoie vers la connexion" "/admin/dashboard" "307"
attendu "sans session, l'API refuse" "/api/jeunes" "401"
C="$(MDP="${MDP}" python3 -c 'import json, os; print(json.dumps({"username": "reprise.essai.temporaire", "password": os.environ["MDP"]}))' \
     | curl -s -o "${TMP}/login" -m 20 -c "${COOKIES}" -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary @- "${URL}/api/auth/login" 2>/dev/null)"
if [ "${C}" = "200" ] && grep -q 'pj_token' "${COOKIES}" 2>/dev/null; then ok "connexion avec le compte temporaire (HTTP 200, session ouverte)"; else ko "connexion impossible : HTTP ${C}"; bilan; fi

attendu "tableau de bord" "/admin/dashboard" "200"
attendu "liste des jeunes (page)" "/admin/jeunes" "200"
attendu "liste des activités (page)" "/admin/activites" "200"
attendu "page Monitoring" "/admin/monitoring" "200"
# Concordance entre ce que l'API renvoie et ce que contient la base, pour la commune du compte.
concorde() {  # concorde <libellé> <chemin API> <expression Python donnant le nombre> <requête SQL>
  local c n_api n_sql
  c="$(code "$2")"
  n_api="$(python3 -c "import json,sys
try:
    d=json.load(open(sys.argv[1])); print($3)
except Exception: print('?')" "${TMP}/corps" 2>/dev/null)"
  n_sql="$(psql -X -Atq -d "${BASE}" -v t="${COMMUNE}" 2>/dev/null << SQL
$4
SQL
)"
  if [ "${c}" = "200" ] && [ "${n_api}" = "${n_sql}" ]; then ok "$1 : l'API renvoie ${n_api} élément(s), la base en contient ${n_sql}"
  else ko "$1 : HTTP ${c}, API ${n_api}, base ${n_sql}"; fi
}
concorde "jeunes" "/api/jeunes" "len(d)" "SELECT count(*) FROM jeunes WHERE tenant_id = :'t';"
concorde "espaces" "/api/espaces" "len(d if isinstance(d, list) else d.get('espaces', []))" "SELECT count(*) FROM espaces WHERE tenant_id = :'t';"
concorde "réservations de véhicule" "/api/vehicules" "len(d.get('reservations', []))" "SELECT count(*) FROM reservations_vehicules WHERE tenant_id = :'t' AND statut != 'annulee';"
JEUNE="$(psql -X -Atq -d "${BASE}" -v t="${COMMUNE}" 2>/dev/null << 'SQL'
SELECT id FROM jeunes WHERE tenant_id = :'t' ORDER BY id LIMIT 1;
SQL
)"
if [ -n "${JEUNE}" ]; then
  attendu "fiche d'un jeune (page)" "/jeunes/${JEUNE}" "200"
  c="$(code "/api/jeunes/${JEUNE}/fiche")"
  contacts_api="$(python3 -c 'import json,sys
try: print(len(json.load(open(sys.argv[1])).get("contacts", [])))
except Exception: print("?")' "${TMP}/corps")"
  contacts_sql="$(psql -X -Atq -d "${BASE}" -v j="${JEUNE}" 2>/dev/null << 'SQL'
SELECT count(*) FROM jeunes_contacts WHERE jeune_id = :'j';
SQL
)"
  if [ "${c}" = "200" ] && [ "${contacts_api}" = "${contacts_sql}" ]; then ok "fiche d'un jeune (API) : ${contacts_api} contact(s) d'urgence, autant qu'en base"; else ko "fiche d'un jeune (API) : HTTP ${c}, ${contacts_api} contact(s) contre ${contacts_sql} en base"; fi
else
  note "aucun jeune dans cette commune : fiche non essayée"
fi
if grep -qiE 'error|erreur' "${TMP}/app.log"; then note "le journal de l'application contient $(grep -ciE 'error|erreur' "${TMP}/app.log") ligne(s) d'erreur pendant l'essai"; else ok "aucune erreur dans le journal de l'application pendant l'essai"; fi

# ── 7. Bilan ─────────────────────────────────────────────────────────────────
echo ""
echo "Temps mesurés sur CETTE machine :"
echo "  restauration ${D_RESTAURATION} s + migrations ${D_MIGRATIONS} s + démarrage de l'application ${D_APPLICATION} s — essai complet $(ecoule "${DEBUT_TOTAL}" "$(maintenant)") s"
echo "  (hors préparation d'un serveur neuf : installation, certificats, DNS, secrets, récupération de la sauvegarde)"
echo "Perte de données en cas de reprise sur cette sauvegarde : tout ce qui a été saisi depuis sa création, il y a ${AGE_H} h (${PRECISION})."
echo "(La base jetable ${BASE} et le compte temporaire sont supprimés à la fin de ce script.)"
bilan
