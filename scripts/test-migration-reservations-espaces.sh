#!/usr/bin/env bash
# Test local de apps/admin/scripts/migration-reservations-espaces-2026-10.sql et de son
# diagnostic, sur une base PostgreSQL JETABLE créée puis détruite ici.
# Aucun accès distant.
#
# Ce que ce test établit, sur une base qui contient DÉJÀ des lignes fautives
# (réservations inversées, jeune rattaché à l'espace d'une autre commune) :
#   - le diagnostic les liste et n'écrit rien ;
#   - la migration s'applique sans erreur, ne modifie AUCUNE donnée, laisse
#     les contraintes concernées NOT VALID et le dit ;
#   - les nouvelles écritures fautives sont refusées immédiatement ;
#   - une fois les lignes corrigées, rejouer la migration valide tout ;
#   - la rejouer encore ne change rien (idempotence).
#
# Usage : bash scripts/test-migration-reservations-espaces-2026-10.sh
# Connexion : variables PG* habituelles ; par défaut l'utilisateur courant sur
# localhost:5432. Compatible Bash 3.2.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_DIR="$(cd "${DIR}/.." && pwd)/apps/admin/scripts"
MIGRATION="${SQL_DIR}/migration-reservations-espaces-2026-10.sql"
DIAGNOSTIC="${SQL_DIR}/diagnostic-reservations-espaces-2026-10.sql"
BASE="pole_jeunesse_test_migration_resa"
TMP="$(mktemp -d)"

HOTE="${PGHOST:-localhost}"
case "${HOTE}" in
  localhost|127.0.0.1|::1) ;;
  *) echo "❌ REFUS : PGHOST='${HOTE}' n'est pas local." >&2; exit 1 ;;
esac

nettoyer() { dropdb --if-exists "${BASE}" >/dev/null 2>&1; rm -rf "${TMP}"; }
trap nettoyer EXIT

if ! pg_isready -q -h "${HOTE}" -p "${PGPORT:-5432}"; then
  echo "❌ Aucun PostgreSQL local joignable : test de la migration non exécuté." >&2
  exit 1
fi

PASS=0; FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
ko() { FAIL=$((FAIL + 1)); echo "  ❌ $1"; }
sql() { psql -X -Atq -v ON_ERROR_STOP=1 -d "${BASE}" -c "$1" 2>"${TMP}/sql.err"; }
# attendre_egal <libellé> <attendu> <obtenu>
egal() { if [ "$2" = "$3" ]; then ok "$1"; else ko "$1 — attendu « $2 », obtenu « $3 »"; fi; }
# refuse <libellé> <contrainte attendue dans l'erreur> <requête>
refuse() {
  if sql "$3" >/dev/null; then ko "$1 — la requête aurait dû être refusée"
  elif grep -q "$2" "${TMP}/sql.err"; then ok "$1"
  else ko "$1 — refusée, mais pas par $2 : $(head -n 1 "${TMP}/sql.err")"; fi
}
etat_contraintes() {
  sql "SELECT string_agg(conname || '=' || CASE WHEN convalidated THEN 'valide' ELSE 'NON_VALIDE' END, ' ' ORDER BY conname)
       FROM pg_constraint WHERE conname IN ('reservations_dates_coherentes','reservations_heure_depart_valide','reservations_heure_retour_valide','reservations_heures_ordonnees','fk_jeunes_espace_commune')"
}
# Empreinte de toutes les données des tables touchées : sert à prouver que rien n'a été modifié.
empreinte() {
  sql "SELECT md5(COALESCE((SELECT string_agg(r::text, '|' ORDER BY id) FROM reservations_vehicules r), '')
              || COALESCE((SELECT string_agg(j::text, '|' ORDER BY id) FROM jeunes j), '')
              || COALESCE((SELECT string_agg(e::text, '|' ORDER BY id) FROM espaces e), ''))"
}
migrer() { psql -X -q -v ON_ERROR_STOP=1 -d "${BASE}" -f "${MIGRATION}" > "${TMP}/migration.out" 2>&1; }

echo "Préparation de la base jetable ${BASE}…"
dropdb --if-exists "${BASE}" >/dev/null 2>&1
createdb "${BASE}" || { echo "❌ createdb" >&2; exit 1; }
psql -X -q -v ON_ERROR_STOP=1 -d "${BASE}" -f "${SQL_DIR}/init-db.sql" >/dev/null 2>"${TMP}/init.err" || { cat "${TMP}/init.err" >&2; exit 1; }

