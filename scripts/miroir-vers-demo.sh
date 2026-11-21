#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Pôle Jeunesse — Miroir des évolutions vers l'application de démonstration
#
#  Reporte les évolutions du code faites ici (pole-jeunesse-mairie, branche
#  main telle que sur GitHub) dans le dépôt de démonstration (par défaut
#  ~/app-pole-jeunesse), sur une branche à part « miroir/mairie-AAAAMMJJ-HHMMSS ». Rien n'est poussé ni
#  fusionné : vous relisez, testez, puis fusionnez vous-même dans la démo.
#
#  Ce qui n'est JAMAIS reporté :
#    - les données : aucune base n'est lue ni modifiée, ni .env*, ni src/data ;
#    - les commits de version (« chore: version X.Y.Z ») : chaque dépôt garde
#      sa propre numérotation et son CHANGELOG ;
#    - les commits marqués « Miroir: non » dans leur message (évolution propre
#      à la mairie) ;
#    - les fichiers propres à la mise en service (liste EXCLUS ci-dessous).
#  Les commits de fusion (merge) sont ignorés : leurs commits sont repris un à un.
#
#  Usage (depuis ce dépôt) :
#    bash scripts/miroir-vers-demo.sh --initialiser   # 1re fois : point de départ = main actuel
#    bash scripts/miroir-vers-demo.sh --simulation    # liste ce qui serait reporté
#    bash scripts/miroir-vers-demo.sh                 # reporte sur une branche miroir/…
#    bash scripts/miroir-vers-demo.sh --continuer     # après résolution d'un conflit
#    bash scripts/miroir-vers-demo.sh --ignorer       # ou : écarter le commit en conflit
#
#  Dépôt de démo : variable DEMO (défaut ~/app-pole-jeunesse).
#  Traçabilité : chaque commit reporté porte la ligne
#    « Miroir-de: pole-jeunesse-mairie@<sha> » ; un commit déjà reporté n'est
#  jamais repris deux fois.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Fichiers propres à la mise en service mairie : jamais reportés.
# Motifs « case » du shell (* couvre aussi les « / »).
EXCLUS=(
  'VERSION'
  'CHANGELOG.md'
  'CLAUDE.md'
  'README.md'
  'MIGRATION-SERVEUR-MAIRIE.md'
  'PROCEDURE-NODE.md'
  'deploy.env.example'
  '.env*'
  '*/.env*'
  'scripts/remise-a-zero.sh'
  'apps/admin/scripts/remise-a-zero-*'
  'scripts/miroir-vers-demo.sh'
  'apps/admin/src/data/*'
)

# Mêmes exclusions, en pathspec git (** traverse les dossiers).
PATHSPEC_EXCLUS=(
  ':(exclude,glob)VERSION'
  ':(exclude,glob)CHANGELOG.md'
  ':(exclude,glob)CLAUDE.md'
  ':(exclude,glob)README.md'
  ':(exclude,glob)MIGRATION-SERVEUR-MAIRIE.md'
  ':(exclude,glob)PROCEDURE-NODE.md'
  ':(exclude,glob)deploy.env.example'
  ':(exclude,glob)**/.env*'
  ':(exclude,glob)scripts/remise-a-zero.sh'
  ':(exclude,glob)apps/admin/scripts/remise-a-zero-*'
  ':(exclude,glob)scripts/miroir-vers-demo.sh'
  ':(exclude,glob)apps/admin/src/data/**'
)

MODE="${1:-}"
case "$MODE" in ""|--simulation|--initialiser|--continuer|--ignorer) ;;
  *) echo "Option inconnue : $MODE" >&2; exit 1 ;; esac

SOURCE="$(cd "$(dirname "$0")/.." && pwd)"
DEMO="${DEMO:-$HOME/app-pole-jeunesse}"
BRANCHE_SOURCE="main"
DISTANT="mairie"
REF_SOURCE="refs/remotes/$DISTANT/$BRANCHE_SOURCE"
ETAT="$DEMO/.git/MIROIR_EN_COURS"

[ -d "$DEMO/.git" ] || { echo "Dépôt de démo introuvable : $DEMO" >&2; exit 1; }
[ "$(cd "$DEMO" && pwd -P)" != "$(cd "$SOURCE" && pwd -P)" ] || { echo "DEMO désigne ce dépôt-ci." >&2; exit 1; }

d() { git -C "$DEMO" "$@"; }

est_exclu() {
  local f="$1" motif
  for motif in "${EXCLUS[@]}"; do
    # shellcheck disable=SC2254
    case "$f" in $motif) return 0 ;; esac
  done
  return 1
}

# Le dépôt de démo connaît ce dépôt sous le nom « mairie » (chemin local).
if d remote get-url "$DISTANT" >/dev/null 2>&1; then
  d remote set-url "$DISTANT" "$SOURCE"
