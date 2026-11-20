#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  Base PostgreSQL jetable pour les tests d'intégration
# ═══════════════════════════════════════════════════════════════════════════
#
#  POURQUOI cette base existe
#  Les 47 tests unitaires mockent `pg`. Un mock accepte joyeusement la chaîne
#  vide pour une colonne DATE, et ne sait pas qu'une colonne n'existe pas. Les
#  deux bugs de production du 2026-07-30 (500 sur /api/projets, widget
#  « Contrats arrivant à échéance » mort depuis toujours) étaient exactement de
#  cette nature : du CÂBLAGE, pas de la logique. Ils étaient donc invisibles
#  pour les tests unitaires, par construction.
#
#  Cette base fait tourner le vrai driver pg contre le vrai schéma, avec les
#  vrais types de colonnes. C'est l'étage qui attrape cette classe de défauts.
#
#  Usage :  bash scripts/setup-test-db.sh
#  Idempotent : la base est DÉTRUITE puis recréée à chaque appel.
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

DB_NAME="${TEST_DB_NAME:-pole_jeunesse_test}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Garde-fou : ne JAMAIS viser la base de production.
# Liste blanche plutôt que liste noire : seules les bases jetables de test/E2E
# peuvent être détruites par ce script, et uniquement sur un serveur local.
if [[ ! "${DB_NAME}" =~ ^pole_jeunesse_(test|e2e)[a-z0-9_]*$ ]]; then
  echo "❌ REFUS : '${DB_NAME}' n'est pas une base jetable (pole_jeunesse_test* ou pole_jeunesse_e2e*)." >&2
  exit 1
fi
case "${PGHOST:-localhost}" in
  localhost|127.0.0.1|::1|/*) ;;
  *) echo "❌ REFUS : PGHOST='${PGHOST}' n'est pas local." >&2; exit 1 ;;
esac
if [[ -n "${DATABASE_URL:-}" && "${DATABASE_URL}" != *"${DB_NAME}"* ]]; then
  echo "⚠️  DATABASE_URL est défini et ne pointe pas sur ${DB_NAME} — il sera ignoré." >&2
fi

if ! pg_isready -q; then
  echo "❌ Aucun PostgreSQL joignable en local." >&2
  echo "   macOS/Homebrew :  brew services start postgresql@16" >&2
  exit 1
fi

echo "🗑  Suppression de ${DB_NAME} si elle existe…"
dropdb --if-exists "${DB_NAME}"

# ${DB_NAME} avec accolades : sous le Bash 3.2 de macOS et une locale UTF-8,
# `$DB_NAME…` est lu comme une variable nommée « DB_NAME… » (unbound variable),
# juste après le dropdb et avant le createdb.
echo "📦 Création de ${DB_NAME}…"
createdb "${DB_NAME}"

echo "🏗  Application du schéma (init-db.sql)…"
psql -q -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "$SCRIPT_DIR/init-db.sql"

TABLES=$(psql -Atq -d "${DB_NAME}" -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")

echo "✅ Base de test prête : ${DB_NAME} ($TABLES tables)"
echo "   Lancer les tests :  npm run test:integration"
