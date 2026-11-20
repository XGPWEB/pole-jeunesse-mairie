#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Pôle Jeunesse — Essai de RESTAURATION d'une sauvegarde de la base
#
#  Une sauvegarde qui existe, qui a la bonne taille et qui se décompresse ne
#  prouve pas qu'on sait la restaurer (audit du 2026-10-07, point 5). Ce script
#  restaure la sauvegarde la plus récente dans une base JETABLE, mesure le
#  temps que cela prend, contrôle ce qui a été restauré, puis supprime la base
#  jetable.
#
#  Il ne modifie JAMAIS la base en service : il n'y fait, au plus, que compter
#  des lignes dans une transaction en lecture seule, pour comparaison. Il
#  n'affiche aucune donnée, seulement des noms de tables et des nombres.
#
#  Usage :
#    bash scripts/test-restauration-sauvegarde.sh [fichier.sql.gz]
#  Sans argument : la sauvegarde la plus récente de ${PJ_BACKUP_DIR}.
#
#  Sur le serveur, la création d'une base demande un compte qui en a le droit :
#    ssh root@<serveur> 'sudo -u postgres bash -s' < scripts/test-restauration-sauvegarde.sh
#  et, pour comparer aussi avec la base en service :
#    ssh root@<serveur> 'sudo -u postgres PJ_BASE_SERVICE=pole_jeunesse bash -s' < scripts/test-restauration-sauvegarde.sh
#
#  Variables :
#    PJ_BACKUP_DIR   répertoire des sauvegardes (défaut /opt/backups/pj-db)
#    PJ_SECRETS      fichier contenant DATABASE_URL de la base en service, pour
#                    la comparaison (défaut /opt/pj-secrets.env ; absent ou
#                    illisible = pas de comparaison, l'essai a lieu quand même)
#    PJ_BASE_SERVICE nom de la base en service, pour la comparaison quand
#                    DATABASE_URL n'est pas lisible — c'est le cas sous le
#                    compte postgres, qui se connecte alors par le socket local
#    PJ_AGE_MAX_H    âge au-delà duquel la sauvegarde est signalée (défaut 26 h)
#
#  Code de sortie : 0 si la restauration est complète et cohérente, 1 sinon.
#  Compatible Bash 3.2.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

BACKUP_DIR="${PJ_BACKUP_DIR:-/opt/backups/pj-db}"
SECRETS="${PJ_SECRETS:-/opt/pj-secrets.env}"
AGE_MAX_H="${PJ_AGE_MAX_H:-26}"
BASE="pole_jeunesse_restore_test_$(date +%Y%m%d%H%M%S)"
TMP="$(mktemp -d)"

PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ✅ $1"; }
ko()   { FAIL=$((FAIL + 1)); echo "  ❌ $1"; }
note() { echo "  ·  $1"; }

nettoyer() {
  # Ne supprime que la base jetable créée ici, jamais autre chose.
  case "${BASE}" in
    pole_jeunesse_restore_test_*) dropdb --if-exists "${BASE}" >/dev/null 2>&1 ;;
  esac
  rm -rf "${TMP}"
}
trap nettoyer EXIT

for outil in psql createdb dropdb gunzip; do
  command -v "${outil}" >/dev/null 2>&1 || { echo "❌ ${outil} introuvable : essai de restauration non exécuté." >&2; exit 1; }
done

# ── 1. La sauvegarde ─────────────────────────────────────────────────────────
FICHIER="${1:-}"
if [ -z "${FICHIER}" ]; then
  FICHIER="$(ls -1t "${BACKUP_DIR}"/*.sql.gz 2>/dev/null | head -n 1)"
fi
echo "1. Sauvegarde"
if [ -z "${FICHIER}" ] || [ ! -f "${FICHIER}" ]; then
  ko "aucune sauvegarde trouvée dans ${BACKUP_DIR}"
  echo ""; echo "Restauration : ${PASS} réussi(s), ${FAIL} échec(s)"; exit 1
fi
TAILLE="$(wc -c < "${FICHIER}" | tr -d ' ')"
AGE_H="$(python3 -c 'import os, sys, time; print(int((time.time() - os.path.getmtime(sys.argv[1])) / 3600))' "${FICHIER}" 2>/dev/null || echo "?")"
note "fichier : $(basename "${FICHIER}") — ${TAILLE} octets — âge : ${AGE_H} h"
NOMBRE="$(ls -1 "${BACKUP_DIR}"/*.sql.gz 2>/dev/null | wc -l | tr -d ' ')"
[ -n "${1:-}" ] || note "${NOMBRE} sauvegarde(s) dans ${BACKUP_DIR}"
if gunzip -t "${FICHIER}" 2>/dev/null; then ok "l'archive se décompresse sans erreur"; else ko "archive gzip corrompue"; fi
if [ "${AGE_H}" != "?" ] && [ "${AGE_H}" -le "${AGE_MAX_H}" ]; then
  ok "sauvegarde récente (${AGE_H} h, seuil ${AGE_MAX_H} h)"
