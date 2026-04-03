#!/bin/bash
# Agent definition: Mastracode
# Sourced by launch-agent-common.sh
#
# Mastracode is a standalone coding agent TUI (npm: mastracode).
# All LLM calls route through the coding LLM proxy (per D-07).
#
# Model selection based on network:
#   Inside VPN -> GitHub Copilot Enterprise (corporate subscription, free)
#   Outside VPN -> Anthropic direct (personal Claude Max / API key)

AGENT_NAME="mastra"
AGENT_DISPLAY_NAME="Mastracode"
AGENT_COMMAND="mastracode"
AGENT_SESSION_PREFIX="mastra"
AGENT_SESSION_VAR="MASTRA_SESSION_ID"
AGENT_TRANSCRIPT_FMT="mastra"
AGENT_ENABLE_PIPE_CAPTURE=false
AGENT_REQUIRES_COMMANDS="mastracode"
AGENT_INSTALL_COMMAND="npm install -g mastracode"

# Verify mastracode CLI is available
agent_check_requirements() {
  if ! command -v mastracode &>/dev/null; then
    _agent_log "Error: mastracode CLI is not installed or not in PATH"
    return 1
  fi
  _agent_log "✅ mastracode CLI detected at $(command -v mastracode)"
}

# First-run setup: mastracode needs OAuth auth on first launch.
# If launched inside tmux without auth, the interactive setup wizard gets mangled.
# Detect missing auth and run mastracode once in the raw terminal first.
_mastra_first_run_setup() {
  local auth_file="$HOME/Library/Application Support/mastracode/auth.json"
  # Linux fallback
  [ ! -d "$HOME/Library" ] && auth_file="$HOME/.local/share/mastracode/auth.json"

  if [ -f "$auth_file" ]; then
    return 0  # already authenticated
  fi

  _agent_log ""
  _agent_log "⚠️  First-run setup required — mastracode needs authentication"
  _agent_log "   This will launch mastracode directly so you can complete the"
  _agent_log "   interactive setup wizard (auth, model selection, etc.)"
  _agent_log "   Once setup completes, press Ctrl+C to exit back to the launcher."
  _agent_log ""
  printf "[%s] Run first-time setup now? [Y/n] " "$AGENT_DISPLAY_NAME"
  read -r response
  if [ -z "$response" ] || [[ "$response" =~ ^[Yy] ]]; then
    _agent_log "Launching mastracode for first-run setup..."
    _agent_log "(Complete the setup wizard, then press Ctrl+C to return)"
    _agent_log ""
    # Run directly in current terminal — NOT inside tmux
    mastracode || true
    _agent_log ""
    if [ -f "$auth_file" ]; then
      _agent_log "✅ Authentication complete"
    else
      _agent_log "⚠️  Auth file not found after setup — mastracode may prompt again inside tmux"
    fi
  else
    _agent_log "Skipping first-run setup — mastracode will prompt for auth inside tmux"
  fi
}

