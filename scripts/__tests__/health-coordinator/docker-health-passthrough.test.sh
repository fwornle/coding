#!/bin/bash
# SPEC R7: Docker .State.Health.Status surfaced as-is via .container.healthcheck.
#
# Wave 0 stub: bash -n passes; runtime fails until plan 33-02 lands the
# coordinator and its docker-inspect probe.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_helpers.sh"
docker_status=$(docker inspect coding-services --format '{{.State.Health.Status}}')
coordinator_status=$(curl -sf "$URL/health/state" | jq -r '.container.healthcheck')
[ "$docker_status" = "$coordinator_status" ] || { echo "FAIL: docker=$docker_status coordinator=$coordinator_status"; exit 1; }
echo "PASS: docker.Health.Status=$docker_status surfaced as-is"
