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

# shellcheck source=scripts/lib/port-pids.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/port-pids.sh"

# The agent → proxy wiring (lib/agents/proxy-routing.mjs). `_coding_wiring
# pre-launch|route <agent>` runs one phase and evals the shell it prints:
# `_agent_log` lines, unset/export, hook locals, and `exit 1` when the launch
# must abort. Its inputs are exported to node only — some are plain shell
# variables at this point (TARGET_PROJECT_DIR is exported later).
_CODING_WIRING_JS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/agents/proxy-routing.mjs"
_coding_wiring() {
  local _wiring
  _wiring="$(
    export CODING_REPO TARGET_PROJECT_DIR TASK_ID CODING_PROJECT_ID CODING_AGENT_SCOPE \
      CODING_PROXY_ROUTE LLM_PROXY_PORT LLM_CLI_PROXY_PORT \
      CODING_COPILOT_BAND COPILOT_AMBIENT_ROUTE COPILOT_MODEL \
      CODING_OPENCODE_MODEL OPENCODE_ANTHROPIC_NATIVE QWEN_LAPTOP_API_BASE_URL
    node "$_CODING_WIRING_JS" "$@"
  )" || { _agent_log "🚫 agent → proxy wiring failed ($*) — launch aborted"; exit 1; }
  eval "$_wiring"
}

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
    wait_count=$((wait_count + 1))
  done

  if [ -f "$lock_file" ]; then
    _agent_log "⚠️  Transition still in progress after ${max_wait}s, proceeding anyway..."
  elif [ $wait_count -gt 0 ]; then
    _agent_log "✅ Transition complete, continuing startup"
  fi
}

# Docker is the only supported deployment mode. The DOCKER_MODE / CODING_DOCKER_MODE
# variables are kept for backwards-compatibility with downstream scripts and
# log lines that key off them — they're effectively constants now and could
# be folded out in a later cleanup pass.
_detect_docker_mode() {
  DOCKER_MODE=true
  export CODING_DOCKER_MODE=true
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

  # Write session state for cross-agent continuity (D-07, PROF-02)
  node "$SCRIPT_DIR/write-session-state.js" "$AGENT_NAME" "$TARGET_PROJECT_DIR" 2>/dev/null || {
    _agent_log "Warning: Session state write failed"
  }

  node "$SCRIPT_DIR/psm-session-cleanup.js" "$SESSION_ID" 2>/dev/null || {
    _agent_log "Warning: Session cleanup failed"
  }

  # D3: commit what this session learned, locally. Never pushes — that is
  # `coding sync --push`, on the user's confirmation.
  node "$SCRIPT_DIR/../lib/history/sync.mjs" commit --repo "$TARGET_PROJECT_DIR" >/dev/null 2>&1 || true
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
  _resolve_project_id
}

# The project id the agent's token usage is recorded under (token_usage.project):
# lib/teams/config.cjs projectIdFor of the enclosing repo — a teams `repos[].id`,
# else the repo's directory name; empty outside any repo. The SAME function stamps observations, so tokens and knowledge
# for one repo carry one id. Sent to the proxy as an x-project header (claude,
# opencode, pi) or a /p/<id> URL segment (copilot); see configure_proxy_routing.
# A caller-set CODING_PROJECT_ID wins (experiment cells run in a temp worktree
# whose name is not the project). Empty on any failure: unrecorded, never fatal.
_resolve_project_id() {
  if [ -z "${CODING_PROJECT_ID:-}" ]; then
    # teamForPath = projectIdFor of the enclosing repo root, null outside any
    # repo — the same answer the token adapters give for a session's cwd.
    CODING_PROJECT_ID="$(node --input-type=module -e '
      try {
        const { teamForPath } = await import(process.argv[1]);
        process.stdout.write(String(teamForPath(process.argv[2]) || ""));
      } catch { /* unresolvable -> empty */ }
    ' "$CODING_REPO/lib/attribution/repo-router.mjs" "$TARGET_PROJECT_DIR" 2>/dev/null || true)"
  fi
  # One path-safe segment, or nothing — the proxy applies the same rule.
  case "$CODING_PROJECT_ID" in
    *[!A-Za-z0-9._~@+-]*|.|..) CODING_PROJECT_ID="" ;;
  esac
  export CODING_PROJECT_ID
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

