#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Pôle Jeunesse — Script de déploiement VPS
#  Usage : bash ~/app-pole-jeunesse/deploy.sh
#
#  Config VPS (VPS_IP / VPS_USER / SSH_KEY) : ce script charge ces variables
#  depuis `deploy.env` à la racine du repo s'il existe (non versionné — voir
#  .gitignore). Pour le créer : cp deploy.env.example deploy.env, puis
#  renseigner les vraies valeurs. En l'absence de deploy.env, les valeurs
#  codées en dur ci-dessous sont utilisées en repli.
# ─────────────────────────────────────────────────────────────────────────────

set -e

LOCAL_ROOT="$(cd "$(dirname "$0")" && pwd)"

VPS_USER="root"
VPS_DIR="/opt/pole-jeunesse-admin"

# Adresse du serveur et clé SSH : uniquement dans deploy.env (non versionné).
if [ ! -f "$LOCAL_ROOT/deploy.env" ]; then
  echo "❌ deploy.env absent : cp deploy.env.example deploy.env, puis renseigner VPS_IP et SSH_KEY." >&2
  exit 1
fi
set -a
source "$LOCAL_ROOT/deploy.env"
set +a
: "${VPS_IP:?VPS_IP manquant dans deploy.env}"
: "${SSH_KEY:?SSH_KEY manquant dans deploy.env}"

ADMIN_DIR="$LOCAL_ROOT/apps/admin"

# ── Couleurs ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Pôle Jeunesse — Déploiement VPS            ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════╝${NC}"
echo ""

SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15"

# Adresse publique du site : lue sur le serveur (APP_BASE_URL de
# /opt/pj-secrets.env), jamais écrite dans ce script. Sert aux messages
# ci-dessous ; Nginx et la supervision la relisent eux-mêmes sur le serveur.
# Sa validité est contrôlée par scripts/check-deploy-secrets.sh.
lire_adresse_vps() {
  ssh $SSH_OPTS $VPS_USER@$VPS_IP "sed -n 's/^APP_BASE_URL=//p' /opt/pj-secrets.env 2>/dev/null | tail -n 1" 2>/dev/null \
    | tr -d "\"'\r" || true
}

# ── Retour arrière manuel : bash deploy.sh --retour-arriere ──────────────────
# Remet en service la version précédente conservée sur le serveur, avec sa
# configuration, sans rien construire ni transférer. À utiliser quand une
# version livrée démarre correctement mais se révèle mauvaise à l'usage.
if [ "${1:-}" = "--retour-arriere" ]; then
  echo -e "${YELLOW}Retour arrière vers la version précédente...${NC}"
  set +e
  ssh $SSH_OPTS $VPS_USER@$VPS_IP "bash -s -- --retour-arriere" < "$LOCAL_ROOT/scripts/deploy-release.sh"
  CODE_RETOUR=$?
  set -e
  if [ "${CODE_RETOUR}" -eq 0 ]; then
    echo -e "${GREEN}  ✅ Version précédente en service, identité vérifiée. Contrôle : $(lire_adresse_vps)/api/health${NC}"
  elif [ "${CODE_RETOUR}" -eq 1 ]; then
    echo -e "${RED}  ❌ Retour arrière NON effectué : c'est toujours la version de départ qui est en service (voir le message ci-dessus).${NC}"
  else
    echo -e "${RED}  🚨 Site à vérifier tout de suite (code ${CODE_RETOUR}) : voir README, section « Retour arrière ».${NC}"
  fi
  exit "${CODE_RETOUR}"
fi

# ── Pré-contrôle des secrets du VPS — AVANT tests, build, transfert et redémarrage ─
# Sans JWT_SECRET utilisable sur le VPS, le déploiement ne doit même pas
# commencer : auparavant un simple avertissement était affiché et PM2 démarrait
# avec le gabarit du fichier ecosystem comme secret (valeur publique → JWT
# forgeables). Le contrôle vit dans scripts/check-deploy-secrets.sh pour être
# testable en local (scripts/test-check-deploy-secrets.sh).
check_vps_secrets() {
  ssh $SSH_OPTS $VPS_USER@$VPS_IP "bash -s -- /opt/pj-secrets.env" < "$LOCAL_ROOT/scripts/check-deploy-secrets.sh"
}
echo -e "${YELLOW}[pré-contrôle] Secrets du VPS...${NC}"
if ! check_vps_secrets; then
  echo -e "${RED}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║   ❌ DÉPLOIEMENT ANNULÉ — secrets invalides  ║${NC}"
  echo -e "${RED}╚══════════════════════════════════════════════╝${NC}"
  exit 1
fi

# ── Pré-contrôle du schéma de la base cible ───────────────────────────────────
# Le code déployé lit des colonnes créées par des migrations appliquées à la
# main (animateurs.session_version, sorties_participants.ordre…). Sur un ancien
# schéma, l'application démarrerait puis répondrait 500 partout. Contrôle en
# LECTURE SEULE (scripts/check-deploy-schema.sh) : aucune migration n'est
# appliquée par ce script, il s'arrête et indique lesquelles appliquer.
check_vps_schema() {
  ssh $SSH_OPTS $VPS_USER@$VPS_IP "bash -s -- /opt/pj-secrets.env" < "$LOCAL_ROOT/scripts/check-deploy-schema.sh"
}
# ── Pré-contrôle de Node sur le VPS ───────────────────────────────────────────
# Le serveur doit déjà tourner sur la branche majeure de .nvmrc, celle du build.
# deploy.sh ne change jamais Node : voir PROCEDURE-NODE.md.
NODE_MAJEUR="$(tr -d '[:space:]' < "$LOCAL_ROOT/.nvmrc")"
echo -e "${YELLOW}[pré-contrôle] Node du VPS...${NC}"
NODE_VPS="$(ssh $SSH_OPTS $VPS_USER@$VPS_IP 'node --version 2>/dev/null' || true)"
if [ "${NODE_VPS%%.*}" != "v${NODE_MAJEUR}" ]; then
  echo -e "${RED}  ❌ Node du VPS : ${NODE_VPS:-absent} ; attendu : v${NODE_MAJEUR} (.nvmrc).${NC}"
  echo -e "${RED}     Mettre Node à jour SÉPARÉMENT, avant la livraison : PROCEDURE-NODE.md.${NC}"
  echo -e "${RED}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║   ❌ DÉPLOIEMENT ANNULÉ — Node du VPS        ║${NC}"
  echo -e "${RED}╚══════════════════════════════════════════════╝${NC}"
  exit 1
