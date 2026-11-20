#!/usr/bin/env bash
# Test local du script de sauvegarde que deploy.sh installe sur le serveur
# (/opt/scripts/backup-db.sh). Le script est EXTRAIT de deploy.sh tel quel, puis
# exécuté ici contre une base PostgreSQL jetable et des répertoires temporaires.
# Aucun accès distant, aucun courriel : sans msmtp configuré, l'alerte se
# limite à une ligne de journal.
#
# Ce que ce test établit :
#   - le dump de la base est produit, lisible et complet ;
#   - les données sur disque (archives CAF…) sont archivées à côté, fichier
#     pour fichier, lisibles par leur seul propriétaire, et se restaurent à
#     l'identique ;
#   - une archive de données en échec alerte, s'arrête AVANT la purge et ne
#     retire rien des sauvegardes existantes ;
#   - un répertoire de données absent ou vide n'est pas une erreur ;
#   - la purge ne retire que ce qui a plus de 7 jours, dumps comme archives.
#
# Usage : bash scripts/test-backup-db.sh
# Connexion : variables PG* habituelles ; par défaut l'utilisateur courant sur
# localhost:5432. Compatible Bash 3.2.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RACINE="$(cd "${DIR}/.." && pwd)"
BASE="pole_jeunesse_test_backup"
T="$(mktemp -d)"

HOTE="${PGHOST:-localhost}"
case "${HOTE}" in
  localhost|127.0.0.1|::1) ;;
  *) echo "❌ REFUS : PGHOST='${HOTE}' n'est pas local." >&2; exit 1 ;;
esac
nettoyer() { dropdb --if-exists "${BASE}" >/dev/null 2>&1; chmod -R u+rwx "${T}" 2>/dev/null; rm -rf "${T}"; }
trap nettoyer EXIT
if ! pg_isready -q -h "${HOTE}" -p "${PGPORT:-5432}"; then
  echo "❌ Aucun PostgreSQL local joignable : test de la sauvegarde non exécuté." >&2; exit 1
fi

# ── Le script, tel que deploy.sh l'écrit sur le serveur ──────────────────────
SCRIPT="${T}/backup-db.sh"
awk '/^cat > \/opt\/scripts\/backup-db.sh << .BACKUP_SCRIPT.$/{f=1;next} /^BACKUP_SCRIPT$/{f=0} f' "${RACINE}/deploy.sh" > "${SCRIPT}"
if [ ! -s "${SCRIPT}" ] || ! bash -n "${SCRIPT}"; then
  echo "❌ Script de sauvegarde introuvable ou invalide dans deploy.sh : adapter ce test." >&2; exit 1
fi

PASS=0; FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
ko() { FAIL=$((FAIL + 1)); echo "  ❌ $1"; [ -f "${T}/journal" ] && tail -n 4 "${T}/journal" | sed 's/^/        | /'; }
egal() { if [ "$2" = "$3" ]; then ok "$1"; else ko "$1 — attendu « $2 », obtenu « $3 »"; fi; }
vrai() { if eval "$2"; then ok "$1"; else ko "$1"; fi; }

echo "Préparation de la base jetable ${BASE}…"
dropdb --if-exists "${BASE}" >/dev/null 2>&1
createdb "${BASE}" || { echo "❌ createdb" >&2; exit 1; }
psql -X -q -v ON_ERROR_STOP=1 -d "${BASE}" -f "${RACINE}/apps/admin/scripts/init-db.sql" >/dev/null 2>"${T}/init.err" || { cat "${T}/init.err" >&2; exit 1; }
psql -X -q -d "${BASE}" -c "INSERT INTO tenants (id, nom) VALUES ('essai', 'Essai'); INSERT INTO jeunes (id, nom, prenom, tenant_id) SELECT 'j' || g, 'N', 'P', 'essai' FROM generate_series(1, 25) g;" >/dev/null

SAUV="${T}/backups"; DONNEES="${T}/pj-shared/data"
mkdir -p "${SAUV}" "${DONNEES}/caf-archives"
printf 'DATABASE_URL=postgresql://%s@localhost:%s/%s\n' "${PGUSER:-${USER}}" "${PGPORT:-5432}" "${BASE}" > "${T}/secrets.env"
echo '{"annee":2025,"total":1234}' > "${DONNEES}/caf-archives/2025.json"
echo '{"annee":2026,"total":5678}' > "${DONNEES}/caf-archives/2026 été.json"
echo '{"reglage":true}' > "${DONNEES}/reglages.json"

