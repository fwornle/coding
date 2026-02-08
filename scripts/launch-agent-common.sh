#!/bin/bash

# Agent-Agnostic Shared Launcher Orchestration
# Extracts all common startup logic from agent-specific launchers.
#
# Usage (from a thin wrapper):
#   source "$SCRIPT_DIR/launch-agent-common.sh"
#   launch_agent "$CODING_REPO/config/agents/<name>.sh" "$@"
#
# Agent config files define:
#   AGENT_NAME            - e.g. "claude", "copilot"
#   AGENT_COMMAND         - binary/script to exec inside tmux
#   AGENT_DISPLAY_NAME    - human-readable name for log messages (default: AGENT_NAME)
#   AGENT_SESSION_PREFIX  - prefix for session ID (default: AGENT_NAME)
#   AGENT_SESSION_VAR     - env var to export session ID as (e.g. CLAUDE_SESSION_ID)
#   AGENT_TRANSCRIPT_FMT  - transcript format (default: AGENT_NAME)
#   AGENT_ENABLE_PIPE_CAPTURE - "true" to enable tmux pipe-pane capture (default: false)
#   AGENT_PROMPT_REGEX    - regex for prompt detection (required if pipe capture enabled)
#
# Agent config files may define hook functions:
#   agent_check_requirements() - verify agent-specific dependencies
#   agent_pre_launch()         - run before launching (start servers, log info, etc.)
#   agent_cleanup()            - called on EXIT (stop agent-specific processes)

set -e

# ============================================
# Shared Functions
# ============================================

# Log with agent display name prefix
_agent_log() {
  echo "[${AGENT_DISPLAY_NAME:-Agent}] $1"
}

# Wait if a Docker mode transition is in progress
_check_transition_lock() {
  local lock_file="$CODING_REPO/.transition-in-progress"
  local wait_count=0
  local max_wait=60

  while [ -f "$lock_file" ] && [ $wait_count -lt $max_wait ]; do
    if [ $wait_count -eq 0 ]; then
      _agent_log "⏳ Docker mode transition in progress, waiting..."
    fi
    sleep 1
    ((wait_count++))
  done

  if [ -f "$lock_file" ]; then
    _agent_log "⚠️  Transition still in progress after ${max_wait}s, proceeding anyway..."
  elif [ $wait_count -gt 0 ]; then
    _agent_log "✅ Transition complete, continuing startup"
  fi
}

# Detect whether we should use Docker mode
_detect_docker_mode() {
  DOCKER_MODE=false

  if [ -f "$CODING_REPO/.docker-mode" ]; then
    DOCKER_MODE=true
    _agent_log "🐳 Docker mode enabled (via .docker-mode marker)"
  fi

  if timeout 5 docker ps --format '{{.Names}}' 2>/dev/null | grep -q "coding-services"; then
    DOCKER_MODE=true
    _agent_log "🐳 Docker mode enabled (coding-services container running)"
  fi

  if [ "$CODING_DOCKER_MODE" = "true" ]; then
    DOCKER_MODE=true
    _agent_log "🐳 Docker mode enabled (via CODING_DOCKER_MODE env)"
  fi

  export CODING_DOCKER_MODE="$DOCKER_MODE"
}

# Generate unique session ID
_generate_session_id() {
  local prefix="${AGENT_SESSION_PREFIX:-$AGENT_NAME}"
  SESSION_ID="${prefix}-$$-$(date +%s)"
  export SESSION_ID

  # Export agent-specific session var if defined
  if [ -n "$AGENT_SESSION_VAR" ]; then
    export "$AGENT_SESSION_VAR"="$SESSION_ID"
  fi
}

# Register session with Process State Manager
_register_session() {
  _agent_log "Registering session: $SESSION_ID"
  node "$SCRIPT_DIR/psm-register-session.js" "$SESSION_ID" "$$" "$TARGET_PROJECT_DIR" 2>/dev/null || {
    _agent_log "Warning: Failed to register session with Process State Manager"
  }
}

# Cleanup handler for session termination
_cleanup_session() {
  _agent_log "Session ending - cleaning up services..."

  # Call agent-specific cleanup if defined
  if type agent_cleanup &>/dev/null; then
    agent_cleanup
  fi

  node "$SCRIPT_DIR/psm-session-cleanup.js" "$SESSION_ID" 2>/dev/null || {
    _agent_log "Warning: Session cleanup failed"
  }
}

