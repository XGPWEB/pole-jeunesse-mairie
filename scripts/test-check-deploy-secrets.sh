#!/usr/bin/env bash
# Tests locaux de scripts/check-deploy-secrets.sh sur des fichiers temporaires.
# Aucun accès réseau, aucun secret réel : toutes les valeurs sont fabriquées ici.
# Usage : bash scripts/test-check-deploy-secrets.sh
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="$DIR/check-deploy-secrets.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0; FAIL=0
URL='APP_BASE_URL=https://polejeunesse.exemple.test'
DB="DATABASE_URL=postgresql://u:p@localhost:5432/base_de_test\n$URL"
VALIDE="$(printf 'k7Qz%.0s' {1..12})-R4nd0m-9xLmP2vT"   # 64 caractères, fabriqué pour le test

# expect <code attendu: 0|1> <libellé> <contenu du fichier | __ABSENT__>
expect() {
  local attendu="$1" libelle="$2" contenu="$3" fichier="$TMP/secrets.env" code=0
  rm -f "$fichier"
  [ "$contenu" = "__ABSENT__" ] || printf '%b\n' "$contenu" > "$fichier"
  bash "$CHECK" "$fichier" >/dev/null 2>&1 || code=$?
  [ "$code" -ne 0 ] && code=1
  if [ "$code" -eq "$attendu" ]; then
    PASS=$((PASS + 1)); echo "  ✅ $libelle"
  else
    FAIL=$((FAIL + 1)); echo "  ❌ $libelle (code obtenu $code, attendu $attendu)"
  fi
}

expect 1 "fichier secrets absent"                    "__ABSENT__"
expect 1 "JWT_SECRET absente"                        "$DB"
expect 1 "JWT_SECRET vide"                           "$DB\nJWT_SECRET="
expect 1 "JWT_SECRET vide entre guillemets"          "$DB\nJWT_SECRET=\"\""
expect 1 "JWT_SECRET espaces seuls"                  "$DB\nJWT_SECRET=   "
expect 1 "gabarit __JWT_SECRET__"                    "$DB\nJWT_SECRET=__JWT_SECRET__"
expect 1 "exemple versionné (.env.example)"          "$DB\n$(grep '^JWT_SECRET=' "$DIR/../.env.example")"
expect 1 "placeholder long « changez-moi »"          "$DB\nJWT_SECRET=ceci-est-une-valeur-a-changez-moi-absolument-0123456789"
expect 1 "secret de test « not-for-prod »"           "$DB\nJWT_SECRET=integration-test-secret-not-for-prod"
expect 1 "trop courte (31 caractères)"               "$DB\nJWT_SECRET=$(printf 'aB3%.0s' {1..10})x"
expect 1 "un seul caractère répété"                  "$DB\nJWT_SECRET=$(printf 'a%.0s' {1..40})"
expect 1 "DATABASE_URL absente"                      "JWT_SECRET=$VALIDE"
expect 1 "dernière occurrence vide l'emporte"        "$DB\nJWT_SECRET=$VALIDE\nJWT_SECRET="
expect 0 "secret valide"                             "$DB\nJWT_SECRET=$VALIDE"
expect 0 "secret valide entre guillemets"            "$DB\nJWT_SECRET=\"$VALIDE\""
expect 0 "secret valide, fins de ligne CRLF"         "DATABASE_URL=postgresql://u:p@localhost:5432/b\r\n$URL\r\nJWT_SECRET=$VALIDE\r"

# APP_BASE_URL : adresse publique du site (liens des e-mails, Nginx, supervision).
J="JWT_SECRET=$VALIDE"
D='DATABASE_URL=postgresql://u:p@localhost:5432/base_de_test'
expect 1 "APP_BASE_URL absente"                      "$D\n$J"
expect 1 "APP_BASE_URL vide"                         "$D\n$J\nAPP_BASE_URL="
expect 1 "APP_BASE_URL en http"                      "$D\n$J\nAPP_BASE_URL=http://polejeunesse.exemple.test"
expect 1 "APP_BASE_URL avec « / » final"             "$D\n$J\nAPP_BASE_URL=https://polejeunesse.exemple.test/"
expect 1 "APP_BASE_URL avec chemin"                  "$D\n$J\nAPP_BASE_URL=https://polejeunesse.exemple.test/admin"
expect 1 "APP_BASE_URL sans domaine"                 "$D\n$J\nAPP_BASE_URL=https://localhost"
expect 1 "APP_BASE_URL en majuscules"                "$D\n$J\nAPP_BASE_URL=https://PoleJeunesse.exemple.test"
expect 1 "APP_BASE_URL avec caractère d'injection"   "$D\n$J\nAPP_BASE_URL=https://a.test;rm"
expect 0 "APP_BASE_URL valide entre guillemets"      "$D\n$J\nAPP_BASE_URL=\"https://polejeunesse.ville-nogentsurmarne.fr\""

