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
DB='DATABASE_URL=postgresql://u:p@localhost:5432/base_de_test'
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
expect 0 "secret valide, fins de ligne CRLF"         "$DB\r\nJWT_SECRET=$VALIDE\r"

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
