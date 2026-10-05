#!/usr/bin/env bash
# bin/init-history.sh — set up the tools repo's own learning checkout.
#
# Called by bin/coding on every launch and by install.sh during setup.
#
# The tools repo is an ordinary linked repo (per-repo tenancy T7): what coding
# learns about itself lives in its `coding-history` checkout, like any repo's:
#
#   <coding>/.coding/                 the coding-history repo (or untracked, on skip)
#   ├── history/                      LSL transcripts, YYYY/MM/<file> + logs/
#   └── kb/                           knowledge exports, insight documents
#       └── insights/                 UKB insight documents + their images
#
#   <coding>/knowledge-management/insights →  ../.coding/kb/insights (symlink)
#
# The symlink keeps every writer that addresses the old insights path working
# unchanged (semantic-analysis, obs-api, the viewer). Transcripts need none:
# every reader resolves .coding/history (T9). Both paths are gitignored in this
# repo, so a UKB run leaves `git status` clean here.
#
# The checkout itself is lib/history/repo-link.mjs's job — the same code every
# other repo goes through. CODING_HISTORY_REPO (written to .env by install.sh)
# answers its question; without it nothing is asked from here (this runs on
# every launch, non-interactively), and the launcher asks when an agent starts
# in this repo. Never pushes: publishing transcripts is `coding sync --push`.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Source CODING_HISTORY_REPO from .env without polluting the parent shell.
history_repo=""
if [ -f .env ]; then
  history_repo="$(grep -m1 -E '^CODING_HISTORY_REPO=' .env 2>/dev/null | cut -d= -f2- || true)"
  history_repo="${history_repo%\"}"
  history_repo="${history_repo#\"}"
fi

args=(ensure "$REPO_ROOT" --no-ask)
[ -n "$history_repo" ] && args+=(--remote "$history_repo")
node "$REPO_ROOT/lib/history/repo-link.mjs" "${args[@]}" </dev/null >/dev/null \
  || echo "[init-history] learning checkout setup did not complete" >&2

# The insight documents. A real directory here is either the pre-T7 tracked
# tree (still tracked: leave it — that checkout has not got the move yet) or
# what is left of it after the move (untracked leftovers: fold them in).
INSIGHTS="knowledge-management/insights"
target=".coding/kb/insights"
mkdir -p "$target"
if [ -d "$INSIGHTS" ] && [ ! -L "$INSIGHTS" ]; then
  if [ -z "$(git ls-files -- "$INSIGHTS" | head -1)" ]; then
    for entry in "$INSIGHTS"/* "$INSIGHTS"/.[!.]*; do
      [ -e "$entry" ] || continue
      name="$(basename "$entry")"
      if [ -e "$target/$name" ]; then
        # Same name on both sides: merge a directory, keep the existing file.
        if [ -d "$entry" ] && [ -d "$target/$name" ]; then
          mv -n "$entry"/* "$target/$name"/ 2>/dev/null || true
          rmdir "$entry" 2>/dev/null || true
        fi
      else
        mv "$entry" "$target/$name"
      fi
    done
    if rmdir "$INSIGHTS" 2>/dev/null; then
      echo "[init-history] moved $INSIGHTS → $target"
    else
      echo "[init-history] $INSIGHTS: entries already in $target left in place" >&2
    fi
  fi
fi
if [ ! -e "$INSIGHTS" ] && [ ! -L "$INSIGHTS" ]; then
  mkdir -p "$(dirname "$INSIGHTS")"
  ln -s ../.coding/kb/insights "$INSIGHTS"
fi
