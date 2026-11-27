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
#  connue (avec un secret public, n'importe qui peut forger un JWT admin), ou
#  si APP_BASE_URL (adresse publique du site) est absente ou mal formée.
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

[ -f "$SECRETS_FILE" ] || fail "$SECRETS_FILE introuvable. Crée-le manuellement (chmod 600) avec DATABASE_URL, JWT_SECRET, APP_BASE_URL et IDFM_API_KEY."

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

# Adresse publique du site : source unique des liens envoyés par e-mail, de la
# configuration Nginx, du certificat et de la supervision (deploy.sh).
# Forme stricte : https://<nom de domaine>, sans chemin ni « / » final.
APP_URL="$(read_secret APP_BASE_URL)"
[ -n "$APP_URL" ] || fail "APP_BASE_URL absente ou vide dans $SECRETS_FILE (ex. APP_BASE_URL=https://polejeunesse.ville-nogentsurmarne.fr)."
if ! [[ "$APP_URL" =~ ^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
  fail "APP_BASE_URL doit être de la forme https://<nom de domaine> en minuscules, sans chemin ni « / » final."
fi

# Certificat fourni par la mairie (facultatif) : SSL_CERTIFICAT et SSL_CLE,
# chemins absolus, les deux ou aucun. Sans eux, deploy.sh utilise Let's Encrypt.
CERT="$(read_secret SSL_CERTIFICAT)"
CLE="$(read_secret SSL_CLE)"
if [ -n "$CERT" ] || [ -n "$CLE" ]; then
  [ -n "$CERT" ] && [ -n "$CLE" ] || fail "SSL_CERTIFICAT et SSL_CLE vont ensemble : renseigner les deux, ou aucun (Let's Encrypt)."
  for chemin in "$CERT" "$CLE"; do
    [[ "$chemin" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "SSL_CERTIFICAT / SSL_CLE : chemin absolu attendu, sans espace ni caractère spécial."
    [ -r "$chemin" ] || fail "Fichier de certificat introuvable ou illisible : $chemin"
  done
  if command -v openssl >/dev/null 2>&1; then
    openssl x509 -noout -in "$CERT" 2>/dev/null || fail "SSL_CERTIFICAT n'est pas un certificat lisible (format PEM attendu)."
    PUB_CERT="$(openssl x509 -noout -pubkey -in "$CERT" 2>/dev/null | openssl sha256 2>/dev/null)"
    PUB_CLE="$(openssl pkey -pubout -in "$CLE" 2>/dev/null | openssl sha256 2>/dev/null)"
    [ -n "$PUB_CLE" ] && [ "$PUB_CERT" = "$PUB_CLE" ] || fail "SSL_CLE ne correspond pas à SSL_CERTIFICAT."
    openssl x509 -checkend 0 -noout -in "$CERT" >/dev/null 2>&1 || fail "Le certificat SSL_CERTIFICAT est expiré."
    if ! openssl x509 -checkend $((30 * 86400)) -noout -in "$CERT" >/dev/null 2>&1; then
      echo "  ⚠️  Le certificat fourni expire dans moins de 30 jours : demander son renouvellement à la DSI."
    fi
  fi
  echo "  🔒 Certificat fourni utilisable"
fi

echo "  🔑 Fichier secrets présent, DATABASE_URL, JWT_SECRET et APP_BASE_URL utilisables"
