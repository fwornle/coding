#!/usr/bin/env bash
# Move session transcripts that the OUTER repo tracks under .specstory/history/
# into the repo's private learning checkout, <project>/.coding/ (per-repo tenancy).
#
# The launcher refuses to set up .coding/ over tracked transcripts
# (lib/history/repo-link.mjs ensure → "tracked-history") and points here.
#
# Usage:
#   migrate-history-to-private.sh <project-dir> [--purge] [--auto] [--remote URL]
#
# Phases:
#   A. Untrack .specstory/history/ in the outer repo and commit (non-destructive:
#      the files stay on disk, and in the outer repo's past commits).
#   B. (--purge only) Rewrite outer repo history with git-filter-repo to remove
#      .specstory/history/ from every past commit, then FORCE-PUSH to origin.
#      DESTRUCTIVE: rewrites shared history. Anyone with a clone must re-clone.
#      The on-host backup is kept at <project>/../<project>.pre-purge-<ts>.bundle.
#   C. Hand over to lib/history/repo-link.mjs ensure — the same code every
#      `coding` launch runs: the transcripts move into .coding/history/, the
#      private remote (default: what the launcher offers, <user>/<name>-history)
#      is created if missing and linked, the choice is recorded, and .coding/ is
#      excluded through .git/info/exclude. Migrated transcripts are committed
#      locally, never pushed from here — `coding sync --push` does that.
#
# Safety:
#   - Phase B requires --purge AND an explicit "yes-purge-<repo>" typed back.
#   - Working tree must be clean outside .specstory/history/ before phase A.

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
      sed -n '2,28p' "$0"
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

step() { echo ""; echo "── $1"; }
fail() { echo "❌ $1" >&2; exit 1; }
ok()   { echo "✅ $1"; }

# ----------------------------- preflight ------------------------------------
step "Preflight: $NAME at $PROJECT_DIR"
git -C "$PROJECT_DIR" rev-parse --git-dir >/dev/null 2>&1 \
  || fail "$PROJECT_DIR is not a git repo"

OUTER_REMOTE="$(git -C "$PROJECT_DIR" config --get remote.origin.url 2>/dev/null || true)"
echo "  Outer origin: ${OUTER_REMOTE:-(none)}"

# Permit ANY change inside .specstory/history/ (it migrates with us); block
# anything else.
#
# This deliberately matches every porcelain status code, not just '??'. The
# earlier '^\?\? ' pattern permitted untracked files only, which made the
# script refuse to start on exactly the repos it exists to repair: once the
# outer repo tracks history files, the live LSL writer keeps them permanently
# ' M', so preflight failed on a modification that phase A was about to
# untrack anyway. Racing it with a commit does not help — the writer touches
# the tree again within seconds.
DIRTY="$(git -C "$PROJECT_DIR" status --porcelain | grep -vE '^.. "?\.specstory/history/' || true)"
if [ -n "$DIRTY" ]; then
  echo "$DIRTY" | sed 's/^/  /'
  fail "Working tree not clean (changes outside .specstory/history/) — commit or stash first"
fi

OUTER_BRANCH="$(git -C "$PROJECT_DIR" rev-parse --abbrev-ref HEAD)"
echo "  Outer branch: $OUTER_BRANCH"

TRACKED_COUNT="$(git -C "$PROJECT_DIR" ls-files .specstory/history 2>/dev/null | wc -l | tr -d ' ')"
echo "  Tracked history files: $TRACKED_COUNT"

# Default remote URL: the same derivation the launcher offers
# (lib/history/repo-link.mjs defaultRemote — LSL_HISTORY_REMOTE_TEMPLATE, else
# the gh user for bmw.ghe.com, else next to the outer repo's own remote).
if [ -z "$REMOTE_URL" ]; then
  REMOTE_URL="$(node "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/history/repo-link.mjs" default-remote "$PROJECT_DIR" 2>/dev/null || true)"
fi
if [ -z "$REMOTE_URL" ]; then
  echo "❌ No default remote could be derived for $NAME — pass one: $(basename "$0") $PROJECT_DIR --remote <url>" >&2
  exit 1
fi
echo "  Private history remote: $REMOTE_URL"

# ----------------------------- phase A --------------------------------------
if [ "$TRACKED_COUNT" -gt 0 ]; then
  step "Phase A: untrack .specstory/history/ in outer repo"
  if [ "$AUTO" != "true" ]; then
    read -r -p "Proceed with: git rm -r --cached .specstory/history/ + commit + push? [y/N] " ans
    case "$ans" in y|Y|yes) ;; *) fail "User aborted phase A" ;; esac
  fi

  git -C "$PROJECT_DIR" rm -r -q --cached .specstory/history/
  # No .gitignore edit: repo-link (phase C) excludes .coding/ and the legacy path
  # through .git/info/exclude — a tracked .gitignore is the project's, not ours.
  git -C "$PROJECT_DIR" commit -q -m "chore: stop tracking .specstory/history (session logs move to the private learning repo)"
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
step "Phase C: move into the private learning checkout (.coding/)"
TOOLS_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if ! RESULT="$(node "$TOOLS_REPO/lib/history/repo-link.mjs" ensure "$PROJECT_DIR" --remote "$REMOTE_URL" --no-ask)"; then
  fail "repo-link ensure failed — see the messages above"
fi
echo "  $RESULT"
case "$RESULT" in
  *'"tracked-history"'*) fail "the outer repo still tracks .specstory/history — phase A did not run (pass a clean tree)" ;;
esac
[ -d "$PROJECT_DIR/.coding/history" ] || fail "no $PROJECT_DIR/.coding/history after ensure"
ok "Transcripts in $PROJECT_DIR/.coding/history ($(find "$PROJECT_DIR/.coding/history" -type f -not -path '*/.git/*' | wc -l | tr -d ' ') files)"

step "Done: $NAME"
echo "  • Outer repo: .specstory/history untracked (no .gitignore change; .coding/ excluded via .git/info/exclude)"
[ "$PURGE" = true ] && echo "  • Outer history: purged + force-pushed"
echo "  • Learning checkout: $PROJECT_DIR/.coding → $REMOTE_URL"
echo "  • Push the migrated transcripts when ready:  coding sync --push"