fi
echo -e "  ⚙️  Node du VPS : ${NODE_VPS}"

echo -e "${YELLOW}[pré-contrôle] Schéma de la base...${NC}"
if ! check_vps_schema; then
  echo -e "${RED}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║   ❌ DÉPLOIEMENT ANNULÉ — schéma incompatible║${NC}"
  echo -e "${RED}╚══════════════════════════════════════════════╝${NC}"
  exit 1
fi
echo ""

# ── 0. Tests unitaires — bloque le déploiement si échec ──────────────────────
echo -e "${YELLOW}[0/5] Tests unitaires...${NC}"
cd "$ADMIN_DIR"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh" && nvm use "$(cat "$LOCAL_ROOT/.nvmrc")" --silent 2>/dev/null || true
if ! npm test; then
  echo ""
  echo -e "${RED}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║   ❌ DÉPLOIEMENT ANNULÉ — tests en échec     ║${NC}"
  echo -e "${RED}╚══════════════════════════════════════════════╝${NC}"
  exit 1
fi
echo -e "${GREEN}    ✅ Tous les tests passent${NC}"
echo ""

# ── Version et commit attendus sur le serveur ────────────────────────────────
# Relevés AVANT le build, comme le fait next.config.js : ce sont eux que
# /api/health devra annoncer pour que la livraison soit considérée réussie.
VERSION_ATTENDUE="$(tr -d '[:space:]' < "$LOCAL_ROOT/VERSION")"
COMMIT_ATTENDU="$(git -C "$LOCAL_ROOT" rev-parse --short HEAD 2>/dev/null || true)"
if [ -z "${VERSION_ATTENDUE}" ] || [ -z "${COMMIT_ATTENDU}" ]; then
  echo -e "${RED}  ❌ Version (fichier VERSION) ou commit Git introuvable : impossible de vérifier ce qui sera livré.${NC}"
  exit 1
fi
if [ -n "$(git -C "$LOCAL_ROOT" status --porcelain 2>/dev/null)" ]; then
  echo -e "${YELLOW}  ⚠️  Fichiers non commités : le build portera le commit ${COMMIT_ATTENDU}-modifié.${NC}"
fi
echo -e "  Version à livrer : ${VERSION_ATTENDUE} (commit ${COMMIT_ATTENDU})"
echo ""

# ── 1. Build local ────────────────────────────────────────────────────────────
echo -e "${YELLOW}[1/5] Build Next.js en cours...${NC}"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh" && nvm use "$(cat "$LOCAL_ROOT/.nvmrc")" --silent 2>/dev/null || true

cd "$ADMIN_DIR"
NEXT_BIN="node_modules/.bin/next"
[ -f "$NEXT_BIN" ] || NEXT_BIN="$LOCAL_ROOT/node_modules/.bin/next"
# Node du PATH (celui que nvm vient de sélectionner), plus /usr/local/bin/node
# en dur : sur ce poste c'est un Node 18, que Next 16 refuse (>= 20.9 requis).
# Le contrôle de version donne un message clair au lieu d'un build en échec.
NODE_BIN="$(command -v node || true)"
if [ -z "${NODE_BIN}" ]; then
  echo -e "${RED}  ❌ node introuvable dans le PATH — build impossible.${NC}"
  exit 1
fi
# Le build se fait avec la branche majeure de Node fixée dans .nvmrc, la même
# que celle du serveur (contrôlée au pré-contrôle « Node du VPS »).
if [ "$("${NODE_BIN}" -p 'process.versions.node.split(".")[0]')" != "${NODE_MAJEUR}" ]; then
  echo -e "${RED}  ❌ Node $("${NODE_BIN}" -v) (${NODE_BIN}) : le build doit utiliser Node ${NODE_MAJEUR} (.nvmrc). nvm install ${NODE_MAJEUR} && nvm use ${NODE_MAJEUR}, puis relancer.${NC}"
  exit 1
fi
"${NODE_BIN}" "$NEXT_BIN" build

echo -e "${GREEN}    ✅ Build terminé${NC}"

# ── Copier nodemailer dans le standalone (non inclus automatiquement) ─────────
echo -e "${YELLOW}  → Copie de nodemailer dans le standalone...${NC}"
mkdir -p "$ADMIN_DIR/.next/standalone/node_modules"
# nodemailer peut être dans node_modules local ou à la racine du monorepo
NODEMAILER_SRC=""
[ -d "$ADMIN_DIR/node_modules/nodemailer" ] && NODEMAILER_SRC="$ADMIN_DIR/node_modules/nodemailer"
[ -z "$NODEMAILER_SRC" ] && [ -d "$LOCAL_ROOT/node_modules/nodemailer" ] && NODEMAILER_SRC="$LOCAL_ROOT/node_modules/nodemailer"
if [ -n "$NODEMAILER_SRC" ]; then
  cp -r "$NODEMAILER_SRC" "$ADMIN_DIR/.next/standalone/node_modules/nodemailer"
  echo -e "${GREEN}  ✅ nodemailer inclus${NC}"
else
  echo -e "${RED}  ⚠️  nodemailer introuvable — emails désactivés${NC}"
fi
echo ""

# ── 2. Préparer l'archive ─────────────────────────────────────────────────────
echo -e "${YELLOW}[2/5] Préparation du paquet de déploiement...${NC}"
cd "$ADMIN_DIR"

