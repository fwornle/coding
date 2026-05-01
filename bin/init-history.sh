#!/usr/bin/env bash
# bin/init-history.sh — ensure private session-history dirs exist.
#
# Called by bin/coding on every launch and by install.sh during setup. The
# .specstory/history/ tree is excluded from the public 'coding' repo and
# lives in a separate private repo (see install.sh and the
# CODING_HISTORY_REPO entry in .env). Classification logs and operational
# logs both live inside the private repo at .specstory/history/logs/.
# LSL files are organized by year/month at .specstory/history/YYYY/MM/<file>.md.
#
# Behaviour:
#   - If CODING_HISTORY_REPO is configured AND .specstory/history/ has no
#     .git checkout AND the dir is empty: clone the private repo into it.
#   - If clone fails (auth/network) we fall through silently — services keep
#     working with an empty local dir.
#   - Always: mkdir -p the dirs LSL services write to. Most writers already
#     auto-create on first write, but pre-empting startup races is cheap.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

HIST_DIR=".specstory/history"
CLASS_DIR=".specstory/history/logs/classification"

# Source CODING_HISTORY_REPO from .env without polluting the parent shell.
history_repo=""
if [ -f .env ]; then
  history_repo="$(grep -E '^CODING_HISTORY_REPO=' .env 2>/dev/null | head -1 | cut -d= -f2- || true)"
  # Strip surrounding quotes if any
  history_repo="${history_repo%\"}"
  history_repo="${history_repo#\"}"
fi

if [ -n "$history_repo" ] && [ ! -d "$HIST_DIR/.git" ]; then
  if [ ! -d "$HIST_DIR" ] || [ -z "$(ls -A "$HIST_DIR" 2>/dev/null)" ]; then
    mkdir -p "$(dirname "$HIST_DIR")"
    if git clone --quiet "$history_repo" "$HIST_DIR" 2>/dev/null; then
      echo "[init-history] cloned $history_repo → $HIST_DIR"
    else
      echo "[init-history] clone of $history_repo failed (auth/network?) — using empty local dir"
    fi
  fi
  # Existing non-empty directory and no .git: leave it. install.sh prints
  # the seed-the-private-repo recipe; we don't want to silently overwrite.
fi

# Always ensure the dirs exist so LSL services don't crash on a fresh
# checkout that hasn't been through install.sh.
mkdir -p "$HIST_DIR" "$CLASS_DIR"
