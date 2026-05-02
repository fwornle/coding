#!/usr/bin/env bash
# Migrate .specstory/history/ from a public/outer repo into a private nested repo.
#
# Usage:
#   migrate-history-to-private.sh <project-dir> [--purge] [--auto] [--remote URL]
#
# Phases:
#   A. Untrack .specstory/history/ from the outer repo (non-destructive).
#   B. (--purge only) Rewrite outer repo history with git-filter-repo to remove
#      .specstory/history/ from every past commit, then FORCE-PUSH to origin.
#      DESTRUCTIVE: rewrites shared history. Anyone with a clone must re-clone.
#      The on-host backup is kept at <project>/../<project>.pre-purge-<ts>.bundle.
#   C. Bootstrap a private nested git repo at .specstory/history/, set the
#      remote (defaults to bmw.ghe.com:Frank-Woernle/<name>-history.git),
#      attempt to create the private repo via gh if missing, push initial commit.
#
# Safety:
#   - Phase B requires --purge AND an explicit "yes-purge-<repo>" typed back.
#   - Working tree must be clean before phase A.
#   - Outer remote must be reachable.
#   - Skipped repos write .specstory/.history-repo-skipped so the launcher
#     won't re-prompt.

set -euo pipefail

# ----------------------------- arg parsing ----------------------------------
PROJECT_DIR=""
PURGE=false
AUTO=false
REMOTE_URL=""

while [ $# -gt 0 ]; do
  case "$1" in
    --purge) PURGE=true; shift ;;
    --auto)  AUTO=true; shift ;;
    --remote) REMOTE_URL="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,32p' "$0"
      exit 0
      ;;
    *)
      if [ -z "$PROJECT_DIR" ]; then PROJECT_DIR="$1"; else
        echo "Unexpected arg: $1" >&2; exit 2
      fi
      shift
      ;;
  esac
done

if [ -z "$PROJECT_DIR" ]; then
  echo "Usage: $(basename "$0") <project-dir> [--purge] [--auto] [--remote URL]" >&2
  exit 2
fi
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd)"
NAME="$(basename "$PROJECT_DIR")"
HISTORY_DIR="$PROJECT_DIR/.specstory/history"

step() { echo ""; echo "── $1"; }
fail() { echo "❌ $1" >&2; exit 1; }
ok()   { echo "✅ $1"; }

# ----------------------------- preflight ------------------------------------
step "Preflight: $NAME at $PROJECT_DIR"
git -C "$PROJECT_DIR" rev-parse --git-dir >/dev/null 2>&1 \
  || fail "$PROJECT_DIR is not a git repo"

OUTER_REMOTE="$(git -C "$PROJECT_DIR" config --get remote.origin.url 2>/dev/null || true)"
echo "  Outer origin: ${OUTER_REMOTE:-(none)}"

# Permit untracked content inside .specstory/history/ (it migrates with us);
# block anything else.
DIRTY="$(git -C "$PROJECT_DIR" status --porcelain | grep -vE '^\?\? \.specstory/history/' || true)"
if [ -n "$DIRTY" ]; then
  echo "$DIRTY" | sed 's/^/  /'
  fail "Working tree not clean (changes outside .specstory/history/) — commit or stash first"
fi

OUTER_BRANCH="$(git -C "$PROJECT_DIR" rev-parse --abbrev-ref HEAD)"
echo "  Outer branch: $OUTER_BRANCH"

TRACKED_COUNT="$(git -C "$PROJECT_DIR" ls-files .specstory/history 2>/dev/null | wc -l | tr -d ' ')"
echo "  Tracked history files: $TRACKED_COUNT"

# Default remote URL (HTTPS — gh credential helper supplies the token;
# SSH to bmw.ghe.com is not configured by default)
DEFAULT_PRIVATE="https://bmw.ghe.com/Frank-Woernle/${NAME}-history.git"
if [ -z "$REMOTE_URL" ]; then
  REMOTE_URL="$DEFAULT_PRIVATE"
