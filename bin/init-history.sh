#!/usr/bin/env bash
# bin/init-history.sh — put the tools repo's session history in the data home.
#
# Called by bin/coding on every launch and by install.sh during setup.
#
# WHERE HISTORY LIVES. Session transcripts are user data, so they live in the
# per-scope data home (lib/paths/data-home.cjs), not in this public checkout:
#
#   ~/.coding/data/<scope>/            the user-data repo (when one is configured)
#   ├── history/                       LSL transcripts, YYYY/MM/<file> + logs/
#   ├── kb/                            knowledge worth keeping
#   └── var/                           machine-local churn, git-ignored
#
#   $CODING_REPO/.specstory/history  →  ~/.coding/data/<scope>/history   (symlink)
#
# The symlink keeps every writer that addresses `.specstory/history` working
# unchanged, and makes the history of whoever installed this checkout THEIRS:
# a colleague's clone of `coding` no longer carries a slot that their own
# installer might fill from the tools author's history repo.
#
# Behaviour:
#   - A REAL, non-empty .specstory/history directory is a pre-data-home install
#     (including the developer's own machine). It is left exactly as it is; the
#     move is deliberate (scripts/migrate-data-home.mjs), never a side effect of
#     launching an agent.
#   - No resolvable scope (the placeholder): stay in the repo, as before. A
#     history written under the placeholder's data home would be stranded the
#     moment the user names their scope.
#   - Otherwise, when CODING_HISTORY_REPO is configured and the data home has no
#     checkout yet and holds no history or knowledge: clone it. A data-home
#     repo (it has a top-level history/) becomes the data home itself; an older
#     transcripts-only repo (YYYY/ at its root, like the original
#     `coding-history`) is cloned INTO history/, so it keeps working unchanged.
#   - Then the symlink, when .specstory/history is absent or an empty dir.
#
# DELIBERATELY CLONE-ONLY. This runs on every `bin/coding` launch, so it must
# never push: publishing verbatim transcripts is a decision, not a side effect
# of starting an agent. Creating the remote and seeding it from a local snapshot
# is install.sh's job (`history_repo_seed`), where it is confirmed explicitly and
# gated behind CODING_HISTORY_PUSH=1 for unattended runs.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

LINK=".specstory/history"

# Source CODING_HISTORY_REPO from .env without polluting the parent shell.
history_repo=""
if [ -f .env ]; then
  history_repo="$(grep -m1 -E '^CODING_HISTORY_REPO=' .env 2>/dev/null | cut -d= -f2- || true)"
  history_repo="${history_repo%\"}"
  history_repo="${history_repo#\"}"
fi

# Only fills in a missing tree; never touches one that already has content.
ensure_legacy_dirs() {
  mkdir -p "$LINK" "$LINK/logs/classification"
}

is_empty_dir() {
  [ -d "$1" ] && [ -z "$(ls -A "$1" 2>/dev/null)" ]
}

# 1. A pre-data-home install: a real directory with content. Leave it alone.
if [ -d "$LINK" ] && [ ! -L "$LINK" ] && ! is_empty_dir "$LINK"; then
  ensure_legacy_dirs
  exit 0
fi

# 2. No scope to file the history under — keep the old in-repo layout.
if ! scope="$("$REPO_ROOT/bin/coding-data-home" --require-scope 2>/dev/null)"; then
  ensure_legacy_dirs
  exit 0
fi
data_home="$("$REPO_ROOT/bin/coding-data-home" --ensure)"
hist_dir="$data_home/history"

# 3. Clone the configured repo into a data home that has nothing of its own.
if [ -n "$history_repo" ] && [ ! -e "$data_home/.git" ] && [ ! -e "$hist_dir/.git" ] \
  && is_empty_dir "$hist_dir" && is_empty_dir "$data_home/kb"; then
  # One clone implementation for every learning repo (lib/history/repo-link.mjs).
  # --nest keeps this data home's historical handling of a transcripts-only repo
  # (YYYY/ at its root, like the original `coding-history`): it is cloned INTO
  # history/ and keeps working unchanged. A data-home repo (top-level history/)
  # becomes the data home itself; local untracked files such as var/ are kept.
  if ! node "$REPO_ROOT/lib/history/repo-link.mjs" clone "$data_home" "$history_repo" --nest 2>&1 \
      | sed 's/^\[history\]/[init-history]/'; then
    echo "[init-history] clone of $history_repo failed (auth/network?) — using empty local dir"
  fi
fi

mkdir -p "$hist_dir/logs/classification"

# 4. Point the repo's .specstory/history at it.
if [ -L "$LINK" ]; then
  current="$(readlink "$LINK")"
  if [ "$current" != "$hist_dir" ]; then
    # Somebody pointed it elsewhere on purpose (or at another scope's data
    # home). Say so rather than silently re-pointing it.
    echo "[init-history] $LINK → $current, not this scope's $hist_dir — left as is" >&2
  fi
elif [ ! -e "$LINK" ] || is_empty_dir "$LINK"; then
  [ -d "$LINK" ] && rmdir "$LINK"
  mkdir -p "$(dirname "$LINK")"
  ln -s "$hist_dir" "$LINK"
  echo "[init-history] $LINK → $hist_dir (scope: $scope)"
fi
