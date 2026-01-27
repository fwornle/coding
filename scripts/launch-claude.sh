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
# Docker Mode Transition Check
# ============================================

# Wait if a mode transition is in progress
check_transition_lock() {
  local lock_file="$CODING_REPO/.transition-in-progress"
  local wait_count=0
  local max_wait=60  # Max 60 seconds wait

  while [ -f "$lock_file" ] && [ $wait_count -lt $max_wait ]; do
    if [ $wait_count -eq 0 ]; then
      log "⏳ Docker mode transition in progress, waiting..."
    fi
    sleep 1
    ((wait_count++))
  done

  if [ -f "$lock_file" ]; then
    log "⚠️  Transition still in progress after ${max_wait}s, proceeding anyway..."
  elif [ $wait_count -gt 0 ]; then
    log "✅ Transition complete, continuing startup"
  fi
}

check_transition_lock

# ============================================
# Docker Mode Detection
# ============================================
DOCKER_MODE=false

# Check for Docker mode marker file
if [ -f "$CODING_REPO/.docker-mode" ]; then
  DOCKER_MODE=true
  log "🐳 Docker mode enabled (via .docker-mode marker)"
fi

# Check for running coding-services container (with timeout to prevent hang if Docker not running)
if timeout 5 docker ps --format '{{.Names}}' 2>/dev/null | grep -q "coding-services"; then
  DOCKER_MODE=true
  log "🐳 Docker mode enabled (coding-services container running)"
fi

# Allow forcing Docker mode via environment variable
if [ "$CODING_DOCKER_MODE" = "true" ]; then
  DOCKER_MODE=true
  log "🐳 Docker mode enabled (via CODING_DOCKER_MODE env)"
fi

export CODING_DOCKER_MODE="$DOCKER_MODE"

# ============================================
# Platform Detection
# ============================================
PLATFORM="$(uname -s)"
case "$PLATFORM" in
  Darwin) PLATFORM="macos" ;;
  Linux)  PLATFORM="linux" ;;
  *)      PLATFORM="unknown" ;;
esac

# Early Docker launch: start Docker immediately so it boots in parallel with setup
# NOTE: We do NOT kill Docker processes here - that's destructive and breaks other sessions
DOCKER_LAUNCH_START=""
DOCKER_FRESH_START=false
if [ "$DOCKER_MODE" = true ]; then
  log "🔍 Checking Docker status..."

  # Check if docker client is installed
  if ! command -v docker &>/dev/null; then
    log "❌ Docker client not found in PATH"
    log "💡 Install Docker Desktop: https://www.docker.com/products/docker-desktop"
  elif docker ps >/dev/null 2>&1; then
    # Docker is already running - nothing to do
    log "   ✓ Docker daemon is responding"
  else
    # Docker client exists but daemon not running
    DOCKER_PS_ERROR=$(docker ps 2>&1)
    log "   ✗ Docker daemon not responding"
    log "   ✗ Error: ${DOCKER_PS_ERROR:0:150}"

    if [ "$PLATFORM" = "macos" ]; then
      if [ ! -d "/Applications/Docker.app" ]; then
        log "❌ Docker Desktop not installed"
        log "💡 Install from: https://www.docker.com/products/docker-desktop"
      else
        # Check if Docker Desktop process is running
        DOCKER_PIDS=$(pgrep -f "Docker Desktop" 2>/dev/null || true)

        if [ -n "$DOCKER_PIDS" ]; then
          # Process running but daemon not responding - wait briefly then check again
          log "   Docker Desktop process running (PIDs: $DOCKER_PIDS)"
          log "⏳ Waiting 5s for daemon..."
          sleep 5
          if ! docker ps >/dev/null 2>&1; then
            log "⚠️  Docker Desktop running but daemon not responding - may be crashed/hung"
            log "💡 Check Docker Desktop window for error dialogs"
            log "💡 Try: Quit Docker Desktop and restart it"
          fi
        else
          # Docker Desktop not running - start it and bring to foreground
          log "🐳 Starting Docker Desktop..."
          DOCKER_LAUNCH_START=$(date +%s)
          DOCKER_FRESH_START=true

          # Use open -F to bring to foreground
          open -F -a "Docker" 2>/dev/null

          # Wait for process to appear (takes 3-5s normally)
          sleep 5

          # Verify process started
          DOCKER_PIDS=$(pgrep -f "Docker Desktop" 2>/dev/null || true)
          if [ -n "$DOCKER_PIDS" ]; then
            log "   ✓ Docker Desktop started (PIDs: $DOCKER_PIDS)"
          else
            log "⚠️  Docker Desktop process not found after 5s"
            log "💡 Check if Docker Desktop window appeared"
            log "💡 If not, try starting it manually from Applications"
          fi
        fi
      fi
    elif [ "$PLATFORM" = "linux" ]; then
      if command -v systemctl &>/dev/null && systemctl is-enabled docker &>/dev/null; then
        log "🐳 Starting Docker via systemd..."
        sudo systemctl start docker 2>/dev/null || true
        DOCKER_LAUNCH_START=$(date +%s)
      else
        log "💡 Start Docker: sudo systemctl start docker"
      fi
    fi
  fi