# Mandatory monitoring verification
_verify_monitoring() {
  local target_project="$1"

  _agent_log "🔐 MANDATORY: Verifying monitoring systems before ${AGENT_DISPLAY_NAME} startup..."

  if node "$SCRIPT_DIR/monitoring-verifier.js" --project "$target_project" --strict; then
    _agent_log "✅ MONITORING VERIFIED: All systems operational - ${AGENT_DISPLAY_NAME} startup approved"
    return 0
  else
    _agent_log "❌ MONITORING FAILED: Critical systems not operational"
    _agent_log "🚨 BLOCKING ${AGENT_DISPLAY_NAME} STARTUP - monitoring must be healthy first"
    _agent_log "💡 Run 'node scripts/monitoring-verifier.js --install-all' to fix"
    exit 1
  fi
}

# Resolve target project directory
_resolve_target_project() {
  if [ -n "$CODING_PROJECT_DIR" ]; then
    TARGET_PROJECT_DIR="$CODING_PROJECT_DIR"
    _agent_log "Target project: $TARGET_PROJECT_DIR"
    _agent_log "Coding services from: $CODING_REPO"
  else
    TARGET_PROJECT_DIR="$CODING_REPO"
    _agent_log "Working in coding repository: $TARGET_PROJECT_DIR"
  fi
}

# Load environment configuration files
_load_env_files() {
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
}

# Check and start Docker
_ensure_docker() {
  if ! ensure_docker_running; then
    if [ "$DOCKER_MODE" = true ]; then
      _agent_log "❌ Docker mode requires Docker to be running"
      exit 1
    fi
    _agent_log "⚠️ WARNING: Continuing in DEGRADED mode without Docker/Qdrant"
    _agent_log "   Knowledge base will work but without semantic search capabilities"
  fi
}

# Start coding services (Docker or Native mode)
_start_services() {
  # Check if Node.js is available
  if ! command -v node &> /dev/null; then
    _agent_log "Error: Node.js is required but not found in PATH"
    exit 1
  fi

  if [ "$DOCKER_MODE" = true ]; then
    local docker_dir="$CODING_REPO/docker"

    if [ ! -f "$docker_dir/docker-compose.yml" ]; then
      _agent_log "Error: Docker compose file not found at $docker_dir/docker-compose.yml"
      exit 1
    fi

    # Check if containers are already healthy - skip docker compose if so
    if curl -sf http://localhost:8080/health >/dev/null 2>&1; then
      _agent_log "✅ coding-services already running and healthy - reusing existing containers"
    else
      _agent_log "🐳 Starting coding services via Docker..."
      export CODING_REPO

      if ! docker compose -f "$docker_dir/docker-compose.yml" up -d; then
        _agent_log "Error: Failed to start Docker containers"
        exit 1
      fi

      _agent_log "⏳ Waiting for coding-services to be healthy..."
      for i in {1..60}; do
        if curl -sf http://localhost:8080/health >/dev/null 2>&1; then
          _agent_log "✅ coding-services healthy after ${i} seconds"
          break
        fi
        if [ $i -eq 60 ]; then
          _agent_log "❌ coding-services health check failed after 60 seconds"
          _agent_log "   Check logs: docker compose -f $docker_dir/docker-compose.yml logs"
          exit 1
        fi
        sleep 1
      done
    fi

    # Generate Docker MCP config if it doesn't exist or is outdated
    if [ ! -f "$CODING_REPO/claude-code-mcp-docker.json" ] || \
       [ "$CODING_REPO/docker/docker-compose.yml" -nt "$CODING_REPO/claude-code-mcp-docker.json" ]; then
      _agent_log "Generating Docker MCP configuration..."
      "$SCRIPT_DIR/generate-docker-mcp-config.sh" || _agent_log "Warning: Could not generate Docker MCP config"
    fi
  else
    _agent_log "Starting coding services for ${AGENT_DISPLAY_NAME} (native mode)..."

    if ! "$CODING_REPO/start-services.sh"; then
      _agent_log "Error: Failed to start services"
      exit 1
    fi
  fi

  # Brief wait for services to stabilize
  sleep 2
}