# État « avant la migration » : on retire ce qu'elle crée, puis on sème des
# données dont certaines violent les futurs invariants.
sql "ALTER TABLE jeunes DROP CONSTRAINT fk_jeunes_espace_commune;
     ALTER TABLE reservations_vehicules DROP CONSTRAINT reservations_dates_coherentes, DROP CONSTRAINT reservations_heure_depart_valide,
       DROP CONSTRAINT reservations_heure_retour_valide, DROP CONSTRAINT reservations_heures_ordonnees;
     DROP INDEX uq_espaces_tenant_id;
     INSERT INTO tenants (id, nom) VALUES ('commune-a', 'A'), ('commune-b', 'B');
     INSERT INTO espaces (id, nom, tenant_id) VALUES ('esp-a', 'Espace A', 'commune-a'), ('esp-b', 'Espace B', 'commune-b');
     INSERT INTO jeunes (id, nom, prenom, espace_id, tenant_id) VALUES
       ('j-conforme', 'N', 'P', 'esp-a', 'commune-a'),
       ('j-croise',   'N', 'P', 'esp-b', 'commune-a'),
       ('j-sans',     'N', 'P', NULL,    'commune-a');
     INSERT INTO reservations_vehicules (id, date_debut, date_fin, heure_depart, heure_retour, motif, tenant_id) VALUES
       ('r-conforme',         '2026-11-10', '2026-11-10', '09:00', '12:00', 'm', 'commune-a'),
       ('r-sejour',           '2026-11-12', '2026-11-14', '18:00', '09:00', 'm', 'commune-a'),
       ('r-sans-retour',      '2026-11-15', '2026-11-15', '09:00', '',      'm', 'commune-a'),
       ('r-retour-null',      '2026-11-16', '2026-11-16', '09:00', NULL,    'm', 'commune-a'),
       ('r-dates-inversees',  '2026-11-20', '2026-11-19', '09:00', '12:00', 'm', 'commune-a'),
       ('r-heures-inversees', '2026-11-21', '2026-11-21', '18:00', '09:00', 'm', 'commune-a'),
       ('r-format',           '2026-11-22', '2026-11-22', '9h',    '',      'm', 'commune-a');" >/dev/null \
  || { cat "${TMP}/sql.err" >&2; echo "❌ préparation des données" >&2; exit 1; }

egal "état initial : aucune des contraintes n'existe" "" "$(etat_contraintes)"
AVANT="$(empreinte)"

echo "Diagnostic (lecture seule) sur des données fautives"
psql -X -q -v ON_ERROR_STOP=1 -d "${BASE}" -f "${DIAGNOSTIC}" > "${TMP}/diag.out" 2>&1; egal "le diagnostic se termine sans erreur" "0" "$?"
for attendu in r-dates-inversees r-heures-inversees r-format j-croise; do
  if grep -q "${attendu}" "${TMP}/diag.out"; then ok "le diagnostic signale ${attendu}"; else ko "le diagnostic ne signale pas ${attendu}"; fi
done
for conforme in r-conforme r-sejour r-sans-retour r-retour-null j-conforme j-sans; do
  if grep -q "${conforme}" "${TMP}/diag.out"; then ko "le diagnostic signale à tort ${conforme}"; else ok "le diagnostic ne signale pas ${conforme}"; fi
done
egal "le diagnostic n'a rien modifié" "${AVANT}" "$(empreinte)"
egal "le diagnostic n'a créé aucune contrainte" "" "$(etat_contraintes)"

echo "Migration sur des données fautives"
migrer; egal "la migration s'applique sans erreur" "0" "$?"
egal "aucune donnée modifiée, supprimée ni réaffectée" "${AVANT}" "$(empreinte)"
egal "contraintes violées par l'existant laissées NOT VALID, les autres validées" \
  "fk_jeunes_espace_commune=NON_VALIDE reservations_dates_coherentes=NON_VALIDE reservations_heure_depart_valide=NON_VALIDE reservations_heure_retour_valide=valide reservations_heures_ordonnees=NON_VALIDE" \
  "$(etat_contraintes)"
for mot in reservations_dates_coherentes reservations_heures_ordonnees reservations_heure_depart_valide fk_jeunes_espace_commune r-dates-inversees r-heures-inversees r-format j-croise; do
  if grep -q "${mot}" "${TMP}/migration.out"; then ok "l'avertissement cite ${mot}"; else ko "l'avertissement ne cite pas ${mot}"; fi
done

