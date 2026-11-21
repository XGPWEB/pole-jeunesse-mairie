#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Pôle Jeunesse — Miroir des évolutions vers l'application de démonstration
#
#  Reporte les évolutions du code faites ici (pole-jeunesse-mairie, branche
#  main) dans le dépôt de démonstration (par défaut ~/app-pole-jeunesse), sur
#  une branche à part « miroir/mairie-AAAAMMJJ-HHMMSS ». Rien n'est poussé ni
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
d fetch -q "$DISTANT" "$BRANCHE_SOURCE"

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

# Déjà reporté = présent dans l'historique de la branche courante de la démo.
deja_reporte() { [ -n "$(d log HEAD -F --grep="Miroir-de: pole-jeunesse-mairie@$1" -1 --format=%H)" ]; }

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
  if [ -n "$(d status --porcelain --untracked-files=no)" ]; then
    echo "Le dépôt de démo a des modifications non validées : validez-les ou mettez-les de côté." >&2
    exit 1
  fi
  BRANCHE="miroir/mairie-$(date +%Y%m%d-%H%M%S)"
  d switch -q -c "$BRANCHE" main
  echo "Branche $BRANCHE créée dans $DEMO (depuis main, $(d log -1 --format=%h HEAD))."
fi

[ "$MODE" != "--simulation" ] || echo "Simulation — rien n'est modifié dans $DEMO :"

for SHA in $COMMITS; do
  COURT="$(d log -1 --format='%h %s' "$SHA")"
  SUJET="$(d log -1 --format=%s "$SHA")"
  if deja_reporte "$SHA"; then echo "  déjà fait $COURT"; continue; fi
  if grep -qx "$SHA" <<<"$(d config --get-all miroir.mairie.ignores || true)"; then
    echo "  ignoré    $COURT  (écarté à la main)"; continue
  fi
  if [[ "$SUJET" =~ ^chore(\(.*\))?:\ version\  ]]; then echo "  ignoré    $COURT  (version)"; continue; fi
  MESSAGE="$(d log -1 --format=%B "$SHA")"
  if grep -qiE '^Miroir:[[:space:]]*non' <<<"$MESSAGE"; then
    echo "  ignoré    $COURT  (Miroir: non)"; continue
  fi
  UTILES=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    est_exclu "$f" || UTILES=1
  done < <(d diff-tree --no-commit-id --name-only -r "$SHA")
  if [ "$UTILES" = 0 ]; then echo "  ignoré    $COURT  (fichiers propres à la mairie)"; continue; fi

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
