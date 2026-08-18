#!/bin/bash
# Agent definition: pi (https://pi.dev/)
# Sourced by launch-agent-common.sh
#
# pi is a standalone coding agent TUI + harness (npm:
# @earendil-works/pi-coding-agent, MIT). It replaces the retired mastracode
# agent. All LLM calls route through the coding LLM proxy (per D-07).
#
# There is deliberately NO scripts/launch-pi.sh: bin/coding falls back to
# launch-generic.sh for any agent that only needs a config file, and this agent
# needs nothing more. mastra carried a launch-mastra.sh that did nothing but
# delegate.
#
# Two things pi does that mastracode could not, which is why it is wired as a
# first-class agent rather than a like-for-like port:
#
#   1. Its custom-provider seam CAN attach request headers, so `x-agent: pi` and
#      `x-task-id: $TASK_ID` bind every call per-request. mastracode could attach
#      neither a header nor a body.agent field, which is why it needed a
#      dedicated /v1/mastra proxy sub-route to derive the agent from the URL
#      path, and why it was stuck ambient-bound with task_id=''.
#   2. It writes its own session JSONL, so there is no hook-generation to do.
#      mastra.sh had to heredoc a Python script into the repo and register it
#      against six lifecycle events just to produce a readable transcript.

AGENT_NAME="pi"
AGENT_DISPLAY_NAME="Pi"
AGENT_COMMAND="pi"
AGENT_SESSION_PREFIX="pi"
AGENT_SESSION_VAR="PI_SESSION_ID"
AGENT_TRANSCRIPT_FMT="pi"
# pi persists a structured session JSONL of its own (see agent_pre_launch), so
# there is nothing for the terminal-scraping capture path to add.
AGENT_ENABLE_PIPE_CAPTURE=false
AGENT_REQUIRES_COMMANDS="pi"
AGENT_INSTALL_COMMAND="npm install -g --ignore-scripts @earendil-works/pi-coding-agent"

# Verify the `pi` on PATH is actually the coding agent.
#
# `pi` is a two-character binary name — the most collision-prone of any agent
# here — and `pi --version` prints a bare semver ("0.84.2") that identifies
# nothing. So resolve the binary and check its provenance, falling back to the
# help banner. A `command -v pi` test alone would happily accept a plotting tool,
# a shell alias, or a pi-calculating toy and then fail deep inside tmux.
agent_check_requirements() {
  if ! command -v pi &>/dev/null; then
    _agent_log "Error: pi CLI is not installed or not in PATH"
    return 1
  fi

  local resolved
  resolved="$(command -v pi)"
  # Follow symlinks: a global npm install leaves <prefix>/bin/pi -> ../lib/
  # node_modules/@earendil-works/pi-coding-agent/dist/cli.js
  local real
  real="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$resolved" 2>/dev/null || echo "$resolved")"

  if [[ "$real" == *"@earendil-works/pi-coding-agent"* ]]; then
    _agent_log "✅ pi CLI detected ($(pi --version 2>/dev/null || echo 'unknown')) at $resolved"
    return 0
  fi

  # Installed some other way (Homebrew formula, bun link, a vendored build) —
  # the package path tells us nothing, so ask the binary what it is.
  if pi --help 2>&1 | head -1 | grep -q 'AI coding assistant'; then
    _agent_log "✅ pi CLI detected ($(pi --version 2>/dev/null || echo 'unknown')) at $resolved"
    return 0
  fi

  _agent_log "Error: '$resolved' is on PATH as \`pi\` but is not the pi coding agent"
  _agent_log "       (resolved to: $real)"
  _agent_log "       Install it with: $AGENT_INSTALL_COMMAND"
  return 1
}

# Write the models.json that points pi at the local proxy.
#
# $1 = the pi config directory to write into.
#
# The header block is the whole reason pi can be measured per-request. pi
# interpolates $VAR in header values from its own process environment at config
# load (verified live: TASK_ID=c4-final-hdr produced a token_usage row with
# task_id='c4-final-hdr'). Because that resolution is per-process, and the
# experiment harness spawns one pi process per cell, a single static file gives
# per-cell task binding — no per-cell config directory is needed.
_pi_write_models_json() {
  local cfg_dir="$1"
  local models_file="$cfg_dir/models.json"
  local port="${LLM_CLI_PROXY_PORT:-12435}"

  mkdir -p "$cfg_dir"

  # `openai-completions`, not `anthropic-messages`. The Anthropic wire is not a
  # matter of preference here — it is closed to pi. The proxy's /v1/messages is
  # an Anthropic-protocol passthrough and answers 501 for any foreground agent
  # routed to a non-Anthropic provider: "foreground pi is routed to gh-copilot
  # by fg-chat/pi, but this endpoint is an Anthropic-protocol passthrough".
  #
  # baseUrl is the /v1 root; pi's openai client appends /chat/completions. That
  # bare shim path defaults the agent to 'opencode', which the x-agent header
  # then overrides (server.mjs:3153 — header > body.agent > path default).
  #
  # The api key is a literal non-secret placeholder: the proxy is no-auth on
  # localhost and holds the real provider credentials itself. Same arrangement
  # copilot's BYOK seam already uses.
  #
  # ONE model entry, deliberately. The proxy replaces body.model with whatever
  # (provider, complexity) resolves to in llm-routing.yaml, so a longer list
  # would offer a choice that Ctrl+P appears to make and routing then silently
  # discards. fg-chat/pi is the real control; edit it there.
  cat > "$models_file" <<JSON
{
  "providers": {
    "rapid-proxy-pi": {
      "api": "openai-completions",
      "baseUrl": "http://127.0.0.1:${port}/v1",
      "apiKey": "coding-local-proxy-no-auth",
      "headers": {
        "x-agent": "pi",
        "x-task-id": "\$TASK_ID"
      },
      "models": [
        {
          "id": "claude-sonnet-5",
          "name": "Claude Sonnet 5 (routed by the coding proxy)",
          "input": ["text"],
          "contextWindow": 200000,
          "reasoning": true
        }
      ]
    }
  }
}
JSON
  _agent_log "Wrote pi provider config: $models_file"
}

