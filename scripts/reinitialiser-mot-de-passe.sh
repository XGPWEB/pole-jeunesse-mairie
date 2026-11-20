#!/usr/bin/env bash
# Réinitialise le mot de passe d'un compte directement en base de production,
# sans passer par l'e-mail. Le mot de passe est saisi au clavier (masqué),
# haché ICI avec bcryptjs : seul le hash part vers le serveur.
# Toutes les sessions ouvertes du compte sont révoquées.
#
# Usage : bash scripts/reinitialiser-mot-de-passe.sh <identifiant>
set -euo pipefail

USERNAME="${1:-}"
[ -n "$USERNAME" ] || { echo "Usage : $0 <identifiant>" >&2; exit 1; }
# L'identifiant est transmis dans la ligne de commande distante : on refuse
# tout caractère qui pourrait en sortir.
[[ "$USERNAME" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Identifiant invalide." >&2; exit 1; }

LOCAL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$LOCAL_ROOT/deploy.env" ] || { echo "deploy.env absent (voir deploy.env.example)." >&2; exit 1; }
set -a; . "$LOCAL_ROOT/deploy.env"; set +a
: "${VPS_IP:?VPS_IP manquant dans deploy.env}" "${SSH_KEY:?SSH_KEY manquant dans deploy.env}"
SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
VPS="${VPS_USER:-root}@${VPS_IP}"

read -rsp "Nouveau mot de passe pour « $USERNAME » : " P1; echo
read -rsp "Confirmez : " P2; echo
[ "$P1" = "$P2" ] || { echo "Les deux saisies diffèrent." >&2; exit 1; }
[ "${#P1}" -ge 12 ] || { echo "12 caractères minimum." >&2; exit 1; }

HASH="$(cd "$LOCAL_ROOT" && P="$P1" node -e "process.stdout.write(require('bcryptjs').hashSync(process.env.P, 10))")"
unset P1 P2
FORMAT_HASH='^\$2[aby]\$10\$[./A-Za-z0-9]{53}$'
[[ "$HASH" =~ $FORMAT_HASH ]] ||{ echo "Hash inattendu, abandon." >&2; exit 1; }

# Les valeurs passent par des variables psql (:'…') : aucune interpolation
# shell dans le SQL lui-même.
ssh "${SSH_OPTS[@]}" "$VPS" \
  "set -a; . /opt/pj-secrets.env; set +a; psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 -v hash='$HASH' -v u='$USERNAME'" <<'SQL'
UPDATE animateurs
   SET password_hash = :'hash',
       password_reset_requested = FALSE,
       session_version = session_version + 1,
       session_invalidated_at = clock_timestamp()
 WHERE username = :'u' AND statut = 'actif'
RETURNING username, role, tenant_id;
SQL
