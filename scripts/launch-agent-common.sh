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

# Check and start Docker — required (Docker is the only supported mode).
_ensure_docker() {
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
    if curl -sf http://localhost:8080/health >/dev/null 2>&1; then
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
    pid=$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null | head -1 || true)

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
_start_services() {
  if ! command -v node &> /dev/null; then
    _agent_log "Error: Node.js is required but not found in PATH"
    exit 1
  fi

  local docker_dir="$CODING_REPO/docker"
  if [ ! -f "$docker_dir/docker-compose.yml" ]; then
    _agent_log "Error: Docker compose file not found at $docker_dir/docker-compose.yml"
    exit 1
  fi

  # Fast path: already healthy and ports are bound
  # (skip this shortcut after --force, since we just tore everything down)
  if [ "$CODING_FORCE_CLEAN" != "true" ] && curl -sf http://localhost:8080/health >/dev/null 2>&1; then
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
      if curl -sf http://localhost:8080/health >/dev/null 2>&1; then
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
  # guard covers opencode/copilot/mastra: early-return before running any adapter. Default
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
# :${LLM_PROXY_PORT:-12435} so its tokens land in token_usage and are measurable —
# not just claude. Each agent needs a different redirect seam (all → the one proxy):
#   claude    ANTHROPIC_BASE_URL  → proxy /v1/messages (Max-OAuth bearer forwarded)
#   opencode  ANTHROPIC_BASE_URL  → same seam (opencode's AI-SDK anthropic provider
#                                    honours it) for the anthropic path
#   mastra    self-routed by its config (MASTRACODE_MODEL_ID=rapid-proxy-mastra →
#                                    proxy /v1/mastra); nothing to add here
#   copilot   no base-URL override on the Copilot CLI (GitHub-enterprise OAuth) —
#                                    not yet proxy-routable; flagged honestly
#
# HEALTH-GATED: if the proxy is unreachable we log a loud warning and launch the
# agent UNROUTED (direct, unmeasured) rather than brick it. Runs AFTER
# agent_pre_launch + _set_agent_env_vars so it has the final say on the routing env.
configure_proxy_routing() {
  # Opt-out safety valve: CODING_PROXY_ROUTE=0 launches the agent direct (unmeasured)
  # without touching its env — use if the proxy is misbehaving in the hot path.
  case "${CODING_PROXY_ROUTE:-1}" in
    0|false|no|off)
      _agent_log "ℹ️  CODING_PROXY_ROUTE=${CODING_PROXY_ROUTE} — proxy routing disabled; ${AGENT_NAME:-$AGENT} launches direct (unmeasured)."
      return 0
      ;;
  esac

  local port="${LLM_PROXY_PORT:-12435}"
  local base="http://127.0.0.1:${port}"

  if ! curl -sf -o /dev/null --max-time 2 "${base}/health" 2>/dev/null; then
    _agent_log "⚠️  LLM proxy unreachable at ${base} — launching ${AGENT_NAME:-$AGENT} UNROUTED; its traffic will NOT be measured."
    _agent_log "    Start it:  launchctl kickstart -k gui/\$(id -u)/com.coding.llm-cli-proxy  then relaunch."
    return 0
  fi

  case "${AGENT_NAME:-$AGENT}" in
    claude)
      # VERIFIED: Claude Code honours ANTHROPIC_BASE_URL and forwards its Max-OAuth
      # bearer to it. Unset the API-key envs so OAuth is used — they take precedence
      # over the subscription login and would bypass the measured (Max) path; the
      # proxy passthrough re-injects the Max bearer when the caller sends none.
      export ANTHROPIC_BASE_URL="${base}"
      unset ANTHROPIC_API_KEY ANTHROPIC_ADMIN_API_KEY ANTHROPIC_AUTH_TOKEN
      # Bind this launcher's measurement span to the proxy tap's Route-1 passthrough rows
      # PER-REQUEST (newline-separated `Name: value` form). An empty TASK_ID sends a BLANK
      # x-task-id and, per D-08 (no-inherit), the tap stamps task_id='' on those wire rows
      # — there is NO ambient resolveLiveTaskId() fallback. The span binding is recovered
      # later at reconcile time by the RECONCILE_GAP_FILL_SQL task_id backfill (CR-03), which
      # stamps the span task_id onto a matched task_id='' wire row (span-scoped, not ambient).
      # Header env format verified live in Plan 06's EARLY gate before the full run.
      export ANTHROPIC_CUSTOM_HEADERS="x-task-id: ${TASK_ID:-}"
      _agent_log "🔌 claude → proxy ${base}/v1/messages (Max-OAuth forwarded; token_usage agent='claude'; x-task-id=${TASK_ID:-<ambient>})"
      ;;
    opencode)
      # BEST-EFFORT: opencode's AI-SDK anthropic provider should honour
      # ANTHROPIC_BASE_URL for its anthropic path; the proxy forwards opencode's own
      # credential (KEEP its ANTHROPIC_API_KEY — unsetting it would trip opencode's
      # auth prompt). The VPN/copilot-enterprise path is unaffected (not anthropic).
      # Validate end-to-end with a live opencode run — if unhonoured, opencode falls
      # back to the direct endpoint (works, just unmeasured — never broken).
      export ANTHROPIC_BASE_URL="${base}"
      _agent_log "🔌 opencode → proxy ${base}/v1/messages (anthropic path; best-effort — validate live)"
      ;;
    mastra)
      # Self-routed in mastra.sh's agent_pre_launch via the customProvider seam. The MASTRACODE_MODEL_ID
      # → /v1/mastra path is NOT launcher-controlled per-launch (no base-URL path seam to embed a
      # task_id), so mastra stays AMBIENT-BOUND this phase (documented deviation — see SUMMARY).
      if [ -n "${MASTRACODE_MODEL_ID:-}" ]; then
        _agent_log "🔌 mastra → proxy ${base}/v1/mastra (self-routed via MASTRACODE_MODEL_ID; ambient-bound this phase)"
      else
        _agent_log "⚠️  mastra: MASTRACODE_MODEL_ID unset — proxy routing may be inactive."
      fi
      ;;
    copilot)
      # BYOK measurement seam (Phase-81 verified live). The Copilot CLI cannot set request headers,
      # so its ONLY per-request binding seam is the task-scoped base-URL PATH (/v1/copilot/t/<task_id>,
      # Plan 03); the CLI appends /chat/completions. The API key is a literal non-secret placeholder
      # against the localhost no-auth proxy (T-82-05-01, accepted). This is the SINGLE measured home
      # for launcher-driven copilot BYOK (copilot.sh agent_pre_launch delegates here, Plan 06 / D-03).
      #
      # BYOK for BOTH launch modes (ambient routing shipped 2026-07-19; supersedes the WR-02 unset):
      #   - Measured span (TASK_ID set): task-scoped path /v1/copilot/t/<taskId> — per-request binding.
      #   - Interactive (no TASK_ID): unbound /v1/copilot — the shim stamps agent='copilot' from the
      #     path and resolves the task_id from the reconciler's ambient slot
      #     (active-measurement.copilot.json, kept in sync by measurement-reconciler.mjs), so ambient
      #     copilot sessions get wire token rows AND per-run context-breakdown capture under the SAME
      #     session uuid the auto-measure run row uses.
      # WR-02 (double-write) is closed two ways: the stop-adapter reconcile matches copadt transcript
      # rows against wire rows (request-id + fuzzy), and auto-measure-foreground's copilot pass only
      # inserts copadt aggregate rows when NO wire rows exist for the session (wire-presence guard).
      # WR-05 (dead URL) is covered by the /health gate above — same accepted risk as claude/opencode.
      # Opt-out: COPILOT_AMBIENT_ROUTE=0 restores the copadt-only interactive launch.
      if [ -n "${TASK_ID:-}" ]; then
        export COPILOT_PROVIDER_BASE_URL="${base}/v1/copilot/t/${TASK_ID}"
        export COPILOT_PROVIDER_TYPE="openai"
        export COPILOT_PROVIDER_API_KEY="rapid-proxy-no-auth-placeholder"
        export COPILOT_MODEL="${COPILOT_MODEL:-claude-haiku-4-5}"
        export COPILOT_AUTO_UPDATE="false"
        # COPILOT_PROVIDER_WIRE_MODEL is honoured if the caller pre-set it (wire name ≠ COPILOT_MODEL);
        # left inherited rather than forced, since the launcher has no wire-name mapping.
        _agent_log "🔌 copilot → proxy ${COPILOT_PROVIDER_BASE_URL} (BYOK openai; measured span; token_usage agent='copilot'; model=${COPILOT_MODEL})"
      elif [ "${COPILOT_AMBIENT_ROUTE:-1}" != "0" ]; then
        export COPILOT_PROVIDER_BASE_URL="${base}/v1/copilot"
        export COPILOT_PROVIDER_TYPE="openai"
        export COPILOT_PROVIDER_API_KEY="rapid-proxy-no-auth-placeholder"
        # The BYOK provider serves the proxy's copilot catalog, not GitHub's — default to the
        # dotted opus id the proxy's copilot client verifiably serves (COPILOT_MODEL_MAP handles
        # the -fast / dash aliases on the send path).
        export COPILOT_MODEL="${COPILOT_MODEL:-claude-opus-4.8}"
        export COPILOT_AUTO_UPDATE="false"
        _agent_log "🔌 copilot → proxy ${COPILOT_PROVIDER_BASE_URL} (BYOK openai; AMBIENT — task_id from reconciler slot; model=${COPILOT_MODEL}; opt-out COPILOT_AMBIENT_ROUTE=0)"
      else
        unset COPILOT_PROVIDER_BASE_URL COPILOT_PROVIDER_TYPE COPILOT_PROVIDER_API_KEY
        _agent_log "ℹ️  copilot: COPILOT_AMBIENT_ROUTE=0 — interactive launch stays copadt-only (unmeasured wire; no context capture)."
      fi
      ;;
    *)
      _agent_log "ℹ️  ${AGENT_NAME:-$AGENT}: no proxy-routing rule; launching as configured (traffic may be unmeasured)."
      ;;
  esac
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

  # 6. Network detection (needed early for dry-run output and agent config)
  _agent_log "Detecting network environment..."
  detect_network_and_configure_proxy

  # 7. Dry-run exit
  if [ "$CODING_DRY_RUN" = "true" ]; then
    _agent_log "DRY-RUN: All startup logic completed successfully"
    _agent_log "DRY-RUN: Would launch in tmux: $AGENT_COMMAND"
    _agent_log "DRY-RUN: Agent=$AGENT_NAME, Docker=$DOCKER_MODE, Platform=$PLATFORM"
    _agent_log "DRY-RUN: Project=$TARGET_PROJECT_DIR"
    _agent_log "DRY-RUN: Network: CN=$INSIDE_CN, Proxy=$PROXY_WORKING, Required=$PROXY_REQUIRED"
    # Run agent pre-launch to show model selection
    if type agent_pre_launch &>/dev/null; then
      agent_pre_launch
    fi
    exit 0
  fi

  # 7. Early Docker launch (parallel with setup)
  early_docker_launch

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
  tmux_session_wrapper "$AGENT_COMMAND" "$@"
}
