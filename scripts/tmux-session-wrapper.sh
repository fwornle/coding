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
  local status_cmd="CODING_REPO=${coding_repo} node ${coding_repo}/scripts/combined-status-line.js"

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

  # Attach — blocks until the agent exits or user detaches
  tmux attach-session -t "$session_name"

  # After attach returns, clean up the session if it still exists
  tmux kill-session -t "$session_name" 2>/dev/null || true
}
