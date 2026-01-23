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

# Wait for Memgraph
if [ -n "$MEMGRAPH_HOST" ]; then
    wait_for_service "Memgraph" "$MEMGRAPH_HOST" "${MEMGRAPH_PORT:-7687}"
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
        if [ -z "${!key}" ]; then
            export "$key=$value"
        fi
    done < /coding/.env
fi

# Activate Python virtual environment for code-graph-rag
export VIRTUAL_ENV=/coding/integrations/code-graph-rag/.venv
export PATH="$VIRTUAL_ENV/bin:$PATH"

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
echo "  Code-Graph-RAG:      http://localhost:${CODE_GRAPH_RAG_PORT:-3850}"
echo "  Health Dashboard:    http://localhost:${HEALTH_DASHBOARD_PORT:-3032}"
echo ""
echo "=== Starting supervisord ==="
echo ""

# ===========================================
# Start supervisord or passed command
# ===========================================

exec "$@"