# Resolve the active feature set and refresh .coding/runtime/features.json.
#
# Sets CODING_FEATURES (space-separated enabled ids) and CODING_NEEDS_DOCKER
# (true/false), and exports them so every child — the services starter, the
# container entrypoint via the snapshot, the hook builder — acts on the same
# decision rather than each re-deriving it.
#
# A malformed config aborts here. Launching a half-configured stack under a
# configuration nobody could parse is worse than refusing with the reason.
_resolve_features() {
  local snapshot="$CODING_REPO/.coding/runtime/features.json"
  mkdir -p "$CODING_REPO/.logs"

  if ! node "$CODING_REPO/bin/coding-features" snapshot >/dev/null 2>"$CODING_REPO/.logs/features-resolve.err"; then
    _agent_log "❌ Feature configuration is invalid — refusing to start."
    sed 's/^/    /' "$CODING_REPO/.logs/features-resolve.err" >&2 2>/dev/null || true
    _agent_log "   Fix it, or reset with: coding-features profile full"
    exit 1
  fi

  # node, not jq: jq is not a dependency of this project and this path runs on
  # every launch on three platforms.
  CODING_FEATURES="$(node -e '
    const s = require(process.argv[1]);
    process.stdout.write(s.enabled.join(" "));
  ' "$snapshot" 2>/dev/null)"
  CODING_NEEDS_DOCKER="$(node -e '
    const s = require(process.argv[1]);
    process.stdout.write(String(s.needsDocker));
  ' "$snapshot" 2>/dev/null)"

  # Fail safe, not closed: if the snapshot could not be read, behave exactly as
  # this script always has (everything on, Docker required) rather than silently
  # skipping services.
  [ -n "$CODING_NEEDS_DOCKER" ] || CODING_NEEDS_DOCKER=true

  export CODING_FEATURES CODING_NEEDS_DOCKER
  _agent_log "Features: ${CODING_FEATURES:-(none)}"
}

