#!/usr/bin/env bash
# Tests locaux de scripts/check-deploy-schema.sh sur des bases PostgreSQL JETABLES
# (pole_jeunesse_test_schema_*), créées puis détruites ici. Aucun accès distant.
#
# Usage : bash scripts/test-check-deploy-schema.sh
# Connexion : variables PG* habituelles (PGHOST, PGPORT, PGUSER, PGPASSWORD) ;
# par défaut l'utilisateur courant sur localhost:5432. Compatible Bash 3.2.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RACINE="$(cd "${DIR}/.." && pwd)"
CHECK="${DIR}/check-deploy-schema.sh"
SQL_DIR="${RACINE}/apps/admin/scripts"
TMP="$(mktemp -d)"

HOTE="${PGHOST:-localhost}"
PORT="${PGPORT:-5432}"
UTILISATEUR="${PGUSER:-${USER}}"
case "${HOTE}" in
  localhost|127.0.0.1|::1) ;;
  *) echo "❌ REFUS : PGHOST='${HOTE}' n'est pas local." >&2; exit 1 ;;
esac
if [ -n "${PGPASSWORD:-}" ]; then IDENT="${UTILISATEUR}:${PGPASSWORD}"; else IDENT="${UTILISATEUR}"; fi

B_OK="pole_jeunesse_test_schema_ok"
B_ANCIEN="pole_jeunesse_test_schema_ancien"
B_PARTIEL="pole_jeunesse_test_schema_partiel"
B_SANS_FK="pole_jeunesse_test_schema_sans_fk"

nettoyer() {
  for b in "${B_OK}" "${B_ANCIEN}" "${B_PARTIEL}" "${B_SANS_FK}"; do dropdb --if-exists "${b}" >/dev/null 2>&1; done
  rm -rf "${TMP}"
}
trap nettoyer EXIT

if ! pg_isready -q -h "${HOTE}" -p "${PORT}"; then
  echo "❌ Aucun PostgreSQL local joignable : tests du contrôle de schéma non exécutés." >&2
  exit 1
fi

# Schéma « d'avant les migrations 2026-10 » : init-db.sql sans ses
# inclusions finales (\ir migration-…), c'est-à-dire l'état d'une base
# existante sur laquelle les migrations n'ont pas encore été appliquées.
grep -v '^\\ir migration-.*-2026-10\.sql' "${SQL_DIR}/init-db.sql" > "${TMP}/init-sans-migrations.sql"
if cmp -s "${TMP}/init-sans-migrations.sql" "${SQL_DIR}/init-db.sql"; then
  echo "❌ init-db.sql n'inclut plus les migrations 2026-10 par \\ir : adapter ce test." >&2
  exit 1
fi

creer() {  # creer <base> <fichiers sql…>
  local base="$1"; shift
  dropdb --if-exists "${base}" >/dev/null 2>&1
  createdb "${base}" || return 1
  for f in "$@"; do
    psql -q -X -v ON_ERROR_STOP=1 -d "${base}" -f "${f}" >/dev/null 2>"${TMP}/psql.err" || { cat "${TMP}/psql.err" >&2; return 1; }
  done
}

echo "Préparation des bases jetables…"
creer "${B_OK}"      "${SQL_DIR}/init-db.sql"                                                   || { echo "❌ préparation ${B_OK}" >&2; exit 1; }
creer "${B_ANCIEN}"  "${TMP}/init-sans-migrations.sql"                                          || { echo "❌ préparation ${B_ANCIEN}" >&2; exit 1; }
creer "${B_PARTIEL}" "${TMP}/init-sans-migrations.sql" "${SQL_DIR}/migration-securite-2026-10.sql" || { echo "❌ préparation ${B_PARTIEL}" >&2; exit 1; }
creer "${B_SANS_FK}" "${TMP}/init-sans-migrations.sql" "${SQL_DIR}/migration-securite-2026-10.sql" "${SQL_DIR}/migration-integrite-2026-10.sql" || { echo "❌ préparation ${B_SANS_FK}" >&2; exit 1; }

PASS=0; FAIL=0
ok()  { PASS=$((PASS + 1)); echo "  ✅ $1"; }
ko()  { FAIL=$((FAIL + 1)); echo "  ❌ $1"; }

# lancer <libellé> <code attendu> <contenu du fichier secrets | __ABSENT__>  → sortie dans ${TMP}/sortie
lancer() {
  local libelle="$1" attendu="$2" contenu="$3" code=0
  rm -f "${TMP}/secrets.env"
  [ "${contenu}" = "__ABSENT__" ] || printf '%s\n' "${contenu}" > "${TMP}/secrets.env"
  bash "${CHECK}" "${TMP}/secrets.env" > "${TMP}/sortie" 2>&1 || code=$?
  if [ "${code}" -eq "${attendu}" ]; then ok "${libelle} (code ${code})"; else ko "${libelle} (code ${code}, attendu ${attendu})"; sed 's/^/        /' "${TMP}/sortie"; fi
}
contient()    { if grep -qF -- "$2" "${TMP}/sortie"; then ok "$1"; else ko "$1 — texte attendu absent : $2"; fi; }
ne_contient() { if grep -qF -- "$2" "${TMP}/sortie"; then ko "$1 — texte interdit présent : $2"; else ok "$1"; fi; }

