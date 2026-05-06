#!/bin/bash
# Full Phase 33 acceptance suite. Runs every test in this directory.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_helpers.sh"

echo "Phase 33 health-coordinator full suite"
echo "URL=$URL"
echo ""

bash "$SCRIPT_DIR/quick.sh" || exit 1

for t in \
  docker-health-passthrough.test.sh \
  injection.test.sh \
  two-session-agreement.test.sh \
  keepalive.test.sh \
  detection-latency.test.sh \
  eviction.test.sh
do
  echo ""
  echo "=== Running $t ==="
  bash "$SCRIPT_DIR/$t" || { echo "FAIL: $t"; exit 1; }
done

echo ""
echo "=== Running rules-schema.test.mjs ==="
node --test "$SCRIPT_DIR/rules-schema.test.mjs"

echo ""
echo "All Phase 33 acceptance tests passed."