fi
echo "  Private history remote: $REMOTE_URL"

if [ -e "$HISTORY_DIR/.git" ]; then
  ok "Nested repo already present — skipping phase A/C bootstrap"
  NESTED_PRESENT=true
else
  NESTED_PRESENT=false
fi

# ----------------------------- phase A --------------------------------------
if [ "$TRACKED_COUNT" -gt 0 ] && [ "$NESTED_PRESENT" = false ]; then
  step "Phase A: untrack .specstory/history/ in outer repo"
  if [ "$AUTO" != "true" ]; then
    read -r -p "Proceed with: git rm -r --cached .specstory/history/ + commit + push? [y/N] " ans
    case "$ans" in y|Y|yes) ;; *) fail "User aborted phase A" ;; esac
  fi

  git -C "$PROJECT_DIR" rm -r --cached .specstory/history/ >/dev/null
  # Add to .gitignore if not already
  if ! grep -qxF ".specstory/history/" "$PROJECT_DIR/.gitignore" 2>/dev/null \
     && ! grep -qxF ".specstory/history" "$PROJECT_DIR/.gitignore" 2>/dev/null; then
    {
      echo ""
      echo "# Private history repo — chat logs live in a separate <name>-history repo"
      echo ".specstory/history/"
    } >> "$PROJECT_DIR/.gitignore"
    git -C "$PROJECT_DIR" add .gitignore
  fi
  git -C "$PROJECT_DIR" commit -m "chore: stop tracking .specstory/history (moving to private repo)" >/dev/null
  ok "Untracked + committed"

  if [ -n "$OUTER_REMOTE" ]; then
    if [ "$AUTO" != "true" ]; then
      read -r -p "  Push to outer origin/$OUTER_BRANCH? [y/N] " ans
      case "$ans" in y|Y|yes) git -C "$PROJECT_DIR" push origin "$OUTER_BRANCH" && ok "Pushed" ;; *) echo "  (skipped push — push manually when ready)" ;; esac
    else
      git -C "$PROJECT_DIR" push origin "$OUTER_BRANCH" && ok "Pushed"
    fi
  fi
fi

# ----------------------------- phase B (optional, destructive) --------------
if [ "$PURGE" = true ]; then
  step "Phase B: PURGE .specstory/history from outer repo's git history (DESTRUCTIVE)"
  echo "  This will:"
  echo "  - Run \`git filter-repo --invert-paths --path .specstory/history/\` (rewrites every commit)"
  echo "  - Force-push to outer origin (anyone with a clone must re-clone)"
  echo "  - Save a bundle backup at $PROJECT_DIR/../$NAME.pre-purge-$(date +%Y%m%d-%H%M%S).bundle"
  echo ""
  echo "  Type exactly:  yes-purge-$NAME"
  read -r -p "  Confirmation: " confirmation
  if [ "$confirmation" != "yes-purge-$NAME" ]; then
    fail "Confirmation mismatch — aborting purge"
  fi

  BUNDLE="$PROJECT_DIR/../$NAME.pre-purge-$(date +%Y%m%d-%H%M%S).bundle"
  step "  → Backup: bundling current state to $BUNDLE"
  git -C "$PROJECT_DIR" bundle create "$BUNDLE" --all
  ok "Backup created"

  step "  → Running git filter-repo"
  git -C "$PROJECT_DIR" filter-repo --invert-paths --path .specstory/history/ --force
  ok "History rewritten"

  # filter-repo removes the origin remote; restore it
  if [ -n "$OUTER_REMOTE" ]; then
    git -C "$PROJECT_DIR" remote add origin "$OUTER_REMOTE" 2>/dev/null \
      || git -C "$PROJECT_DIR" remote set-url origin "$OUTER_REMOTE"
    ok "Remote restored: $OUTER_REMOTE"

    step "  → Force-pushing rewritten history (DESTRUCTIVE)"
    git -C "$PROJECT_DIR" push --force origin "$OUTER_BRANCH"
    ok "Force-pushed to origin/$OUTER_BRANCH"
    echo "  ⚠️  Anyone with an existing clone must re-clone or run:"
    echo "      git fetch && git reset --hard origin/$OUTER_BRANCH"
  else
    echo "  (no outer origin — skipping force-push)"
  fi