else
  ko "sauvegarde ancienne (${AGE_H} h, seuil ${AGE_MAX_H} h) : c'est la quantité de travail qui serait perdue"
fi
# Un dump complet se termine par cette ligne : son absence signale un dump tronqué.
if gunzip -c "${FICHIER}" 2>/dev/null | tail -n 5 | grep -q 'PostgreSQL database dump complete'; then
  ok "le dump est complet (marqueur de fin présent)"
else
  ko "le dump semble tronqué (marqueur de fin absent)"
fi

# ── 2. Restauration dans une base jetable ────────────────────────────────────
echo "2. Restauration dans la base jetable ${BASE}"
if ! createdb "${BASE}" 2>"${TMP}/createdb.err"; then
  ko "création de la base jetable impossible : $(head -n 1 "${TMP}/createdb.err")"
  note "sur le serveur, lancer ce script avec un compte autorisé à créer une base (sudo -u postgres)"
  echo ""; echo "Restauration : ${PASS} réussi(s), ${FAIL} échec(s)"; exit 1
fi
DEBUT="$(date +%s)"
# Les lignes de propriété et de droits visent des rôles qui peuvent ne pas
# exister ici ; elles ne changent rien aux données restaurées.
if gunzip -c "${FICHIER}" 2>/dev/null \
   | grep -v -E '^(ALTER .* OWNER TO |GRANT |REVOKE |ALTER DEFAULT PRIVILEGES )' \
   | psql -X -q -v ON_ERROR_STOP=1 -d "${BASE}" >/dev/null 2>"${TMP}/restore.err"; then
  DUREE=$(( $(date +%s) - DEBUT ))
  ok "restauration terminée sans erreur en ${DUREE} s"
else
  DUREE=$(( $(date +%s) - DEBUT ))
  ko "restauration interrompue après ${DUREE} s : $(grep -m 1 -E 'ERROR|ERREUR' "${TMP}/restore.err" | cut -c1-160)"
fi

q() { psql -X -Atq -d "${BASE}" -c "$1" 2>/dev/null; }

# ── 3. Ce qui a été restauré ─────────────────────────────────────────────────
echo "3. Contenu restauré"
TABLES="$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")"
if [ "${TABLES:-0}" -ge 20 ]; then ok "${TABLES} tables restaurées"; else ko "${TABLES:-0} table(s) seulement : restauration incomplète"; fi

for table in tenants animateurs espaces jeunes activites inscriptions pointages; do
  n="$(q "SELECT count(*) FROM ${table}")"
  if [ -z "${n}" ]; then ko "table ${table} absente"
  elif [ "${n}" -gt 0 ]; then ok "table ${table} : ${n} ligne(s)"
  else note "table ${table} : vide"; fi
done
for table in tenants animateurs; do
  [ "$(q "SELECT count(*) FROM ${table}")" -gt 0 ] 2>/dev/null || ko "la table ${table} ne peut pas être vide dans une base en service"
done

# Objets créés par les migrations d'octobre 2026 : le code en dépend.
objets() {
  q "SELECT 'colonne animateurs.session_version' WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'animateurs' AND column_name = 'session_version')
     UNION ALL SELECT 'colonne sorties_participants.ordre' WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sorties_participants' AND column_name = 'ordre')
     UNION ALL SELECT 'table monitoring_events' WHERE to_regclass('public.monitoring_events') IS NULL
     UNION ALL SELECT 'index uniq_inscriptions_actives' WHERE to_regclass('public.uniq_inscriptions_actives') IS NULL
     UNION ALL SELECT 'contrainte fk_sorties_participants_jeune' WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sorties_participants_jeune')"
}
MANQUANTS="$(objets | tr '\n' ',' | sed 's/,$//')"
if [ -z "${MANQUANTS}" ]; then ok "les objets exigés par le code sont présents (migrations d'octobre 2026)"; else ko "objets absents de la base restaurée : ${MANQUANTS}"; fi

