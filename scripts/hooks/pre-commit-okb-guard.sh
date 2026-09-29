#!/usr/bin/env bash
# Pre-commit hook: keep knowledge-base content out of a code commit.
#
# This one template is installed into TWO kinds of repository, and since the
# data-root split they need different answers:
#
#   1. The tools repo. `.data/knowledge-export/`, `.data/knowledge-graph/` and
#      `.data/observation-export/` LEFT it — they live under the data root now
#      (`~/.coding/data/<scope>/kb/…`, see lib/paths/data-home.cjs) and are
#      gitignored here. Nothing under them can legitimately be staged again, so
#      the old "commit them separately" advice is wrong: separately is still in
#      the wrong repository. A hit means a .gitignore re-include crept back, or
#      someone used `git add -f`, and 119 MB of one developer's knowledge base
#      is about to re-enter every clone.
#
#   2. An OKB submodule inside a consumer repo. There `.data/exports/*.json` IS
#      the live baseline, tracked on purpose, and the original semantics still
#      hold: a KB-only commit is fine, mixing KB with code is not.
#
# The two were previously one pattern covering both, which is why the tools-repo
# half went stale silently when the trees moved: it kept matching paths that no
# longer exist, and fired on their DELETIONS during the migration commit.
#
# To bypass: git commit --no-verify

set -euo pipefail

# Phase 44 S-3: snapshot/restore bypass (SnapshotManager sets OKB_SNAPSHOT=1 via execGit env)
if [ "${OKB_SNAPSHOT:-0}" = "1" ]; then
    exit 0
fi

staged_all=$(git diff --cached --name-only)
[ -n "$staged_all" ] || exit 0

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || echo '')

# The discriminator is the path resolver itself: only the tools repo ships it,
# and its presence is exactly the condition under which the trees below have a
# different home to be in. Checking for a marker file rather than the repo's
# name keeps this working for a checkout under any name.
if [ -n "$repo_root" ] && [ -f "$repo_root/lib/paths/data-home.cjs" ]; then
    # ── 1. tools repo: these trees are not allowed back ──────────────────────
    MOVED_PATTERN='^\.data/(knowledge-export|knowledge-graph|observation-export)/'
    staged_moved=$(echo "$staged_all" | grep -E "$MOVED_PATTERN" || true)

    # Deletions are how the content LEAVES, so they must stay allowed — the
    # migration commit itself was 507 of them, and this guard blocked it.
    if [ -n "$staged_moved" ]; then
        staged_moved=$(git diff --cached --name-only --diff-filter=d \
            | grep -E "$MOVED_PATTERN" || true)
    fi

    [ -n "$staged_moved" ] || exit 0

    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  KNOWLEDGE BASE CONTENT IN THE TOOLS REPO                    ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "These trees moved to the data root and are gitignored here:"
    echo ""
    echo "$staged_moved" | while read -r f; do echo "  - $f"; done
    echo ""
    echo "They belong under \$(bin/coding-data-home)/kb/ — a per-machine,"
    echo "per-scope location, so a colleague's clone does not start as a copy"
    echo "of this machine's knowledge base."
    echo ""
    echo "If these are staged, either a .gitignore re-include came back or they"
    echo "were added with 'git add -f'. Check .gitignore around the"
    echo "'.data/knowledge-*' block before unstaging:"
    echo ""
    echo "  git reset HEAD .data/knowledge-export .data/knowledge-graph .data/observation-export"
    echo ""
    echo "Escape hatch: git commit --no-verify"
    echo ""
    exit 1
fi

# ── 2. OKB submodule: KB-only commits fine, mixed commits blocked ────────────
KB_PATTERN='\.data/(knowledge-export|exports)/.*\.json$'

staged_kb=$(echo "$staged_all" | grep -E "$KB_PATTERN" || true)
[ -n "$staged_kb" ] || exit 0

staged_other=$(echo "$staged_all" | grep -vE "$KB_PATTERN" || true)
[ -n "$staged_other" ] || exit 0

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  OKB BASELINE GUARD                                          ║"
echo "║                                                              ║"
echo "║  KB export files are staged alongside other changes.         ║"
echo "║  Please commit them separately.                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "KB files staged:"
echo "$staged_kb" | while read -r f; do echo "  - $f"; done
echo ""
echo "Other files staged:"
echo "$staged_other" | while read -r f; do echo "  - $f"; done
echo ""
echo "Options:"
echo "  1. Unstage KB files:  git reset HEAD .data/exports/"
echo "  2. Unstage other files and commit KB only"
echo "  3. Force: git commit --no-verify"
echo ""

exit 1
