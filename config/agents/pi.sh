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

# Install the repo's pi extensions into the agent config dir.
#
# $1 = the pi config directory to write into.
#
# pi auto-discovers `<agent-dir>/extensions/*.ts`, and $1 IS the agent dir
# (PI_CODING_AGENT_DIR), so this reaches every pi launch through the wrapper
# regardless of which project the session is cwd'd into. That matters: the
# incident these guard against happened in _work/a2a, not in this repo, so a
# project-local `.pi/extensions` here would have done nothing.
#
# Copied rather than symlinked. The agent dir is gitignored scratch that the
# wrapper owns and rewrites; a symlink into the repo would make a `pi` session
# silently pick up an extension mid-edit from an unrelated branch checkout.
# Copying pins the behaviour to launch time, like models.json above.
# Line-1 marker our extension sources carry, so the installer can tell a file
# it wrote from one the user authored. Same contract as _PI_APPEND_MARKER.
_PI_EXTENSION_MARKER="// managed by coding/config/agents/pi.sh"
_pi_install_extensions() {
  local cfg_dir="$1"
  local src_dir="${CODING_REPO:-}/config/agents/pi-extensions"
  [ -d "$src_dir" ] || return 0

  local ext_dir="$cfg_dir/extensions"
  mkdir -p "$ext_dir"
  local n=0
  local skipped=0
  for f in "$src_dir"/*.ts; do
    [ -e "$f" ] || continue
    local dest="$ext_dir/$(basename "$f")"
    # Same marker contract as APPEND_SYSTEM.md: only ever overwrite a file we
    # wrote. Under CODING_AGENT_SCOPE=global ext_dir is ~/.pi/agent/extensions,
    # which the user owns — a same-named extension of theirs is theirs to keep.
    # Our sources carry the marker on line 1 and the copy is verbatim, so it
    # travels with the file.
    if [ -e "$dest" ] && ! grep -qF "$_PI_EXTENSION_MARKER" "$dest" 2>/dev/null; then
      _agent_log "pi: leaving user-authored extension $(basename "$f") alone"
      skipped=$((skipped + 1))
      continue
    fi
    # cmp before cp so an unchanged file keeps its mtime — pi caches by path and
    # there is no reason to look modified on every launch.
    if ! cmp -s "$f" "$dest"; then
      cp "$f" "$dest" || {
        _agent_log "WARNING: could not install pi extension $(basename "$f")"
        continue
      }
    fi
    n=$((n + 1))
  done
  [ "$skipped" -gt 0 ] && _agent_log "pi extensions skipped (user-authored): $skipped"
  [ "$n" -gt 0 ] && _agent_log "pi extensions installed: $n in $ext_dir"
  return 0
}

# Install the canonical /sl prompt template where pi discovers slash commands.
# The wrapper config directory is owned by coding, but in global mode leave an
# existing user-authored prompt untouched.
_pi_install_session_log_prompt() {
  local cfg_dir="$1"
  local scope="$2"
  local source="${CODING_REPO:-}/.claude/commands/sl.md"
  local target="$cfg_dir/prompts/sl.md"
  [ -f "$source" ] || return 0

  mkdir -p "$cfg_dir/prompts"
  if [ "$scope" = "global" ] && [ -f "$target" ] && ! cmp -s "$source" "$target"; then
    _agent_log "pi: leaving user-authored /sl prompt alone"
    return 0
  fi
  cp "$source" "$target"
  _agent_log "pi: /sl prompt installed in $cfg_dir/prompts"
}

# State the search convention the extension enforces.
#
# $1 = the pi config directory.
#
# APPEND_SYSTEM.md is appended to pi's system prompt rather than replacing it
# (SYSTEM.md would replace). Belt and braces with the extension: the extension
# is the deterministic gate, this is what stops the model SPENDING a tool call
# to discover the gate. A blocked call costs a round trip; a model that never
# tries costs nothing.
#
# WRAPPER SCOPE ONLY. $1 is our gitignored scratch dir there, so writing is
# safe. Under `CODING_AGENT_SCOPE=global` it is ~/.pi/agent, which the user
# owns — the same reason _pi_write_models_json exists rather than editing a
# user-authored models.json in place. The marker guard is the second line of
# defence: we only ever overwrite a file we wrote.
_PI_APPEND_MARKER="<!-- managed by coding/config/agents/pi.sh -->"
_pi_write_append_system() {
  local cfg_dir="$1"
  local scope="$2"
  [ "$scope" = "global" ] && return 0

  local f="$cfg_dir/APPEND_SYSTEM.md"
  if [ -f "$f" ] && ! grep -qF "$_PI_APPEND_MARKER" "$f" 2>/dev/null; then
    _agent_log "pi: leaving user-authored APPEND_SYSTEM.md alone"
    return 0
  fi

  mkdir -p "$cfg_dir"
  cat > "$f" <<'PIAPPEND'
<!-- managed by coding/config/agents/pi.sh -->

## Searching the filesystem

Keep searches inside the project. `find .` and `git ls-files` are the right
instruments (this agent's tools are read/bash/edit/write — there is no separate
find or grep tool to reach for).

Never search from `/`, `~`, `/Users`, or another whole-machine root. Such a scan
takes minutes (343s measured here) and is refused by a tool guard, so attempting
it only wastes a turn.

When a file is not in the project, that IS the answer — report it and stop.
Do not widen the search to the machine. If you have a specific reason to believe
it is somewhere particular, search that place by name:

- recently deleted -> `~/.Trash`
- installed by a package manager -> `which`, `npm ls`, `brew list`
- elsewhere in a known checkout -> that path directly
PIAPPEND
  _agent_log "pi: APPEND_SYSTEM.md written ($cfg_dir)"
  return 0
}

# Configure pi and validate environment.
# Note: agent_pre_launch runs AFTER detect_network_and_configure_proxy,
# so INSIDE_CN and PROXY_WORKING are already set.
#
# The proxy wiring — the config dir for this scope, models.json (the
# rapid-proxy-pi + qwen-laptop providers, merged into the user's), the pinned
# provider/model in settings.json, the session-transcript dir and the PI_* env —
# is lib/agents/proxy-routing.mjs (preLaunchWiring); it also sets _pi_cfg_dir and
# _pi_scope for the installers below.
agent_pre_launch() {
  local _pi_cfg_dir _pi_scope
  _coding_wiring pre-launch pi

  _pi_install_extensions "$_pi_cfg_dir"
  _pi_install_session_log_prompt "$_pi_cfg_dir" "$_pi_scope"
  _pi_write_append_system "$_pi_cfg_dir" "$_pi_scope"

  validate_agent_connectivity "$AGENT_NAME" || true
}
