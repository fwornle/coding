#!/bin/bash

# Shared Docker auto-start logic
# Sourced by both launch-claude.sh and launch-copilot.sh
#
# Provides:
#   detect_platform()          - Sets PLATFORM to macos|linux|unknown
#   docker_daemon_ready()      - Returns 0 if Docker daemon responds
#   early_docker_launch()      - Starts Docker Desktop if not running (non-blocking)
#   ensure_docker_running()    - Waits for Docker daemon with timeout
#   show_docker_help()         - Platform-specific Docker troubleshooting tips

# Avoid re-sourcing
if [ -n "$_ENSURE_DOCKER_LOADED" ]; then
  return 0 2>/dev/null || true
fi
_ENSURE_DOCKER_LOADED=true

# ============================================
# Platform Detection
# ============================================
detect_platform() {
  PLATFORM="$(uname -s)"
  case "$PLATFORM" in
    Darwin) PLATFORM="macos" ;;
    Linux)  PLATFORM="linux" ;;
    *)      PLATFORM="unknown" ;;
  esac
  export PLATFORM
}

# ============================================
# Docker Daemon Readiness Check
# ============================================
docker_daemon_ready() {
  timeout 5 docker ps >/dev/null 2>&1
}

# ============================================
# Restart Docker Desktop (kill + relaunch)
# ============================================
# Used when Docker Desktop process is running but daemon is unresponsive.
# Common causes: failed update, hung backend, crashed VM.
restart_docker_desktop() {
  if [ "$PLATFORM" != "macos" ]; then
    log "Auto-restart only supported on macOS"
    return 1
  fi

  log "  Killing Docker Desktop processes..."

  # Graceful quit first (2s timeout)
  osascript -e 'quit app "Docker"' 2>/dev/null || true
  sleep 2

  # Check if processes are still alive
  if pgrep -f "Docker Desktop" >/dev/null 2>&1 || pgrep -f "com.docker.backend" >/dev/null 2>&1; then
    # Force kill remaining processes
    killall "Docker Desktop" 2>/dev/null || true
    killall "Docker" 2>/dev/null || true
    killall "com.docker.backend" 2>/dev/null || true
    killall "com.docker.vmnetd" 2>/dev/null || true
    sleep 3
  fi

  # Verify processes are gone (up to 5s)
  for i in $(seq 1 5); do
    if ! pgrep -f "Docker Desktop" >/dev/null 2>&1 && \
       ! pgrep -f "com.docker.backend" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  # Final check - if still running, force with signal 9
  if pgrep -f "com.docker.backend" >/dev/null 2>&1; then
    log "  Force-killing stubborn Docker processes..."
    pkill -9 -f "com.docker.backend" 2>/dev/null || true
    pkill -9 -f "Docker Desktop" 2>/dev/null || true
    sleep 2
  fi

  log "  Relaunching Docker Desktop..."
  DOCKER_LAUNCH_START=$(date +%s)
  DOCKER_FRESH_START=true
  open -F -a "Docker" 2>/dev/null

  # Wait for process to appear
  sleep 5

  # Verify it started
  local new_pids
  new_pids=$(pgrep -f "Docker Desktop" 2>/dev/null || true)
  if [ -n "$new_pids" ]; then
    log "  Docker Desktop restarted (PIDs: $(echo "$new_pids" | head -3 | tr '\n' ' '))"
  else
    log "  Docker Desktop failed to restart"
    log "  Try starting it manually from Applications"
    return 1
  fi

  return 0
}