# Configure pi and validate environment.
# Note: agent_pre_launch runs AFTER detect_network_and_configure_proxy,
# so INSIDE_CN and PROXY_WORKING are already set.
agent_pre_launch() {
  local port="${LLM_CLI_PROXY_PORT:-12435}"

  # D-15: check LLM proxy reachability (warn only, do not block)
  if curl -sf "http://localhost:${port}/health" &>/dev/null; then
    _agent_log "LLM proxy reachable on port ${port}"
  else
    _agent_log "WARNING: LLM proxy not reachable on port ${port} -- pi may not have LLM access"
  fi

  # ───────────────────────────────────────────────────────────────────────────
  # Wrapper-scoped config directory (same default and same reasoning as
  # opencode's wrapper-scoped plugins).
  #
  # PI_CODING_AGENT_DIR relocates pi's whole config root (default ~/.pi/agent:
  # models.json, auth.json, AGENTS.md, skills, extensions). Pointing it at a
  # repo-local directory means a bare `pi` outside this project behaves exactly
  # as it did before the project was installed, and — the part that matters —
  # we never rewrite a user-authored ~/.pi/agent/models.json to insert our
  # provider. Writing into the user's config root would be a destructive edit of
  # a file we do not own.
  local _pi_scope="${CODING_AGENT_SCOPE:-}"
  if [ -z "$_pi_scope" ] && [ -f "${CODING_REPO:-}/.env" ]; then
    _pi_scope="$(grep -m1 '^CODING_AGENT_SCOPE=' "${CODING_REPO}/.env" 2>/dev/null | cut -d= -f2- || true)"
  fi

  local _pi_cfg_dir
  if [ "${_pi_scope:-wrapper}" != "global" ] && [ -n "${CODING_REPO:-}" ]; then
    _pi_cfg_dir="${CODING_REPO}/.pi-agent"
    export PI_CODING_AGENT_DIR="$_pi_cfg_dir"
    _agent_log "🔒 Wrapper-scoped: pi config dir is $_pi_cfg_dir (bare \`pi\` still uses ~/.pi/agent)"
  else
    _pi_cfg_dir="$HOME/.pi/agent"
    _agent_log "🌐 Global scope: using pi's default config dir $_pi_cfg_dir"
  fi

  _pi_write_models_json "$_pi_cfg_dir"

  # Pin provider + model for this launch. pi reads both from the environment,
  # so no argv juggling is needed and the user can still switch mid-session with
  # /model or Ctrl+L.
  export PI_PROVIDER="rapid-proxy-pi"
  export PI_MODEL="claude-sonnet-5"

  # Session storage, pinned to a deterministic project-local path.
  #
  # pi's default is ~/.pi/agent/sessions/--<url-encoded-cwd>--/, which a reader
  # would have to reverse-engineer per project. Pinning it removes that guesswork
  # entirely — this is the directory PiSessionReader watches, and it is why pi
  # needs no equivalent of mastra's findMastraTranscriptDir() heuristic.
  local _pi_project="${TARGET_PROJECT_DIR:-${CODING_REPO:-.}}"
  local _pi_sessions
  _pi_sessions="$(cd "$_pi_project" && pwd)/.observations/pi-sessions"
  mkdir -p "$_pi_sessions"
  export PI_CODING_AGENT_SESSION_DIR="$_pi_sessions"
  _agent_log "Session transcripts: $_pi_sessions"

  # Egress posture (T1-T4 lockdown): pi's startup does update checks, package
  # updates and install telemetry, and PI_TELEMETRY also governs provider
  # attribution headers. None of that is wanted from a launcher whose entire
  # point is that traffic leaves through one audited proxy.
  export PI_OFFLINE=1
  export PI_TELEMETRY=0
  export PI_SKIP_VERSION_CHECK=1

  # D-06: validate connectivity for the chosen provider (warn only, don't abort)
  validate_agent_connectivity "$AGENT_NAME" || true
}
