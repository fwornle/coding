#!/bin/bash

# Launch Claude Code with MCP configuration
# Supports both native and Docker modes

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODING_REPO="$(dirname "$SCRIPT_DIR")"
export CODING_REPO

# Source agent-common setup functions
source "$SCRIPT_DIR/agent-common-setup.sh"

log() {
  echo "[Claude] $1"
}

# ============================================
# Docker Mode Detection
# ============================================
DOCKER_MODE=false

# Check for Docker mode marker file
if [ -f "$CODING_REPO/.docker-mode" ]; then
  DOCKER_MODE=true
  log "🐳 Docker mode enabled (via .docker-mode marker)"
fi

# Check for running coding-services container
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "coding-services"; then
  DOCKER_MODE=true
  log "🐳 Docker mode enabled (coding-services container running)"
fi

# Allow forcing Docker mode via environment variable
if [ "$CODING_DOCKER_MODE" = "true" ]; then
  DOCKER_MODE=true
  log "🐳 Docker mode enabled (via CODING_DOCKER_MODE env)"
fi

export CODING_DOCKER_MODE="$DOCKER_MODE"

# Generate unique session ID for this Claude session
SESSION_ID="claude-$$-$(date +%s)"
export CLAUDE_SESSION_ID="$SESSION_ID"

# Register session with Process State Manager
register_session() {
  log "Registering session: $SESSION_ID"
  node "$SCRIPT_DIR/psm-register-session.js" "$SESSION_ID" "$$" "$TARGET_PROJECT_DIR" 2>/dev/null || {
    log "Warning: Failed to register session with Process State Manager"
  }
}

# Cleanup handler for session termination
cleanup_session() {
  log "Session ending - cleaning up services..."
  node "$SCRIPT_DIR/psm-session-cleanup.js" "$SESSION_ID" 2>/dev/null || {
    log "Warning: Session cleanup failed"
  }
}

# Set up trap handlers for cleanup on exit
trap cleanup_session EXIT INT TERM

# 🚨 MANDATORY MONITORING VERIFICATION 🚨
# This MUST succeed before Claude starts - implements user's requirement for robust monitoring
verify_monitoring_systems() {
  local target_project="$1"
  
  log "🔐 MANDATORY: Verifying monitoring systems before Claude startup..."
  
  # Use the monitoring verifier with strict mode
  if node "$SCRIPT_DIR/monitoring-verifier.js" --project "$target_project" --strict; then
    log "✅ MONITORING VERIFIED: All systems operational - Claude startup approved"
    return 0
  else
    log "❌ MONITORING FAILED: Critical systems not operational"
    log "🚨 BLOCKING CLAUDE STARTUP - monitoring must be healthy first"
    log "💡 Run 'node scripts/monitoring-verifier.js --install-all' to fix"
    exit 1
  fi
}


# Use target project directory if specified, otherwise use coding repo
if [ -n "$CODING_PROJECT_DIR" ]; then
  TARGET_PROJECT_DIR="$CODING_PROJECT_DIR"
  log "Target project: $TARGET_PROJECT_DIR"
  log "Coding services from: $CODING_REPO"
else
  TARGET_PROJECT_DIR="$CODING_REPO"
  log "Working in coding repository: $TARGET_PROJECT_DIR"
fi

# Register this Claude session with Process State Manager
register_session

# Load environment configuration BEFORE starting services (from coding repo)
if [ -f "$CODING_REPO/.env" ]; then
  set -a
  source "$CODING_REPO/.env"
  set +a
fi

if [ -f "$CODING_REPO/.env.ports" ]; then
  set -a
  source "$CODING_REPO/.env.ports"
  set +a
fi

# Check if Docker daemon is actually ready (not just client installed)
# IMPORTANT: docker info succeeds with just client info, docker ps requires daemon
docker_daemon_ready() {
  docker ps >/dev/null 2>&1
}

# Ensure Docker is running (required for Qdrant vector search)
ensure_docker_running() {
  # First check if daemon is fully ready (use docker ps, not docker info!)
  if docker_daemon_ready; then
    log "✅ Docker daemon is running"
    return 0
  fi

  # Check if Docker is in a stale/broken state (processes exist but daemon not responding)
  if ps aux | grep -q "[c]om.docker.backend"; then
    log "⚠️  Docker processes exist but daemon not responding - force restarting..."
    pkill -9 -f "Docker" 2>/dev/null
    pkill -9 -f "com.docker" 2>/dev/null
    sleep 2
  fi

  log "🐳 Docker not running - attempting to start Docker Desktop..."

  # Try to start Docker Desktop on macOS
  if [ -d "/Applications/Docker.app" ]; then
    log "   Starting Docker Desktop..."
    open -a "Docker" 2>/dev/null

    log "⏳ Waiting for Docker daemon (max 30 seconds)..."
    for i in {1..30}; do
      if docker_daemon_ready; then
        log "✅ Docker daemon ready after ${i} seconds"
        return 0
      fi
      sleep 1
    done

    log "❌ Docker daemon not ready after 30 seconds"
    log "⚠️  Vector search features will be DISABLED (Qdrant unavailable)"
    log "💡 Please start Docker Desktop manually for full functionality"
    return 1
  else
    log "❌ Docker Desktop not found at /Applications/Docker.app"
    log "⚠️  Vector search features will be DISABLED (Qdrant unavailable)"
    log "💡 Install Docker Desktop: https://www.docker.com/products/docker-desktop"
    return 1
  fi
}

