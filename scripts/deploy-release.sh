#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Pôle Jeunesse — Installation d'une version SUR LE SERVEUR, avec retour arrière
#
#  deploy.sh exécute ce script sur le VPS (ssh "bash -s -- …" < ce fichier) une
#  fois les archives transférées. Il remplace l'ancienne étape qui extrayait le
#  nouveau build PAR-DESSUS celui en service (audit du 2026-10-07, constat A6) :
#  seuls quatre dossiers étaient mis de côté, `server.js` et la configuration
#  PM2 étaient écrasés, et un build défaillant laissait le site en panne sans
#  moyen de revenir à la version précédente.
#
#  Principe :
#    1. la nouvelle version est préparée dans un répertoire NEUF, à côté de
#       celle en service, et contrôlée avant toute bascule ;
#    2. sa configuration PM2 est écrite DANS ce répertoire : chaque version
#       conserve la configuration avec laquelle elle a tourné ;
#    3. la bascule est un changement de lien symbolique, suivi du redémarrage ;
#    4. la livraison n'est réussie que si /api/health répond 200 ET annonce la
#       version, le commit et l'identifiant de release attendus ;
#    5. sinon, retour arrière AUTOMATIQUE vers la version précédente (lien,
#       configuration, redémarrage), tenu pour fait seulement si l'application
#       annonce l'identité de cette version précédente ;
#    6. la version précédente complète est conservée après une réussite.
#
#  Une bascule n'est jamais déduite d'un lien déplacé ni d'« une » réponse
#  saine : seul compte ce que l'application annonce (voir « Identité »).
#
#  Arborescence (sous ${PJ_RACINE}, /opt par défaut) :
#    pole-jeunesse-admin        → lien vers la version en service
#    pj-releases/<identifiant>/ version complète + .pj/ecosystem.config.js
#    pj-shared/data/            données sur disque (archives CAF), communes à
#                               toutes les versions
#    pj-ecosystem.config.js     copie de la configuration en service
#
#  Première exécution sur un serveur à l'ancienne disposition (répertoire réel
#  pole-jeunesse-admin) : ce répertoire devient la première « version
#  précédente », complète, avec sa configuration ; rien n'est supprimé.
#
#  Usage : deploy-release.sh <version attendue> <commit attendu>
#          deploy-release.sh --retour-arriere      (retour arrière manuel, voir plus bas)
#  Codes de sortie d'une livraison :
#    0  version en service et vérifiée
#    1  échec AVANT toute bascule : rien n'a changé sur le serveur
#    2  version défaillante, retour arrière VÉRIFIÉ : l'ancienne version est en service
#    3  version défaillante ET retour arrière impossible, en échec ou non
#       confirmé : intervention requise (aucune version n'a été renommée)
#
#  Variables d'environnement (valeurs par défaut = production) — elles servent
#  aux tests locaux (scripts/test-deploy-release.sh), jamais à la production :
#    PJ_RACINE, PJ_TMP, PJ_PORT, PJ_PM2, PJ_SECRETS, PJ_SMTP, PJ_DELAI_SANTE, PJ_DELAI_PM2
#
#  N'affiche jamais un secret. Compatible Bash 3.2 (tests sous macOS).
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

VERSION_ATTENDUE="${1:-}"
COMMIT_ATTENDU="${2:-}"

RACINE="${PJ_RACINE:-/opt}"
TMP_ARCHIVES="${PJ_TMP:-/tmp}"
PORT="${PJ_PORT:-3000}"
PM2="${PJ_PM2:-pm2}"
SECRETS="${PJ_SECRETS:-/opt/pj-secrets.env}"
SMTP="${PJ_SMTP:-/opt/pj-smtp.env}"
DELAI_SANTE="${PJ_DELAI_SANTE:-30}"
DELAI_PM2="${PJ_DELAI_PM2:-60}"

# Chemin RÉEL de la racine. Les versions sont comparées par leur chemin (celle
# en service, la précédente, celles à purger) : si la racine était atteinte par
# un lien symbolique, la version précédente ne serait pas reconnue et serait
# supprimée au ménage.
if [ -d "${RACINE}" ]; then RACINE="$(cd "${RACINE}" && pwd -P)"; fi

APP="${RACINE}/pole-jeunesse-admin"
RELEASES="${RACINE}/pj-releases"
PARTAGE="${RACINE}/pj-shared"
CONFIG_ACTIVE="${RACINE}/pj-ecosystem.config.js"
URL_SANTE="http://127.0.0.1:${PORT}/api/health"
NOM_PM2="pole-jeunesse-admin"

info()  { echo "  $1"; }
alerte() { echo "  ❌ $1" >&2; }

if [ "${1:-}" != "--retour-arriere" ]; then
if [ -z "${VERSION_ATTENDUE}" ] || [ -z "${COMMIT_ATTENDU}" ]; then
  alerte "Usage : deploy-release.sh <version attendue> <commit attendu>"
  exit 1
fi
case "${VERSION_ATTENDUE}${COMMIT_ATTENDU}" in
  *[!A-Za-z0-9._-]*) alerte "Version ou commit attendu au format inattendu."; exit 1 ;;
esac
fi

ARCHIVE_APP="${TMP_ARCHIVES}/pj-admin-deploy.tar.gz"
ARCHIVE_STATIC="${TMP_ARCHIVES}/pj-admin-static.tar.gz"
ARCHIVE_DATA="${TMP_ARCHIVES}/pj-admin-data.tar.gz"

