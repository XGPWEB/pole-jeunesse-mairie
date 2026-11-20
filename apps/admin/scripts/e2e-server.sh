#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  Serveur E2E local isolé — lancé par Playwright (playwright.config.ts)
#
#  1. détruit puis recrée la base jetable pole_jeunesse_e2e depuis init-db.sql ;
#  2. y crée les comptes de test (mot de passe généré par Playwright, reçu par
#     variable d'environnement, jamais écrit sur disque) ;
#  3. démarre Next sur 127.0.0.1 uniquement.
#
#  Ne JAMAIS lancer ce script avec un DATABASE_URL de production : il refuse
#  tout ce qui n'est pas une base locale nommée pole_jeunesse_e2e*.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

DB_NAME="${E2E_DB_NAME:-pole_jeunesse_e2e}"
PORT="${E2E_PORT:-3100}"

case "$DB_NAME" in
  pole_jeunesse_e2e*) ;;
  *) echo "❌ REFUS : base E2E inattendue ($DB_NAME)." >&2; exit 1 ;;
esac
case "${DATABASE_URL:-}" in
  *@localhost:*/"$DB_NAME"|*@127.0.0.1:*/"$DB_NAME"|*@localhost/"$DB_NAME"|*@127.0.0.1/"$DB_NAME") ;;
  *) echo "❌ REFUS : DATABASE_URL doit viser la base locale $DB_NAME." >&2; exit 1 ;;
esac
: "${JWT_SECRET:?JWT_SECRET requis}"
: "${E2E_ADMIN_USER:?E2E_ADMIN_USER requis}"
: "${E2E_ADMIN_PASS:?E2E_ADMIN_PASS requis}"

# setup-test-db.sh se connecte via les variables PG* / le socket local ; on lui
# transmet l'URL explicitement pour que CI (utilisateur postgres + mot de passe)
# et poste local (utilisateur courant) empruntent le même chemin.
TEST_DB_NAME="$DB_NAME" bash scripts/setup-test-db.sh >&2
node scripts/seed-e2e.mjs >&2

exec npx next dev --hostname 127.0.0.1 --port "$PORT"
