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

# Emit a diagnostic post-mortem when an agent session dies during startup.
# Surfaces the tail of the captured launch output so the real error (a failed
# MCP gate, missing config, proxy/auth hiccup) is visible instead of a silent
# drop back to the shell prompt.
_tmux_wrapper_report_fast_exit() {
  local session_name="$1"
  local log_file="$2"
  local start_epoch="$3"
  local lived=$(( $(date +%s) - start_epoch ))

  {
    echo ""
    echo "[tmux-wrapper] ⚠️  Session '${session_name}' exited after ${lived}s — the agent failed to start."
    echo "[tmux-wrapper]     The launch command died before the session became interactive."
    if [ -n "$log_file" ] && [ -s "$log_file" ]; then
      echo "[tmux-wrapper] ─── tail of the failed launch ──────────────────────────────"
      tail -n 25 "$log_file" 2>/dev/null | tr -d '\r'
      echo "[tmux-wrapper] ────────────────────────────────────────────────────────────"
      echo "[tmux-wrapper]     Full log: ${log_file}"
    else
      echo "[tmux-wrapper]     (no output captured — the command exited too fast to log)"
    fi
    echo "[tmux-wrapper]     Likely causes: MCP services not ready (VKB :8080), missing MCP"
    echo "[tmux-wrapper]     config, or a transient proxy/auth hiccup. Re-running 'coding'"
    echo "[tmux-wrapper]     usually clears a startup timing race."
  } >&2
}

