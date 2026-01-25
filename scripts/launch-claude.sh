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
  else
    log "   ✓ Docker client installed: $(command -v docker)"

    # Try to connect to daemon and capture error
    DOCKER_PS_OUTPUT=$(docker ps 2>&1)
    DOCKER_PS_EXIT=$?

    if [ $DOCKER_PS_EXIT -eq 0 ]; then
      log "   ✓ Docker daemon is responding"
    else
      log "   ✗ Docker daemon not responding (exit code: $DOCKER_PS_EXIT)"
      log "   ✗ Error: ${DOCKER_PS_OUTPUT:0:200}"  # First 200 chars of error

      # Platform-specific diagnostics and startup
      if [ "$PLATFORM" = "macos" ]; then
        # Check Docker Desktop installation
        if [ -d "/Applications/Docker.app" ]; then
          log "   ✓ Docker Desktop installed at /Applications/Docker.app"
        else
          log "   ✗ Docker Desktop NOT found at /Applications/Docker.app"
          log "💡 Install Docker Desktop: https://www.docker.com/products/docker-desktop"
        fi

        # Check Docker Desktop process
        DOCKER_PIDS=$(pgrep -f "Docker Desktop" 2>/dev/null || true)
        if [ -n "$DOCKER_PIDS" ]; then
          log "   ✓ Docker Desktop process running (PIDs: $DOCKER_PIDS)"
          # Process exists but daemon not responding - wait a bit
          log "⏳ Docker Desktop process found, waiting 5s for daemon to respond..."
          sleep 5
          if docker ps >/dev/null 2>&1; then
            log "   ✓ Docker daemon now responding after wait"
          else
            # Still not responding - likely crashed or hung
            log "⚠️  Docker Desktop appears hung or crashed (process exists but daemon not responding)"
            log "💡 Please quit Docker Desktop manually and restart it"
            log "💡 If it keeps crashing, try: Docker Desktop → Reset to factory defaults"
          fi
        elif [ -d "/Applications/Docker.app" ]; then
          # Docker Desktop not running but installed - start it
          log "   ✗ Docker Desktop process NOT running"
          log "🐳 Starting Docker Desktop (this may take a moment)..."

          # Capture output from open command
          OPEN_OUTPUT=$(open -a "Docker" 2>&1)
          OPEN_EXIT=$?
          DOCKER_LAUNCH_START=$(date +%s)
          DOCKER_FRESH_START=true

          if [ $OPEN_EXIT -ne 0 ]; then
            log "   ⚠️  'open -a Docker' returned exit code $OPEN_EXIT"
            log "   ⚠️  Output: $OPEN_OUTPUT"
          else
            log "   ✓ 'open -a Docker' command succeeded"
          fi

          # Wait briefly and verify Docker Desktop process started
          sleep 3
          DOCKER_PIDS=$(pgrep -f "Docker Desktop" 2>/dev/null || true)
          if [ -z "$DOCKER_PIDS" ]; then
            log "   ⚠️  Docker Desktop process not found after 3s - retrying..."
            open -a "Docker" 2>/dev/null
            sleep 3
            DOCKER_PIDS=$(pgrep -f "Docker Desktop" 2>/dev/null || true)
          fi

          if [ -n "$DOCKER_PIDS" ]; then
            log "   ✓ Docker Desktop process started (PIDs: $DOCKER_PIDS)"
            log "⏳ Waiting for Docker daemon to be ready..."
          else
            log "❌ Failed to start Docker Desktop process"
            log "💡 Please start Docker Desktop manually from Applications"
            log "💡 Check Console.app for Docker Desktop crash logs"
          fi
        fi
      elif [ "$PLATFORM" = "linux" ]; then
        # Linux: Try systemd first, then direct dockerd
        if command -v systemctl &>/dev/null && systemctl is-enabled docker &>/dev/null; then
          log "🐳 Starting Docker via systemd (will check readiness later)..."
          sudo systemctl start docker 2>/dev/null || true
          DOCKER_LAUNCH_START=$(date +%s)
        elif command -v dockerd &>/dev/null; then
          log "🐳 Docker daemon available but not running - please start manually"
          log "💡 Try: sudo systemctl start docker  OR  sudo dockerd &"
        fi
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
# Timeout: 90 seconds normally, 150 seconds for fresh starts (after reset/first install)
DOCKER_TIMEOUT_NORMAL=90
DOCKER_TIMEOUT_FRESH=150