# Copier le dossier public/ dans le standalone (Next.js ne le fait pas automatiquement)
if [ -d "$ADMIN_DIR/public" ]; then
  cp -r "$ADMIN_DIR/public" "$ADMIN_DIR/.next/standalone/public"
  # server.js tourne depuis apps/admin et Nginx sert les images depuis
  # apps/admin/public : sans cette seconde copie, un fichier ajouté à public/
  # n'arrivait jamais à l'endroit où il est réellement servi.
  mkdir -p "$ADMIN_DIR/.next/standalone/apps/admin"
  rm -rf "$ADMIN_DIR/.next/standalone/apps/admin/public"
  cp -r "$ADMIN_DIR/public" "$ADMIN_DIR/.next/standalone/apps/admin/public"
  echo -e "${GREEN}  ✅ Dossier public/ inclus dans le standalone${NC}"
fi

# Créer une archive complète du standalone
# On exclut src/data pour ne JAMAIS écraser les données de production
tar -czf /tmp/pj-admin-deploy.tar.gz \
  --exclude="*.log" \
  --exclude=".DS_Store" \
  --exclude="apps/admin/src/data" \
  -C .next/standalone .

# Ajouter les fichiers statiques et public séparément
tar -czf /tmp/pj-admin-static.tar.gz \
  -C .next static

# Ajouter les données JSON (si le dossier existe)
if [ -d "src/data" ]; then
  tar -czf /tmp/pj-admin-data.tar.gz -C src data
fi

echo -e "${GREEN}    ✅ Paquets prêts${NC}"
echo ""

# ── 3. Préparer le VPS ───────────────────────────────────────────────────────
echo -e "${YELLOW}[3/5] Configuration du VPS...${NC}"
ssh $SSH_OPTS $VPS_USER@$VPS_IP "bash -s" << 'REMOTE'
set -e

# Node n'est JAMAIS installé ni mis à jour ici : changer de runtime pendant une
# livraison ferait tourner le retour arrière sur une combinaison jamais
# essayée. La branche de Node du serveur est vérifiée au pré-contrôle et se
# change par scripts/mettre-a-jour-node.sh (PROCEDURE-NODE.md).

# Installer PM2 si absent
if ! command -v pm2 &>/dev/null; then
  echo "Installation de PM2..."
  npm install -g pm2
fi

# Créer les répertoires nécessaires. /opt/pole-jeunesse-admin n'est PAS créé
# ici : c'est le lien vers la version en service, géré par deploy-release.sh.
mkdir -p /opt/backups/pj-db
mkdir -p /opt/scripts

# ── Script de sauvegarde DB ────────────────────────────────────────────────────
cat > /opt/scripts/backup-db.sh << 'BACKUP_SCRIPT'
#!/bin/bash
# Sauvegarde PostgreSQL ET données sur disque — Pôle Jeunesse
#
# Deux archives par passage, dans le même répertoire :
#   pj-AAAAMMJJ-HHMMSS.sql.gz        dump de la base
#   pj-data-AAAAMMJJ-HHMMSS.tar.gz   fichiers écrits sur disque par l'application
#                                    (/opt/pj-shared/data : archives CAF…)
# Jusqu'au 2026-10-07 seule la base était sauvegardée : les archives CAF
# n'existaient qu'en un exemplaire, sur le disque du serveur.
#
# Les chemins se surchargent par variables d'environnement pour les tests
# locaux (scripts/test-backup-db.sh) ; en production les valeurs par défaut
# s'appliquent.
# pipefail est ESSENTIEL : sans lui, l'échec de pg_dump dans le pipe est masqué
# par le code de retour de gzip (toujours 0), ce qui produisait une archive vide
# journalisée « OK », puis la purge supprimait les sauvegardes saines.
set -euo pipefail

LOG="${PJ_BACKUP_LOG:-/var/log/pj-backup.log}"
BACKUP_DIR="${PJ_BACKUP_DIR:-/opt/backups/pj-db}"
MIN_SIZE="${PJ_BACKUP_MIN_SIZE:-100000}"
SECRETS="${PJ_SECRETS:-/opt/pj-secrets.env}"
DATA_DIR="${PJ_DATA_DIR:-/opt/pj-shared/data}"

log() { echo "$(date '+%Y-%m-%d %H:%M') — $*" >> "$LOG"; }