else
  d remote add "$DISTANT" "$SOURCE"
fi
# Source de vérité : le main de GitHub (origin), pour qu'une PR fusionnée en
# ligne soit vue sans « git pull ». Hors ligne : main local, avec un avertissement.
if git -C "$SOURCE" fetch -q origin "$BRANCHE_SOURCE" 2>/dev/null; then
  d fetch -q "$DISTANT" "+refs/remotes/origin/$BRANCHE_SOURCE:$REF_SOURCE"
else
  echo "Attention : GitHub injoignable, lecture du main local de $SOURCE." >&2
  d fetch -q "$DISTANT" "+refs/heads/$BRANCHE_SOURCE:$REF_SOURCE"
fi

if [ "$MODE" = "--initialiser" ]; then
  if d config --get miroir.mairie.depuis >/dev/null; then
    echo "Déjà initialisé (depuis $(d config --get miroir.mairie.depuis | cut -c1-7))." >&2
    echo "Pour repartir d'ailleurs : git -C $DEMO config miroir.mairie.depuis <sha>" >&2
    exit 1
  fi
  d config miroir.mairie.depuis "$(d rev-parse "$REF_SOURCE")"
  echo "Point de départ : $(d log -1 --format='%h %s' "$REF_SOURCE")"
  echo "Les commits faits ensuite sur main seront reportés dans $DEMO."
  exit 0
fi

DEPUIS="$(d config --get miroir.mairie.depuis || true)"
[ -n "$DEPUIS" ] || { echo "Pas encore initialisé : bash scripts/miroir-vers-demo.sh --initialiser" >&2; exit 1; }

# Raison de ne pas reporter un commit (rien si on doit le reporter).
# $1 = sha source, $2 = branche de la démo dont l'historique fait foi.
raison_ignore() {
  local sha="$1" ref="$2" f utiles=0
  if [ -n "$(d log "$ref" -F --grep="Miroir-de: pole-jeunesse-mairie@$sha" -1 --format=%H)" ]; then
    echo "déjà fait"; return
  fi
  if grep -qx "$sha" <<<"$(d config --get-all miroir.mairie.ignores || true)"; then
    echo "écarté à la main"; return
  fi
  if [[ "$(d log -1 --format=%s "$sha")" =~ ^chore(\(.*\))?:\ version\  ]]; then
    echo "version"; return
  fi
  if grep -qiE '^Miroir:[[:space:]]*non' <<<"$(d log -1 --format=%B "$sha")"; then
    echo "Miroir: non"; return
  fi
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    est_exclu "$f" || utiles=1
  done < <(d diff-tree --no-commit-id --name-only -r "$sha")
  [ "$utiles" = 1 ] || echo "fichiers propres à la mairie"
}

ecrire_message() { # $1 = sha source → message du commit reporté sur la sortie
  d log -1 --format=%B "$1" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'
  printf '\nMiroir-de: pole-jeunesse-mairie@%s\n' "$1"
}

valider() { # $1 = sha source ; l'index contient le report
  local msg
  msg="$(mktemp)"
  ecrire_message "$1" > "$msg"
  d commit -q -F "$msg" \
    --author="$(d log -1 --format='%an <%ae>' "$1")" \
    --date="$(d log -1 --format=%aI "$1")"
  rm -f "$msg"
  echo "  reporté   $(d log -1 --format='%h' HEAD)  ←  $(d log -1 --format='%h %s' "$1")"
}

if [ "$MODE" = "--ignorer" ]; then
  [ -f "$ETAT" ] || { echo "Aucun report en cours." >&2; exit 1; }
  EN_COURS="$(cat "$ETAT")"
  d reset -q --merge HEAD 2>/dev/null || d reset -q --hard HEAD
  d config --add miroir.mairie.ignores "$EN_COURS"
  rm -f "$ETAT"
  echo "  écarté    $(d log -1 --format='%h %s' "$EN_COURS")  (ne sera plus proposé)"
  MODE="--continuer"
elif [ "$MODE" = "--continuer" ]; then
  [ -f "$ETAT" ] || { echo "Aucun report en cours." >&2; exit 1; }
  EN_COURS="$(cat "$ETAT")"
  if [ -n "$(d diff --name-only --diff-filter=U)" ]; then
    echo "Il reste des fichiers en conflit :" >&2; d diff --name-only --diff-filter=U >&2; exit 1
  fi
  # Seuls les fichiers déjà suivis sont pris en compte (jamais les non suivis).
  d add -u
  if d diff --cached --quiet; then
    echo "  ignoré    $(d log -1 --format='%h %s' "$EN_COURS")  (rien à reporter après résolution)"
    d config --add miroir.mairie.ignores "$EN_COURS"
  else
    valider "$EN_COURS"
  fi
  rm -f "$ETAT"
else
  [ ! -f "$ETAT" ] || { echo "Un report est en cours dans $DEMO : résolvez puis --continuer." >&2; exit 1; }