# Certificat fourni (SSL_CERTIFICAT / SSL_CLE) : fabriqué ici, auto-signé.
B="$D\n$J\n$URL"
if command -v openssl >/dev/null 2>&1; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj '/CN=polejeunesse.exemple.test' \
    -keyout "$TMP/cle.pem" -out "$TMP/cert.pem" >/dev/null 2>&1
  openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj '/CN=autre.exemple.test' \
    -keyout "$TMP/autre-cle.pem" -out "$TMP/autre-cert.pem" >/dev/null 2>&1
  openssl req -x509 -newkey rsa:2048 -nodes -days 10 -subj '/CN=bientot.exemple.test' \
    -keyout "$TMP/court-cle.pem" -out "$TMP/court-cert.pem" >/dev/null 2>&1
  echo "pas un certificat" > "$TMP/faux.pem"
  expect 0 "certificat fourni valide"                "$B\nSSL_CERTIFICAT=$TMP/cert.pem\nSSL_CLE=$TMP/cle.pem"
  expect 0 "certificat qui expire bientôt (avertit)" "$B\nSSL_CERTIFICAT=$TMP/court-cert.pem\nSSL_CLE=$TMP/court-cle.pem"
  expect 1 "certificat sans sa clé"                  "$B\nSSL_CERTIFICAT=$TMP/cert.pem"
  expect 1 "clé sans certificat"                     "$B\nSSL_CLE=$TMP/cle.pem"
  expect 1 "clé d'un autre certificat"               "$B\nSSL_CERTIFICAT=$TMP/cert.pem\nSSL_CLE=$TMP/autre-cle.pem"
  expect 1 "certificat introuvable"                  "$B\nSSL_CERTIFICAT=$TMP/absent.pem\nSSL_CLE=$TMP/cle.pem"
  expect 1 "fichier qui n'est pas un certificat"     "$B\nSSL_CERTIFICAT=$TMP/faux.pem\nSSL_CLE=$TMP/cle.pem"
  expect 1 "chemin relatif"                          "$B\nSSL_CERTIFICAT=cert.pem\nSSL_CLE=cle.pem"
  expect 1 "chemin avec caractère spécial"           "$B\nSSL_CERTIFICAT=$TMP/cert.pem|x\nSSL_CLE=$TMP/cle.pem"
  printf '%b\n' "$B\nSSL_CERTIFICAT=$TMP/court-cert.pem\nSSL_CLE=$TMP/court-cle.pem" > "$TMP/court.env"
  # Sortie capturée d'abord : avec pipefail, « | grep -q » couperait le script (SIGPIPE).
  SORTIE="$(bash "$CHECK" "$TMP/court.env" 2>&1 || true)"
  if grep -q "moins de 30 jours" <<<"$SORTIE"; then
    PASS=$((PASS + 1)); echo "  ✅ avertissement d'expiration proche affiché"
  else
    FAIL=$((FAIL + 1)); echo "  ❌ avertissement d'expiration proche absent"
  fi
fi

# Le message d'erreur ne doit jamais contenir la valeur refusée.
printf '%s\nJWT_SECRET=%s\n' "$DB" "court-mais-confidentiel" > "$TMP/secrets.env"
if bash "$CHECK" "$TMP/secrets.env" 2>&1 | grep -q "court-mais-confidentiel"; then
  FAIL=$((FAIL + 1)); echo "  ❌ la valeur du secret apparaît dans la sortie"
else
  PASS=$((PASS + 1)); echo "  ✅ la valeur du secret n'apparaît pas dans la sortie"
fi

echo ""
echo "check-deploy-secrets : $PASS réussis, $FAIL échoués"
[ "$FAIL" -eq 0 ]
