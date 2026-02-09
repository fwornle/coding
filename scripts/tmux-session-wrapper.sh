#!/bin/bash

# Shared tmux session wrapper for coding agents
# Wraps any agent command in a tmux session with the coding status bar.
#
# Usage:
#   source "$SCRIPT_DIR/tmux-session-wrapper.sh"
#   tmux_session_wrapper <command> [args...]
#
# Behavior:
#   1. Already inside tmux ($TMUX set) → configure current session's status bar, then exec
#   2. Otherwise → create detached session, configure status bar, attach
#
# Optional pipe-pane capture (for non-native agents like CoPilot):
#   Set AGENT_ENABLE_PIPE_CAPTURE=true before calling tmux_session_wrapper
#   Set AGENT_PROMPT_REGEX to the prompt detection pattern
#   Capture file and monitor process are cleaned up automatically
#
# Prerequisite: tmux must be installed (handled by install.sh)

tmux_session_wrapper() {
  local cmd="$1"
  shift

  if ! command -v tmux &>/dev/null; then
    echo "[tmux-wrapper] ERROR: tmux is required but not found. Run: brew install tmux" >&2
    exit 1
  fi

  local coding_repo="${CODING_REPO:?CODING_REPO must be set}"
  local agent="${CODING_AGENT:-agent}"
  local session_name="coding-${agent}-$$"
  # Pass project identity into status command so each session underlines its OWN project
  local transcript_project="${TRANSCRIPT_SOURCE_PROJECT:-${CODING_PROJECT_DIR:-$(pwd)}}"
  local status_cmd="CODING_REPO=${coding_repo} TRANSCRIPT_SOURCE_PROJECT=${transcript_project} node ${coding_repo}/scripts/status-line-fast.cjs"

  # Export so tmux environment inherits it (needed for the status-right #() command)
  export CODING_REPO
  export CODING_TMUX_MODE=true

  # Helper: apply status bar configuration to a tmux session
  _configure_tmux_status() {
    local target_session="$1"
    tmux set-option -t "$target_session" status on
    tmux set-option -t "$target_session" status-interval 5
    tmux set-option -t "$target_session" status-right-length 200
    tmux set-option -t "$target_session" status-style "bg=default,fg=default"
    tmux set-option -t "$target_session" status-right "#(${status_cmd} 2>/dev/null || echo '[Status Offline]') %H:%M"
    tmux set-option -t "$target_session" mouse on
  }

  # --- Case: already inside tmux → configure current session, exec directly ---
  if [ -n "$TMUX" ]; then
    local current_session
    current_session=$(tmux display-message -p '#S')
    echo "[tmux-wrapper] Already in tmux session '$current_session', configuring status bar"
    _configure_tmux_status "$current_session"
    exec "$cmd" "$@"
  fi

  # --- Case: not in tmux → create new session ---
  echo "[tmux-wrapper] Creating tmux session: $session_name"

  # Build the inner command that tmux will run.
  # We need to pass through all environment variables and the command with args.
  # Using a shell wrapper to preserve quoting.
  local inner_cmd
  inner_cmd="CODING_REPO='${coding_repo}' CODING_AGENT='${agent}' CODING_TMUX_MODE=true"

  # Propagate key environment variables into the tmux session
  local env_vars=(
    CODING_DOCKER_MODE CODING_PROJECT_DIR CODING_TOOLS_PATH
    CODING_AGENT_ADAPTER_PATH CODING_HOOKS_CONFIG CODING_TRANSCRIPT_FORMAT
    TRANSCRIPT_SOURCE_PROJECT CLAUDE_SESSION_ID COPILOT_SESSION_ID
    ANTHROPIC_API_KEY COPILOT_HTTP_ADAPTER_PID COPI_LOG_DIR
    AGENT_ENABLE_PIPE_CAPTURE AGENT_PROMPT_REGEX SESSION_ID
    PATH HOME USER SHELL TERM
  )

  for var in "${env_vars[@]}"; do
    if [ -n "${!var}" ]; then
      # Escape single quotes in values
      local val="${!var}"
      val="${val//\'/\'\\\'\'}"
      inner_cmd="${inner_cmd} ${var}='${val}'"
    fi
  done

  # Append the actual command
  inner_cmd="${inner_cmd} '${cmd}'"
  for arg in "$@"; do
    arg="${arg//\'/\'\\\'\'}"
    inner_cmd="${inner_cmd} '${arg}'"
  done

  # Create detached session running the agent command
  tmux new-session -d -s "$session_name" "$inner_cmd"

  # Configure status bar on the new session
  _configure_tmux_status "$session_name"

  # --- Optional: pipe-pane capture for non-native agents ---
  local capture_monitor_pid=""
  if [ "${AGENT_ENABLE_PIPE_CAPTURE}" = "true" ]; then
    local capture_dir="${COPI_LOG_DIR:-${coding_repo}/.logs/capture}"
    mkdir -p "$capture_dir"
    local capture_file="${capture_dir}/capture-${session_name}-$(date +%s).txt"
    export TMUX_CAPTURE_FILE="$capture_file"

    echo "[tmux-wrapper] Enabling pipe-pane capture: $capture_file"
    tmux pipe-pane -t "$session_name" -o "cat >> '${capture_file}'"

    # Start capture monitor in background (prompt detection + hook firing)
    if [ -f "${coding_repo}/scripts/capture-monitor.js" ]; then
      CAPTURE_FILE="$capture_file" \
        AGENT_PROMPT_REGEX="${AGENT_PROMPT_REGEX:-}" \
        CODING_REPO="$coding_repo" \
        SESSION_ID="${SESSION_ID:-}" \
        COPI_LOG_DIR="${capture_dir}" \
        node "${coding_repo}/scripts/capture-monitor.js" &
      capture_monitor_pid=$!
      echo "[tmux-wrapper] Capture monitor started (PID: $capture_monitor_pid)"
    fi
  fi

  # Attach — blocks until the agent exits or user detaches
  tmux attach-session -t "$session_name"

  # Cleanup: stop capture monitor if running
  if [ -n "$capture_monitor_pid" ] && kill -0 "$capture_monitor_pid" 2>/dev/null; then
    kill "$capture_monitor_pid" 2>/dev/null || true
  fi

  # After attach returns, clean up the session if it still exists
  tmux kill-session -t "$session_name" 2>/dev/null || true
}