CODE=0
sauvegarder() {  # sauvegarder [VAR=valeur …]  → CODE
  CODE=0
  env PJ_BACKUP_LOG="${T}/journal" PJ_BACKUP_DIR="${SAUV}" PJ_BACKUP_MIN_SIZE=500 PJ_SECRETS="${T}/secrets.env" PJ_DATA_DIR="${DONNEES}" "$@" \
    bash "${SCRIPT}" > "${T}/sortie" 2>&1 || CODE=$?
}
nb() { ls -1 "${SAUV}"/$1 2>/dev/null | wc -l | tr -d ' '; }
# Sur le contenu seul : le tar de macOS réécrit les accents des noms (NFD).
empreinte() { (cd "$1" && find . -type f -exec shasum {} \; 2>/dev/null | cut -d' ' -f1 | sort | shasum | cut -d' ' -f1); }
droits() { python3 -c 'import os, sys; print(oct(os.stat(sys.argv[1]).st_mode & 0o777)[2:])' "$1"; }

echo "1. Sauvegarde nominale : base ET données sur disque"
sauvegarder
egal "code de sortie 0" "0" "${CODE}"
egal "un dump de la base" "1" "$(nb 'pj-*.sql.gz')"
egal "une archive des données sur disque" "1" "$(nb 'pj-data-*.tar.gz')"
DUMP="$(ls -1 "${SAUV}"/pj-*.sql.gz | head -n 1)"; ARCHIVE="$(ls -1 "${SAUV}"/pj-data-*.tar.gz | head -n 1)"
vrai "le dump est lisible et complet" "gunzip -c '${DUMP}' | tail -n 5 | grep -q 'PostgreSQL database dump complete'"
vrai "le dump contient les lignes de la base" "[ \"\$(gunzip -c '${DUMP}' | grep -c '^j[0-9]')\" = 25 ]"
egal "l'archive contient les 3 fichiers de données" "3" "$(tar -tzf "${ARCHIVE}" | grep -vc '/$')"
egal "l'archive n'est lisible que par son propriétaire" "600" "$(droits "${ARCHIVE}")"
vrai "dump et archive portent le même horodatage" "[ \"\$(basename '${DUMP}' .sql.gz | sed 's/^pj-//')\" = \"\$(basename '${ARCHIVE}' .tar.gz | sed 's/^pj-data-//')\" ]"
mkdir -p "${T}/restaure" && tar -xzf "${ARCHIVE}" -C "${T}/restaure"
egal "restaurée, l'archive rend le contenu des fichiers à l'identique" "$(empreinte "${DONNEES}")" "$(empreinte "${T}/restaure/data")"
vrai "le fichier au nom accentué et avec espace est restauré" "[ -f '${T}/restaure/data/caf-archives/2026 été.json' ]"
vrai "le journal note les deux réussites" "grep -q 'OK — pj-[0-9].*sql.gz' '${T}/journal' && grep -q 'OK — pj-data-.*3 fichier' '${T}/journal'"
vrai "aucun fichier temporaire laissé" "! ls -A '${SAUV}' | grep -q '^\\.tmp-'"
vrai "aucun secret dans le journal ni la sortie" "! grep -q 'postgresql://' '${T}/journal' '${T}/sortie'"

echo "2. Répertoire de données absent, puis vide : pas une erreur"
sleep 1
sauvegarder PJ_DATA_DIR="${T}/inexistant"
egal "absent : code de sortie 0" "0" "${CODE}"
egal "absent : le dump est quand même fait" "2" "$(nb 'pj-*.sql.gz')"
egal "absent : pas d'archive de données supplémentaire" "1" "$(nb 'pj-data-*.tar.gz')"
vrai "absent : le journal le dit" "grep -q 'rien a archiver' '${T}/journal'"
mkdir -p "${T}/vide/data"; sleep 1
sauvegarder PJ_DATA_DIR="${T}/vide/data"
egal "vide : code de sortie 0, pas d'archive vide" "0 1" "${CODE} $(nb 'pj-data-*.tar.gz')"

echo "3. Données illisibles ou archive en échec : alerte, arrêt avant la purge, rien n'est retiré"
# Un vieux dump et une vieille archive, que la purge retirerait normalement.
touch -t 202601010000 "${SAUV}/pj-20260101-000000.sql.gz" "${SAUV}/pj-data-20260101-000000.tar.gz"
# Faux tar, placé devant le vrai, pour provoquer les pannes une à une.
VRAI_TAR="$(command -v tar)"; mkdir -p "${T}/faux"
cat > "${T}/faux/tar" << FAUX
#!/bin/sh
case "\$1" in
  -czf)
    case "\${FAUX_TAR:-}" in
      echec)   echo "tar: panne simulee" >&2; exit 2 ;;
      partiel) exec "${VRAI_TAR}" --exclude=reglages.json "\$@" ;;
      change)  "${VRAI_TAR}" "\$@" || exit \$?; echo "tar: data/reglages.json: file changed as we read it" >&2; exit 1 ;;
      autre1)  "${VRAI_TAR}" "\$@" || exit \$?; echo "tar: data/caf-archives: Cannot open: Permission denied" >&2; exit 1 ;;
    esac ;;