# Check and start Docker before starting services
if ! ensure_docker_running; then
  if [ "$DOCKER_MODE" = true ]; then
    log "❌ Docker mode requires Docker to be running"
    exit 1
  fi
  log "⚠️ WARNING: Continuing in DEGRADED mode without Docker/Qdrant"
  log "   Knowledge base will work but without semantic search capabilities"
fi

# ============================================
# Start Services (Docker or Native mode)
# ============================================

# Check if Node.js is available
if ! command -v node &> /dev/null; then
  log "Error: Node.js is required but not found in PATH"
  exit 1
fi

if [ "$DOCKER_MODE" = true ]; then
  # Docker mode: Start services via docker compose
  log "🐳 Starting coding services via Docker..."

  DOCKER_DIR="$CODING_REPO/docker"

  if [ ! -f "$DOCKER_DIR/docker-compose.yml" ]; then
    log "Error: Docker compose file not found at $DOCKER_DIR/docker-compose.yml"
    exit 1
  fi

  # Export environment variables for docker compose
  export CODING_REPO

  # Start containers
  if ! docker compose -f "$DOCKER_DIR/docker-compose.yml" up -d; then
    log "Error: Failed to start Docker containers"
    exit 1
  fi

  # Wait for health check
  log "⏳ Waiting for coding-services to be healthy..."
  for i in {1..60}; do
    if curl -sf http://localhost:8080/health >/dev/null 2>&1; then
      log "✅ coding-services healthy after ${i} seconds"
      break
    fi
    if [ $i -eq 60 ]; then
      log "❌ coding-services health check failed after 60 seconds"
      log "   Check logs: docker compose -f $DOCKER_DIR/docker-compose.yml logs"
      exit 1
    fi
    sleep 1
  done

  # Generate Docker MCP config if it doesn't exist or is outdated
  if [ ! -f "$CODING_REPO/claude-code-mcp-docker.json" ] || \
     [ "$CODING_REPO/docker/docker-compose.yml" -nt "$CODING_REPO/claude-code-mcp-docker.json" ]; then
    log "Generating Docker MCP configuration..."
    "$SCRIPT_DIR/generate-docker-mcp-config.sh" || log "Warning: Could not generate Docker MCP config"
  fi
else
  # Native mode: Start services using simple startup script
  log "Starting coding services for Claude (native mode)..."

  if ! "$CODING_REPO/start-services.sh"; then
    log "Error: Failed to start services"
    exit 1
  fi
fi

# Brief wait for services to stabilize
sleep 2

# 🚨 MANDATORY MONITORING VERIFICATION - AFTER SERVICES START 🚨
# User requirement: "monitoring should be one of the first things coding/bin/coding does"
verify_monitoring_systems "$TARGET_PROJECT_DIR"


# Check for MCP sync requirement (always from coding repo)
if [ -f "$CODING_REPO/.mcp-sync/sync-required.json" ]; then
  log "MCP memory sync required, will be handled by Claude on startup"
fi

# Run agent-common initialization (LSL, monitoring, gitignore, etc.)
agent_common_init "$TARGET_PROJECT_DIR" "$CODING_REPO"

# Find MCP config (always from coding repo)
MCP_CONFIG=""
if [ "$DOCKER_MODE" = true ]; then
  # Docker mode: Use Docker-specific MCP config with stdio proxies
  if [ -f "$CODING_REPO/claude-code-mcp-docker.json" ]; then
    MCP_CONFIG="$CODING_REPO/claude-code-mcp-docker.json"
    log "Using Docker MCP config: $MCP_CONFIG"
  else
    log "Warning: Docker MCP config not found, using default"
  fi
fi

# Fall back to standard configs
if [ -z "$MCP_CONFIG" ]; then
  if [ -f "$CODING_REPO/claude-code-mcp-processed.json" ]; then
    MCP_CONFIG="$CODING_REPO/claude-code-mcp-processed.json"
  elif [ -f "$HOME/.config/claude/claude_desktop_config.json" ]; then
    MCP_CONFIG="$HOME/.config/claude/claude_desktop_config.json"
  elif [ -f "$HOME/Library/Application Support/Claude/claude_desktop_config.json" ]; then
    MCP_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
  fi
fi

if [ -z "$MCP_CONFIG" ]; then
  log "Warning: No MCP configuration found. Some features may not work."
  log "Run './install.sh' to configure MCP servers."
fi

# Set environment variables
export CODING_AGENT="claude"
export CODING_TOOLS_PATH="$CODING_REPO"
export TRANSCRIPT_SOURCE_PROJECT="$TARGET_PROJECT_DIR"

# Change to target project directory before launching Claude
cd "$TARGET_PROJECT_DIR"
log "Changed working directory to: $(pwd)"

# Launch Claude with MCP config
if [ -n "$MCP_CONFIG" ]; then
  log "Using MCP config: $MCP_CONFIG"
  exec "$CODING_REPO/bin/claude-mcp" "$@"
else
  log "Launching Claude without MCP config"
  exec claude "$@"
fi