fi

# ----------------------------- phase C --------------------------------------
step "Phase C: bootstrap private nested history repo"

if [ "$NESTED_PRESENT" = true ]; then
  ok "Nested repo already exists at $HISTORY_DIR/.git — skipping init"
else
  mkdir -p "$HISTORY_DIR"
  git -C "$HISTORY_DIR" init -b main >/dev/null
  ok "Initialized $HISTORY_DIR as a git repo"

  if [ -z "$(ls -A "$HISTORY_DIR" 2>/dev/null | grep -v '^\.git$')" ]; then
    cat > "$HISTORY_DIR/README.md" <<EOF
# ${NAME}-history

Private LSL/session history for the **${NAME}** project. Created by
\`migrate-history-to-private.sh\`. Do not make this repo public.
EOF
  fi

  git -C "$HISTORY_DIR" remote add origin "$REMOTE_URL" 2>/dev/null \
    || git -C "$HISTORY_DIR" remote set-url origin "$REMOTE_URL"
  git -C "$HISTORY_DIR" add -A
  git -C "$HISTORY_DIR" commit -m "Initial private history repo for ${NAME}" >/dev/null
  ok "Configured remote $REMOTE_URL + initial commit"
fi

# Try to create the remote repo via gh if it doesn't exist
if [ "$AUTO" = "true" ]; then
  CREATE_ANS="y"
elif command -v gh >/dev/null 2>&1; then
  read -r -p "  Create the private repo on bmw.ghe.com via \`gh\` if missing? [Y/n] " CREATE_ANS
  CREATE_ANS="${CREATE_ANS:-y}"
fi

if [ "${CREATE_ANS:-n}" = "y" ] || [ "$CREATE_ANS" = "Y" ]; then
  # Parse host + owner/repo from either git@host:owner/repo.git or https://host/owner/repo.git
  if [[ "$REMOTE_URL" =~ ^https://([^/]+)/(.+)\.git$ ]]; then
    HOST_PART="${BASH_REMATCH[1]}"
    REPO_PART="${BASH_REMATCH[2]}"
  elif [[ "$REMOTE_URL" =~ ^[^@]+@([^:]+):(.+)\.git$ ]]; then
    HOST_PART="${BASH_REMATCH[1]}"
    REPO_PART="${BASH_REMATCH[2]}"
  else
    HOST_PART=""
    REPO_PART=""
  fi
  echo "  Checking gh for: $HOST_PART/$REPO_PART"
  if gh -R "$HOST_PART/$REPO_PART" repo view >/dev/null 2>&1; then
    ok "Remote repo exists"
  else
    if gh repo create "$HOST_PART/$REPO_PART" --private --description "Private LSL history for $NAME" >/dev/null 2>&1; then
      ok "Created private remote repo: $HOST_PART/$REPO_PART"
    else
      echo "  ⚠️  Could not auto-create remote — create manually then re-run push"
    fi
  fi
fi

# Push initial commit
if git -C "$HISTORY_DIR" push -u origin main 2>&1 | tail -3; then
  ok "Pushed initial private history to $REMOTE_URL"
else
  echo "  ⚠️  Push failed — fix remote and run: git -C $HISTORY_DIR push -u origin main"
fi

# Remove skip marker if present
rm -f "$PROJECT_DIR/.specstory/.history-repo-skipped"

step "Done: $NAME"
echo "  • Outer repo: tracked → ignored"
[ "$PURGE" = true ] && echo "  • Outer history: purged + force-pushed"
echo "  • Private repo: $HISTORY_DIR → $REMOTE_URL"