# Is one feature enabled? Reads the resolved list, so it costs nothing per call.
_feature_enabled() {
  case " $CODING_FEATURES " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

# Is coding-services ready to serve the features that are actually enabled?
#
# This used to be a single `curl -sf localhost:8080/health` (vkb-server). That
# server was retired and its port is no longer published, so the gate could
# never pass again: every launch waited the full 30s and aborted, with the
# container sitting there healthy. Probe the services the enabled features
# actually depend on instead, so the check cannot outlive the thing it checks.
#
# Ports come from .env.ports (sourced by _load_env_files), never hardcoded.
_coding_services_ready() {
  if _feature_enabled knowledge; then
    curl -sf --max-time 5 "http://localhost:${SEMANTIC_ANALYSIS_SSE_PORT:-3848}/health" \
      >/dev/null 2>&1 || return 1
  fi

  if _feature_enabled constraints; then
    curl -sf --max-time 5 "http://localhost:${CONSTRAINT_MONITOR_SSE_PORT:-3849}/health" \
      >/dev/null 2>&1 || return 1
  fi

  # graphify speaks MCP only and has no /health route. A bare GET is rejected at
  # the JSON-RPC layer (400), which still proves the server is listening — so
  # accept any HTTP reply here and fail only when the connection itself fails.
  if _feature_enabled codegraph; then
    curl -s --max-time 5 -o /dev/null "http://localhost:${GRAPHIFY_MCP_PORT:-3851}/mcp" \
      >/dev/null 2>&1 || return 1
  fi

  return 0
}

# Check and start Docker — required only when a feature actually needs it.
#
# This used to be unconditional, and the hard exit below is why a proxy-only or
# logging-only install could not work at all on a machine without Docker: only
# `knowledge`, `codegraph` and `constraints` run in the container, but every
# launch demanded it regardless.
_ensure_docker() {
  if [ "$CODING_NEEDS_DOCKER" != "true" ]; then
    _agent_log "🐳 Docker not needed for the active features — skipping."
    return 0
  fi
  if ! ensure_docker_running; then
    _agent_log "❌ Docker is required but not running. Start Docker Desktop and retry."
    exit 1
  fi
}

# Check if coding-services container has unbound ports (running but ports not mapped to host).
# Returns 0 if ports are broken, 1 if OK or container not running.
_container_has_unbound_ports() {
  local state
  state=$(docker inspect coding-services --format '{{.State.Status}}' 2>/dev/null || echo "missing")
  [ "$state" != "running" ] && return 1

  local port_bindings
  port_bindings=$(docker inspect coding-services --format '{{range $p, $conf := .NetworkSettings.Ports}}{{$p}}={{if $conf}}{{(index $conf 0).HostPort}}{{else}}UNBOUND{{end}} {{end}}' 2>/dev/null || true)

  echo "$port_bindings" | grep -q "UNBOUND"
}

# Force-recreate coding-services after resolving port conflicts.
# Returns 0 on successful recovery, 1 on failure.
_recover_stale_container() {
  local docker_dir="$1"
  local max_wait="${2:-20}"

  _agent_log "⚠️  Container has unbound ports — resolving conflicts and recreating..."
  _resolve_port_conflicts "$docker_dir/docker-compose.yml"

  docker compose -f "$docker_dir/docker-compose.yml" up -d --force-recreate coding-services 2>/dev/null

  for j in $(seq 1 "$max_wait"); do
    if _coding_services_ready; then
      _agent_log "✅ Recovered after port conflict resolution (${j}s)"
      return 0
    fi
    sleep 1
  done

  _agent_log "❌ Recovery failed after ${max_wait}s"
  return 1
}

# Diagnose why coding-services failed to become healthy.
# Attempts recovery and returns 0 on success, 1 on failure.
_diagnose_unhealthy_services() {
  local docker_dir="$1"

  local state
  state=$(docker inspect coding-services --format '{{.State.Status}}' 2>/dev/null || echo "missing")
  _agent_log "   Container state: $state"

  if [ "$state" = "running" ] && _container_has_unbound_ports; then
    _recover_stale_container "$docker_dir" 20 && return 0
  fi

  # Show recent logs for debugging
  _agent_log "   Recent logs:"
  docker compose -f "$docker_dir/docker-compose.yml" logs --tail 10 coding-services 2>/dev/null | sed 's/^/   /'
  _agent_log "   Full logs: docker compose -f $docker_dir/docker-compose.yml logs coding-services"
  return 1
}

# Resolve port conflicts before starting Docker services.
# Extracts published host ports from docker-compose.yml and kills any
# non-Docker process occupying them.
_resolve_port_conflicts() {
  local compose_file="$1"
  local conflicts_found=false

  # Extract host ports from docker-compose port mappings (format: "HOST:CONTAINER")
  local host_ports
  host_ports=$(grep -oE '^\s+- "([0-9]+):' "$compose_file" | grep -oE '[0-9]+' || true)

  if [ -z "$host_ports" ]; then
    return 0
  fi

  for port in $host_ports; do
    # Find PID listening on this port (exclude docker-proxy which is expected)
    local pid
    pid=$(listening_pids "$port" | head -1)

    if [ -z "$pid" ]; then
      continue
    fi

    # Check if this is a Docker process (com.docker or docker-proxy) — leave those alone
    local proc_name
    proc_name=$(ps -p "$pid" -o comm= 2>/dev/null || true)
    if [[ "$proc_name" == *docker* ]] || [[ "$proc_name" == *com.docker* ]]; then
      continue
    fi

    local proc_cmd
    proc_cmd=$(ps -p "$pid" -o args= 2>/dev/null | head -c 120 || true)
    _agent_log "⚠️  Port $port blocked by PID $pid: $proc_cmd"

    kill "$pid" 2>/dev/null && {
      _agent_log "   Killed PID $pid to free port $port"
      conflicts_found=true
    } || {
      _agent_log "   Failed to kill PID $pid — try: sudo kill $pid"
    }
  done

  if [ "$conflicts_found" = true ]; then
    # Brief pause for ports to be released by the kernel
    sleep 1
  fi
}

# Start coding services (Docker or Native mode)
# Export CODING_DATA_HOME for docker-compose.
#
# The compose file mounts it and REFUSES to interpolate without it (`:?`). That
# is deliberate: the data root is where the knowledge graph lives, and a compose
# run that quietly fell back to some default path would mount an EMPTY graph —
# indistinguishable, from the dashboard, from a knowledge base that lost its
# content. So the launcher is required to state it.
#
# --ensure creates the root and its history/ kb/ var/ subtrees plus the var/
# .gitignore, because Docker would otherwise create the mount source itself, as
# root, with no .gitignore in it.
_export_data_home() {
  local resolved
  if ! resolved="$("$CODING_REPO/bin/coding-data-home" --ensure 2>/dev/null)" || [ -z "$resolved" ]; then
    _agent_log "Error: could not resolve the data root (bin/coding-data-home failed)"
    _agent_log "       check ~/.coding/scope, or run: bin/coding-data-home --explain"
    exit 1
  fi
  export CODING_DATA_HOME="$resolved"

  # The scope travels with the data root, for the same reason and by the same
  # mechanism: `~/.coding/scope` is a per-machine file that does not exist in
  # the image, so the container is TOLD its tenant rather than deriving one.
  # Without this a container would resolve the placeholder 'default' and tag a
  # colleague's entities under a tenant nobody owns.
  local scope
  if ! scope="$("$CODING_REPO/bin/coding-data-home" --scope 2>/dev/null)" || [ -z "$scope" ]; then
    _agent_log "Error: could not resolve the scope (bin/coding-data-home --scope failed)"
    _agent_log "       check ~/.coding/scope, or run: bin/coding-data-home --explain"
    exit 1
  fi
  export CODING_SCOPE="$scope"
}

_start_services() {
  if ! command -v node &> /dev/null; then
    _agent_log "Error: Node.js is required but not found in PATH"
    exit 1
  fi

  # Nothing in the active feature set runs in the container. Host services are
  # started separately (scripts/start-services-robust.js), so there is nothing
  # left to do here — and, crucially, no reason to demand a docker-compose.yml
  # or a running daemon.
  if [ "$CODING_NEEDS_DOCKER" != "true" ]; then
    _agent_log "🐳 No container-backed features enabled — skipping coding-services."
    return 0
  fi

  local docker_dir="$CODING_REPO/docker"
  if [ ! -f "$docker_dir/docker-compose.yml" ]; then
    _agent_log "Error: Docker compose file not found at $docker_dir/docker-compose.yml"
    exit 1
  fi

  # Before ANY compose invocation in this shell — including the ones inside
  # _recover_stale_container, which inherit the export.
  _export_data_home

  # Fast path: already healthy and ports are bound
  # (skip this shortcut after --force, since we just tore everything down)
  if [ "$CODING_FORCE_CLEAN" != "true" ] && _coding_services_ready; then
    _agent_log "✅ coding-services already running and healthy - reusing existing containers"
  else
    # Detect stale container (running but ports not bound to host) — common after
    # Docker Desktop crashes or port conflicts. Fix it immediately instead of
    # waiting 60s to fail.
    if _container_has_unbound_ports; then
      _resolve_port_conflicts "$docker_dir/docker-compose.yml"
      _agent_log "🐳 Recreating coding-services (stale port bindings)..."
      export CODING_REPO
      docker compose -f "$docker_dir/docker-compose.yml" up -d --force-recreate coding-services
    else
      _resolve_port_conflicts "$docker_dir/docker-compose.yml"
      _agent_log "🐳 Starting coding services via Docker..."
      export CODING_REPO
      if ! docker compose -f "$docker_dir/docker-compose.yml" up -d; then
        _agent_log "Error: Failed to start Docker containers"
        exit 1
      fi
    fi

    _agent_log "⏳ Waiting for coding-services to be healthy..."
    local max_wait=30
    for i in $(seq 1 $max_wait); do
      if _coding_services_ready; then
        _agent_log "✅ coding-services healthy after ${i}s"
        break
      fi
      if [ "$i" -eq "$max_wait" ]; then
        _agent_log "❌ coding-services health check failed after ${max_wait}s"
        if _diagnose_unhealthy_services "$docker_dir"; then
          break  # recovery succeeded
        fi
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

# Inject knowledge context for non-Claude agents (D-06)
# Claude uses a per-prompt UserPromptSubmit hook (registered globally).
# Other agents get a session-start context file written before launch.
_inject_knowledge_context() {
  local agent="$AGENT_NAME"
  local hooks_dir="$CODING_REPO/src/hooks"

  # Per-avenue injection toggle (Phase 87, AVN-04). An avenue declaring env=kb-off gets
  # CODING_KNOWLEDGE_INJECTION=0 in the spawned agent's env (runner, Plan 03). This ONE
  # guard covers opencode/copilot/pi: early-return before running any adapter. Default
  # ON; only the literal 0/false/off disables. Scoped to this process env (Pitfall 4) — the
  # operator's interactive session leaves the var unset, so injection stays on for them.
  local _kb="$(printf '%s' "${CODING_KNOWLEDGE_INJECTION:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  if [ "$_kb" = "0" ] || [ "$_kb" = "false" ] || [ "$_kb" = "off" ]; then
    _agent_log "Knowledge injection disabled for ${AGENT_DISPLAY_NAME:-$agent} (CODING_KNOWLEDGE_INJECTION=${CODING_KNOWLEDGE_INJECTION})"
    return 0
  fi

  # Claude uses per-prompt hook (registered in ~/.claude/settings.json) -- skip here
  if [ "$agent" = "claude" ]; then
    return 0
  fi

  local adapter="$hooks_dir/knowledge-injection-${agent}.js"
  if [ ! -f "$adapter" ]; then
    _agent_log "No knowledge injection adapter for ${agent} -- skipping"
    return 0
  fi

  _agent_log "Injecting knowledge context for ${AGENT_DISPLAY_NAME}..."

  # Export target project dir for the adapter to use
  export TARGET_PROJECT_DIR="${TARGET_PROJECT_DIR}"
  export CODING_PROJECT_DIR="${TARGET_PROJECT_DIR}"

  # Run adapter with timeout (fail-open -- never block agent startup)
  if timeout 10 node "$adapter" 2>/dev/null; then
    _agent_log "Knowledge context injected for ${AGENT_DISPLAY_NAME}"
  else
    _agent_log "Knowledge injection skipped (service unavailable or timeout)"
  fi
}

# ============================================
# Proxy routing (Route 1) — measure EVERY agent
# ============================================
#
# Route each coding agent's foreground LLM traffic through the coding LLM proxy on
# :${LLM_PROXY_PORT:-12435} so its tokens land in token_usage and are measurable.
# Each agent has its own redirect seam (all → the one proxy):
#   claude    ANTHROPIC_BASE_URL → /v1/messages (Max-OAuth bearer forwarded),
#             ANTHROPIC_CUSTOM_HEADERS binds x-task-id / x-project
#   opencode  ANTHROPIC_BASE_URL for its anthropic path; the rest of its routing
#             is in OPENCODE_CONFIG_CONTENT (agent_pre_launch)
#   pi        self-routed by the models.json provider agent_pre_launch writes
#   copilot   BYOK: COPILOT_PROVIDER_BASE_URL=/v1/copilot[/p/..][/b/..][/t/..]
#
# HEALTH-GATED, FAIL-CLOSED (T1): agents launched via bin/coding MUST route
# through the proxy. If the daemon is unreachable after a short retry window the
# launch ABORTS with remediation hints — no silent direct (unmeasured) fallback.
# A bare `claude`/`opencode` started outside bin/coding is untouched by this
# policy; CODING_PROXY_ROUTE=0 remains the explicit direct-launch escape hatch.
# Runs AFTER agent_pre_launch + _set_agent_env_vars so it has the final say on
# the routing env.
#
# The rules live in lib/agents/proxy-routing.mjs (proxyRouting), shared with the
# experiment runner; tests/agents/proxy-routing-parity.test.mjs pins them.
configure_proxy_routing() {
  _coding_wiring route "${AGENT_NAME:-$AGENT}"
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
  # Agent configs may add native command/skill loading flags. Expand an absent
  # array to no words so the launcher stays compatible with the other agents.
  if ! declare -p AGENT_COMMAND_ARGS >/dev/null 2>&1; then
    AGENT_COMMAND_ARGS=()
  fi

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

  # 5b. Resolve features (before dry-run, so --dry-run reports the real set and
  #     an invalid config is caught without starting anything)
  _resolve_features

  # 6. Network detection (needed early for dry-run output and agent config)
  _agent_log "Detecting network environment..."
  detect_network_and_configure_proxy

  # 7. Dry-run exit
  if [ "$CODING_DRY_RUN" = "true" ]; then
    _agent_log "DRY-RUN: All startup logic completed successfully"
    _agent_log "DRY-RUN: Would launch in tmux: $AGENT_COMMAND"
    _agent_log "DRY-RUN: Agent=$AGENT_NAME, Docker=$DOCKER_MODE, Platform=$PLATFORM"
    _agent_log "DRY-RUN: Features=${CODING_FEATURES:-none} (docker needed: $CODING_NEEDS_DOCKER)"
    _agent_log "DRY-RUN: Project=$TARGET_PROJECT_DIR"
    _agent_log "DRY-RUN: Network: CN=$INSIDE_CN, Proxy=$PROXY_WORKING, Required=$PROXY_REQUIRED"
    # Run agent pre-launch to show model selection
    if type agent_pre_launch &>/dev/null; then
      agent_pre_launch
    fi
    exit 0
  fi

  # 7. Early Docker launch (parallel with setup) — skipped when no enabled
  #    feature runs in the container, so a machine without Docker Desktop is
  #    never nudged to start it.
  if [ "$CODING_NEEDS_DOCKER" = "true" ]; then
    early_docker_launch || true
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

  # 12.5. Inject knowledge context (session-start adapters)
  _inject_knowledge_context

  # 13. Agent-specific requirements check (with auto-install)
  if type agent_check_requirements &>/dev/null; then
    if ! agent_check_requirements; then
      if [ -n "$AGENT_INSTALL_COMMAND" ]; then
        _agent_log ""
        _agent_log "Would you like to install it now?"
        _agent_log "  Command: $AGENT_INSTALL_COMMAND"
        _agent_log ""
        printf "[%s] Install now? [Y/n] " "$AGENT_DISPLAY_NAME"
        read -r response
        if [ -z "$response" ] || [[ "$response" =~ ^[Yy] ]]; then
          _agent_log "📦 Installing: $AGENT_INSTALL_COMMAND"
          if eval "$AGENT_INSTALL_COMMAND"; then
            _agent_log "✅ Installed successfully, retrying requirements check..."
            if ! agent_check_requirements; then
              _agent_log "❌ Requirements still not met after install"
              exit 1
            fi
          else
            _agent_log "❌ Install failed. Run manually: $AGENT_INSTALL_COMMAND"
            exit 1
          fi
        else
          _agent_log "Skipped. Install manually: $AGENT_INSTALL_COMMAND"
          exit 1
        fi
      else
        exit 1
      fi
    fi
  fi

  # 15. Agent-specific pre-launch hook (can use INSIDE_CN, PROXY_WORKING)
  if type agent_pre_launch &>/dev/null; then
    agent_pre_launch
  fi

  # 15. Agent-common init (LSL, monitoring, gitignore, etc.)
  agent_common_init "$TARGET_PROJECT_DIR" "$CODING_REPO"

  # 16. Log mode info
  _agent_log "MCP servers run via stdio-proxy → SSE connections to Docker"

  # 17. Set env vars
  _set_agent_env_vars

  # 17b. Route this agent's LLM traffic through the proxy so it is measurable
  #      (Route 1). AFTER agent_pre_launch + env vars so it has the final say.
  configure_proxy_routing

  # 18. cd to project
  cd "$TARGET_PROJECT_DIR"
  _agent_log "Changed working directory to: $(pwd)"

  # 19. Launch via tmux session wrapper
  _agent_log "Launching ${AGENT_DISPLAY_NAME}..."
  source "$SCRIPT_DIR/tmux-session-wrapper.sh"
  tmux_session_wrapper "$AGENT_COMMAND" "${AGENT_COMMAND_ARGS[@]}" "$@"
}