# ============================================
# Early Docker Launch (non-blocking)
# ============================================
# Starts Docker Desktop if not running. Sets DOCKER_LAUNCH_START and DOCKER_FRESH_START.
# Call this early so Docker boots in parallel with other setup.
# NOTE: Does NOT kill existing Docker processes - that's destructive.
early_docker_launch() {
  DOCKER_LAUNCH_START=""
  DOCKER_FRESH_START=false

  log "Checking Docker status..."

  # Check if docker client is installed
  if ! command -v docker &>/dev/null; then
    log "Docker client not found in PATH"
    log "Install Docker Desktop: https://www.docker.com/products/docker-desktop"
    return 1
  fi

  # Already running?
  if docker_daemon_ready; then
    log "  Docker daemon is responding"
    return 0
  fi

  # Docker client exists but daemon not running
  local docker_ps_error
  docker_ps_error=$(timeout 5 docker ps 2>&1 || echo "Docker daemon not responding")
  log "  Docker daemon not responding"
  log "  Error: ${docker_ps_error:0:150}"

  if [ "$PLATFORM" = "macos" ]; then
    if [ ! -d "/Applications/Docker.app" ]; then
      log "Docker Desktop not installed"
      log "Install from: https://www.docker.com/products/docker-desktop"
      return 1
    fi

    # Check if Docker Desktop process is running
    local docker_pids
    docker_pids=$(pgrep -f "Docker Desktop" 2>/dev/null || true)

    if [ -n "$docker_pids" ]; then
      # Process running but daemon not responding - wait briefly first
      log "  Docker Desktop process running (PIDs: $(echo "$docker_pids" | head -3 | tr '\n' ' '))"
      log "Waiting 10s for daemon to respond..."
      for i in $(seq 1 10); do
        if docker_daemon_ready; then
          log "  Docker daemon responded after ${i}s"
          return 0
        fi
        sleep 1
      done

      # Still not responding - attempt automatic restart
      log "Docker Desktop running but daemon not responding after 10s"
      log "Attempting automatic restart of Docker Desktop..."
      restart_docker_desktop
    else
      # Docker Desktop not running - start it
      log "Starting Docker Desktop..."
      DOCKER_LAUNCH_START=$(date +%s)
      DOCKER_FRESH_START=true

      open -F -a "Docker" 2>/dev/null

      # Wait for process to appear (takes 3-5s normally)
      sleep 5

      # Verify process started
      docker_pids=$(pgrep -f "Docker Desktop" 2>/dev/null || true)
      if [ -n "$docker_pids" ]; then
        log "  Docker Desktop started (PIDs: $docker_pids)"
      else
        log "Docker Desktop process not found after 5s"
        log "Check if Docker Desktop window appeared"
        log "If not, try starting it manually from Applications"
      fi
    fi
  elif [ "$PLATFORM" = "linux" ]; then
    if command -v systemctl &>/dev/null && systemctl is-enabled docker &>/dev/null; then
      log "Starting Docker via systemd..."
      sudo systemctl start docker 2>/dev/null || true
      DOCKER_LAUNCH_START=$(date +%s)
    else
      log "Start Docker: sudo systemctl start docker"
    fi
  fi

  return 0
}

# ============================================
# Ensure Docker Running (blocking wait)
# ============================================
# Waits up to DOCKER_TIMEOUT seconds for Docker daemon.
# Uses DOCKER_LAUNCH_START from early_docker_launch() to account for elapsed time.
DOCKER_TIMEOUT=45

ensure_docker_running() {
  # Already running?
  if docker_daemon_ready; then
    log "Docker daemon is running"
    return 0
  fi

  # Calculate wait time (account for early launch)
  local wait_seconds=$DOCKER_TIMEOUT
  if [ -n "$DOCKER_LAUNCH_START" ]; then
    local elapsed=$(($(date +%s) - DOCKER_LAUNCH_START))
    wait_seconds=$((DOCKER_TIMEOUT - elapsed))
    [ $wait_seconds -le 0 ] && wait_seconds=10  # At least 10 more seconds
    log "Docker started ${elapsed}s ago, waiting ${wait_seconds}s more..."
  else
    log "Waiting for Docker daemon (max ${wait_seconds}s)..."
  fi

  # Poll for readiness
  for ((i=1; i<=wait_seconds; i++)); do
    if docker_daemon_ready; then
      local total=$i
      [ -n "$DOCKER_LAUNCH_START" ] && total=$(($(date +%s) - DOCKER_LAUNCH_START))
      log "Docker daemon ready after ${total}s"
      return 0
    fi
    # Progress updates
    if [ $((i % 10)) -eq 0 ]; then
      log "Still waiting... ($((wait_seconds - i))s remaining)"
    fi
    sleep 1
  done

  # First timeout - try restart if on macOS and Docker Desktop is hung
  if [ "$PLATFORM" = "macos" ]; then
    local pids
    pids=$(pgrep -f "Docker Desktop" 2>/dev/null || true)
    if [ -n "$pids" ]; then
      log "Docker daemon not ready after ${DOCKER_TIMEOUT}s - attempting restart recovery..."
      restart_docker_desktop

      # Wait for daemon after restart (up to 30s more)
      log "Waiting for daemon after restart (max 30s)..."
      for ((j=1; j<=30; j++)); do
        if docker_daemon_ready; then
          log "Docker daemon ready after restart (${j}s)"
          return 0
        fi
        if [ $((j % 10)) -eq 0 ]; then
          log "Still waiting after restart... ($((30 - j))s remaining)"
        fi
        sleep 1
      done

      log "Docker still not ready after restart"
      log "Check Docker Desktop window for error dialogs or license agreements"
    else
      log "Docker Desktop process not running"
      log "Try starting Docker Desktop manually from Applications"
    fi
  else
    log "Docker not ready after ${DOCKER_TIMEOUT}s"
  fi
  return 1
}

# ============================================
# Platform-Specific Docker Help
# ============================================
show_docker_help() {
  if [ "$PLATFORM" = "macos" ]; then
    log "Common fixes:"
    log "  1. Check Docker Desktop window for dialogs (license, setup, errors)"
    log "  2. Quit Docker Desktop (Cmd+Q) and restart"
    log "  3. If repeated crashes: Docker Desktop > Settings > Reset to factory defaults"
  elif [ "$PLATFORM" = "linux" ]; then
    log "Try: sudo systemctl start docker"
  fi
}