ensure_docker_running() {
  # First check if daemon is fully ready (use docker ps, not docker info!)
  if docker_daemon_ready; then
    log "✅ Docker daemon is running"
    return 0
  fi

  # Use longer timeout for fresh Docker starts (after factory reset, first install)
  local timeout=$DOCKER_TIMEOUT_NORMAL
  if [ "$DOCKER_FRESH_START" = true ]; then
    timeout=$DOCKER_TIMEOUT_FRESH
    log "📦 Fresh Docker Desktop start detected - using extended timeout (${timeout}s)"
  fi

  # Calculate remaining wait time if Docker was launched early
  local wait_seconds=$timeout
  if [ -n "$DOCKER_LAUNCH_START" ]; then
    local now=$(date +%s)
    local elapsed=$((now - DOCKER_LAUNCH_START))
    wait_seconds=$((timeout - elapsed))
    if [ $wait_seconds -le 0 ]; then
      log "❌ Docker daemon not ready after ${timeout} seconds (launched early)"
      log "⚠️  Vector search features will be DISABLED (Qdrant unavailable)"
      show_docker_help
      return 1
    fi
    log "⏳ Docker was launched ${elapsed}s ago, waiting up to ${wait_seconds}s more..."
  else
    # Docker was not launched early - try to start it now (platform-specific)
    log "🐳 Docker not running - attempting to start..."

    if [ "$PLATFORM" = "macos" ]; then
      # macOS: Check for crashed Docker Desktop first
      if pgrep -q "Docker Desktop"; then
        log "⚠️  Docker Desktop process exists but daemon not responding"
        log "💡 Docker Desktop may have crashed - please quit and restart it manually"
        log "💡 Check for error dialog in Docker Desktop window"
        return 1
      elif [ -d "/Applications/Docker.app" ]; then
        log "   Starting Docker Desktop..."
        open -a "Docker" 2>/dev/null
      else
        log "❌ Docker Desktop not found at /Applications/Docker.app"
        log "💡 Install Docker Desktop: https://www.docker.com/products/docker-desktop"
        return 1
      fi
    elif [ "$PLATFORM" = "linux" ]; then
      # Linux: Try systemd, then manual
      if command -v systemctl &>/dev/null; then
        log "   Starting Docker via systemd..."
        if ! sudo systemctl start docker 2>/dev/null; then
          log "❌ Failed to start Docker via systemd"
          log "💡 Try manually: sudo systemctl start docker"
          return 1
        fi
      else
        log "❌ Docker not running and systemctl not available"
        log "💡 Start Docker daemon manually: sudo dockerd &"
        return 1
      fi
    else
      log "❌ Unsupported platform: $PLATFORM"
      log "💡 Please start Docker manually"
      return 1
    fi

    log "⏳ Waiting for Docker daemon (max ${wait_seconds} seconds)..."
  fi

  # Poll for Docker readiness with progress updates and diagnostics
  local last_update=0
  for ((i=1; i<=wait_seconds; i++)); do
    if docker_daemon_ready; then
      local total_elapsed=$i
      if [ -n "$DOCKER_LAUNCH_START" ]; then
        total_elapsed=$(($(date +%s) - DOCKER_LAUNCH_START))
      fi
      log "✅ Docker daemon ready after ${total_elapsed} seconds"
      return 0
    fi
    # Show progress and diagnostics every 20 seconds
    if [ $((i - last_update)) -ge 20 ]; then
      local remaining=$((wait_seconds - i))
      log "⏳ Still waiting for Docker daemon... (${remaining}s remaining)"

      # Show diagnostic info
      if [ "$PLATFORM" = "macos" ]; then
        local docker_pids=$(pgrep -f "Docker Desktop" 2>/dev/null || true)
        if [ -n "$docker_pids" ]; then
          log "   Docker Desktop PIDs: $docker_pids"
        else
          log "   ⚠️  Docker Desktop process not found!"
        fi
        # Check socket
        if [ -S "$HOME/.docker/run/docker.sock" ]; then
          log "   Docker socket exists at ~/.docker/run/docker.sock"
        elif [ -S "/var/run/docker.sock" ]; then
          log "   Docker socket exists at /var/run/docker.sock"
        else
          log "   ⚠️  Docker socket not found"
        fi
      fi

      last_update=$i
    fi
    sleep 1
  done

  # Timeout reached - show detailed diagnostics
  log "❌ Docker daemon not ready after ${timeout} seconds"
  log "🔍 Final diagnostic info:"
  if [ "$PLATFORM" = "macos" ]; then
    local docker_pids=$(pgrep -f "Docker Desktop" 2>/dev/null || true)
    log "   Docker Desktop PIDs: ${docker_pids:-NONE}"
    log "   Socket ~/.docker/run/docker.sock: $([ -S "$HOME/.docker/run/docker.sock" ] && echo "EXISTS" || echo "NOT FOUND")"
    log "   Socket /var/run/docker.sock: $([ -S "/var/run/docker.sock" ] && echo "EXISTS" || echo "NOT FOUND")"
    local docker_error=$(docker ps 2>&1)
    log "   docker ps error: ${docker_error:0:150}"
  fi
  log "⚠️  Vector search features will be DISABLED (Qdrant unavailable)"
  show_docker_help
  return 1
}

# Helper to show platform-specific Docker help
show_docker_help() {
  if [ "$PLATFORM" = "macos" ]; then
    log "💡 Please start Docker Desktop manually for full functionality"
    # Check if Docker Desktop process exists (might be crashed)
    if pgrep -q "Docker Desktop"; then
      log "⚠️  Docker Desktop process found but daemon not responding - may have crashed"
      log "💡 Try: Quit Docker Desktop, then restart it"
      log "💡 If crashes persist: Docker Desktop → Troubleshoot → Reset to factory defaults"
    fi
  elif [ "$PLATFORM" = "linux" ]; then
    log "💡 Please start Docker: sudo systemctl start docker"
  else
    log "💡 Please start Docker manually"
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