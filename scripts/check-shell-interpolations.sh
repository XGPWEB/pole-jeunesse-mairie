#!/usr/bin/env bash
# Refuse `$VAR` immédiatement suivi d'un caractère non ASCII dans les scripts shell.
#
# Sous le Bash 3.2 de macOS avec une locale UTF-8, `$DB_NAME…` est lu comme une
# variable nommée « DB_NAME… » : `bash -n` ne voit rien et l'exécution échoue
# (« unbound variable » avec `set -u`). Écrire `${DB_NAME}…`.
#
# Usage : bash scripts/check-shell-interpolations.sh [fichiers…]
# Sans argument : deploy.sh et tous les scripts du dépôt.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [ "$#" -eq 0 ]; then
  set -- deploy.sh scripts/*.sh apps/admin/scripts/*.sh
fi

# perl plutôt que grep -P : même comportement sous macOS et Linux. Les lignes de
# commentaire sont ignorées (elles peuvent citer la forme fautive).
if perl -ne 'next if /^\s*#/; if (/\$[A-Za-z_][A-Za-z0-9_]*[\x80-\xFF]/) { print "$ARGV:$.: $_"; $trouve = 1 } close ARGV if eof; END { exit($trouve ? 0 : 1) }' "$@"; then
  echo "❌ Interpolation non délimitée devant un caractère non ASCII : utiliser \${VAR}." >&2
  exit 1
fi
echo "✅ Interpolations shell correctement délimitées"