url() { printf 'postgresql://%s@%s:%s/%s' "${IDENT}" "${HOTE}" "${PORT}" "$1"; }

echo "── Schéma à jour"
lancer "schéma à jour : le déploiement peut continuer" 0 "DATABASE_URL=$(url "${B_OK}")"
contient "message de compatibilité" "Schéma de la base compatible"

echo "── Migrations manquantes"
lancer "aucune migration appliquée : arrêt" 1 "DATABASE_URL=$(url "${B_ANCIEN}")"
contient    "cite animateurs.session_version"            "colonne animateurs.session_version"
contient    "cite sorties_participants.ordre"            "colonne sorties_participants.ordre"
contient    "ordre : sécurité en premier"                "1. psql -v ON_ERROR_STOP=1 -d <base> -f apps/admin/scripts/migration-securite-2026-10.sql"
contient    "ordre : intégrité en second"                "2. psql -v ON_ERROR_STOP=1 -d <base> -f apps/admin/scripts/migration-integrite-2026-10.sql"
contient    "ordre : participants en troisième"          "3. psql -v ON_ERROR_STOP=1 -d <base> -f apps/admin/scripts/migration-participants-fk-2026-10.sql"
contient    "cite la clé étrangère des participants"     "contrainte sorties_participants.fk_sorties_participants_jeune"
contient    "annonce l'arrêt avant transfert"            "rien n'a été transféré ni redémarré"

lancer "seule la migration sécurité appliquée : arrêt" 1 "DATABASE_URL=$(url "${B_PARTIEL}")"
contient    "demande la migration intégrité"             "1. psql -v ON_ERROR_STOP=1 -d <base> -f apps/admin/scripts/migration-integrite-2026-10.sql"
ne_contient "ne redemande pas la migration sécurité"     "migration-securite-2026-10.sql"
contient    "puis la migration participants"             "2. psql -v ON_ERROR_STOP=1 -d <base> -f apps/admin/scripts/migration-participants-fk-2026-10.sql"

lancer "seule la clé étrangère des participants manque : arrêt" 1 "DATABASE_URL=$(url "${B_SANS_FK}")"
contient    "demande la seule migration participants"    "1. psql -v ON_ERROR_STOP=1 -d <base> -f apps/admin/scripts/migration-participants-fk-2026-10.sql"
ne_contient "ne redemande pas la migration sécurité"     "migration-securite-2026-10.sql"
ne_contient "ne redemande pas la migration intégrité"    "migration-integrite-2026-10.sql"
contient    "renvoie au diagnostic des orphelines"       "diagnostic-participants-orphelins.sql"

echo "── Base inaccessible ou contrôle impossible"
lancer "port fermé : arrêt, contrôle impossible" 2 "DATABASE_URL=postgresql://${UTILISATEUR}:motdepasse-de-test@127.0.0.1:1/${B_OK}"
contient    "message « inaccessible »"                   "Base de données inaccessible"
ne_contient "n'affiche pas le mot de passe de l'URL"     "motdepasse-de-test"
lancer "base inexistante : arrêt, contrôle impossible" 2 "DATABASE_URL=$(url pole_jeunesse_test_schema_inexistante)"
contient    "message « inaccessible »"                   "Base de données inaccessible"
lancer "fichier secrets absent : arrêt" 2 "__ABSENT__"
lancer "DATABASE_URL absente : arrêt" 2 "JWT_SECRET=peu-importe-ici"
lancer "DATABASE_URL vide : arrêt" 2 "DATABASE_URL="

echo "── Lecture seule : le contrôle n'a rien modifié"
avant="$(psql -X -Atq -d "${B_ANCIEN}" -c "SELECT count(*) FROM information_schema.columns WHERE table_schema='public'")"
bash "${CHECK}" "${TMP}/secrets.env" >/dev/null 2>&1
printf 'DATABASE_URL=%s\n' "$(url "${B_ANCIEN}")" > "${TMP}/secrets.env"
bash "${CHECK}" "${TMP}/secrets.env" >/dev/null 2>&1
apres="$(psql -X -Atq -d "${B_ANCIEN}" -c "SELECT count(*) FROM information_schema.columns WHERE table_schema='public'")"
if [ "${avant}" = "${apres}" ] && [ -n "${avant}" ]; then ok "schéma inchangé après contrôle (${apres} colonnes)"; else ko "schéma modifié par le contrôle (${avant} → ${apres})"; fi

echo ""
echo "check-deploy-schema : ${PASS} réussis, ${FAIL} échoués"
[ "${FAIL}" -eq 0 ]
