#!/usr/bin/env bash
# Pre-commit hook: guard OKB baseline (.data/knowledge-export/*.json) commits
#
# Prevents accidental commits of auto-exported knowledge base files.
# These files are updated automatically by GraphKnowledgeExporter whenever
# entities change. They should only be committed intentionally as part of
# a "docs: update KB" commit.
#
# To bypass (when you really intend to commit KB data):
#   git commit -m "docs: update KB - <description>"
#   git commit --no-verify  (escape hatch)

set -euo pipefail

# Files that require an explicit KB-update commit message
# Covers both coding repo (.data/knowledge-export/) and OKB submodule (.data/exports/)
KB_PATTERN='\.data/(knowledge-export|exports)/.*\.json$'

# Check if any staged files match the KB pattern
staged_kb_files=$(git diff --cached --name-only | grep -E "$KB_PATTERN" || true)

if [ -z "$staged_kb_files" ]; then
    exit 0  # No KB files staged — nothing to guard
fi

# KB files are staged — check if the commit message indicates an intentional KB update.
# For hooks that run BEFORE the message is finalized, we check:
#   1. The commit message file (if using -m or -F)
#   2. The MERGE_MSG / SQUASH_MSG (if merging)
#
# Note: git pre-commit hook does NOT have access to the commit message.
# We must use a different strategy: unstage KB files and warn the user.

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  OKB BASELINE GUARD                                        ║"
echo "║                                                            ║"
echo "║  The following .data/knowledge-export/ files are staged:   ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "$staged_kb_files" | while read -r f; do echo "  - $f"; done
echo ""
echo "These files are auto-exported by GraphKnowledgeExporter and"
echo "should only be committed as part of an intentional KB update."
echo ""
echo "Options:"
echo "  1. Unstage them:    git reset HEAD .data/knowledge-export/"
echo "     then re-commit your actual changes"
echo ""
echo "  2. Commit KB only:  git add .data/knowledge-export/ && \\"
echo "                      git commit -m 'docs: update KB'"
echo ""
echo "  3. Force this commit: git commit --no-verify"
echo ""

exit 1