# Signale l'échec au journal de monitoring de l'application (page Monitoring),
# en plus du courriel ci-dessous. Sans secret configuré, ou si l'application
# est arrêtée, cet appel ne fait rien : le courriel reste le canal de secours.
signaler_monitoring() {
  local secret
  secret=$(grep '^INTERNAL_MONITORING_SECRET=' "$SECRETS" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  [ -n "${secret}" ] || return 0
  python3 - "$1" "$2" << 'PYJSON' | curl -s -m 10 -o /dev/null -X POST http://127.0.0.1:3000/api/monitoring/internal-report -H "X-Internal-Secret: ${secret}" -H 'Content-Type: application/json' --data-binary @- || true
import json, sys
print(json.dumps({"type": sys.argv[1], "message": sys.argv[2]}))
PYJSON
}

alerte() {
  log "ÉCHEC — $1"
  signaler_monitoring "Sauvegarde de la base en échec" "$1"
  if command -v msmtp &>/dev/null && [ -f /etc/msmtprc ]; then
    DEST=$(grep '^MAIL_ADMIN=' /opt/pj-smtp.env 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'")
    EXP=$(grep -E '^(MAIL_FROM|SMTP_USER)=' /opt/pj-smtp.env 2>/dev/null | sort | head -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'")
    if [ -z "$DEST" ]; then
      log "MAIL_ADMIN absent de /opt/pj-smtp.env : alerte non envoyée par courriel"
    else
    {
      echo "To: $DEST"
      echo "From: ${EXP:-$DEST}"
      echo "Subject: [ALERTE] Pole Jeunesse — sauvegarde BDD en echec"
      echo ""
      echo "La sauvegarde de la base a echoue : $1"
      echo "Heure : $(date '+%d/%m/%Y %H:%M')"
      echo ""
      echo "Les sauvegardes existantes N'ONT PAS ete purgees."
    } | msmtp "$DEST" 2>> "$LOG" || true
    fi
  fi
  exit 1
}

if [ -f "$SECRETS" ]; then
  DB_URL=$(grep '^DATABASE_URL=' "$SECRETS" | cut -d= -f2- | tr -d '"' | tr -d "'")
fi
DB_URL="${DB_URL:-postgresql://pj_admin@localhost:5432/pole_jeunesse}"

STAMP="$(date +%Y%m%d-%H%M%S)"
FILENAME="pj-$STAMP.sql.gz"
TMP="$BACKUP_DIR/.tmp-$FILENAME"

pg_dump "$DB_URL" | gzip > "$TMP" || { rm -f "$TMP"; alerte 'pg_dump ou gzip a echoue'; }

SIZE_BYTES=$(wc -c < "$TMP" 2>/dev/null | tr -d ' ' || echo 0)
[ "$SIZE_BYTES" -gt "$MIN_SIZE" ] || { rm -f "$TMP"; alerte "archive trop petite (${SIZE_BYTES} octets)"; }
gunzip -t "$TMP" 2>/dev/null || { rm -f "$TMP"; alerte 'archive gzip corrompue'; }

mv "$TMP" "$BACKUP_DIR/$FILENAME"
SIZE=$(du -sh "$BACKUP_DIR/$FILENAME" | cut -f1)
log "OK — $FILENAME ($SIZE)"

# ── Données sur disque de l'application ──────────────────────────────────────
# Le dump ci-dessus est déjà en place : un échec ici alerte et s'arrête AVANT
# la purge, sans rien retirer des sauvegardes existantes.
DATA_FILE="pj-data-$STAMP.tar.gz"
if [ -d "$DATA_DIR" ] && [ -n "$(find "$DATA_DIR" -type f -print -quit 2>/dev/null)" ]; then
  DATA_TMP="$BACKUP_DIR/.tmp-$DATA_FILE"
  ERR_TAR="$BACKUP_DIR/.tmp-tar-$STAMP.err"
  # Un répertoire illisible ferait compter (et archiver) moins de fichiers
  # qu'il n'y en a, sans que rien ne le montre : c'est un échec.
  N_SOURCE=$(find "$DATA_DIR" -type f 2>>"$LOG" | wc -l | tr -d ' ') \
    || alerte 'donnees sur disque illisibles en partie (find en erreur) : aucune archive faite'
  # Lisible par root seul : ces fichiers contiennent des données personnelles.
  CODE_TAR=0
  ( umask 077; tar -czf "$DATA_TMP" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")" ) 2>"$ERR_TAR" || CODE_TAR=$?
  cat "$ERR_TAR" >> "$LOG" 2>/dev/null || true
  # Seul écart toléré : code 1 parce qu'un fichier a changé pendant la lecture
  # (l'application peut écrire à cet instant). L'archive reste utilisable et
  # elle est contrôlée ci-dessous. Tout autre code ou message est un échec.
  if [ "$CODE_TAR" -eq 1 ] && [ -s "$ERR_TAR" ] && ! grep -qv 'changed as we read it' "$ERR_TAR"; then
    CODE_TAR=0
  fi
  rm -f "$ERR_TAR"
  [ "$CODE_TAR" -eq 0 ] || { rm -f "$DATA_TMP"; alerte "archive des donnees sur disque en echec (tar code $CODE_TAR)"; }
  N_ARCHIVE=$(tar -tzf "$DATA_TMP" 2>/dev/null | grep -vc '/$' || true)
  [ "${N_ARCHIVE:-0}" -ge 1 ] && [ "${N_ARCHIVE:-0}" -ge "$N_SOURCE" ] \
    || { rm -f "$DATA_TMP"; alerte "archive des donnees sur disque incomplete (${N_ARCHIVE:-0} fichier(s) archives pour $N_SOURCE sur disque)"; }
  chmod 600 "$DATA_TMP"
  mv "$DATA_TMP" "$BACKUP_DIR/$DATA_FILE"
  log "OK — $DATA_FILE ($N_ARCHIVE fichier(s), $(du -sh "$BACKUP_DIR/$DATA_FILE" | cut -f1))"
else
  log "donnees sur disque : rien a archiver ($DATA_DIR absent ou vide)"
fi

# Purge UNIQUEMENT apres un dump valide et une archive de donnees aboutie
find "$BACKUP_DIR" -name '*.sql.gz' -mtime +7 -delete
find "$BACKUP_DIR" -name 'pj-data-*.tar.gz' -mtime +7 -delete
COUNT=$(ls -1 "$BACKUP_DIR"/*.sql.gz 2>/dev/null | wc -l | tr -d ' ')
COUNT_DATA=$(ls -1 "$BACKUP_DIR"/pj-data-*.tar.gz 2>/dev/null | wc -l | tr -d ' ')
log "$COUNT sauvegarde(s) de base et $COUNT_DATA archive(s) de donnees conservee(s)"
BACKUP_SCRIPT
chmod +x /opt/scripts/backup-db.sh

# ── Script de monitoring ───────────────────────────────────────────────────────
cat > /opt/scripts/check-health.sh << 'MONITOR_SCRIPT'
#!/bin/bash
LOG=/var/log/pj-health.log
# Adresse publique lue à chaque passage (APP_BASE_URL de /opt/pj-secrets.env).
BASE=$(sed -n 's/^APP_BASE_URL=//p' /opt/pj-secrets.env 2>/dev/null | tail -n 1 | tr -d "\"'\r")
if [ -z "$BASE" ]; then
  echo "$(date '+%Y-%m-%d %H:%M') — APP_BASE_URL absente de /opt/pj-secrets.env : contrôle impossible" >> "$LOG"
  exit 1
fi
URL="${BASE}/api/health"
COOLDOWN_FILE=/tmp/pj-alert-sent

# Vérifier l'état
HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 10 "$URL" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
  # App up : supprimer le cooldown si présent (prêt pour alerter à nouveau)
  rm -f "$COOLDOWN_FILE"
  exit 0
fi

# App down
echo "$(date '+%Y-%m-%d %H:%M') — ALERTE HTTP $HTTP_CODE" >> "$LOG"

# Anti-spam : une seule alerte toutes les 30 min
if [ -f "$COOLDOWN_FILE" ]; then
  LAST=$(cat "$COOLDOWN_FILE")
  NOW=$(date +%s)
  if [ $((NOW - LAST)) -lt 1800 ]; then exit 0; fi
fi
date +%s > "$COOLDOWN_FILE"

# Envoyer alerte email via msmtp (si disponible)
if command -v msmtp &>/dev/null && [ -f /etc/msmtprc ]; then
  MAIL_DEST=$(grep '^MAIL_ADMIN=' /opt/pj-smtp.env 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'")
  EXP=$(grep -E '^(MAIL_FROM|SMTP_USER)=' /opt/pj-smtp.env 2>/dev/null | sort | head -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  if [ -z "$MAIL_DEST" ]; then
    echo "$(date '+%Y-%m-%d %H:%M') — MAIL_ADMIN absent de /opt/pj-smtp.env : alerte non envoyée par courriel" >> "$LOG"
  else
  {
    echo "To: $MAIL_DEST"
    echo "From: ${EXP:-$MAIL_DEST}"
    echo "Subject: [ALERTE] Pôle Jeunesse — App inaccessible (HTTP $HTTP_CODE)"
    echo ""
    echo "Le serveur Pôle Jeunesse ne répond pas."
    echo "URL: $URL"
    echo "Code HTTP: $HTTP_CODE"
    echo "Heure: $(date '+%d/%m/%Y %H:%M')"
    echo ""
    echo "Vérifiez sur le serveur : pm2 status"
  } | msmtp "$MAIL_DEST" 2>> "$LOG" || true
  fi
fi
MONITOR_SCRIPT
chmod +x /opt/scripts/check-health.sh

# ── Script de surveillance de la copie NAS ────────────────────────────────────
# L'acces au module rsync pj-backups est restreint a la plage IP de la box.
# Celle-ci etant dynamique, un changement hors plage couperait la copie
# hors-site SANS SIGNAL. Ce controle transforme la panne silencieuse en alerte.
cat > /opt/scripts/check-nas-pull.sh << 'NAS_SCRIPT'
#!/bin/bash
set -uo pipefail
LOG=/var/log/pj-nas-pull.log
RSYNCD_LOG=/var/log/rsyncd.log
SEUIL_HEURES=36
COOLDOWN=/tmp/pj-nas-alert-sent

log() { echo "$(date '+%Y-%m-%d %H:%M') — $*" >> "$LOG"; }
[ -f "$RSYNCD_LOG" ] || { log 'rsyncd.log introuvable'; exit 1; }

DERNIER=$(grep 'rsync on pj-backups' "$RSYNCD_LOG" 2>/dev/null | tail -1 | awk '{print $1" "$2}')
if [ -z "$DERNIER" ]; then
  MSG='aucun pull du NAS trouve dans le journal'
else
  TS=$(date -d "$(echo "$DERNIER" | tr '/' '-')" +%s 2>/dev/null || echo 0)
  HEURES=$(( ($(date +%s) - TS) / 3600 ))
  if [ "$HEURES" -le "$SEUIL_HEURES" ]; then
    log "OK — dernier pull il y a ${HEURES}h"; rm -f "$COOLDOWN"; exit 0
  fi
  MSG="aucun pull du NAS depuis ${HEURES}h (dernier : $DERNIER)"
fi

log "ALERTE — $MSG"
if [ -f "$COOLDOWN" ]; then
  LAST=$(cat "$COOLDOWN"); [ $(( $(date +%s) - LAST )) -lt 86400 ] && exit 0
fi
date +%s > "$COOLDOWN"

# Même signalement que la sauvegarde : journal de monitoring de l'application,
# en plus du courriel (sans effet si le secret n'est pas configuré).
MON_SECRET=$(grep '^INTERNAL_MONITORING_SECRET=' /opt/pj-secrets.env 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'")
if [ -n "${MON_SECRET}" ]; then
  python3 - "$MSG" << 'PYJSON' | curl -s -m 10 -o /dev/null -X POST http://127.0.0.1:3000/api/monitoring/internal-report -H "X-Internal-Secret: ${MON_SECRET}" -H 'Content-Type: application/json' --data-binary @- || true
import json, sys
print(json.dumps({"type": "Copie NAS interrompue", "message": sys.argv[1]}))
PYJSON
fi

if command -v msmtp &>/dev/null && [ -f /etc/msmtprc ]; then
  DEST=$(grep '^MAIL_ADMIN=' /opt/pj-smtp.env 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'")
  EXP=$(grep -E '^(MAIL_FROM|SMTP_USER)=' /opt/pj-smtp.env 2>/dev/null | sort | head -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  if [ -z "$DEST" ]; then
    log 'MAIL_ADMIN absent de /opt/pj-smtp.env : alerte non envoyée par courriel'
  else
  {
    echo "To: $DEST"
    echo "From: ${EXP:-$DEST}"
    echo 'Subject: [ALERTE] Sauvegarde NAS interrompue'
    echo ''
    echo "La copie hors-site ne se fait plus : $MSG"
    echo ''
    echo 'Cause probable : l IP publique de la box a change et n est plus'
    echo 'dans la plage autorisee (hosts allow) du module rsync pj-backups.'
    echo 'Ajuster /etc/rsyncd.conf puis : systemctl restart rsync'
  } | msmtp "$DEST" 2>> "$LOG" || true
  fi
fi
NAS_SCRIPT
chmod +x /opt/scripts/check-nas-pull.sh

# ── Configurer msmtp pour les alertes email ────────────────────────────────────
if [ -f /opt/pj-smtp.env ]; then
  python3 - << 'MSMTP_PY'
import os, re
try:
    env = {}
    with open('/opt/pj-smtp.env', 'r') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line: continue
            k, _, v = line.partition('=')
            env[k.strip()] = v.strip().strip('"').strip("'")
    if not env.get('SMTP_HOST'): raise ValueError('SMTP_HOST manquant')
    tls_starttls = 'on' if env.get('SMTP_SECURE', 'false').lower() != 'true' else 'off'
    tls_on = 'on' if env.get('SMTP_SECURE', 'false').lower() == 'true' else 'off'
    # La directive `from` de msmtp attend une ADRESSE NUE. MAIL_FROM est au
    # format d'affichage ("Pôle Jeunesse Nogent <x@y.fr>") : le passer tel quel
    # faisait rejeter TOUS les envois par le serveur SMTP (501), donc toutes les
    # alertes de supervision échouaient silencieusement. Le nom d'affichage doit
    # figurer dans l'en-tête From: du message, pas dans l'enveloppe SMTP.
    import re as _re
    _mail_from = env.get('MAIL_FROM', '') or env.get('SMTP_USER', '')
    _m = _re.search(r'<([^>]+)>', _mail_from)
    envelope_from = _m.group(1) if _m else _mail_from.strip()
    cfg = f"""account default
host {env.get('SMTP_HOST', 'smtp.gmail.com')}
port {env.get('SMTP_PORT', '587')}
tls {tls_on}
tls_starttls {tls_starttls}
auth on
user {env.get('SMTP_USER', '')}
password {env.get('SMTP_PASS', '')}
from {envelope_from}
logfile /var/log/msmtp.log
"""
    with open('/etc/msmtprc', 'w') as f: f.write(cfg)
    os.chmod('/etc/msmtprc', 0o600)
    print('  📧 msmtp configuré')
except Exception as e:
    print(f'  ⚠️  msmtp non configuré : {e}')
MSMTP_PY
  # Installer msmtp si absent
  if ! command -v msmtp &>/dev/null; then
    apt-get install -y msmtp -qq 2>/dev/null && echo '  📦 msmtp installé' || true
  fi
fi

# ── Enregistrer les cron jobs ─────────────────────────────────────────────────
# Backup DB à 2h chaque nuit
(crontab -l 2>/dev/null | grep -v 'backup-db.sh'; echo "0 2 * * * /opt/scripts/backup-db.sh") | crontab -
# Health check toutes les 5 minutes
(crontab -l 2>/dev/null | grep -v 'check-health.sh'; echo "*/5 * * * * /opt/scripts/check-health.sh") | crontab -
# Controle quotidien de la copie NAS (apres le pull de 1h)
(crontab -l 2>/dev/null | grep -v 'check-nas-pull.sh'; echo "30 9 * * * /opt/scripts/check-nas-pull.sh") | crontab -
echo "  ⏰ Cron jobs configurés (backup 2h, monitoring /5min)"

echo "VPS prêt."
REMOTE

echo -e "${GREEN}    ✅ VPS configuré${NC}"
echo ""

# ── 4. Uploader les fichiers ──────────────────────────────────────────────────
echo -e "${YELLOW}[4/5] Upload vers le VPS...${NC}"

# Envoi d'une archive, capable de REPRENDRE après une coupure.
# Le 2026-10-07, l'envoi de l'archive principale (18 Mo) par scp a été coupé
# en route à chaque tentative (« ssh_packet_write_poll: Result too large », un
# travers connu du client SSH de macOS), et chaque relance repartait de zéro.
# rsync --partial reprend là où l'envoi s'est arrêté ; les tentatives sont
# espacées pour ne pas multiplier les connexions. L'empreinte du fichier reçu
# est comparée à celle du fichier local : une archive tronquée ne passe pas.
# Un échec ici survient AVANT toute installation : le site n'est pas touché.
empreinte_locale() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1; else sha256sum "$1" | cut -d' ' -f1; fi
}
envoyer() {  # envoyer <fichier local> → /tmp/<même nom> sur le VPS
  local fichier="$1" nom tentative=1 attendue recue
  nom="$(basename "${fichier}")"
  attendue="$(empreinte_locale "${fichier}")"
  while [ "${tentative}" -le 6 ]; do
    if command -v rsync >/dev/null 2>&1; then
      rsync --partial --inplace -e "ssh $SSH_OPTS -o ServerAliveInterval=5 -o ServerAliveCountMax=3" "${fichier}" "$VPS_USER@$VPS_IP:/tmp/${nom}" 2>/dev/null || true
    else
      scp $SSH_OPTS "${fichier}" "$VPS_USER@$VPS_IP:/tmp/" 2>/dev/null || true
    fi
    recue="$(ssh $SSH_OPTS $VPS_USER@$VPS_IP "sha256sum /tmp/${nom} 2>/dev/null | cut -d' ' -f1" 2>/dev/null || true)"
    if [ -n "${attendue}" ] && [ "${recue}" = "${attendue}" ]; then
      echo "    ✓ ${nom} envoyé et vérifié"
      return 0
    fi
    echo -e "${YELLOW}    … ${nom} : envoi interrompu (tentative ${tentative}/6), reprise dans 8 s${NC}"
    tentative=$((tentative + 1))
    sleep 8
  done
  echo -e "${RED}  ❌ ${nom} n'a pas pu être envoyé intact après 6 tentatives.${NC}"
  echo "     Rien n'a été installé : la version en service n'est pas touchée. Vérifier la connexion, puis relancer."
  return 1
}

# Upload standalone app
envoyer /tmp/pj-admin-deploy.tar.gz
envoyer /tmp/pj-admin-static.tar.gz

# Upload données JSON seulement si le fichier n'existe pas sur le VPS
if [ -f /tmp/pj-admin-data.tar.gz ]; then
  envoyer /tmp/pj-admin-data.tar.gz
fi

echo -e "${GREEN}    ✅ Upload terminé${NC}"

# ── Upload configuration SMTP ──────────────────────────────────────────────────
if [ -f "$ADMIN_DIR/.env.local" ]; then
  echo -e "${YELLOW}  → Upload configuration SMTP...${NC}"
  scp $SSH_OPTS "$ADMIN_DIR/.env.local" $VPS_USER@$VPS_IP:/opt/pj-smtp.env
  ssh $SSH_OPTS $VPS_USER@$VPS_IP "chmod 600 /opt/pj-smtp.env"
  echo -e "${GREEN}  ✅ Secrets SMTP uploadés${NC}"
fi
echo ""

# ── Créer/s'assurer que le fichier secrets existe sur le VPS ──────────────────
# DATABASE_URL est stockée dans /opt/pj-secrets.env (jamais dans le code)
# ⚠️ Aucun secret n'est écrit en dur ici. Le fichier /opt/pj-secrets.env doit être
# créé manuellement sur le VPS (chmod 600) avec au minimum :
#   DATABASE_URL=postgresql://<user>:<password>@localhost:5432/<base>
#   JWT_SECRET=<chaîne aléatoire longue>
#   APP_BASE_URL=https://<adresse du site>   (sans « / » final)
# et, si la DSI fournit le certificat (sinon Let's Encrypt) :
#   SSL_CERTIFICAT=/chemin/fullchain.pem  SSL_CLE=/chemin/privkey.pem
#   IDFM_API_KEY=<clé API IDFM>
# Second passage juste avant l'extraction et le redémarrage : le fichier a pu
# être modifié pendant le build, et c'est la dernière étape sans effet sur le VPS.
if ! check_vps_secrets; then
  echo -e "${RED}  ❌ DÉPLOIEMENT ANNULÉ — secrets invalides (aucune extraction ni redémarrage effectués)${NC}"
  exit 1
fi
if ! check_vps_schema; then
  echo -e "${RED}  ❌ DÉPLOIEMENT ANNULÉ — schéma incompatible (aucune extraction ni redémarrage effectués)${NC}"
  exit 1
fi

# ── 5. Déployer sur le VPS ────────────────────────────────────────────────────
echo -e "${YELLOW}[5/5] Déploiement et démarrage...${NC}"
# L'installation sur le serveur est faite par scripts/deploy-release.sh, exécuté
# là-bas : la nouvelle version est préparée dans un répertoire distinct,
# vérifiée (santé + version + commit attendus), et le script revient seul à la
# version précédente si elle ne répond pas (audit du 2026-10-07, constat A6).
set +e
ssh $SSH_OPTS $VPS_USER@$VPS_IP "bash -s -- ${VERSION_ATTENDUE} ${COMMIT_ATTENDU}" < "$LOCAL_ROOT/scripts/deploy-release.sh"
CODE_RELEASE=$?
set -e
case "${CODE_RELEASE}" in
  0) ;;
  1)
    echo -e "${RED}╔══════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║   ❌ DÉPLOIEMENT ANNULÉ avant toute bascule  ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════╝${NC}"
    echo "  La version en service n'a pas été touchée."
    exit 1 ;;
  2)
    echo -e "${RED}╔══════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║   ❌ VERSION DÉFAILLANTE — retour arrière OK ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════╝${NC}"
    echo "  La version ${VERSION_ATTENDUE} n'a pas démarré correctement ; la version précédente est de nouveau en service."
    echo "  Ne pas taguer ${VERSION_ATTENDUE}. Corriger, puis relancer le déploiement."
    exit 1 ;;
  *)
    echo -e "${RED}╔══════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║   🚨 SITE À VÉRIFIER — intervention requise  ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════╝${NC}"
    echo "  La nouvelle version n'a pas été confirmée et le retour arrière n'a pas pu l'être non plus (code ${CODE_RELEASE})."
    echo "  Aucune version n'a été renommée ni supprimée ; le message ci-dessus dit laquelle répond réellement."
    echo "  Vérifier tout de suite : ssh ${VPS_USER}@${VPS_IP} 'pm2 status ; ls -l /opt/pole-jeunesse-admin /opt/pj-releases'"
    echo "  Procédure manuelle : README, section « Retour arrière »."
    exit 1 ;;
