#!/bin/bash

# Shared Docker auto-start logic
# Sourced by launch-agent-common.sh (all agent launchers)
#
# Provides:
#   detect_platform()          - Sets PLATFORM to macos|linux|wsl|windows|unknown
#   docker_daemon_ready()      - Returns 0 if Docker daemon responds
#   early_docker_launch()      - Starts Docker if not running (non-blocking)
#   ensure_docker_running()    - Supervised wait: relaunches Docker if it dies while starting
#   show_docker_help()         - Platform-specific Docker troubleshooting tips
#
# WHY THE START IS SUPERVISED, NOT JUST AWAITED
# On macOS, Docker Desktop launched shortly after a reboot — or shortly after
# a previous instance quit — regularly kills itself: its internal fork/exec server fails with "sending file descriptors:
# broken pipe", so neither the Electron UI nor com.docker.build ever spawn,
# and ~10s later the backend logs "shutting down engines" and exits. That is
# the "takes 2-3 attempts to start Docker" symptom — every attempt is a full
# launch that silently dies (see com.docker.backend.log; newer versions log
# "backend crashed ... opening tray: starting electron"). Suspected trigger:
# endpoint-security software (Defender / CyberArk EPM) gating every exec. Waiting longer cannot fix a launch
# that has already exited, so the wait loop watches for the engine process to
# disappear and relaunches it, up to DOCKER_START_ATTEMPTS times.
#
# Liveness is keyed on com.docker.backend, NOT on the "Docker Desktop" UI
# process: the UI is spawned by the backend, appears late, and never appears
# at all in the failure above — so it is the wrong thing to wait for.

# Avoid re-sourcing
if [ -n "$_ENSURE_DOCKER_LOADED" ]; then
  return 0 2>/dev/null || true
fi
_ENSURE_DOCKER_LOADED=true

# Overall budget for Docker to become ready, across all relaunches. A cold
# boot of the Docker Desktop VM takes 30-60s; a relaunch after a self-kill
# costs another ~30s on top. Env-overridable.
DOCKER_TIMEOUT="${DOCKER_TIMEOUT:-180}"
# How many times to (re)launch Docker when the launch dies on its own.
DOCKER_START_ATTEMPTS="${DOCKER_START_ATTEMPTS:-4}"
# Engine alive but daemon still unresponsive this long = hung, not slow.
DOCKER_HUNG_AFTER="${DOCKER_HUNG_AFTER:-120}"

# ============================================
# Platform Detection
# ============================================
# Same classification as install.sh: WSL is its own platform because Docker
# there is usually Docker Desktop on the Windows side, started from Windows.
detect_platform() {
  case "$(uname -s)" in
    Darwin*) PLATFORM="macos" ;;
    Linux*)
      if [ -n "${WSL_DISTRO_NAME:-}" ] || grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
        PLATFORM="wsl"
      else
        PLATFORM="linux"
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
    *) PLATFORM="unknown" ;;
  esac
  export PLATFORM
}

# ============================================
# Docker Daemon Readiness Check
# ============================================
_docker_cli() {
  if command -v timeout &>/dev/null; then
    timeout 5 docker "$@"
  elif command -v gtimeout &>/dev/null; then
    gtimeout 5 docker "$@"
  else
    docker "$@"
  fi
}

docker_daemon_ready() {
  _docker_cli ps >/dev/null 2>&1
}

# ============================================
# Docker Desktop on Windows (reached from WSL or Git Bash)
# ============================================
# Prints the POSIX path of "Docker Desktop.exe", or nothing.
_windows_docker_desktop_exe() {
  local candidate
  for candidate in \
    "${DOCKER_DESKTOP_EXE:-}" \
    "/mnt/c/Program Files/Docker/Docker/Docker Desktop.exe" \
    "/c/Program Files/Docker/Docker/Docker Desktop.exe"; do
    [ -n "$candidate" ] && [ -f "$candidate" ] && { echo "$candidate"; return 0; }
  done
  if [ -n "${PROGRAMFILES:-}" ] && command -v cygpath &>/dev/null; then
    candidate="$(cygpath -u "$PROGRAMFILES")/Docker/Docker/Docker Desktop.exe"
    [ -f "$candidate" ] && { echo "$candidate"; return 0; }
  fi
  return 1
}

# Docker Desktop's engine is com.docker.backend.exe on the Windows side.
_windows_docker_backend_alive() {
  tasklist.exe /FI "IMAGENAME eq com.docker.backend.exe" /NH 2>/dev/null | grep -qi "com.docker.backend"
}