# Heuristic: does the captured startup log show a launch-failure signature?
# Anchored to launcher-specific markers so a healthy session's early output
# does not trigger a false post-mortem.
_looks_like_launch_failure() {
  local log="$1"
  [ -n "$log" ] && [ -s "$log" ] || return 1
  tail -n 40 "$log" 2>/dev/null | tr -d '\r' | \
    grep -qiE '❌|validation failed|config file not found|command not found|no such file|not reachable|exit code [1-9]'
}

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
  # Pass project identity into status command so each session underlines its OWN project.
  # TMUX_PANE_WIDTH=#{pane_width} is expanded by tmux per pane on each substitution,
  # letting status-line-fast.cjs / combined-status-line.js size the right-pad to fit
  # the actual pane width (the prerequisite for residue-free trailing-edge filling).
  local transcript_project="${TRANSCRIPT_SOURCE_PROJECT:-${CODING_PROJECT_DIR:-$(pwd)}}"
  local status_cmd="CODING_REPO=${coding_repo} TRANSCRIPT_SOURCE_PROJECT=${transcript_project} TMUX_PANE_WIDTH=#{pane_width} node ${coding_repo}/scripts/status-line-fast.cjs"

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
    tmux set-option -t "$target_session" status-right "#(${status_cmd} 2>/dev/null || echo '[Status Offline]')"
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
    HTTP_PROXY HTTPS_PROXY http_proxy https_proxy NO_PROXY no_proxy
    OPENCODE_CONFIG_CONTENT
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

  # Diagnostic capture: record the launch pane's early output so that if the
  # inner command dies before the session becomes interactive (a failed
  # pre-flight gate inside claude-mcp-launcher.sh, a transient proxy/auth
  # hiccup, etc.) we can surface WHY instead of dropping the user back to a
  # bare shell with no explanation.
  local launch_log_dir="${coding_repo}/.logs/launch"
  mkdir -p "$launch_log_dir" 2>/dev/null || true
  find "$launch_log_dir" -type f -mtime +7 -delete 2>/dev/null || true
  local launch_log="${launch_log_dir}/${session_name}-$(date +%s).log"
  local session_start_epoch
  session_start_epoch=$(date +%s)

  # Create detached session running the agent command
  tmux new-session -d -s "$session_name" "$inner_cmd"

  # Fast-fail: the inner command may have exited before the session even
  # settled (e.g. missing MCP config → immediate exit 1). If so there is
  # nothing to attach to — report and bail instead of a silent return.
  if ! tmux has-session -t "$session_name" 2>/dev/null; then
    _tmux_wrapper_report_fast_exit "$session_name" "$launch_log" "$session_start_epoch"
    return 1
  fi

  # Tap the pane's output into the diagnostic log during startup. We disarm the
  # pipe after the pre-flight window (validate-mcp-startup.sh waits up to 30s)
  # so a healthy interactive session is NOT logged in full. Skipped when the
  # caller already owns pipe capture (AGENT_ENABLE_PIPE_CAPTURE), whose file we
  # reuse for the post-mortem instead.
  if [ "${AGENT_ENABLE_PIPE_CAPTURE}" != "true" ]; then
    tmux pipe-pane -t "$session_name" "cat >> '${launch_log}'" 2>/dev/null || true
    ( sleep 35
      tmux has-session -t "$session_name" 2>/dev/null && \
        tmux pipe-pane -t "$session_name" 2>/dev/null
    ) >/dev/null 2>&1 &
    disown 2>/dev/null || true
  fi

  # Configure status bar on the new session (guarded — the session can still
  # race-die between the check above and here).
  _configure_tmux_status "$session_name" 2>/dev/null || true

  # --- Optional: pipe-pane capture for non-native agents ---
  local capture_monitor_pid=""
  if [ "${AGENT_ENABLE_PIPE_CAPTURE}" = "true" ]; then
    local capture_dir="${COPI_LOG_DIR:-${coding_repo}/.logs/capture}"
    mkdir -p "$capture_dir"
    find "$capture_dir" -type f -mtime +14 -delete 2>/dev/null || true
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

  # Attach — blocks until the agent exits or user detaches.
  #
  # Guard: tmux attach-session requires a real interactive terminal. When
  # 'coding' is launched from a non-TTY context (a VS Code task, a pipe, a
  # non-login/non-interactive shell, an SSH command without -t, etc.) attach
  # fails instantly with "open terminal failed: not a terminal". The detached
  # session is still alive at that instant, so the post-mortem check below sees
  # has-session → true, skips the report, and kill-session silently drops the
  # user back to the shell with no explanation. Detect that up front and report.
  if [ ! -t 0 ] || [ ! -t 1 ]; then
    {
      echo ""
      echo "[tmux-wrapper] ⚠️  Cannot attach to session '${session_name}' — not running in an interactive terminal."
      echo "[tmux-wrapper]     tmux attach-session needs a real TTY on both stdin and stdout."
      echo "[tmux-wrapper]     stdin tty:  $([ -t 0 ] && echo yes || echo NO)"
      echo "[tmux-wrapper]     stdout tty: $([ -t 1 ] && echo yes || echo NO)"
      echo "[tmux-wrapper]     Launch 'coding' directly from an interactive terminal, or attach"
      echo "[tmux-wrapper]     manually:  tmux attach -t ${session_name}"
    } >&2
    # Leave the session running so the user can attach manually instead of
    # killing work-in-progress. Skip the auto-cleanup at the end of the function.
    return 1
  fi

  tmux attach-session -t "$session_name"
  local attach_rc=$?

  # If attach itself failed (non-zero) but the session is still alive, the agent
  # is running detached — surface the failure and preserve the session instead
  # of silently killing it.
  if [ "$attach_rc" -ne 0 ] && tmux has-session -t "$session_name" 2>/dev/null; then
    {
      echo ""
      echo "[tmux-wrapper] ⚠️  tmux attach-session failed (exit ${attach_rc}) but session '${session_name}' is still alive."
      echo "[tmux-wrapper]     The agent is running detached. Attach manually with:"
      echo "[tmux-wrapper]        tmux attach -t ${session_name}"
    } >&2
    return "$attach_rc"
  fi

  # Cleanup: stop capture monitor if running
  if [ -n "$capture_monitor_pid" ] && kill -0 "$capture_monitor_pid" 2>/dev/null; then
    kill "$capture_monitor_pid" 2>/dev/null || true
  fi

  # Post-mortem: if the session is gone now, distinguish a normal detach/quit
  # from a startup crash. A crash either dies almost instantly (< 5s) or leaves
  # a recognisable failure signature in the captured startup log. Must run
  # BEFORE kill-session so has-session reflects the real state.
  if ! tmux has-session -t "$session_name" 2>/dev/null; then
    local lived=$(( $(date +%s) - session_start_epoch ))
    local diag_log="${TMUX_CAPTURE_FILE:-$launch_log}"
    if [ "$lived" -lt 5 ] || _looks_like_launch_failure "$diag_log"; then
      _tmux_wrapper_report_fast_exit "$session_name" "$diag_log" "$session_start_epoch"
    fi
  fi

  # After attach returns, clean up the session if it still exists
  tmux kill-session -t "$session_name" 2>/dev/null || true

  # Reset terminal state — tmux/agent may leave the terminal in raw mode,
  # causing "staircase" output (LF without CR) after detach/exit
  stty sane 2>/dev/null || true
  printf '\e[?1004l' 2>/dev/null || true   # Disable focus reporting
  printf '\e[?1049l' 2>/dev/null || true   # Exit alternate screen buffer (if stuck)
  printf '\e[?25h' 2>/dev/null || true     # Ensure cursor is visible
  # Note: intentionally NOT using '\ec' (RIS / full terminal reset) here.
  # RIS resets terminal geometry and column tracking, which corrupts VS Code's
  # integrated terminal and causes garbled/wrapped output on the next launch.
}
