#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Pôle Jeunesse — Contrôle du SCHÉMA de la base cible AVANT tout déploiement
#
#  Usage : bash scripts/check-deploy-schema.sh [chemin du fichier secrets]
#          (défaut : /opt/pj-secrets.env — DATABASE_URL y est lue)
#
#  deploy.sh exécute ce script sur le VPS (ssh "bash -s" < ce fichier) avant le
#  moindre transfert et avant tout redémarrage PM2. Le nouveau code LIT des
#  colonnes créées par des migrations appliquées à la main : démarré sur un
#  ancien schéma, il répond 500 à chaque requête authentifiée
#  (animateurs.session_version) et sur les sorties (sorties_participants.ordre).
#
#  Ce script est en LECTURE SEULE : il n'applique aucune migration et n'écrit
#  rien en base (transaction READ ONLY). Il s'arrête en erreur :
#    - code 1 : schéma incompatible → liste des migrations à appliquer ;
#    - code 2 : contrôle impossible (base inaccessible, psql absent, secret
#               manquant) → on ne déploie pas « à l'aveugle ».
#
#  Il n'affiche JAMAIS DATABASE_URL. Compatible Bash 3.2 (macOS) : pas de
#  tableau associatif, interpolations ${VAR} délimitées.
#  Tests locaux : scripts/test-check-deploy-schema.sh (bases jetables).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SECRETS_FILE="${1:-/opt/pj-secrets.env}"
MIGRATIONS_DIR="apps/admin/scripts"

# ── Objets exigés par le code, et migration qui les crée ─────────────────────
# Format : type|table|objet|migration
#   colonne → colonne `objet` de `table` ; table → table `objet` ;
#   index   → index `objet` (schéma public) ;
#   contrainte → contrainte `objet` portée par `table`.
# À compléter à chaque migration dont le code dépend au démarrage.
EXIGENCES='
colonne|animateurs|session_version|migration-securite-2026-10.sql
colonne|animateurs|last_totp_step|migration-securite-2026-10.sql
colonne|animateurs|totp_pending_secret|migration-securite-2026-10.sql
colonne|animateurs|totp_pending_expires_at|migration-securite-2026-10.sql
table||password_reset_tokens|migration-securite-2026-10.sql
index||uq_jeunes_tenant_id|migration-securite-2026-10.sql
index||uq_activites_tenant_id|migration-securite-2026-10.sql
colonne|sorties_participants|ordre|migration-integrite-2026-10.sql
index||uniq_inscriptions_actives|migration-integrite-2026-10.sql
index||uniq_recup_conge|migration-integrite-2026-10.sql
contrainte|sorties_participants|fk_sorties_participants_jeune|migration-participants-fk-2026-10.sql
table||monitoring_events|migration-monitoring-2026-10.sql
table||monitoring_alerts|migration-monitoring-2026-10.sql
table||pij_accueils|migration-pij-2026-10.sql
table||pij_dossiers|migration-pij-2026-10.sql
table||pij_rdv|migration-pij-agenda-2026-10.sql
table||pij_agenda_liens|migration-pij-agenda-2026-10.sql
table||pij_missions|migration-pij-missions-2026-10.sql
colonne|pij_rdv|hub_id|migration-pij-hub-2026-10.sql
index||uq_pij_rdv_hub|migration-pij-hub-2026-10.sql
colonne|jeunes|vaccins|migration-fiche-sante-2026-10.sql
colonne|jeunes|autorisation_mesures_urgence|migration-fiche-sante-2026-10.sql
colonne|jeunes|fiche_sante_nom|migration-fiche-sante-2026-10.sql
colonne|animateurs|rubriques|migration-rubriques-2026-10.sql
colonne|animateurs|gere_droits|migration-rubriques-2026-10.sql
'
# Ordre d'application documenté (SUIVI-AUDIT-2026-10-06.md).
ORDRE_MIGRATIONS="migration-securite-2026-10.sql migration-integrite-2026-10.sql migration-participants-fk-2026-10.sql migration-monitoring-2026-10.sql migration-pij-2026-10.sql migration-pij-agenda-2026-10.sql migration-pij-missions-2026-10.sql migration-pij-hub-2026-10.sql migration-fiche-sante-2026-10.sql migration-rubriques-2026-10.sql"

arret() {
  local code="$1"; shift
  echo "  ❌ $1" >&2
  shift
  while [ "$#" -gt 0 ]; do echo "     $1" >&2; shift; done
  echo "     Déploiement interrompu : rien n'a été transféré ni redémarré." >&2
  exit "${code}"
}

# Même lecture que check-deploy-secrets.sh : dernière occurrence, sans guillemets.
read_secret() {
  local key="$1" line
  line="$(grep -E "^${key}=" "$SECRETS_FILE" | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%$'\r'}"
  line="${line#\"}"; line="${line%\"}"
  line="${line#\'}"; line="${line%\'}"
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  printf '%s' "$line"
}

[ -f "$SECRETS_FILE" ] || arret 2 "${SECRETS_FILE} introuvable : impossible de contrôler le schéma."
DB_URL="$(read_secret DATABASE_URL)"
[ -n "$DB_URL" ] || arret 2 "DATABASE_URL absente ou vide dans ${SECRETS_FILE} : impossible de contrôler le schéma."
command -v psql >/dev/null 2>&1 || arret 2 "psql introuvable sur cette machine : impossible de contrôler le schéma." \
  "Installer le client PostgreSQL (paquet postgresql-client), puis relancer."