# ============================================
# Linux: which Docker are we managing?
# ============================================
# Prints one of: desktop (Docker Desktop for Linux, user unit) | rootless
# (user unit) | system (dockerd system unit) | service (no systemd) | none.
_linux_docker_flavor() {
  if command -v systemctl &>/dev/null && [ -d /run/systemd/system ]; then
    if systemctl --user cat docker-desktop.service &>/dev/null; then echo desktop; return; fi
    if systemctl --user cat docker.service &>/dev/null; then echo rootless; return; fi
    if systemctl cat docker.service &>/dev/null; then echo system; return; fi
  fi
  if command -v service &>/dev/null && [ -x /etc/init.d/docker ]; then echo service; return; fi
  echo none
}

# Run a privileged command without ever blocking on a password prompt — the
# launcher is not the place to ask for one. Returns non-zero if sudo needs it.
_as_root() {
  if [ "$(id -u)" = "0" ]; then "$@"; else sudo -n "$@" 2>/dev/null; fi
}

# ============================================
# Engine liveness (is a launch still in progress?)
# ============================================
# Returns 0 = alive, 1 = not running, 2 = cannot tell on this platform.
_docker_engine_alive() {
  case "$PLATFORM" in
    macos)
      pgrep -f "Docker.app/Contents/MacOS/com.docker.backend" >/dev/null 2>&1
      ;;
    wsl|windows)
      if _windows_docker_desktop_exe >/dev/null && command -v tasklist.exe &>/dev/null; then
        _windows_docker_backend_alive
      else
        _docker_linux_unit_alive
      fi
      ;;
    linux)
      _docker_linux_unit_alive
      ;;
    *) return 2 ;;
  esac
}

_docker_linux_unit_alive() {
  local state
  case "$(_linux_docker_flavor)" in
    desktop)  state=$(systemctl --user is-active docker-desktop 2>/dev/null) ;;
    rootless) state=$(systemctl --user is-active docker 2>/dev/null) ;;
    system)   state=$(systemctl is-active docker 2>/dev/null) ;;
    *) return 2 ;;
  esac
  case "$state" in
    active|activating|reloading) return 0 ;;
    *) return 1 ;;
  esac
}

# ============================================
# Single launch attempt (non-blocking)
# ============================================
# Returns 0 if a launch was issued, 1 if there is nothing we can launch here.
_docker_launch_once() {
  case "$PLATFORM" in
    macos)
      if [ ! -d "/Applications/Docker.app" ]; then
        log "Docker Desktop not installed"
        log "Install from: https://www.docker.com/products/docker-desktop"
        return 1
      fi
      # -g: don't steal focus from the terminal; -F: don't restore old windows.
      open -g -F -a "Docker" 2>/dev/null
      ;;
    wsl|windows)
      local exe winpath
      if exe=$(_windows_docker_desktop_exe); then
        if [ "$PLATFORM" = "wsl" ]; then winpath=$(wslpath -w "$exe"); else winpath=$(cygpath -w "$exe"); fi
        # Start-Process detaches, so Docker Desktop outlives this shell.
        powershell.exe -NoProfile -NonInteractive -Command "Start-Process -FilePath '$winpath'" >/dev/null 2>&1 \
          || (cd /mnt/c 2>/dev/null || cd /c 2>/dev/null || true; cmd.exe /c start "" "$winpath" >/dev/null 2>&1)
      elif [ "$PLATFORM" = "wsl" ]; then
        # Native dockerd inside the distro (no Docker Desktop on Windows)
        _docker_launch_linux || return 1
      else
        log "Docker Desktop not found under Program Files"
        log "Install from: https://www.docker.com/products/docker-desktop"
        return 1
      fi
      ;;
    linux)
      _docker_launch_linux || return 1
      ;;
    *)
      log "Don't know how to start Docker on $(uname -s)"
      return 1
      ;;
  esac
  return 0
}

_docker_launch_linux() {
  case "$(_linux_docker_flavor)" in
    desktop)  systemctl --user start --no-block docker-desktop 2>/dev/null ;;
    rootless) systemctl --user start --no-block docker 2>/dev/null ;;
    system)
      if ! _as_root systemctl start --no-block docker; then
        log "Cannot start dockerd without a password — run: sudo systemctl start docker"
        log "  (or once: sudo systemctl enable --now docker, so it starts at boot)"
        return 1
      fi
      ;;
    service)
      if ! _as_root service docker start >/dev/null; then
        log "Cannot start dockerd without a password — run: sudo service docker start"
        return 1
      fi
      ;;
    *)
      log "No Docker service found (Docker Engine or Docker Desktop for Linux)"
      log "Install: https://docs.docker.com/engine/install/"
      return 1
      ;;
  esac
}