IDENTIFIANT="${VERSION_ATTENDUE}-${COMMIT_ATTENDU}-$(date +%Y%m%d-%H%M%S)"
NOUVELLE="${RELEASES}/${IDENTIFIANT}"
EN_PREPARATION="${NOUVELLE}.preparation"

# ── Outils ───────────────────────────────────────────────────────────────────

# Remplace un lien symbolique de façon atomique (rename(2)) : il n'existe aucun
# instant où le chemin pointe dans le vide.
basculer_lien() {  # basculer_lien <cible> <lien>
  ln -s "$1" "$2.bascule.$$" || return 1
  python3 -c 'import os, sys; os.replace(sys.argv[1], sys.argv[2])' "$2.bascule.$$" "$2" || { rm -f "$2.bascule.$$"; return 1; }
}

# ── Ce que l'application annonce ─────────────────────────────────────────────
# Lit /api/health et renseigne S_OK (1 si l'état est « ok »), S_VERSION,
# S_COMMIT (sans le suffixe « -modifié » d'un build fait avec des fichiers non
# commités) et S_RELEASE (identifiant de release, vide si le build ne l'annonce
# pas). Une réponse absente, en erreur ou illisible donne S_OK=0.
S_OK=0; S_VERSION=""; S_COMMIT=""; S_RELEASE=""
lire_sante() {
  local ligne
  S_OK=0; S_VERSION=""; S_COMMIT=""; S_RELEASE=""
  ligne="$(curl -s -m 5 "${URL_SANTE}" 2>/dev/null | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
if isinstance(d, dict) and d.get("status") == "ok":
    commit = str(d.get("commit") or "")
    if commit.endswith("-modifié"):
        commit = commit[: -len("-modifié")]
    champs = [str(d.get("version") or ""), commit, str(d.get("release") or "")]
    print("|".join(c.replace("|", "").replace("\n", "") for c in champs))
' 2>/dev/null)"
  [ -n "${ligne}" ] || return 0
  S_OK=1
  S_VERSION="${ligne%%|*}"; ligne="${ligne#*|}"
  S_COMMIT="${ligne%%|*}"
  S_RELEASE="${ligne#*|}"
}
decrire_sante() {  # phrase pour les messages
  if [ "${S_OK}" -eq 1 ]; then
    echo "version ${S_VERSION:-?}, commit ${S_COMMIT:-?}${S_RELEASE:+, release ${S_RELEASE}}"
  else
    echo "aucune réponse saine"
  fi
}

# ── Identité de chaque version ───────────────────────────────────────────────
# Un lien correctement déplacé et « une » réponse saine ne prouvent pas une
# bascule : si PM2 ne redémarre rien, c'est l'ANCIEN processus qui répond
# (revue du 2026-10-07, R1). Chaque version porte donc son identité dans
# <version>/.pj/identite, et toute bascule — livraison, retour arrière
# automatique ou manuel, remise en service après échec — n'est tenue pour
# faite que si l'application annonce CETTE identité.
#   version, commit   ce que /api/health doit annoncer
#   release           identifiant de la version (nom de son répertoire)
#   sante_release     1 si ce build annonce son identifiant dans /api/health
#                     (variable PJ_RELEASE_ID de sa configuration PM2) : il est
#                     alors exigé lui aussi, ce qui distingue deux versions
#                     construites depuis le même commit
#   origine           d'où vient cette identité (voir adopter_identite)
ecrire_identite() {  # <répertoire> <version> <commit> <release> <sante_release> <origine>
  mkdir -p "$1/.pj" && chmod 700 "$1/.pj" || return 1
  printf 'version=%s\ncommit=%s\nrelease=%s\nsante_release=%s\norigine=%s\n' "$2" "$3" "$4" "$5" "$6" > "$1/.pj/identite"
}
lire_identite() {  # <répertoire> <champ> → valeur, vide si inconnue
  [ -f "$1/.pj/identite" ] || return 0
  sed -n "s/^$2=//p" "$1/.pj/identite" | head -n 1
}

# Versions déjà présentes sur le serveur SANS identité (installées avant ce
# correctif) : on la reconstitue de la source la plus sûre disponible.
#   1. le nom du répertoire, « <version>-<commit>-<date>-<heure> », que ce
#      script a toujours donné à ses versions ;
#   2. à défaut la version inscrite dans apps/admin/package.json : le commit
#      reste inconnu (« ? ») et ne sera pas exigé — la version, elle, l'est.
# Sans l'une ni l'autre, la version reste sans identité et aucune bascule vers
# elle ne peut être confirmée.
MOTIF_RELEASE='^([0-9]+\.[0-9]+\.[0-9]+)-([0-9a-f]+)-[0-9]{8}-[0-9]{6}$'
adopter_identite() {  # <répertoire>
  local dir="$1" nom version
  [ -f "${dir}/.pj/identite" ] && return 0
  [ -d "${dir}" ] || return 0
  nom="$(basename "${dir}")"; nom="${nom%.echec}"
  if [[ "${nom}" =~ ${MOTIF_RELEASE} ]]; then
    ecrire_identite "${dir}" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${nom}" 0 "nom-du-repertoire"
    return 0
  fi
  version="$(python3 -c '
import json, sys
try:
    print(json.load(open(sys.argv[1])).get("version") or "")
except Exception:
    pass
' "${dir}/apps/admin/package.json" 2>/dev/null)"
  case "${version}" in
    ''|*[!0-9.]*) ;;
    *) ecrire_identite "${dir}" "${version}" "?" "${nom}" 0 "package-json" ;;
  esac
  return 0
}
# La version EN SERVICE au lancement du script : si son identité est absente ou
# son commit inconnu et que l'application répond, on retient ce qu'elle annonce
# — à condition que cela ne contredise pas la version déjà connue.
adopter_identite_servie() {  # <répertoire de la version en service>
  local dir="$1" v c
  [ -d "${dir}" ] || return 0
  adopter_identite "${dir}"
  v="$(lire_identite "${dir}" version)"; c="$(lire_identite "${dir}" commit)"
  if [ -n "${v}" ] && [ "${c}" != "?" ]; then return 0; fi
  lire_sante
  [ "${S_OK}" -eq 1 ] && [ -n "${S_VERSION}" ] && [ -n "${S_COMMIT}" ] || return 0
  if [ -n "${v}" ] && [ "${v}" != "${S_VERSION}" ]; then return 0; fi
  ecrire_identite "${dir}" "${S_VERSION}" "${S_COMMIT}" "$(basename "${dir}")" 0 "sante-constatee"
}
decrire_identite() {  # <répertoire>
  local v c
  v="$(lire_identite "$1" version)"; c="$(lire_identite "$1" commit)"
  if [ -z "${v}" ]; then echo "identité inconnue"; else echo "version ${v}, commit ${c}"; fi
}

