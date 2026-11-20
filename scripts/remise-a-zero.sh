#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Pôle Jeunesse — Remise à zéro des données de démonstration
#
#  Se lance depuis le Mac, dans le dépôt. Agit sur le serveur indiqué :
#    1. sauvegarde complète de la base (pg_dump) dans /opt/backups/pj-db ;
#    2. applique apps/admin/scripts/remise-a-zero-2026-11.sql
#       (contenu conservé / vidé : voir l'en-tête de ce fichier) ;
#    3. avec --confirmer seulement : met de côté les archives CAF sur disque
#       (/opt/pj-shared/data/caf-archives → /opt/backups/pj-db/), puis
#       redémarre l'application.
#
#  Usage :
#    bash scripts/remise-a-zero.sh root@<serveur>              # simulation
#    bash scripts/remise-a-zero.sh root@<serveur> --confirmer  # exécution
#
#  Clé SSH : SSH_KEY de deploy.env (ou de l'environnement), sinon ~/.ssh/id_rsa.
#  Base visée : DATABASE_URL lu dans /opt/pj-secrets.env sur le serveur.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CIBLE="${1:-}"
MODE="${2:-}"
[ -n "$CIBLE" ] || { echo "Usage : $0 root@<serveur> [--confirmer]" >&2; exit 1; }
[[ "$CIBLE" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9.:-]+$ ]] || { echo "Cible SSH invalide : $CIBLE" >&2; exit 1; }
case "$MODE" in ""|--confirmer) ;; *) echo "Option inconnue : $MODE" >&2; exit 1 ;; esac

RACINE="$(cd "$(dirname "$0")/.." && pwd)"
if [ -z "${SSH_KEY:-}" ] && [ -f "$RACINE/deploy.env" ]; then
  SSH_KEY="$(set -a; . "$RACINE/deploy.env"; printf '%s' "${SSH_KEY:-}")"
fi
SQL="$RACINE/apps/admin/scripts/remise-a-zero-2026-11.sql"
SSH_OPTS=(-i "${SSH_KEY:-$HOME/.ssh/id_rsa}" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
DATE_TAG="$(date +%Y-%m-%d-%H%M%S)"

echo ""
echo "Serveur visé : $CIBLE"
ssh "${SSH_OPTS[@]}" "$CIBLE" 'set -a; . /opt/pj-secrets.env; set +a; psql "$DATABASE_URL" -XtAc "SELECT current_database() || '"'"' sur '"'"'  || coalesce(inet_server_addr()::text, '"'"'socket local'"'"')"'
echo ""

if [ "$MODE" = "--confirmer" ]; then
  echo "⚠️  Les données listées ci-dessus seront SUPPRIMÉES (une sauvegarde est faite avant)."
  read -rp "Tapez REMISE-A-ZERO pour confirmer : " REP
  [ "$REP" = "REMISE-A-ZERO" ] || { echo "Annulé."; exit 0; }

  echo "[1/3] Sauvegarde de la base…"
  ssh "${SSH_OPTS[@]}" "$CIBLE" "set -euo pipefail; set -a; . /opt/pj-secrets.env; set +a
    mkdir -p /opt/backups/pj-db
    F=/opt/backups/pj-db/pj-avant-remise-a-zero-${DATE_TAG}.sql.gz
    pg_dump \"\$DATABASE_URL\" | gzip > \"\$F\"
    chmod 600 \"\$F\"
    gzip -t \"\$F\" && echo \"  ✅ \$F (\$(du -h \"\$F\" | cut -f1))\""

  echo "[2/3] Remise à zéro de la base…"
  ssh "${SSH_OPTS[@]}" "$CIBLE" 'set -a; . /opt/pj-secrets.env; set +a; psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -v confirmation=REMISE-A-ZERO' < "$SQL"

  echo "[3/3] Archives CAF mises de côté et redémarrage…"
  ssh "${SSH_OPTS[@]}" "$CIBLE" "set -e
    if [ -d /opt/pj-shared/data/caf-archives ]; then
      mv /opt/pj-shared/data/caf-archives /opt/backups/pj-db/caf-archives-avant-remise-a-zero-${DATE_TAG}
      echo '  ✅ archives CAF déplacées dans /opt/backups/pj-db/'
    else
      echo '  (aucune archive CAF)'
    fi
    pm2 restart pole-jeunesse-admin >/dev/null && echo '  ✅ application redémarrée'"
  echo ""
  echo "Terminé. Sauvegarde : /opt/backups/pj-db/pj-avant-remise-a-zero-${DATE_TAG}.sql.gz"
else
  ssh "${SSH_OPTS[@]}" "$CIBLE" 'set -a; . /opt/pj-secrets.env; set +a; psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1' < "$SQL"
  echo ""
  echo "Pour exécuter réellement : bash scripts/remise-a-zero.sh $CIBLE --confirmer"
fi