esac
exec "${VRAI_TAR}" "\$@"
FAUX
chmod +x "${T}/faux/tar"
echec_donnees() {  # echec_donnees <libellé> <motif attendu au journal> [VAR=valeur …]
  local libelle="$1" motif="$2" avant_d avant_a; shift 2
  avant_d="$(nb 'pj-*.sql.gz')"; avant_a="$(nb 'pj-data-*.tar.gz')"
  sleep 1
  sauvegarder "$@"
  vrai "${libelle} : code de sortie non nul" "[ '${CODE}' != 0 ]"
  vrai "${libelle} : le journal en donne la raison" "tail -n 3 '${T}/journal' | grep -q 'ÉCHEC — ${motif}'"
  egal "${libelle} : le dump de ce passage est conservé, aucune archive de données gardée" "$((avant_d + 1)) ${avant_a}" "$(nb 'pj-*.sql.gz') $(nb 'pj-data-*.tar.gz')"
  vrai "${libelle} : pas de purge, pas de fichier temporaire" "[ -f '${SAUV}/pj-20260101-000000.sql.gz' ] && [ -f '${SAUV}/pj-data-20260101-000000.tar.gz' ] && ! ls -A '${SAUV}' | grep -q '^\\.tmp-'"
}
if [ "$(id -u)" != 0 ]; then
  chmod 000 "${DONNEES}/caf-archives"
  echec_donnees "sous-répertoire illisible" "donnees sur disque illisibles"
  chmod 755 "${DONNEES}/caf-archives"
else
  echo "  ·  sous-répertoire illisible : non essayé (root lit tout)"
fi
echec_donnees "tar en panne" "archive des donnees sur disque en echec (tar code 2)" PATH="${T}/faux:${PATH}" FAUX_TAR=echec
echec_donnees "archive incomplète" "archive des donnees sur disque incomplete (2 fichier(s) archives pour 3" PATH="${T}/faux:${PATH}" FAUX_TAR=partiel
echec_donnees "code 1 pour une autre raison qu'un fichier modifié" "archive des donnees sur disque en echec (tar code 1)" PATH="${T}/faux:${PATH}" FAUX_TAR=autre1

echo "4. Passage suivant réussi : la purge retire ce qui a plus de 7 jours, et seulement cela"
touch -t "$(date -v-3d +%Y%m%d%H%M 2>/dev/null || date -d '3 days ago' +%Y%m%d%H%M)" "${SAUV}/pj-recent.sql.gz" "${SAUV}/pj-data-recent.tar.gz"
sleep 1
AVANT_ARCHIVES="$(nb 'pj-data-*.tar.gz')"
sauvegarder PATH="${T}/faux:${PATH}" FAUX_TAR=change
egal "fichier modifié pendant la lecture (tar code 1) : toléré, archive faite" "0 $((AVANT_ARCHIVES - 1 + 1))" "${CODE} $(nb 'pj-data-*.tar.gz')"
vrai "le dump et l'archive de plus de 7 jours sont retirés" "[ ! -e '${SAUV}/pj-20260101-000000.sql.gz' ] && [ ! -e '${SAUV}/pj-data-20260101-000000.tar.gz' ]"
vrai "ceux de 3 jours sont conservés" "[ -f '${SAUV}/pj-recent.sql.gz' ] && [ -f '${SAUV}/pj-data-recent.tar.gz' ]"
vrai "le journal compte les deux sortes de sauvegardes" "tail -n 1 '${T}/journal' | grep -q 'sauvegarde(s) de base et .* archive(s) de donnees'"

echo "5. Base injoignable : alerte, aucune archive, rien n'est retiré"
printf 'DATABASE_URL=postgresql://%s@localhost:%s/base_qui_n_existe_pas\n' "${PGUSER:-${USER}}" "${PGPORT:-5432}" > "${T}/secrets-faux.env"
AVANT_DUMPS="$(nb 'pj-*.sql.gz')"; AVANT_ARCHIVES="$(nb 'pj-data-*.tar.gz')"
sauvegarder PJ_SECRETS="${T}/secrets-faux.env"
vrai "code de sortie non nul" "[ '${CODE}' != 0 ]"
egal "aucun dump ni archive ajouté" "${AVANT_DUMPS} ${AVANT_ARCHIVES}" "$(nb 'pj-*.sql.gz') $(nb 'pj-data-*.tar.gz')"
vrai "le journal signale l'échec" "tail -n 3 '${T}/journal' | grep -q 'ÉCHEC'"

echo ""
echo "backup-db : ${PASS} réussi(s), ${FAIL} échec(s)"
[ "${FAIL}" -eq 0 ]