# Generate hooks.json with shell commands that write NDJSON transcript events.
# Each hook appends a JSON line to .observations/transcripts/mastra-transcript.jsonl
# in the format expected by MastraTranscriptReader._normalizeEvent().
#
# PROTOCOL: mastracode passes hook data as JSON on STDIN (not env vars).
# The only env var set is MASTRA_HOOK_EVENT.
#
# STDIN payloads by event:
#   SessionStart/End: { session_id, cwd, hook_event_name }
#   UserPromptSubmit: { session_id, cwd, hook_event_name, user_message }
#   Stop:            { session_id, cwd, hook_event_name, assistant_message, stop_reason }
#   PreToolUse:      { session_id, cwd, hook_event_name, tool_name, tool_input }
#   PostToolUse:     { session_id, cwd, hook_event_name, tool_name, tool_input, tool_output }
_generate_mastra_hooks_config() {
  local hooks_file="$1"
  local transcript_dir
  transcript_dir="$(cd "${CODING_REPO:-.}" && pwd)/.observations/transcripts"
  local transcript_file="${transcript_dir}/mastra-transcript.jsonl"
  local hook_script_dir="${CODING_REPO:-.}/scripts/mastra-hooks"

  mkdir -p "$transcript_dir"
  mkdir -p "$hook_script_dir"

  # Create a single reusable hook script that reads JSON from stdin,
  # transforms it based on MASTRA_HOOK_EVENT, and appends NDJSON to the transcript.
  cat > "$hook_script_dir/transcript-writer.py" << 'PYSCRIPT'
#!/usr/bin/env python3
"""Mastra lifecycle hook → NDJSON transcript writer.
Reads JSON from stdin (mastracode hook protocol), writes one NDJSON line to transcript file.
"""
import sys, json, os, datetime

def main():
    try:
        d = json.load(sys.stdin)
    except Exception:
        return  # silently skip if stdin is not valid JSON

    event = d.get("hook_event_name", os.environ.get("MASTRA_HOOK_EVENT", ""))
    ts = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    sid = d.get("session_id", "")
    cwd = d.get("cwd", "")

    if event == "SessionStart":
        out = {"type": "session_start", "sessionId": sid, "cwd": cwd, "timestamp": ts}
    elif event == "SessionEnd":
        out = {"type": "session_end", "sessionId": sid, "cwd": cwd, "timestamp": ts}
    elif event == "UserPromptSubmit":
        out = {"type": "message", "role": "user", "content": d.get("user_message", ""),
               "sessionId": sid, "cwd": cwd, "timestamp": ts}
    elif event == "Stop":
        out = {"type": "message", "role": "assistant", "content": d.get("assistant_message", ""),
               "reason": d.get("stop_reason", ""), "sessionId": sid, "cwd": cwd, "timestamp": ts}
    elif event == "PreToolUse":
        out = {"type": "onToolCall", "tool": d.get("tool_name", ""),
               "input": d.get("tool_input", ""), "sessionId": sid, "cwd": cwd, "timestamp": ts}
    elif event == "PostToolUse":
        out = {"type": "onToolResult", "tool": d.get("tool_name", ""),
               "output": d.get("tool_output", ""), "sessionId": sid, "cwd": cwd, "timestamp": ts}
    else:
        out = {"type": event, "sessionId": sid, "cwd": cwd, "timestamp": ts, "raw": d}

    transcript = os.environ.get("MASTRA_TRANSCRIPT_FILE", "")
    if transcript:
        with open(transcript, "a") as f:
            f.write(json.dumps(out, ensure_ascii=False) + "\n")
    else:
        print(json.dumps(out, ensure_ascii=False))

if __name__ == "__main__":
    main()
PYSCRIPT
  chmod +x "$hook_script_dir/transcript-writer.py"

  # Build hooks.json — all events use the same script, differentiated by stdin payload
  local cmd="MASTRA_TRANSCRIPT_FILE=${transcript_file} python3 ${hook_script_dir}/transcript-writer.py"

  cat > "$hooks_file" << HOOKS_EOF
{
  "SessionStart": [{"type": "command", "command": "${cmd}", "timeout": 5000}],
  "SessionEnd": [{"type": "command", "command": "${cmd}", "timeout": 5000}],
  "UserPromptSubmit": [{"type": "command", "command": "${cmd}", "timeout": 5000}],
  "Stop": [{"type": "command", "command": "${cmd}", "timeout": 5000}],
  "PreToolUse": [{"type": "command", "command": "${cmd}", "timeout": 5000}],
  "PostToolUse": [{"type": "command", "command": "${cmd}", "timeout": 5000}]
}
HOOKS_EOF

  _agent_log "Hooks config written to $hooks_file"
  _agent_log "Transcript writer: $hook_script_dir/transcript-writer.py"
  _agent_log "Transcript output: $transcript_file"
}

# Configure Mastracode and validate environment
# Note: agent_pre_launch runs AFTER detect_network_and_configure_proxy,
# so INSIDE_CN and PROXY_WORKING are already set.
agent_pre_launch() {
  # First-run auth check — must happen before tmux launch
  _mastra_first_run_setup

  # D-07: All LLM calls route through coding LLM proxy
  # D-15: Check LLM proxy reachability (warn only, do not block)
  if curl -sf http://localhost:8089/health &>/dev/null; then
    _agent_log "LLM proxy reachable on port 8089"
  else
    _agent_log "WARNING: LLM proxy not reachable on port 8089 -- mastracode may not have LLM access"
  fi

  # Network-adaptive model selection (same pattern as opencode.sh)
  if [ "$INSIDE_CN" = "true" ]; then
    # VPN/Corporate Network: use GitHub Copilot via corporate subscription
    export MASTRA_MODEL="github-copilot-enterprise/claude-opus-4.6"
    _agent_log "VPN -> GitHub Copilot Enterprise (claude-opus-4.6)"
  else
    # Outside VPN: use Anthropic directly
    export MASTRA_MODEL="claude-opus-4-6"
    _agent_log "Public -> Anthropic direct (claude-opus-4.6)"

    if [ -z "$ANTHROPIC_API_KEY" ]; then
      _agent_log "WARNING: ANTHROPIC_API_KEY not set -- mastracode may prompt for auth"
    fi
  fi

  # D-08: Ensure .mastracode/hooks.json exists for transcript capture via lifecycle hooks
  local hooks_dir="$HOME/.mastracode"
  local hooks_file="$hooks_dir/hooks.json"
  if [ ! -f "$hooks_file" ]; then
    _agent_log "Creating hooks config with NDJSON transcript writers at $hooks_file"
    mkdir -p "$hooks_dir"
    _generate_mastra_hooks_config "$hooks_file"
  fi

  # Ensure transcript output directory exists for MastraTranscriptReader
  mkdir -p "${CODING_REPO:-.}/.observations/transcripts"

  # D-06: Validate connectivity for the chosen provider (warn only, don't abort)
  validate_agent_connectivity "$AGENT_NAME" || true
}