# ============================================
# Restart a hung Docker Desktop (macOS: kill + relaunch)
# ============================================
# Used when the engine is running but the daemon stays unresponsive.
# Common causes: failed update, hung backend, crashed VM.
restart_docker_desktop() {
  case "$PLATFORM" in
    macos)
      log "  Stopping Docker Desktop..."
      # `docker desktop stop` first: `osascript quit app "Docker"` was observed
      # to block for over a minute against a half-quit Desktop, and an
      # unbounded wait here would freeze the launcher. Both are time-boxed.
      if command -v timeout &>/dev/null; then
        timeout 30 docker desktop stop >/dev/null 2>&1 \
          || timeout 10 osascript -e 'quit app "Docker"' 2>/dev/null || true
      else
        docker desktop stop >/dev/null 2>&1 || true
      fi
      for _i in $(seq 1 10); do
        _docker_engine_alive || break
        sleep 1
      done
      if _docker_engine_alive; then
        log "  Force-killing stubborn Docker processes..."
        killall "Docker Desktop" "Docker" com.docker.backend com.docker.virtualization 2>/dev/null || true
        sleep 2
        pkill -9 -f "Docker.app/Contents/MacOS/" 2>/dev/null || true
        sleep 2
      fi
      ;;
    wsl|windows)
      if _windows_docker_desktop_exe >/dev/null; then
        log "  Stopping Docker Desktop..."
        taskkill.exe /F /IM "Docker Desktop.exe" >/dev/null 2>&1 || true
        taskkill.exe /F /IM "com.docker.backend.exe" >/dev/null 2>&1 || true
        sleep 3
      fi
      ;;
    linux)
      case "$(_linux_docker_flavor)" in
        desktop)  systemctl --user stop docker-desktop 2>/dev/null || true ;;
        rootless) systemctl --user stop docker 2>/dev/null || true ;;
        system)   _as_root systemctl stop docker || true ;;
      esac
      ;;
  esac
  log "  Relaunching Docker..."
  _docker_launch_once
}

# ============================================
# Early Docker Launch (non-blocking)
# ============================================
# Starts Docker if not running so it boots in parallel with the rest of the
# launcher setup. Sets DOCKER_LAUNCH_START / DOCKER_LAUNCH_ATTEMPTS for
# ensure_docker_running(). Never kills a running Docker — that is destructive
# and reserved for the hung case in ensure_docker_running().
early_docker_launch() {
  DOCKER_LAUNCH_START=""
  DOCKER_LAUNCH_ATTEMPTS=0

  log "Checking Docker status..."

  # The docker CLI may be missing on WSL while Docker Desktop is down: the
  # integration symlink only resolves once Desktop has started.
  if ! command -v docker &>/dev/null; then
    if [ "$PLATFORM" = "wsl" ] && _windows_docker_desktop_exe >/dev/null; then
      log "  docker CLI not available yet (WSL integration appears once Docker Desktop runs)"
    else
      log "Docker client not found in PATH"
      log "Install Docker: https://www.docker.com/products/docker-desktop"
      return 1
    fi
  elif docker_daemon_ready; then
    log "  Docker daemon is responding"
    return 0
  else
    local docker_ps_error
    docker_ps_error=$(_docker_cli ps 2>&1 || true)
    log "  Docker daemon not responding"
    log "  Error: ${docker_ps_error:0:150}"
    if echo "$docker_ps_error" | grep -qi "permission denied"; then
      log "  The daemon may be up but this user cannot reach its socket."
      log "  Fix once: sudo usermod -aG docker \$USER  (then log out and back in)"
    fi
  fi

  if _docker_engine_alive; then
    # Already starting (or hung) — ensure_docker_running() decides which.
    log "  Docker engine process is running — waiting for the daemon"
    DOCKER_LAUNCH_START=$(date +%s)
    return 0
  fi

  log "Starting Docker..."
  if _docker_launch_once; then
    DOCKER_LAUNCH_START=$(date +%s)
    DOCKER_LAUNCH_ATTEMPTS=1
  fi
  return 0
}