esac

ssh $SSH_OPTS $VPS_USER@$VPS_IP "bash -s" << 'REMOTE'
set -e

# Redémarrage automatique de PM2 au démarrage du serveur
pm2 startup systemd -u root --hp /root 2>/dev/null | tail -1 | bash 2>/dev/null || true

# Configurer Nginx — conserver la config SSL si elle existe déjà
if command -v nginx &>/dev/null; then
  # Domaine du site, tiré de APP_BASE_URL (déjà validée par check-deploy-secrets.sh ;
  # revalidée ici car il est injecté dans la configuration Nginx).
  APP_BASE_URL=$(sed -n 's/^APP_BASE_URL=//p' /opt/pj-secrets.env | tail -n 1 | tr -d "\"'\r")
  DOMAINE="${APP_BASE_URL#https://}"
  if ! [[ "$DOMAINE" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
    echo "APP_BASE_URL invalide dans /opt/pj-secrets.env : configuration Nginx non modifiée" >&2
    exit 1
  fi
  # Certificat : celui fourni par la mairie si SSL_CERTIFICAT et SSL_CLE sont
  # renseignés dans /opt/pj-secrets.env (chemins absolus, contrôlés par
  # check-deploy-secrets.sh), sinon celui de Let's Encrypt pour le domaine.
  SSL_CERTIFICAT=$(sed -n 's/^SSL_CERTIFICAT=//p' /opt/pj-secrets.env | tail -n 1 | tr -d "\"'\r")
  SSL_CLE=$(sed -n 's/^SSL_CLE=//p' /opt/pj-secrets.env | tail -n 1 | tr -d "\"'\r")
  if [ -n "$SSL_CERTIFICAT" ] || [ -n "$SSL_CLE" ]; then
    for chemin in "$SSL_CERTIFICAT" "$SSL_CLE"; do
      if ! [[ "$chemin" =~ ^/[A-Za-z0-9._/-]+$ ]] || [ ! -r "$chemin" ]; then
        echo "SSL_CERTIFICAT / SSL_CLE invalides ou illisibles : configuration Nginx non modifiée" >&2
        exit 1
      fi
    done
    ORIGINE_CERT="certificat fourni"
  else
    SSL_CERTIFICAT="/etc/letsencrypt/live/$DOMAINE/fullchain.pem"
    SSL_CLE="/etc/letsencrypt/live/$DOMAINE/privkey.pem"
    ORIGINE_CERT="Let's Encrypt"
  fi
  # Options TLS de certbot si elles existent, sinon réglages équivalents.
  if [ -f /etc/letsencrypt/options-ssl-nginx.conf ] && [ -f /etc/letsencrypt/ssl-dhparams.pem ]; then
    MARQUE_RETIREE="__TLS_INTEGRE__"; MARQUE_GARDEE="__TLS_CERTBOT__"
  else
    MARQUE_RETIREE="__TLS_CERTBOT__"; MARQUE_GARDEE="__TLS_INTEGRE__"
  fi
  CONF=/etc/nginx/sites-available/pole-jeunesse
  # Copie de la configuration en place : rétablie si la nouvelle est refusée par nginx -t.
  [ -f "$CONF" ] && cp -p "$CONF" "$CONF.precedente"
  # Ne réécrire la config QUE si le certificat existe
  if [ -f "$SSL_CERTIFICAT" ]; then
    cat > /etc/nginx/sites-available/pole-jeunesse << 'NGINX_EOF'
# HTTP — tout redirect vers https://__DOMAINE__ (y compris accès par IP)
server {
    listen 80 default_server;
    server_name _;
    return 301 https://__DOMAINE__$request_uri;
}

# HTTPS — catch-all : redirige les accès par IP vers le domaine
server {
    listen 443 ssl http2 default_server;
    server_name _;

    ssl_certificate __CERTIFICAT__;
    ssl_certificate_key __CLE__;
    include /etc/letsencrypt/options-ssl-nginx.conf; # __TLS_CERTBOT__
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # __TLS_CERTBOT__
    ssl_protocols TLSv1.2 TLSv1.3; # __TLS_INTEGRE__
    ssl_prefer_server_ciphers off; # __TLS_INTEGRE__
    ssl_session_cache shared:pj_ssl:10m; # __TLS_INTEGRE__
    ssl_session_timeout 1d; # __TLS_INTEGRE__
    ssl_session_tickets off; # __TLS_INTEGRE__

    return 301 https://__DOMAINE__$request_uri;
}

# HTTPS — domaine principal
server {
    listen 443 ssl http2;
    server_name __DOMAINE__ www.__DOMAINE__;

    ssl_certificate __CERTIFICAT__;
    ssl_certificate_key __CLE__;
    include /etc/letsencrypt/options-ssl-nginx.conf; # __TLS_CERTBOT__
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # __TLS_CERTBOT__
    ssl_protocols TLSv1.2 TLSv1.3; # __TLS_INTEGRE__
    ssl_prefer_server_ciphers off; # __TLS_INTEGRE__
    ssl_session_cache shared:pj_ssl:10m; # __TLS_INTEGRE__
    ssl_session_timeout 1d; # __TLS_INTEGRE__
    ssl_session_tickets off; # __TLS_INTEGRE__

    client_max_body_size 10M;

    # ── Headers de sécurité ───────────────────────────────────────────────────
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=(), payment=()" always;

    # ── Applications tierces hébergées sur ce domaine (ex : LE HUB sous /lehub) ─
    # Chaque app pose son propre fichier dans /etc/nginx/extra-locations/.
    # Ce deploy.sh réécrit le présent fichier à chaque déploiement, MAIS ne touche
    # jamais au contenu de extra-locations/ : les autres apps sont donc protégées.
    # Le joker *.conf est volontaire — nginx tolère qu'aucun fichier ne corresponde.
    include /etc/nginx/extra-locations/*.conf;

    # Servir les fichiers statiques du dossier public/ directement (Next.js standalone ne les sert pas)
    location ~* \.(png|jpg|jpeg|gif|ico|svg|webp|woff|woff2|ttf|eot|otf)$ {
        root /opt/pole-jeunesse-admin/apps/admin/public;
        try_files $uri @nextjs;
        expires 30d;
        add_header Cache-Control "public, max-age=2592000";
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header Origin $http_origin;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header x-middleware-subrequest "";
        proxy_cache_bypass $http_upgrade;
    }

    location @nextjs {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Origin $http_origin;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header x-middleware-subrequest "";
    }
}
NGINX_EOF
    # Le gabarit ci-dessus est entre apostrophes (aucune variable développée,
    # les $uri/$host restent pour Nginx) : on y place le domaine ensuite.
    # « | » comme séparateur : les chemins contiennent des « / » (caractères
    # contrôlés plus haut, aucun « | » possible).
    sed -i -e "s|__DOMAINE__|${DOMAINE}|g" -e "s|__CERTIFICAT__|${SSL_CERTIFICAT}|g" -e "s|__CLE__|${SSL_CLE}|g" \
      -e "/# ${MARQUE_RETIREE}\$/d" -e "s| # ${MARQUE_GARDEE}\$||" "$CONF"
    echo "Config Nginx HTTPS pour ${DOMAINE} (${ORIGINE_CERT}) ✅"
  else
    # Pas de certificat → config HTTP basique (premier déploiement, avant certbot
    # ou avant l'installation du certificat de la mairie)
    cat > /etc/nginx/sites-available/pole-jeunesse << 'NGINX_EOF'
server {
    listen 80;
    server_name _;
    client_max_body_size 10M;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
NGINX_EOF
    echo "Config Nginx HTTP appliquée (SSL non détecté) ✅"
  fi

  ln -sf /etc/nginx/sites-available/pole-jeunesse /etc/nginx/sites-enabled/pole-jeunesse
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  if nginx -t; then
    systemctl reload nginx
    rm -f "$CONF.precedente"
  else
    echo "nginx -t refuse la nouvelle configuration : la précédente est rétablie" >&2
    if [ -f "$CONF.precedente" ]; then mv -f "$CONF.precedente" "$CONF"; else rm -f "$CONF"; fi
    exit 1
  fi
fi

# Nettoyer
rm -f /tmp/pj-admin-deploy.tar.gz /tmp/pj-admin-static.tar.gz /tmp/pj-admin-data.tar.gz

echo ""
echo "=== Status PM2 ==="
pm2 status

REMOTE

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ✅ DÉPLOIEMENT TERMINÉ                     ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
ADRESSE_SITE="$(lire_adresse_vps)"
echo -e "  🌐 Dashboard admin    : ${BLUE}${ADRESSE_SITE}/admin${NC}"
echo -e "  📱 URL animateurs     : ${BLUE}${ADRESSE_SITE}/animateur${NC}"
echo ""

# Nettoyage local
rm -f /tmp/pj-admin-deploy.tar.gz /tmp/pj-admin-static.tar.gz /tmp/pj-admin-data.tar.gz
