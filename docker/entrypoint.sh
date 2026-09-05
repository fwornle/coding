#!/bin/bash
# Entrypoint script for coding-services container
# Waits for databases to be ready, then starts supervisord

set -e

echo "=== Coding Services Container Starting ==="

# ===========================================
# Wait for databases to be ready
# ===========================================

wait_for_service() {
    local name=$1
    local host=$2
    local port=$3
    local max_attempts=${4:-30}
    local attempt=1

    echo "Waiting for $name ($host:$port)..."

    while [ $attempt -le $max_attempts ]; do
        # Use timeout with bash TCP check
        if timeout 2 bash -c "echo >/dev/tcp/$host/$port" 2>/dev/null; then
            echo "$name is ready!"
            return 0
        fi
        echo "  Attempt $attempt/$max_attempts - $name not ready yet..."
        sleep 2
        attempt=$((attempt + 1))
    done

    echo "WARNING: $name may not be ready after $max_attempts attempts, continuing anyway..."
    return 0  # Don't fail - let supervisord handle it
}

# Wait for Qdrant
if [ -n "$QDRANT_URL" ]; then
    QDRANT_HOST=$(echo "$QDRANT_URL" | sed -e 's|http://||' -e 's|:.*||')
    wait_for_service "Qdrant" "$QDRANT_HOST" 6333
fi

# Wait for Redis
if [ -n "$REDIS_URL" ]; then
    REDIS_HOST=$(echo "$REDIS_URL" | sed -e 's|redis://||' -e 's|:.*||')
    wait_for_service "Redis" "$REDIS_HOST" 6379
fi

echo "=== All databases ready ==="

# ===========================================
# Environment setup
# ===========================================

# Load .env file if it exists (only set vars not already defined by docker-compose)
if [ -f /coding/.env ]; then
    echo "Loading environment from /coding/.env (non-conflicting vars only)"
    while IFS='=' read -r key value; do
        # Skip comments, empty lines, and vars already set by docker-compose
        [[ "$key" =~ ^[[:space:]]*# ]] && continue
        [[ -z "$key" ]] && continue
        key=$(echo "$key" | xargs)  # trim whitespace
        # T2 egress lockdown: never import raw provider keys/tokens from the
        # bind-mounted host .env — all LLM/embedding egress routes via the
        # host llm-cli-proxy (:12435). Importing them here would silently
        # re-enable direct provider calls from in-container SDK clients.
        case "$key" in
            *_API_KEY|*_TOKEN|*_MANAGEMENT_KEY) continue ;;
        esac
        if [ -z "${!key}" ]; then
            export "$key=$value"
        fi
    done < /coding/.env
fi

# ===========================================
# Create necessary directories
# ===========================================

mkdir -p /coding/.data/knowledge-graph
mkdir -p /coding/.specstory/history
mkdir -p /var/log/supervisor

echo "=== Data directories ready ==="

# ===========================================
# Print startup info
# ===========================================

echo ""
echo "=== Service Ports ==="
echo "  VKB Server:          http://localhost:${VKB_PORT:-8080}"
echo "  Browser Access SSE:  http://localhost:${BROWSER_ACCESS_PORT:-3847}"
echo "  Semantic Analysis:   http://localhost:${SEMANTIC_ANALYSIS_PORT:-3848}"
echo "  Constraint Monitor:  http://localhost:${CONSTRAINT_MONITOR_PORT:-3849}"
echo "  Graphify MCP:        http://localhost:${GRAPHIFY_MCP_PORT:-3851}/mcp"
echo "  Health Dashboard:    http://localhost:${HEALTH_DASHBOARD_PORT:-3032}"
echo ""
# ===========================================
# Feature gating
# ===========================================
#
# The container cannot run the feature resolver: ~/.coding/features.yaml is on
# the host and never mounted. It reads the flat snapshot the host writes on
# every launch (.coding/runtime/features.json, mounted read-only) and turns it
# into a supervisord include that flips `autostart` to false for the programs
# whose feature is off.
#
# An override rather than a rewrite: supervisord.conf stays the single place
# every program's command and logging are defined, and a missing or unreadable
# snapshot leaves the directory empty, which starts everything — the historical
# behaviour. Failing open is deliberate here; a container that silently ran
# nothing because a JSON file was late would be far harder to diagnose than one
# that ran too much.
#
# PROGRAM_FEATURES is the container-side half of the mapping in
# docs/architecture/features.md. tests/features/container-gating.test.mjs
# asserts it covers exactly the [program:...] sections in supervisord.conf and
# names only features that exist, so the two cannot drift.

FEATURES_SNAPSHOT="/coding/.coding/runtime/features.json"
FEATURES_DIR="/etc/supervisor/features.d"
mkdir -p "$FEATURES_DIR"
rm -f "$FEATURES_DIR"/*.conf

PROGRAM_FEATURES="\
semantic-analysis:knowledge \
vkb-server:knowledge \
embedding-listener:knowledge \
graphify:codegraph \
constraint-monitor:constraints \
constraint-dashboard:constraints \
constraint-dashboard-api:constraints \
health-dashboard:health \
health-dashboard-frontend:health"

if [ -f "$FEATURES_SNAPSHOT" ]; then
    echo "=== Applying feature configuration ==="
    disabled_programs=""
    for pair in $PROGRAM_FEATURES; do
        program="${pair%%:*}"
        feature="${pair##*:}"
        # `node -e` rather than jq: jq is not installed in this image, node is.
        enabled=$(node -e '
            const snap = require(process.argv[1]);
            const value = snap.features?.[process.argv[2]];
            // An unknown feature reads as enabled, so a snapshot written by an
            // older host cannot silently switch a program off.
            process.stdout.write(value === false ? "false" : "true");
        ' "$FEATURES_SNAPSHOT" "$feature" 2>/dev/null || echo "true")

        if [ "$enabled" = "false" ]; then
            printf '[program:%s]\nautostart=false\n\n' "$program" >> "$FEATURES_DIR/disabled.conf"
            disabled_programs="$disabled_programs $program"
        fi
    done

    if [ -n "$disabled_programs" ]; then
        echo "  Disabled by configuration:$disabled_programs"
    else
        echo "  All container programs enabled"
    fi
    echo ""
else
    echo "=== No feature snapshot (${FEATURES_SNAPSHOT}) — starting everything ==="
    echo ""
fi

echo "=== Starting supervisord ==="
echo ""

# ===========================================
# Start supervisord or passed command
# ===========================================

exec "$@"