# ── Requête unique, en lecture seule : une ligne « type|table|objet » par objet PRÉSENT ─
VALEURS=""
while IFS='|' read -r type table objet migration; do
  [ -n "${type}" ] || continue
  case "${type}:${table}:${objet}" in
    *[!A-Za-z0-9_:]*) arret 2 "Manifeste interne invalide (${type}|${table}|${objet})." ;;
  esac
  [ -z "${VALEURS}" ] || VALEURS="${VALEURS},"
  VALEURS="${VALEURS}('${type}','${table}','${objet}')"
done <<EOF_EXIGENCES
${EXIGENCES}
EOF_EXIGENCES

SQL="BEGIN READ ONLY;
SELECT e.type || '|' || e.tbl || '|' || e.obj
  FROM (VALUES ${VALEURS}) AS e(type, tbl, obj)
 WHERE (e.type = 'colonne' AND EXISTS (
          SELECT 1 FROM information_schema.columns c
           WHERE c.table_schema = 'public' AND c.table_name = e.tbl AND c.column_name = e.obj))
    OR (e.type = 'table' AND EXISTS (
          SELECT 1 FROM information_schema.tables t
           WHERE t.table_schema = 'public' AND t.table_name = e.obj))
    OR (e.type = 'index' AND EXISTS (
          SELECT 1 FROM pg_indexes i
           WHERE i.schemaname = 'public' AND i.indexname = e.obj))
    OR (e.type = 'contrainte' AND EXISTS (
          SELECT 1 FROM pg_constraint k
            JOIN pg_class r ON r.oid = k.conrelid
            JOIN pg_namespace n ON n.oid = r.relnamespace
           WHERE n.nspname = 'public' AND r.relname = e.tbl AND k.conname = e.obj AND k.convalidated));
COMMIT;"

ERREUR_PSQL="$(mktemp)"
trap 'rm -f "${ERREUR_PSQL}"' EXIT
PRESENTS=""
if ! PRESENTS="$(PGCONNECT_TIMEOUT=10 psql "$DB_URL" -X -Atq -v ON_ERROR_STOP=1 -c "$SQL" 2>"${ERREUR_PSQL}")"; then
  # Le message de psql ne contient pas le mot de passe, mais on retire par
  # précaution toute URL de connexion avant de l'afficher.
  DETAIL="$(sed -E 's#[a-z]+://[^[:space:]]*#<url masquée>#g' "${ERREUR_PSQL}" | head -n 3 | tr '\n' ' ')"
  arret 2 "Base de données inaccessible : impossible de contrôler le schéma." \
    "Détail psql : ${DETAIL}" \
    "Vérifier que PostgreSQL est démarré et que DATABASE_URL de ${SECRETS_FILE} est correcte."
fi

# ── Comparaison avec les exigences ───────────────────────────────────────────
MANQUANTS=""
MIGRATIONS_REQUISES=""
while IFS='|' read -r type table objet migration; do
  [ -n "${type}" ] || continue
  if ! printf '%s\n' "${PRESENTS}" | grep -qxF "${type}|${table}|${objet}"; then
    if [ "${type}" = "colonne" ] || [ "${type}" = "contrainte" ]; then
      MANQUANTS="${MANQUANTS}
       - ${type} ${table}.${objet}  (${migration})"
    else
      MANQUANTS="${MANQUANTS}
       - ${type} ${objet}  (${migration})"
    fi
    case " ${MIGRATIONS_REQUISES} " in
      *" ${migration} "*) ;;
      *) MIGRATIONS_REQUISES="${MIGRATIONS_REQUISES} ${migration}" ;;
    esac
  fi
done <<EOF_EXIGENCES
${EXIGENCES}
EOF_EXIGENCES

if [ -n "${MANQUANTS}" ]; then
  echo "  ❌ Schéma de la base incompatible avec cette version de l'application." >&2
  echo "     Objets manquants :${MANQUANTS}" >&2
  echo "     Migrations à appliquer, dans cet ordre, APRÈS sauvegarde de la base :" >&2
  n=0
  for m in ${ORDRE_MIGRATIONS}; do
    case " ${MIGRATIONS_REQUISES} " in
      *" ${m} "*)
        n=$((n + 1))
        echo "       ${n}. psql -v ON_ERROR_STOP=1 -d <base> -f ${MIGRATIONS_DIR}/${m}" >&2
        ;;
    esac
  done
  echo "     (voir SUIVI-AUDIT-2026-10-06.md : la migration sécurité ferme les sessions ouvertes ;" >&2
  echo "      la migration intégrité s'arrête si des inscriptions actives en double existent ;" >&2
  echo "      la migration participants s'arrête si des participations orphelines existent," >&2
  echo "      à diagnostiquer avec ${MIGRATIONS_DIR}/diagnostic-participants-orphelins.sql.)" >&2
  echo "     Déploiement interrompu : rien n'a été transféré ni redémarré." >&2
  exit 1
fi

echo "  🗄  Schéma de la base compatible (migrations 2026-10 présentes)"