NON_VALIDES="$(q "SELECT string_agg(conname, ', ' ORDER BY conname) FROM pg_constraint WHERE NOT convalidated")"
if [ -z "${NON_VALIDES}" ]; then ok "toutes les contraintes restaurées sont validées"; else note "contraintes restaurées non validées (état fidèle à la base d'origine) : ${NON_VALIDES}"; fi

# ── 4. Comparaison avec la base en service (lecture seule) ───────────────────
echo "4. Comparaison avec la base en service"
URL=""
if [ -r "${SECRETS}" ]; then
  URL="$(grep -E '^DATABASE_URL=' "${SECRETS}" | tail -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
fi
# Sans URL lisible, la base en service peut être désignée par son nom.
if [ -z "${URL}" ] && [ -n "${PJ_BASE_SERVICE:-}" ]; then
  case "${PJ_BASE_SERVICE}" in
    *[!A-Za-z0-9_]*|pole_jeunesse_restore_test_*) note "PJ_BASE_SERVICE refusé (${PJ_BASE_SERVICE})" ;;
    *) URL="dbname=${PJ_BASE_SERVICE}" ;;
  esac
fi
if [ -z "${URL}" ]; then
  note "DATABASE_URL introuvable (${SECRETS}) et PJ_BASE_SERVICE non défini : comparaison non faite"
else
  COMPTES_SQL="SELECT string_agg(t || '=' || n, ' ' ORDER BY t) FROM (
      SELECT table_name AS t, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', table_name), false, true, '')))[1]::text::bigint AS n
      FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') x"
  EN_SERVICE="$(PGOPTIONS='-c default_transaction_read_only=on' psql -X -Atq "${URL}" -c "${COMPTES_SQL}" 2>/dev/null)"
  RESTAURE="$(q "${COMPTES_SQL}")"
  if [ -z "${EN_SERVICE}" ]; then
    note "base en service injoignable avec ce compte : comparaison non faite"
  else
    python3 - "${EN_SERVICE}" "${RESTAURE}" << 'PY' > "${TMP}/comparaison"
import sys
def lire(s):
    return {k: int(v) for k, v in (p.split('=') for p in s.split())}
service, restaure = lire(sys.argv[1]), lire(sys.argv[2])
absentes = sorted(set(service) - set(restaure))
en_trop = sorted(t for t in restaure if t in service and restaure[t] > service[t])
ecarts = sorted((t, service[t] - restaure[t]) for t in service if t in restaure and service[t] > restaure[t])
print('ABSENTES ' + ','.join(absentes))
print('EN_TROP ' + ','.join(en_trop))
print('ECARTS ' + ', '.join(f'{t} (+{n})' for t, n in ecarts))
print('EN_MOINS ' + ', '.join(f'{t} (-{restaure[t] - service[t]})' for t in en_trop))
print('TOTAL %d %d' % (sum(service.values()), sum(restaure.get(t, 0) for t in service)))
PY
    ABSENTES="$(sed -n 's/^ABSENTES //p' "${TMP}/comparaison")"
    EN_MOINS="$(sed -n 's/^EN_MOINS //p' "${TMP}/comparaison")"
    ECARTS="$(sed -n 's/^ECARTS //p' "${TMP}/comparaison")"
    TOTAUX="$(sed -n 's/^TOTAL //p' "${TMP}/comparaison")"
    if [ -z "${ABSENTES}" ]; then ok "toutes les tables de la base en service sont dans la sauvegarde"; else ko "tables en service absentes de la sauvegarde : ${ABSENTES}"; fi
    note "lignes en service : ${TOTAUX%% *} — lignes restaurées : ${TOTAUX##* }"
    if [ -z "${ECARTS}" ]; then
      ok "aucune ligne créée depuis la sauvegarde"
    else
      note "lignes créées depuis la sauvegarde (elles seraient perdues en cas de restauration) : ${ECARTS}"
    fi
    # Moins de lignes en service que dans la sauvegarde : des suppressions ont eu
    # lieu depuis. Une restauration les ferait REVENIR — à savoir avant de restaurer.
    if [ -n "${EN_MOINS}" ]; then
      note "lignes SUPPRIMÉES depuis la sauvegarde (une restauration les ferait revenir) : ${EN_MOINS}"
    fi
  fi
fi

# ── Bilan ────────────────────────────────────────────────────────────────────
echo ""
echo "Temps de restauration mesuré : ${DUREE:-?} s — âge de la sauvegarde : ${AGE_H} h"
echo "(La base jetable ${BASE} est supprimée à la fin de ce script.)"
echo "Restauration : ${PASS} réussi(s), ${FAIL} échec(s)"
[ "${FAIL}" -eq 0 ]