# ============================================
# Ensure Docker Running (supervised, blocking)
# ============================================
# Waits up to DOCKER_TIMEOUT seconds (counted from the early launch) for the
# daemon. While waiting:
#   - engine process gone            -> the launch died: relaunch
#   - engine alive but unresponsive  -> after DOCKER_HUNG_AFTER: restart once
ensure_docker_running() {
  if docker_daemon_ready; then
    log "Docker daemon is running"
    return 0
  fi

  [ -n "$DOCKER_LAUNCH_START" ] || DOCKER_LAUNCH_START=$(date +%s)
  DOCKER_LAUNCH_ATTEMPTS=${DOCKER_LAUNCH_ATTEMPTS:-0}

  # Nothing launched yet (early launch skipped or Docker was down for a reason
  # it could not handle) — make the first attempt now.
  if [ "$DOCKER_LAUNCH_ATTEMPTS" -eq 0 ] && ! _docker_engine_alive; then
    log "Starting Docker..."
    _docker_launch_once || { show_docker_help; return 1; }
    DOCKER_LAUNCH_ATTEMPTS=1
    DOCKER_LAUNCH_START=$(date +%s)
  fi

  local deadline=$((DOCKER_LAUNCH_START + DOCKER_TIMEOUT))
  local attempt_start=$DOCKER_LAUNCH_START
  local seen_alive=false dead_since="" restarted_hung=false
  local now elapsed last_report=0

  log "Waiting for Docker daemon (up to ${DOCKER_TIMEOUT}s)..."
  while :; do
    now=$(date +%s)
    if command -v docker &>/dev/null && docker_daemon_ready; then
      log "Docker daemon ready after $((now - DOCKER_LAUNCH_START))s (launch attempts: ${DOCKER_LAUNCH_ATTEMPTS})"
      return 0
    fi
    [ "$now" -ge "$deadline" ] && break

    # Captured, not tested bare: the launcher runs under `set -e`.
    local alive=0
    _docker_engine_alive || alive=$?
    case $alive in
      0)
        seen_alive=true
        dead_since=""
        if [ "$restarted_hung" = false ] && [ $((now - attempt_start)) -ge "$DOCKER_HUNG_AFTER" ]; then
          log "Docker engine running for $((now - attempt_start))s but daemon unresponsive — restarting it"
          restarted_hung=true
          restart_docker_desktop || true
          DOCKER_LAUNCH_ATTEMPTS=$((DOCKER_LAUNCH_ATTEMPTS + 1))
          attempt_start=$(date +%s)
          seen_alive=false
        fi
        ;;
      1)
        [ -n "$dead_since" ] || dead_since=$now
        # Give a fresh launch a grace period to spawn its engine; once it was
        # seen alive, a disappearance means the launch died.
        if { [ "$seen_alive" = true ] && [ $((now - dead_since)) -ge 3 ]; } \
           || [ $((now - attempt_start)) -ge 20 ]; then
          if [ "$DOCKER_LAUNCH_ATTEMPTS" -ge "$DOCKER_START_ATTEMPTS" ]; then
            log "Docker exited during startup ${DOCKER_LAUNCH_ATTEMPTS} times — giving up"
            break
          fi
          log "Docker exited during startup (attempt ${DOCKER_LAUNCH_ATTEMPTS}) — relaunching..."
          _docker_launch_once || break
          DOCKER_LAUNCH_ATTEMPTS=$((DOCKER_LAUNCH_ATTEMPTS + 1))
          attempt_start=$(date +%s)
          seen_alive=false
          dead_since=""
        fi
        ;;
    esac

    elapsed=$((now - DOCKER_LAUNCH_START))
    if [ $((elapsed - last_report)) -ge 15 ]; then
      log "  Still waiting for Docker... (${elapsed}s, $((deadline - now))s left)"
      last_report=$elapsed
    fi
    sleep 2
  done

  log "Docker not ready after $(( $(date +%s) - DOCKER_LAUNCH_START ))s (${DOCKER_LAUNCH_ATTEMPTS} launch attempts)"
  show_docker_help
  return 1
}

# ============================================
# Platform-Specific Docker Help
# ============================================
show_docker_help() {
  case "$PLATFORM" in
    macos)
      log "Common fixes:"
      log "  1. Check the Docker Desktop window for dialogs (license, sign-in, update, errors)"
      log "  2. Inspect why it stopped: ~/Library/Containers/com.docker.docker/Data/log/host/com.docker.backend.log"
      log "  3. Give it longer: DOCKER_TIMEOUT=300 coding"
      log "  4. If repeated crashes: Docker Desktop > Troubleshoot > Reset to factory defaults"
      ;;
    wsl)
      log "Common fixes:"
      log "  1. Start Docker Desktop on Windows and enable Settings > Resources > WSL integration for this distro"
      log "  2. Or run Docker Engine inside the distro: sudo systemctl enable --now docker"
      log "  3. Give it longer: DOCKER_TIMEOUT=300 coding"
      ;;
    windows)
      log "Common fixes:"
      log "  1. Start Docker Desktop from the Start menu and check it for dialogs"
      log "  2. Give it longer: DOCKER_TIMEOUT=300 coding"
      ;;
    linux)
      log "Try: sudo systemctl enable --now docker   (Docker Desktop for Linux: systemctl --user enable --now docker-desktop)"
      ;;
  esac
}