fi

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
# Timeout: 30 seconds - Docker Desktop normally starts in ~15-20s
# If it doesn't start by then, it won't (dialog blocking, crash, etc.)
DOCKER_TIMEOUT=30

ensure_docker_running() {
  # Already running?
  if docker_daemon_ready; then
    log "✅ Docker daemon is running"
    return 0
  fi

  # Calculate wait time (account for early launch)
  local wait_seconds=$DOCKER_TIMEOUT
  if [ -n "$DOCKER_LAUNCH_START" ]; then
    local elapsed=$(($(date +%s) - DOCKER_LAUNCH_START))
    wait_seconds=$((DOCKER_TIMEOUT - elapsed))
    [ $wait_seconds -le 0 ] && wait_seconds=5  # At least 5 more seconds
    log "⏳ Docker started ${elapsed}s ago, waiting ${wait_seconds}s more..."
  else
    log "⏳ Waiting for Docker daemon (max ${wait_seconds}s)..."
  fi

  # Poll for readiness
  for ((i=1; i<=wait_seconds; i++)); do
    if docker_daemon_ready; then
      local total=$i
      [ -n "$DOCKER_LAUNCH_START" ] && total=$(($(date +%s) - DOCKER_LAUNCH_START))
      log "✅ Docker daemon ready after ${total}s"
      return 0
    fi
    # Progress update at 10s
    if [ $i -eq 10 ]; then
      log "⏳ Still waiting... ($((wait_seconds - i))s remaining)"
    fi
    sleep 1
  done

  # Timeout - show why
  log "❌ Docker not ready after ${DOCKER_TIMEOUT}s"
  if [ "$PLATFORM" = "macos" ]; then
    local pids=$(pgrep -f "Docker Desktop" 2>/dev/null || true)
    if [ -n "$pids" ]; then
      log "   Docker Desktop is running (PIDs: $pids) but daemon not responding"
      log "💡 Check Docker Desktop window - there may be a dialog requiring attention"
      log "💡 After factory reset, you may need to accept license agreement"
    else
      log "   Docker Desktop process not running"
      log "💡 Try starting Docker Desktop manually from Applications"
    fi
  fi
  return 1
}

# Helper to show platform-specific Docker help
show_docker_help() {
  if [ "$PLATFORM" = "macos" ]; then
    log "💡 Common fixes:"
    log "   1. Check Docker Desktop window for dialogs (license, setup, errors)"
    log "   2. Quit Docker Desktop (Cmd+Q) and restart"
    log "   3. If repeated crashes: Docker Desktop → Settings → Reset to factory defaults"
  elif [ "$PLATFORM" = "linux" ]; then
    log "💡 Try: sudo systemctl start docker"
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
  DOCKER_DIR="$CODING_REPO/docker"

  if [ ! -f "$DOCKER_DIR/docker-compose.yml" ]; then
    log "Error: Docker compose file not found at $DOCKER_DIR/docker-compose.yml"
    exit 1
  fi

  # Check if containers are already healthy - skip docker compose if so
  # This prevents Docker destabilization when starting a second session
  if curl -sf http://localhost:8080/health >/dev/null 2>&1; then
    log "✅ coding-services already running and healthy - reusing existing containers"
  else
    log "🐳 Starting coding services via Docker..."

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
  fi

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