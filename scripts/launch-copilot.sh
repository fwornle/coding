#!/bin/bash

# Launch GitHub CoPilot with fallback services

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODING_REPO="$(dirname "$SCRIPT_DIR")"

# Source agent-common setup functions
source "$SCRIPT_DIR/agent-common-setup.sh"

log() {
  echo "[CoPilot] $1"
}

# Generate unique session ID for this CoPilot session
SESSION_ID="copilot-$$-$(date +%s)"
export COPILOT_SESSION_ID="$SESSION_ID"

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

  # Stop CoPilot-specific fallback services
  if [ -n "$HTTP_SERVER_PID" ] && kill -0 "$HTTP_SERVER_PID" 2>/dev/null; then
    log "Stopping HTTP adapter server (PID: $HTTP_SERVER_PID)"
    kill "$HTTP_SERVER_PID" 2>/dev/null || true
  fi

  node "$SCRIPT_DIR/psm-session-cleanup.js" "$SESSION_ID" 2>/dev/null || {
    log "Warning: Session cleanup failed"
  }
}

# Set up trap handlers for cleanup on exit
trap cleanup_session EXIT INT TERM

# 🚨 MANDATORY MONITORING VERIFICATION 🚨
verify_monitoring_systems() {
  local target_project="$1"

  log "🔐 MANDATORY: Verifying monitoring systems before CoPilot startup..."

  # Use the monitoring verifier with strict mode
  if node "$SCRIPT_DIR/monitoring-verifier.js" --project "$target_project" --strict; then
    log "✅ MONITORING VERIFIED: All systems operational - CoPilot startup approved"
    return 0
  else
    log "❌ MONITORING FAILED: Critical systems not operational"
    log "🚨 BLOCKING COPILOT STARTUP - monitoring must be healthy first"
    log "💡 Run 'node scripts/monitoring-verifier.js --install-all' to fix"
    exit 1
  fi
}

# Check for GitHub CLI and CoPilot extension
check_copilot_requirements() {
  log "Checking CoPilot requirements..."

  # Check for GitHub CLI
  if ! command -v gh &> /dev/null; then
    log "Error: GitHub CLI (gh) is not installed"
    log "Install: https://cli.github.com/"
    exit 1
  fi

  # Check for CoPilot extension
  if ! gh extension list | grep -q copilot; then
    log "Error: GitHub CoPilot extension is not installed"
    log "Install: gh extension install github/gh-copilot"
    exit 1
  fi

  log "✅ GitHub CLI and CoPilot extension detected"
}

# Start CoPilot HTTP adapter server for tool integration
start_http_adapter() {
  local coding_repo="$1"

  log "Starting CoPilot HTTP adapter server..."

  # Check if adapter server is available
  if [ ! -f "$coding_repo/lib/adapters/copilot-http-server.js" ]; then
    log "Warning: CoPilot HTTP adapter not found, some features may not work"
    return 0
  fi

  # Start the HTTP server in background
  cd "$coding_repo"
  nohup node lib/adapters/copilot-http-server.js > .logs/copilot-http-adapter.log 2>&1 &
  HTTP_SERVER_PID=$!

  # Brief wait to check if it started successfully
  sleep 2
  if kill -0 "$HTTP_SERVER_PID" 2>/dev/null; then
    log "✅ HTTP adapter server started (PID: $HTTP_SERVER_PID)"
    export COPILOT_HTTP_ADAPTER_PID="$HTTP_SERVER_PID"
  else
    log "⚠️ HTTP adapter server may have failed to start"
    HTTP_SERVER_PID=""
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

# Register this CoPilot session with Process State Manager
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

# Start all services using simple startup script BEFORE monitoring verification
# Services need to be running for the monitoring verifier to check them
log "Starting coding services for CoPilot..."

# Check if Node.js is available
if ! command -v node &> /dev/null; then
  log "Error: Node.js is required but not found in PATH"
  exit 1
fi

# Start services using the simple startup script (from coding repo)
if ! "$CODING_REPO/start-services.sh"; then
  log "Error: Failed to start services"
  exit 1
fi

# Brief wait for services to stabilize
sleep 2

# 🚨 MANDATORY MONITORING VERIFICATION - AFTER SERVICES START 🚨
verify_monitoring_systems "$TARGET_PROJECT_DIR"

# Check CoPilot requirements
check_copilot_requirements

# Start CoPilot-specific HTTP adapter server
start_http_adapter "$CODING_REPO"

# Run agent-common initialization (LSL, monitoring, gitignore, etc.)
agent_common_init "$TARGET_PROJECT_DIR" "$CODING_REPO"

# Set environment variables for CoPilot adapter
export CODING_AGENT="copilot"
export CODING_TOOLS_PATH="$CODING_REPO"
export TRANSCRIPT_SOURCE_PROJECT="$TARGET_PROJECT_DIR"

# Change to target project directory before launching CoPilot
cd "$TARGET_PROJECT_DIR"
log "Changed working directory to: $(pwd)"

# Launch GitHub CoPilot
log "Launching GitHub CoPilot..."
log "📚 CoPilot features available:"
log "   • Code suggestions and completion"
log "   • Chat interface"
log "   • Memory/Knowledge management (fallback services)"
log "   • Browser automation (Playwright fallback)"
log "   • Session logging (LSL system)"
log ""
log "💡 Tip: Use 'gh copilot suggest' or 'gh copilot explain'"
log ""

exec gh copilot "$@"
