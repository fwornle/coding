#!/bin/bash
# Copy shared workflow types to consumer directories.
#
# Copies all .ts files from shared/workflow-types/ to both the backend
# (mcp-server-semantic-analysis) and dashboard (system-health-dashboard)
# source trees. Test files are excluded from consumer copies.
#
# Run from project root: ./scripts/copy-shared-types.sh

set -euo pipefail

SRC="shared/workflow-types"
BACKEND_DEST="integrations/mcp-server-semantic-analysis/src/shared/workflow-types"
DASHBOARD_DEST="integrations/system-health-dashboard/src/shared/workflow-types"

mkdir -p "$BACKEND_DEST" "$DASHBOARD_DEST"
cp "$SRC"/*.ts "$BACKEND_DEST/"
cp "$SRC"/*.ts "$DASHBOARD_DEST/"

# Remove test files from consumer directories
rm -f "$BACKEND_DEST"/*.test.ts "$DASHBOARD_DEST"/*.test.ts

echo "Shared types copied to backend and dashboard"