# Vrai si ce que l'application vient d'annoncer (lire_sante) est l'identité de
# cette version.
correspond() {  # <répertoire>
  local v c r e
  v="$(lire_identite "$1" version)"; c="$(lire_identite "$1" commit)"
  r="$(lire_identite "$1" release)"; e="$(lire_identite "$1" sante_release)"
  [ "${S_OK}" -eq 1 ] || return 1
  [ -n "${v}" ] && [ "${S_VERSION}" = "${v}" ] || return 1
  if [ "${c}" != "?" ] && [ "${S_COMMIT}" != "${c}" ]; then return 1; fi
  if [ "${e}" = "1" ] && [ "${S_RELEASE}" != "${r}" ]; then return 1; fi
  return 0
}
# Vrai si l'on SAIT distinguer ces deux versions par ce qu'elles annoncent.
# Deux versions de même version et même commit qui n'annoncent pas toutes deux
# leur identifiant sont indiscernables : aucune bascule entre elles ne peut
# être confirmée.
distinguables() {  # <répertoire A> <répertoire B>
  local va vb ca cb
  va="$(lire_identite "$1" version)"; vb="$(lire_identite "$2" version)"
  ca="$(lire_identite "$1" commit)";  cb="$(lire_identite "$2" commit)"
  [ -n "${va}" ] && [ -n "${vb}" ] || return 1
  [ "${va}" != "${vb}" ] && return 0
  if [ "${ca}" != "?" ] && [ "${cb}" != "?" ] && [ "${ca}" != "${cb}" ]; then return 0; fi
  if [ "$(lire_identite "$1" sante_release)" = "1" ] && [ "$(lire_identite "$2" sante_release)" = "1" ] \
     && [ "$(lire_identite "$1" release)" != "$(lire_identite "$2" release)" ]; then return 0; fi
  return 1
}
# Attend que l'application annonce l'identité de cette version.
attendre_release() {  # <répertoire>
  local essai=0
  while [ "${essai}" -lt "${DELAI_SANTE}" ]; do
    lire_sante
    if correspond "$1"; then return 0; fi
    essai=$((essai + 1))
    sleep 1
  done
  lire_sante
  correspond "$1"
}

# Commande PM2 bornée dans le temps. Un PM2 qui ne répond plus (démon bloqué)
# ne doit pas figer la livraison juste après la bascule : passé le délai, la
# commande est abandonnée et la suite (contrôle de santé, retour arrière)
# s'exécute quand même. `timeout` n'existe pas partout : attente explicite.
pm2_borne() {  # sortie standard dans ${SORTIE_PM2} si défini
  ${PM2} "$@" >"${SORTIE_PM2:-/dev/null}" 2>/dev/null &
  local pid=$! attente=0
  while kill -0 "${pid}" 2>/dev/null; do
    if [ "${attente}" -ge "${DELAI_PM2}" ]; then
      kill "${pid}" 2>/dev/null; wait "${pid}" 2>/dev/null
      alerte "PM2 n'a pas répondu en ${DELAI_PM2} s (commande : $1)."
      return 124
    fi
    sleep 1; attente=$((attente + 1))
  done
  wait "${pid}"
}

# Pose la configuration d'une version comme configuration en service, SANS
# solliciter PM2 (sert aussi à remettre le fichier en accord avec le processus
# réellement en service).
poser_config() {  # <fichier de configuration PM2>
  cp -f "$1" "${CONFIG_ACTIVE}.new" && chmod 600 "${CONFIG_ACTIVE}.new" && mv -f "${CONFIG_ACTIVE}.new" "${CONFIG_ACTIVE}"
}
# Demande à PM2 de (re)démarrer sur cette configuration. Le code de retour est
# celui de PM2 (124 = délai dépassé) : il est TOUJOURS relevé par l'appelant,
# et ne vaut jamais preuve — seule l'identité annoncée ensuite fait foi.
demarrer() {  # <fichier de configuration PM2>
  poser_config "$1" || return 1
  pm2_borne startOrRestart "${CONFIG_ACTIVE}" --update-env
}
# Met le lien ET la configuration en service en accord avec une version.
aligner_sur() {  # <répertoire de version>
  basculer_lien "$1" "${APP}" && poser_config "$1/.pj/ecosystem.config.js"
}
decrire_pm2() {  # <code de retour de demarrer>
  case "$1" in
    0) echo "PM2 a accepté la commande" ;;
    124) echo "PM2 n'a pas répondu dans le délai" ;;
    *) echo "PM2 a refusé la commande (code $1)" ;;
  esac
}