echo "Nouvelles écritures, contraintes encore NOT VALID"
refuse "réservation à dates inversées refusée"  "reservations_dates_coherentes" "INSERT INTO reservations_vehicules (id, date_debut, date_fin, heure_depart, heure_retour, tenant_id) VALUES ('n1', '2026-12-02', '2026-12-01', '09:00', '', 'commune-a')"
refuse "réservation à heures inversées refusée" "reservations_heures_ordonnees" "INSERT INTO reservations_vehicules (id, date_debut, date_fin, heure_depart, heure_retour, tenant_id) VALUES ('n2', '2026-12-02', '2026-12-02', '18:00', '09:00', 'commune-a')"
refuse "jeune rattaché à l'espace d'une autre commune refusé" "fk_jeunes_espace_commune" "INSERT INTO jeunes (id, nom, prenom, espace_id, tenant_id) VALUES ('n3', 'N', 'P', 'esp-b', 'commune-a')"
refuse "une ligne fautive ne peut pas être réécrite fautive" "reservations_dates_coherentes" "UPDATE reservations_vehicules SET motif = 'modifié' WHERE id = 'r-dates-inversees'"
# Deux appels séparés : dans UNE même transaction, PostgreSQL revérifie la clé
# étrangère d'une ligne qu'il vient lui-même de réécrire.
if sql "UPDATE jeunes SET nom = 'RENOMME' WHERE id = 'j-croise'" >/dev/null && sql "UPDATE jeunes SET nom = 'N' WHERE id = 'j-croise'" >/dev/null; then ok "la fiche historique croisée reste modifiable hors rattachement"; else ko "la fiche historique croisée est bloquée : $(head -n 1 "${TMP}/sql.err")"; fi
if sql "INSERT INTO reservations_vehicules (id, date_debut, date_fin, heure_depart, heure_retour, tenant_id) VALUES ('n4', '2026-12-03', '2026-12-05', '18:00', '09:00', 'commune-a'); DELETE FROM reservations_vehicules WHERE id = 'n4'" >/dev/null; then ok "réservation conforme de plusieurs jours acceptée"; else ko "réservation conforme refusée : $(head -n 1 "${TMP}/sql.err")"; fi
egal "données inchangées après ces essais" "${AVANT}" "$(empreinte)"

echo "Migration rejouée sans correction"
migrer; egal "la migration rejouée s'applique sans erreur" "0" "$?"
egal "même état des contraintes" \
  "fk_jeunes_espace_commune=NON_VALIDE reservations_dates_coherentes=NON_VALIDE reservations_heure_depart_valide=NON_VALIDE reservations_heure_retour_valide=valide reservations_heures_ordonnees=NON_VALIDE" \
  "$(etat_contraintes)"

echo "Après correction manuelle des lignes signalées"
sql "UPDATE reservations_vehicules SET date_fin = date_debut WHERE id = 'r-dates-inversees';
     UPDATE reservations_vehicules SET heure_retour = '' WHERE id = 'r-heures-inversees';
     UPDATE reservations_vehicules SET heure_depart = '09:00' WHERE id = 'r-format';
     UPDATE jeunes SET espace_id = 'esp-a' WHERE id = 'j-croise';" >/dev/null || ko "correction manuelle : $(head -n 1 "${TMP}/sql.err")"
migrer; egal "la migration rejouée s'applique sans erreur" "0" "$?"
egal "toutes les contraintes sont validées" \
  "fk_jeunes_espace_commune=valide reservations_dates_coherentes=valide reservations_heure_depart_valide=valide reservations_heure_retour_valide=valide reservations_heures_ordonnees=valide" \
  "$(etat_contraintes)"
if grep -qi "warning\|attention" "${TMP}/migration.out"; then ko "avertissement inattendu après correction"; else ok "plus aucun avertissement"; fi
APRES_CORRECTION="$(empreinte)"

echo "Idempotence"
migrer; egal "troisième passage sans erreur" "0" "$?"
egal "données inchangées" "${APRES_CORRECTION}" "$(empreinte)"
psql -X -q -v ON_ERROR_STOP=1 -d "${BASE}" -f "${DIAGNOSTIC}" > "${TMP}/diag2.out" 2>&1
if grep -q "r-\|j-croise" "${TMP}/diag2.out"; then ko "le diagnostic signale encore des lignes"; else ok "le diagnostic ne signale plus rien"; fi

echo ""
echo "Résultat : ${PASS} réussi(s), ${FAIL} échec(s)"
[ "${FAIL}" -eq 0 ]