fi

# Commits à examiner, du plus ancien au plus récent.
COMMITS="$(d rev-list --reverse --no-merges "$DEPUIS..$REF_SOURCE")"
if [ -z "$COMMITS" ]; then
  echo "Rien de nouveau sur $BRANCHE_SOURCE depuis $(echo "$DEPUIS" | cut -c1-7)."
  exit 0
fi

if [ "$MODE" != "--simulation" ] && [ "$MODE" != "--continuer" ]; then
  # Pas de branche s'il n'y a rien à reporter depuis le main de la démo.
  A_REPORTER=0
  d rev-parse -q --verify refs/heads/main >/dev/null || { echo "Pas de branche main locale dans $DEMO." >&2; exit 1; }
  for SHA in $COMMITS; do
    [ -n "$(raison_ignore "$SHA" refs/heads/main)" ] || { A_REPORTER=1; break; }
  done
  if [ "$A_REPORTER" = 0 ]; then
    echo "Rien à reporter : les nouveaux commits de $BRANCHE_SOURCE sont propres à la mairie ou déjà reportés."
    echo "Aucune branche créée ; la démo n'a pas bougé."
    exit 0
  fi
  if [ -n "$(d status --porcelain --untracked-files=no)" ]; then
    echo "Le dépôt de démo a des modifications non validées : validez-les ou mettez-les de côté." >&2
    exit 1
  fi
  BRANCHE="miroir/mairie-$(date +%Y%m%d-%H%M%S)"
  N=2; BASE="$BRANCHE"
  while d rev-parse -q --verify "refs/heads/$BRANCHE" >/dev/null; do BRANCHE="$BASE-$N"; N=$((N + 1)); done
  NON_FUSIONNEES="$(d branch --format='%(refname:short)' --no-merged refs/heads/main --list 'miroir/*')"
  if [ -n "$NON_FUSIONNEES" ]; then
    echo "Note : branche(s) miroir pas encore fusionnées dans main (leurs reports seront refaits ici) :"
    echo "$NON_FUSIONNEES" | sed 's/^/    /'
  fi
  d switch -q -c "$BRANCHE" refs/heads/main
  echo "Branche $BRANCHE créée dans $DEMO (depuis main, $(d log -1 --format=%h HEAD))."
fi

[ "$MODE" != "--simulation" ] || echo "Simulation — rien n'est modifié dans $DEMO :"

for SHA in $COMMITS; do
  COURT="$(d log -1 --format='%h %s' "$SHA")"
  RAISON="$(raison_ignore "$SHA" HEAD)"
  if [ "$RAISON" = "déjà fait" ]; then echo "  déjà fait $COURT"; continue; fi
  if [ -n "$RAISON" ]; then echo "  ignoré    $COURT  ($RAISON)"; continue; fi

  if [ "$MODE" = "--simulation" ]; then echo "  à reporter $COURT"; continue; fi

  # Le diff du commit, fichiers exclus retirés, appliqué en trois voies (les
  # objets de ce dépôt-ci ont été récupérés par le fetch). Les fichiers non
  # suivis de la démo ne sont jamais écrasés : git apply refuse alors.
  SORTIE_APPLY=0
  d diff --binary "$SHA^" "$SHA" -- . "${PATHSPEC_EXCLUS[@]}" \
    | d apply --3way --index --whitespace=nowarn 2>"$DEMO/.git/MIROIR_APPLY.log" || SORTIE_APPLY=$?

  CONFLITS="$(d diff --name-only --diff-filter=U)"
  if [ -n "$CONFLITS" ]; then
    echo "$SHA" > "$ETAT"
    echo
    echo "CONFLIT en reportant $COURT, dans $DEMO :"
    echo "$CONFLITS" | sed 's/^/    /'
    echo "Résolvez ces fichiers (git add), puis : bash scripts/miroir-vers-demo.sh --continuer"
    echo "Pour ne pas reporter ce commit : bash scripts/miroir-vers-demo.sh --ignorer"
    exit 2
  fi
  if [ "$SORTIE_APPLY" != 0 ]; then
    echo >&2
    echo "ÉCHEC en reportant $COURT (rien n'a été appliqué) :" >&2
    sed 's/^/    /' "$DEMO/.git/MIROIR_APPLY.log" >&2
    echo "Corrigez la cause (fichier non suivi au même endroit ?), puis relancez." >&2
    exit 1
  fi
  if d diff --cached --quiet; then
    echo "  ignoré    $COURT  (déjà présent dans la démo)"
    continue
  fi
  valider "$SHA"
done

if [ "$MODE" != "--simulation" ]; then
  echo
  echo "Terminé. Dans $DEMO : relisez (git log main..HEAD), lancez les vérifications,"
  echo "puis fusionnez dans main. Rien n'a été poussé."
fi
