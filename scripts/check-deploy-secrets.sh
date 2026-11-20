#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Pôle Jeunesse — Contrôle des secrets AVANT tout déploiement
#
#  Usage : bash scripts/check-deploy-secrets.sh [chemin du fichier secrets]
#          (défaut : /opt/pj-secrets.env)
#
#  deploy.sh exécute ce script sur le VPS (ssh "bash -s" < ce fichier) avant le
#  moindre transfert et avant tout redémarrage PM2. Il sort en erreur si
#  JWT_SECRET est absent, vide, trop court ou égal à une valeur de remplacement
#  connue : avec un secret public, n'importe qui peut forger un JWT admin.
#
#  Ce script n'affiche JAMAIS la valeur d'un secret, seulement la raison du refus.
#  Il est volontairement autonome pour pouvoir être testé en local sur des
#  fichiers temporaires (scripts/test-check-deploy-secrets.sh).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SECRETS_FILE="${1:-/opt/pj-secrets.env}"
JWT_MIN_LENGTH=32

fail() {
  echo "  ❌ $1" >&2
  echo "     Déploiement interrompu : rien n'a été transféré ni redémarré." >&2
  exit 1
}

# Lit la DERNIÈRE occurrence de la clé (comme le ferait un shell qui source le
# fichier), sans guillemets ni espaces de bordure.
read_secret() {
  local key="$1" line
  line="$(grep -E "^${key}=" "$SECRETS_FILE" | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%$'\r'}"
  line="${line#\"}"; line="${line%\"}"
  line="${line#\'}"; line="${line%\'}"
  # trim
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  printf '%s' "$line"
}

[ -f "$SECRETS_FILE" ] || fail "$SECRETS_FILE introuvable. Crée-le manuellement (chmod 600) avec DATABASE_URL, JWT_SECRET et IDFM_API_KEY."

DB_URL="$(read_secret DATABASE_URL)"
[ -n "$DB_URL" ] || fail "DATABASE_URL absente ou vide dans $SECRETS_FILE."

JWT_SEC="$(read_secret JWT_SECRET)"
[ -n "$JWT_SEC" ] || fail "JWT_SECRET absente ou vide dans $SECRETS_FILE."

if [ "${#JWT_SEC}" -lt "$JWT_MIN_LENGTH" ]; then
  fail "JWT_SECRET trop courte (${#JWT_SEC} caractères, minimum $JWT_MIN_LENGTH). Génère-la avec : openssl rand -base64 48"
fi

# Valeurs de remplacement : gabarits (__X__, <...>), exemples versionnés dans le
# dépôt et formulations « changez-moi ». La comparaison est insensible à la casse.
JWT_LOWER="$(printf '%s' "$JWT_SEC" | tr '[:upper:]' '[:lower:]')"
case "$JWT_LOWER" in
  __*__|\<*\>|*changez-moi*|*changeme*|*change-me*|*change_me*|*placeholder*|*your-secret*|*your_secret*|*not-for-prod*|*example*|*exemple*)
    fail "JWT_SECRET est une valeur de remplacement connue, pas un secret. Génère-la avec : openssl rand -base64 48"
    ;;
esac

# Un secret composé d'un seul caractère répété (« aaaa… ») passe le contrôle de
# longueur sans apporter la moindre entropie.
if [ -z "$(printf '%s' "$JWT_SEC" | tr -d "${JWT_SEC:0:1}")" ]; then
  fail "JWT_SECRET est constituée d'un seul caractère répété."
fi

echo "  🔑 Fichier secrets présent, DATABASE_URL et JWT_SECRET utilisables"