# Set standard agent environment variables
_set_agent_env_vars() {
  export CODING_AGENT="$AGENT_NAME"
  export CODING_TOOLS_PATH="$CODING_REPO"
  export TRANSCRIPT_SOURCE_PROJECT="$TARGET_PROJECT_DIR"
  export CODING_AGENT_ADAPTER_PATH="$CODING_REPO/lib/agent-api/adapters"
  export CODING_HOOKS_CONFIG="$CODING_REPO/config/hooks-config.json"
  export CODING_TRANSCRIPT_FORMAT="${AGENT_TRANSCRIPT_FMT:-$AGENT_NAME}"
}

# ============================================
# Main Entry Point
# ============================================

launch_agent() {
  local agent_config="$1"
  shift

  # Validate agent config exists
  if [ ! -f "$agent_config" ]; then
    echo "Error: Agent config not found: $agent_config" >&2
    exit 1
  fi

  # Source agent config — sets AGENT_NAME, AGENT_COMMAND, hooks, etc.
  source "$agent_config"

  # Validate required config
  if [ -z "$AGENT_NAME" ]; then
    echo "Error: Agent config must define AGENT_NAME" >&2
    exit 1
  fi
  if [ -z "$AGENT_COMMAND" ]; then
    echo "Error: Agent config must define AGENT_COMMAND" >&2
    exit 1
  fi

  # Set defaults
  AGENT_DISPLAY_NAME="${AGENT_DISPLAY_NAME:-$AGENT_NAME}"
  AGENT_SESSION_PREFIX="${AGENT_SESSION_PREFIX:-$AGENT_NAME}"
  AGENT_ENABLE_PIPE_CAPTURE="${AGENT_ENABLE_PIPE_CAPTURE:-false}"

  # Override the log function so agent-common-setup.sh messages also use our prefix
  log() {
    _agent_log "$1"
  }

  # --- Orchestration Pipeline ---

  # 1. Transition lock
  _check_transition_lock

  # 2. Docker detection
  _detect_docker_mode

  # 3. Source Docker helpers
  source "$SCRIPT_DIR/ensure-docker.sh"
  detect_platform

  # 4. Resolve target project (needed for dry-run output and session registration)
  _resolve_target_project

  # 5. Load env files (before dry-run so env is available)
  _load_env_files

  # 6. Dry-run exit
  if [ "$CODING_DRY_RUN" = "true" ]; then
    _agent_log "DRY-RUN: All startup logic completed successfully"
    _agent_log "DRY-RUN: Would launch in tmux: $AGENT_COMMAND"
    _agent_log "DRY-RUN: Agent=$AGENT_NAME, Docker=$DOCKER_MODE, Platform=$PLATFORM"
    _agent_log "DRY-RUN: Project=$TARGET_PROJECT_DIR"
    exit 0
  fi

  # 7. Early Docker launch (parallel with setup)
  if [ "$DOCKER_MODE" = true ]; then
    early_docker_launch
  fi

  # 8. Session ID + register
  _generate_session_id
  _register_session

  # 9. Cleanup trap
  trap _cleanup_session EXIT INT TERM

  # 10. Ensure Docker running
  _ensure_docker

  # 11. Start services
  _start_services

  # 12. Verify monitoring
  _verify_monitoring "$TARGET_PROJECT_DIR"

  # 13. Agent-specific requirements check
  if type agent_check_requirements &>/dev/null; then
    agent_check_requirements
  fi

  # 14. Agent-specific pre-launch hook
  if type agent_pre_launch &>/dev/null; then
    agent_pre_launch
  fi

  # 15. Agent-common init (LSL, monitoring, gitignore, etc.)
  agent_common_init "$TARGET_PROJECT_DIR" "$CODING_REPO"

  # 16. Log mode info
  if [ "$DOCKER_MODE" = true ]; then
    _agent_log "Docker mode: MCP servers will use stdio-proxy → SSE connections to Docker"
  else
    _agent_log "Native mode: MCP servers will run as local processes"
  fi

  # 17. Set env vars
  _set_agent_env_vars

  # 18. cd to project
  cd "$TARGET_PROJECT_DIR"
  _agent_log "Changed working directory to: $(pwd)"

  # 19. Launch via tmux session wrapper
  _agent_log "Launching ${AGENT_DISPLAY_NAME}..."
  source "$SCRIPT_DIR/tmux-session-wrapper.sh"
  tmux_session_wrapper "$AGENT_COMMAND" "$@"
}