dernieres_erreurs() {
  local journal liste="${RELEASES}/.jlist.$$"
  # Bornée elle aussi : si PM2 ne répond plus, on se passe de l'extrait de journal.
  SORTIE_PM2="${liste}" pm2_borne jlist 2>/dev/null || true
  journal="$(python3 -c "
import json, sys
try:
    print([p['pm2_env']['pm_err_log_path'] for p in json.load(open(sys.argv[1])) if p['name'] == '${NOM_PM2}'][0])
except Exception:
    pass
" "${liste}" 2>/dev/null)"
  rm -f "${liste}"
  if [ -n "${journal}" ] && [ -f "${journal}" ]; then
    echo "     Dernières erreurs de l'application :" >&2
    tail -n 15 "${journal}" 2>/dev/null | cut -c1-200 | sed 's/^/       /' >&2
  fi
}

abandon_avant_bascule() {  # rien n'a encore changé pour la version en service
  alerte "$1"
  rm -rf "${EN_PREPARATION}"
  echo "     Rien n'a changé sur le serveur : la version en service est intacte." >&2
  exit 1
}

# ── Retour arrière MANUEL : deploy-release.sh --retour-arriere ───────────────
# Pour une version qui démarre et répond correctement mais se révèle mauvaise à
# l'usage : le contrôle automatique ne peut pas le voir. Revient à l'autre
# version complète conservée, avec SA configuration.
#
# Le retour n'est déclaré fait que si l'application annonce l'identité de la
# version visée. Sinon le lien et la configuration sont remis en accord avec ce
# qui tourne RÉELLEMENT, et le code de sortie n'est jamais 0.
#   0  version précédente en service, identité vérifiée
#   1  retour arrière NON effectué ; la version de départ est en service et le
#      lien comme la configuration la désignent
#   3  état non confirmé (rien ne répond, ou une version inattendue répond) :
#      intervention requise
if [ "${1:-}" = "--retour-arriere" ]; then
  if [ ! -L "${APP}" ]; then alerte "${APP} n'est pas un lien vers une version : aucun retour arrière géré par ce script."; exit 1; fi
  ACTUELLE="$(cd "${APP}" 2>/dev/null && pwd -P)"
  if [ -z "${ACTUELLE}" ] || [ ! -f "${ACTUELLE}/.pj/ecosystem.config.js" ]; then
    alerte "La version en service (${ACTUELLE:-lien cassé}) n'a pas de configuration conservée : retour arrière non géré par ce script."
    echo "     Rien n'a changé sur le serveur." >&2; exit 1
  fi
  adopter_identite_servie "${ACTUELLE}"
  CIBLE=""
  # La plus récente des versions complètes autres que celle en service.
  for candidate in $(ls -1dt "${RELEASES}"/* 2>/dev/null); do
    case "${candidate}" in *.echec|*.preparation) continue ;; esac
    [ "${candidate}" = "${ACTUELLE}" ] && continue
    if [ -f "${candidate}/apps/admin/server.js" ] && [ -f "${candidate}/.pj/ecosystem.config.js" ]; then CIBLE="${candidate}"; break; fi
  done
  if [ -z "${CIBLE}" ]; then alerte "Aucune version précédente complète avec sa configuration dans ${RELEASES}."; echo "     Rien n'a changé sur le serveur." >&2; exit 1; fi
  adopter_identite "${CIBLE}"
  if [ -z "$(lire_identite "${CIBLE}" version)" ]; then
    alerte "Identité de la version précédente inconnue (${CIBLE}) : la bascule ne pourrait pas être vérifiée."
    echo "     Rien n'a changé sur le serveur. Renseigner ${CIBLE}/.pj/identite (voir README, « Retour arrière »)." >&2
    exit 1
  fi
  if ! distinguables "${ACTUELLE}" "${CIBLE}"; then
    alerte "Les deux versions annoncent la même identité ($(decrire_identite "${CIBLE}")) : la bascule ne pourrait pas être vérifiée."
    echo "     Rien n'a changé sur le serveur." >&2
    exit 1
  fi

  info "↩️  Retour arrière de ${ACTUELLE} ($(decrire_identite "${ACTUELLE}"))"
  info "    vers ${CIBLE} ($(decrire_identite "${CIBLE}"))"
  basculer_lien "${CIBLE}" "${APP}" || { alerte "Bascule impossible : rien n'a changé."; exit 1; }
  demarrer "${CIBLE}/.pj/ecosystem.config.js"; CODE_PM2=$?
  [ "${CODE_PM2}" -eq 0 ] || alerte "$(decrire_pm2 "${CODE_PM2}")."

  if attendre_release "${CIBLE}"; then
    pm2_borne save || true
    info "✅ Retour arrière vérifié : $(decrire_sante) en service."
    info "   La version quittée reste disponible : ${ACTUELLE}"
    exit 0
  fi

  # Non confirmé. Qui répond réellement ?
  if correspond "${ACTUELLE}"; then
    # Le processus de la version de départ tourne toujours : PM2 n'a rien
    # redémarré. Lien et configuration sont remis sur elle, sans le solliciter.
    if aligner_sur "${ACTUELLE}"; then
      alerte "Retour arrière NON effectué : $(decrire_pm2 "${CODE_PM2}") et c'est toujours la version de départ qui répond ($(decrire_sante))."
      echo "     Le lien et la configuration désignent de nouveau cette version : état cohérent, rien n'a changé." >&2
      echo "     Vérifier PM2 sur le serveur (pm2 status, pm2 logs) avant de réessayer." >&2
      exit 1
    fi
    alerte "Retour arrière NON effectué, et le lien n'a pas pu être remis sur la version qui répond (${ACTUELLE}). INTERVENTION REQUISE."
    exit 3
  fi

  alerte "La version précédente n'a pas été confirmée ($(decrire_sante)) : remise en service de la version de départ."
  dernieres_erreurs
  if basculer_lien "${ACTUELLE}" "${APP}"; then
    demarrer "${ACTUELLE}/.pj/ecosystem.config.js"; CODE_PM2=$?
    [ "${CODE_PM2}" -eq 0 ] || alerte "$(decrire_pm2 "${CODE_PM2}")."
    if attendre_release "${ACTUELLE}"; then
      pm2_borne save || true
      alerte "Retour arrière abandonné : la version de départ est de nouveau en service, vérifiée ($(decrire_sante))."
      exit 1
    fi
  fi
  # Dernier constat : aligner les fichiers sur ce qui répond, si c'est identifiable.
  lire_sante
  if correspond "${CIBLE}"; then
    aligner_sur "${CIBLE}" || true
    alerte "La version précédente répond finalement ($(decrire_sante)), mais PM2 s'est comporté de façon anormale. INTERVENTION REQUISE : vérifier pm2 status."
    exit 3
  fi
  alerte "État non confirmé après échec du retour arrière et de la remise en service ($(decrire_sante)). INTERVENTION REQUISE."
  echo "     Lien : $(cd "${APP}" 2>/dev/null && pwd -P). Les deux versions sont conservées : ${ACTUELLE} et ${CIBLE}" >&2
  exit 3
fi

# ── 1. Préparer la nouvelle version dans un répertoire neuf ──────────────────
[ -f "${ARCHIVE_APP}" ]    || abandon_avant_bascule "Archive de l'application introuvable (${ARCHIVE_APP})."
[ -f "${ARCHIVE_STATIC}" ] || abandon_avant_bascule "Archive des fichiers statiques introuvable (${ARCHIVE_STATIC})."

mkdir -p "${RELEASES}" "${PARTAGE}/data" || abandon_avant_bascule "Impossible de créer ${RELEASES} ou ${PARTAGE}."
rm -rf "${EN_PREPARATION}"
mkdir -p "${EN_PREPARATION}/apps/admin/.next" "${EN_PREPARATION}/.pj" || abandon_avant_bascule "Impossible de créer le répertoire de la nouvelle version."
chmod 700 "${EN_PREPARATION}/.pj"

tar -xzf "${ARCHIVE_APP}" -C "${EN_PREPARATION}" 2>/dev/null        || abandon_avant_bascule "Archive de l'application illisible ou incomplète."
tar -xzf "${ARCHIVE_STATIC}" -C "${EN_PREPARATION}/apps/admin/.next" 2>/dev/null || abandon_avant_bascule "Archive des fichiers statiques illisible ou incomplète."

for requis in "apps/admin/server.js" "apps/admin/.next/BUILD_ID" "apps/admin/.next/static" "node_modules/next/package.json"; do
  [ -e "${EN_PREPARATION}/${requis}" ] || abandon_avant_bascule "Version incomplète : ${requis} absent de l'archive."
done

# ── 2. Données sur disque : communes à toutes les versions ───────────────────
# apps/admin/src/data (archives CAF) est écrit par l'application. Placé dans
# chaque version, il serait perdu à chaque livraison ou divergerait au retour
# arrière. Il vit dans pj-shared/data ; chaque version y accède par un lien.
ANCIENNE_DISPOSITION=0
if [ -d "${APP}" ] && [ ! -L "${APP}" ]; then
  ANCIENNE_DISPOSITION=1
  if [ -d "${APP}/apps/admin/src/data" ] && [ ! -L "${APP}/apps/admin/src/data" ]; then
    # Copie SANS écrasement : ce qui est déjà dans le partage fait foi.
    cp -Rn "${APP}/apps/admin/src/data/." "${PARTAGE}/data/" 2>/dev/null || true
  fi
fi
# Fichiers de données fournis avec le build : seulement s'ils n'existent pas encore.
if [ -f "${ARCHIVE_DATA}" ]; then
  rm -rf "${EN_PREPARATION}/.pj/data-initiale"
  mkdir -p "${EN_PREPARATION}/.pj/data-initiale"
  if tar -xzf "${ARCHIVE_DATA}" -C "${EN_PREPARATION}/.pj/data-initiale" 2>/dev/null; then
    for f in "${EN_PREPARATION}/.pj/data-initiale/data/"*.json; do
      [ -f "${f}" ] || continue
      [ -e "${PARTAGE}/data/$(basename "${f}")" ] || cp "${f}" "${PARTAGE}/data/"
    done
  fi
  rm -rf "${EN_PREPARATION}/.pj/data-initiale"
fi
mkdir -p "${EN_PREPARATION}/apps/admin/src"
rm -rf "${EN_PREPARATION}/apps/admin/src/data"
ln -s "${PARTAGE}/data" "${EN_PREPARATION}/apps/admin/src/data" || abandon_avant_bascule "Impossible de relier les données partagées."

# ── 3. Configuration PM2 de CETTE version ────────────────────────────────────
# Écrite d'un seul tenant par Python, chaque valeur encodée comme une chaîne
# JSON : aucun jeton de remplacement ne peut rester dans le fichier, et un
# secret contenant une apostrophe ou une barre oblique ne le corrompt pas.
# JWT_SECRET et DATABASE_URL sont obligatoires : sans eux, pas de bascule.
CONFIG_NOUVELLE="${EN_PREPARATION}/.pj/ecosystem.config.js"
: > "${CONFIG_NOUVELLE}" && chmod 600 "${CONFIG_NOUVELLE}" || abandon_avant_bascule "Impossible d'écrire la configuration PM2."
if ! PJ_APP="${APP}" PJ_PORT_APP="${PORT}" PJ_RELEASE="${IDENTIFIANT}" python3 - "${SECRETS}" "${SMTP}" "${CONFIG_NOUVELLE}" << 'PYEOF'
import json, os, sys

chemin_secrets, chemin_smtp, sortie = sys.argv[1:4]

def lire_env(chemin):
    """Dernière occurrence de chaque clé, guillemets d'encadrement retirés (comme check-deploy-secrets.sh)."""
    valeurs = {}
    try:
        with open(chemin, encoding='utf-8') as f:
            for ligne in f:
                ligne = ligne.strip()
                if not ligne or ligne.startswith('#') or '=' not in ligne:
                    continue
                cle, _, valeur = ligne.partition('=')
                valeur = valeur.strip()
                if len(valeur) >= 2 and valeur[0] == valeur[-1] and valeur[0] in ('"', "'"):
                    valeur = valeur[1:-1]
                valeurs[cle.strip()] = valeur
    except OSError:
        pass
    return valeurs

secrets = lire_env(chemin_secrets)
smtp = lire_env(chemin_smtp)

manquants = [c for c in ('JWT_SECRET', 'DATABASE_URL') if not secrets.get(c)]
if manquants:
    sys.stderr.write('  ❌ ' + ' et '.join(manquants) + ' absente(s) de ' + chemin_secrets + '\n')
    sys.exit(1)

app = os.environ['PJ_APP']
env = {
    'NODE_ENV': 'production',
    'TZ': 'Europe/Paris',
    'PORT': int(os.environ['PJ_PORT_APP']),
    # Écoute sur la boucle locale uniquement : Nginx est le seul point d'entrée.
    # Sans cette variable, le serveur Next écoute sur 0.0.0.0 ; si le port était
    # joignable depuis Internet, l'en-tête X-Real-IP (confiance accordée à
    # Nginx pour les quotas par adresse) pourrait être forgé.
    'HOSTNAME': '127.0.0.1',
    # Identifiant de CETTE version, repris par /api/health : il permet de
    # vérifier que c'est bien elle qui répond après une bascule, y compris
    # face à une autre version construite depuis le même commit.
    'PJ_RELEASE_ID': os.environ['PJ_RELEASE'],
    'JWT_SECRET': secrets['JWT_SECRET'],
    'DATABASE_URL': secrets['DATABASE_URL'],
    'IDFM_API_KEY': secrets.get('IDFM_API_KEY', ''),
    # Adresse publique du site (lib/adresse.ts) : sans elle, les liens de
    # réinitialisation et les courriels d'identifiants ne partent pas. Elle
    # était contrôlée et lue par Nginx, mais jamais transmise à l'application.
    'APP_BASE_URL': secrets.get('APP_BASE_URL', ''),
    # Optionnels : origine CORS historique, commune exploitante du monitoring
    # (vide = 'nogent', lib/monitoring.ts).
    'ALLOWED_ORIGIN': secrets.get('ALLOWED_ORIGIN', ''),
    'MONITORING_OWNER_TENANT': secrets.get('MONITORING_OWNER_TENANT', ''),
    # Optionnel : secret partagé des scripts d'exploitation pour signaler un
    # échec au journal de monitoring. Vide = route interne désactivée (404).
    'INTERNAL_MONITORING_SECRET': secrets.get('INTERNAL_MONITORING_SECRET', ''),
    # Optionnel : secret partagé avec LE HUB pour la synchro de l'agenda PIJ
    # (/api/pij/hub/rdv). Vide = route désactivée (404).
    'HUB_SYNC_SECRET': secrets.get('HUB_SYNC_SECRET', ''),
    'HUB_SYNC_TENANT_ID': secrets.get('HUB_SYNC_TENANT_ID', ''),
}
# SMTP_CA_FILE / SMTP_TLS_SERVERNAME : optionnels (autorité privée, nom de
# certificat différent). Aucune variable ne désactive la validation du certificat.
for cle in ('SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_CA_FILE', 'SMTP_TLS_SERVERNAME', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'MAIL_ADMIN'):
    env[cle] = smtp.get(cle, '')

config = {
    'apps': [{
        'name': 'pole-jeunesse-admin',
        # Chemins par le LIEN de la version en service : la même configuration
        # reste valable quel que soit le répertoire de version vers lequel il pointe.
        'script': app + '/apps/admin/server.js',
        'cwd': app + '/apps/admin',
        'env': env,
        'instances': 1,
        # Mode fork volontaire : l'application écrit encore des fichiers locaux
        # (archives CAF dans apps/admin/src/data) sans verrou ; plusieurs
        # processus en cluster pourraient se marcher dessus.
        'exec_mode': 'fork',
        'autorestart': True,
        'watch': False,
        'max_memory_restart': '512M',
        'max_restarts': 10,
        'min_uptime': '30s',
        'exp_backoff_restart_delay': 100,
    }],
}
with open(sortie, 'w', encoding='utf-8') as f:
    f.write('module.exports = ' + json.dumps(config, indent=2, ensure_ascii=False) + ';\n')
PYEOF
then
  abandon_avant_bascule "Configuration PM2 non générée (secret obligatoire manquant ?)."
fi
chmod 600 "${CONFIG_NOUVELLE}"
info "🔑 Configuration PM2 de la nouvelle version écrite (secrets non affichés)"
# Identité de la nouvelle version : ce que /api/health devra annoncer.
ecrire_identite "${EN_PREPARATION}" "${VERSION_ATTENDUE}" "${COMMIT_ATTENDU}" "${IDENTIFIANT}" 1 "livraison" \
  || abandon_avant_bascule "Impossible d'écrire l'identité de la nouvelle version."

mv "${EN_PREPARATION}" "${NOUVELLE}" || abandon_avant_bascule "Impossible de finaliser le répertoire de la nouvelle version."
info "📦 Nouvelle version prête : ${NOUVELLE}"

# ── 4. Identifier la version précédente (celle en service) ───────────────────
# Son identité est relevée MAINTENANT, tant que c'est encore elle qui répond :
# c'est elle qu'il faudra retrouver en cas de retour arrière.
PRECEDENTE=""
if [ "${ANCIENNE_DISPOSITION}" -eq 1 ]; then
  # Ancienne disposition : le répertoire réel devient une version à part
  # entière. Il est DÉPLACÉ (même système de fichiers, rien n'est copié ni
  # supprimé) ; le processus en cours continue de tourner sur ses fichiers.
  PRECEDENTE="${RELEASES}/avant-releases-$(date +%Y%m%d-%H%M%S)"
  if [ -f "${APP}/apps/admin/server.js" ]; then
    lire_sante
    mv "${APP}" "${PRECEDENTE}" || { alerte "Impossible de mettre de côté la version en service."; rm -rf "${NOUVELLE}"; exit 1; }
    mkdir -p "${PRECEDENTE}/.pj" && chmod 700 "${PRECEDENTE}/.pj"
    if [ -f "${CONFIG_ACTIVE}" ]; then cp -p "${CONFIG_ACTIVE}" "${PRECEDENTE}/.pj/ecosystem.config.js"; chmod 600 "${PRECEDENTE}/.pj/ecosystem.config.js"; fi
    if [ "${S_OK}" -eq 1 ] && [ -n "${S_VERSION}" ] && [ -n "${S_COMMIT}" ]; then
      ecrire_identite "${PRECEDENTE}" "${S_VERSION}" "${S_COMMIT}" "$(basename "${PRECEDENTE}")" 0 "sante-constatee"
    else
      adopter_identite "${PRECEDENTE}"
    fi
    # Ses données rejoignent le partage (déjà copiées plus haut) : elle aussi y accède par un lien.
    if [ -d "${PRECEDENTE}/apps/admin/src/data" ] && [ ! -L "${PRECEDENTE}/apps/admin/src/data" ]; then
      mv "${PRECEDENTE}/apps/admin/src/data" "${PRECEDENTE}/apps/admin/src/data.avant-partage"
      ln -s "${PARTAGE}/data" "${PRECEDENTE}/apps/admin/src/data"
    fi
    info "🗄  Version en service mise de côté, complète : ${PRECEDENTE} ($(decrire_identite "${PRECEDENTE}"))"
  else
    # Répertoire sans application (premier déploiement) : rien à conserver comme version.
    mv "${APP}" "${RELEASES}/repertoire-initial-$(date +%Y%m%d-%H%M%S)" || { alerte "Impossible de déplacer ${APP}."; rm -rf "${NOUVELLE}"; exit 1; }
    PRECEDENTE=""
  fi
elif [ -L "${APP}" ]; then
  PRECEDENTE="$(cd "${APP}" 2>/dev/null && pwd -P)"
  [ -f "${PRECEDENTE}/apps/admin/server.js" ] || PRECEDENTE=""
  [ -n "${PRECEDENTE}" ] && adopter_identite_servie "${PRECEDENTE}"
fi

# ── 5. Bascule, redémarrage, vérification ────────────────────────────────────
if [ "${ANCIENNE_DISPOSITION}" -eq 1 ]; then
  ln -s "${NOUVELLE}" "${APP}" || { alerte "Bascule impossible."; [ -n "${PRECEDENTE}" ] && mv "${PRECEDENTE}" "${APP}"; exit 3; }
else
  basculer_lien "${NOUVELLE}" "${APP}" || { alerte "Bascule impossible : la version en service est inchangée."; rm -rf "${NOUVELLE}"; exit 1; }
fi
info "🔀 Bascule vers la nouvelle version"

demarrer "${NOUVELLE}/.pj/ecosystem.config.js"; CODE_PM2=$?
[ "${CODE_PM2}" -eq 0 ] || alerte "$(decrire_pm2 "${CODE_PM2}")."

# Réussite = l'application annonce la version, le commit ET l'identifiant de
# cette version. Une réponse saine d'un autre processus ne suffit pas.
if attendre_release "${NOUVELLE}"; then
  info "✅ Application en ligne et vérifiée : $(decrire_sante)"
  pm2_borne save || true

  # Ménage : on garde la version en service et la précédente COMPLÈTE.
  # Garde-fou : si la précédente n'est pas retrouvée telle quelle dans le
  # répertoire des versions, on ne supprime RIEN plutôt que de risquer de la
  # supprimer sous un autre nom.
  if [ -z "${PRECEDENTE}" ] || [ "${PRECEDENTE}" = "${RELEASES}/$(basename "${PRECEDENTE}")" ]; then
    for ancien in "${RELEASES}"/*; do
      [ -d "${ancien}" ] || continue
      [ "${ancien}" = "${NOUVELLE}" ] && continue
      [ -n "${PRECEDENTE}" ] && [ "${ancien}" = "${PRECEDENTE}" ] && continue
      rm -rf "${ancien}"
    done
  else
    info "⚠️  Ménage des anciennes versions ignoré : la version précédente (${PRECEDENTE}) est hors de ${RELEASES}."
  fi
  if [ -n "${PRECEDENTE}" ]; then info "↩️  Version précédente conservée pour retour arrière : ${PRECEDENTE} ($(decrire_identite "${PRECEDENTE}"))"; fi
  exit 0
fi

# ── 6. Échec : retour arrière ────────────────────────────────────────────────
# Règle : la nouvelle version n'est renommée « .echec » que si l'on a la PREUVE
# qu'elle n'est plus en service, c'est-à-dire que l'application annonce
# l'identité de la version précédente. Dans tous les autres cas, les deux
# versions restent en place sous leur nom et le code de sortie est 3.
if [ "${S_OK}" -eq 1 ]; then
  alerte "Livraison non confirmée : l'application annonce « $(decrire_sante) » au lieu de « version ${VERSION_ATTENDUE}, commit ${COMMIT_ATTENDU}, release ${IDENTIFIANT} »."
else
  alerte "L'application ne répond pas sainement sur ${URL_SANTE} après ${DELAI_SANTE} s."
fi
dernieres_erreurs

ECHEC="${NOUVELLE}.echec"
if [ -z "${PRECEDENTE}" ] || [ ! -f "${PRECEDENTE}/.pj/ecosystem.config.js" ]; then
  alerte "Aucune version précédente complète avec sa configuration : retour arrière impossible. INTERVENTION REQUISE."
  echo "     La version défaillante reste en place : ${NOUVELLE}" >&2
  exit 3
fi

echo "  ↩️  Retour arrière vers ${PRECEDENTE} ($(decrire_identite "${PRECEDENTE}"))…" >&2
if ! basculer_lien "${PRECEDENTE}" "${APP}"; then
  alerte "Retour arrière : bascule du lien impossible. INTERVENTION REQUISE."
  exit 3
fi
demarrer "${PRECEDENTE}/.pj/ecosystem.config.js"; CODE_PM2=$?
[ "${CODE_PM2}" -eq 0 ] || alerte "$(decrire_pm2 "${CODE_PM2}")."

CONFIRME=0
if [ -z "$(lire_identite "${PRECEDENTE}" version)" ]; then
  alerte "Identité de la version précédente inconnue : le retour arrière ne peut pas être vérifié."
elif ! distinguables "${NOUVELLE}" "${PRECEDENTE}"; then
  alerte "La version précédente annonce la même identité que la nouvelle : le retour arrière ne peut pas être vérifié."
elif attendre_release "${PRECEDENTE}"; then
  CONFIRME=1
fi

if [ "${CONFIRME}" -eq 1 ]; then
  # Preuve acquise : c'est la version précédente qui répond. Cela couvre aussi
  # le cas où PM2 n'a jamais démarré la nouvelle version.
  mv "${NOUVELLE}" "${ECHEC}" 2>/dev/null || true
  # Une seule version en échec est gardée pour examen.
  for vieux in "${RELEASES}"/*.echec; do
    [ -d "${vieux}" ] || continue
    [ "${vieux}" = "${ECHEC}" ] || rm -rf "${vieux}"
  done
  pm2_borne save || true
  echo "  ✅ Retour arrière vérifié : $(decrire_sante) de nouveau en service." >&2
  echo "     Version défaillante conservée pour examen : ${ECHEC}" >&2
  exit 2
fi

# Retour arrière NON confirmé : on ne renomme rien, on ne supprime rien.
lire_sante
if [ "${S_OK}" -eq 1 ]; then
  # Quelque chose répond, et ce n'est pas la version précédente : c'est donc le
  # processus de la version défaillante, que PM2 n'a pas remplacé. Le lien et
  # la configuration sont remis sur elle, pour rester en accord avec ce qui tourne.
  aligner_sur "${NOUVELLE}" || true
  alerte "Retour arrière NON effectué : $(decrire_pm2 "${CODE_PM2}") et la version défaillante répond toujours ($(decrire_sante)). INTERVENTION REQUISE."
  echo "     Le lien et la configuration désignent la version qui tourne : ${NOUVELLE}" >&2
else
  alerte "Retour arrière non confirmé : $(decrire_pm2 "${CODE_PM2}") et rien ne répond sainement. INTERVENTION REQUISE."
  echo "     Le lien et la configuration désignent la version précédente : ${PRECEDENTE}" >&2
fi
echo "     Les deux versions sont conservées telles quelles : ${NOUVELLE} et ${PRECEDENTE}" >&2
dernieres_erreurs
exit 3
