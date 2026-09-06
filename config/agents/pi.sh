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
_pi_install_extensions() {
  local cfg_dir="$1"
  local src_dir="${CODING_REPO:-}/config/agents/pi-extensions"
  [ -d "$src_dir" ] || return 0

  local ext_dir="$cfg_dir/extensions"
  mkdir -p "$ext_dir"
  local n=0
  for f in "$src_dir"/*.ts; do
    [ -e "$f" ] || continue
    # cmp before cp so an unchanged file keeps its mtime — pi caches by path and
    # there is no reason to look modified on every launch.
    if ! cmp -s "$f" "$ext_dir/$(basename "$f")"; then
      cp "$f" "$ext_dir/$(basename "$f")" || {
        _agent_log "WARNING: could not install pi extension $(basename "$f")"
        continue
      }
    fi
    n=$((n + 1))
  done
  [ "$n" -gt 0 ] && _agent_log "pi extensions installed: $n in $ext_dir"
  return 0
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
  # Same env var and same default rapid-llm-proxy reads for its own `qwen-laptop`
  # provider (proxy-bridge/server.mjs, qwenLaptopBaseUrl). Read from ONE name so
  # moving the llama.cpp server does not leave pi dialling the old port while the
  # proxy dials the new one — the class of split-brain that had `qwen-local`
  # meaning the laptop in opencode's config and the on-prem cluster in the
  # proxy's, on two different networks, at the same time.
  local _pi_qwen_laptop_url="${QWEN_LAPTOP_API_BASE_URL:-http://127.0.0.1:8081/v1}"

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
  # `input` includes image on the proxy provider: the proxy's OpenAI shim used
  # to flatten array-form message content down to its text parts, so an attached
  # image was deleted before the request left the proxy and the model — seeing a
  # message that never had one — reported that image input was unsupported. The
  # shim now preserves non-text parts for the OpenAI-native legs and gives the
  # text-only legs a visible marker instead of a silent deletion, so declaring
  # the modality here is what lets pi attach the image at all.
  #
  # qwen-laptop keeps ["text"]: it is dialled direct, never through the shim, and
  # the llama.cpp build serving it is not a vision model.
  #
  # ONE model entry on the PROXY provider, deliberately. The proxy replaces
  # body.model with whatever (provider, complexity) resolves to in
  # llm-routing.yaml, so a longer list there would offer a choice that Ctrl+P
  # appears to make and routing then silently discards. fg-chat/pi is the real
  # control; edit it there.
  #
  # The second provider below, `qwen-laptop`, is the exception that proves the
  # rule: it is the one model you can genuinely PICK, because picking it is the
  # only way to reach it. The proxy routes by job and band, never by the model a
  # caller asks for (body.provider was removed as a soft pin precisely so a
  # caller could not move spend), so there is no request pi can make through
  # rapid-proxy-pi that lands on the laptop by choice — only the semantic
  # offload puts work there, and only when it decides to.
  #
  # thinkingLevelMap is what makes pi's per-turn effort selector reach routing.
  #
  # fg-chat/pi is `complexity: from-caller` — the route delegates the band to the
  # caller — and pi sent no band, so every turn fell to defaults.fg-chat (high)
  # and NOTHING pi did was ever eligible for the semantic offload. Observed
  # 2026-08-28: "how many r's in strawberry" was answered by gh-copilot/sonnet-5
  # while the local Qwen sat idle, and the router was not at fault; nobody had
  # told it anything.
  #
  # pi already puts its thinking level on the wire as OpenAI's `reasoning_effort`
  # (verified live: a headless `pi -p` turn carried reasoning_effort: "medium").
  # thinkingLevelMap translates pi's level names into the proxy's band names, so
  # the value that arrives IS the band and neither side keeps a private mapping
  # table that can drift from the other's. proxy-bridge/caller-complexity.mjs
  # also accepts the raw OpenAI words, so a client without this map still works.
  #
  # off/minimal/low → small is the one that matters: `small` is the only band in
  # semantic_routing.offload_bands, so setting pi's thinking level to low or off
  # is what routes a cheap turn to the free local model. xhigh/max are null —
  # pi hides a level mapped to null, and the proxy has no band above `high`, so
  # offering them would advertise a distinction routing cannot make.
  # x-task-id is emitted ONLY when this launch actually has a task to bind.
  #
  # pi's header interpolation is strict and has no default-value form
  # (dist/core/resolve-config-value.js): `${TASK_ID:-}` fails its ENV_VAR_NAME_RE
  # and would be sent as the LITERAL text "${TASK_ID:-}", and
  # resolveEnvConfigValue tests `env[name] || process.env[name] || undefined`
  # with `||` rather than `??`, so an EMPTY TASK_ID is indistinguishable from a
  # missing one. Either way resolveHeadersOrThrow aborts the whole provider
  # before a single request leaves:
  #
  #   Error: API key auth failed for provider rapid-proxy-pi: Failed to resolve
  #   provider "rapid-proxy-pi" header "x-task-id" from environment variable: TASK_ID
  #
  # An interactive `coding --pi` has no TASK_ID — and exporting an empty one
  # cannot help, because tmux-session-wrapper.sh only forwards NON-EMPTY vars
  # (`[ -n "${!var}" ]`, ~:139). Declaring the header unconditionally therefore
  # made every interactive prompt fail on the FIRST keystroke, with no LLM call
  # attempted. This is not the tools-gate 429 seen during Phase 82 bring-up; it
  # fires earlier, at provider auth, and is total.
  #
  # Omitting the header is the correct encoding, not a workaround. The proxy
  # reads an absent x-task-id as the ambient span (server.mjs ~:3157, taskId then
  # `taskId || resolveLiveTaskId()`), which is exactly the unbound-interactive
  # posture claude already gets from its blank ANTHROPIC_CUSTOM_HEADERS and
  # copilot from its non-task-scoped /v1/copilot path. x-agent still stamps
  # agent='pi', so interactive usage stays attributed — it is only the CELL
  # binding that is (correctly) absent when there is no cell.
  #
  # A measured run sets TASK_ID before agent_pre_launch, so it still gets the
  # header and keeps the per-request binding that keeps pi out of
  # AMBIENT_BOUND_AGENTS.
  local headers_json='"x-agent": "pi"'
  if [ -n "${TASK_ID:-}" ]; then
    headers_json="${headers_json},
        \"x-task-id\": \"\$TASK_ID\""
    _agent_log "Task-bound launch: models.json carries x-task-id (TASK_ID=${TASK_ID})"
  else
    _agent_log "Interactive launch: x-task-id omitted (proxy binds the ambient span)"
  fi

  # Written to a scratch file, then MERGED — never straight over models.json.
  # Under CODING_AGENT_SCOPE=global this path IS the user's own ~/.pi/agent, so a
  # plain `cat >` would silently destroy providers they authored themselves. Same
  # contract _pi_merge_settings already keeps for settings.json: we own specific
  # keys, we preserve everything else.
  local ours_file="$models_file.coding-ours"
  cat > "$ours_file" <<JSON
{
  "providers": {
    "rapid-proxy-pi": {
      "api": "openai-completions",
      "baseUrl": "http://127.0.0.1:${port}/v1",
      "apiKey": "coding-local-proxy-no-auth",
      "headers": {
        ${headers_json}
      },
      "models": [
        {
          "id": "claude-sonnet-5",
          "name": "Claude Sonnet 5 (routed by the coding proxy)",
          "input": ["text", "image"],
          "contextWindow": 200000,
          "reasoning": true,
          "thinkingLevelMap": {
            "off": "small",
            "minimal": "small",
            "low": "small",
            "medium": "medium",
            "high": "high",
            "xhigh": null,
            "max": null
          }
        }
      ]
    },
    "qwen-laptop": {
      "api": "openai-completions",
      "baseUrl": "${_pi_qwen_laptop_url}",
      "apiKey": "local-no-auth-placeholder",
      "models": [
        {
          "id": "qwen3.8-27b-local",
          "name": "Qwen3.8-27B (this laptop, llama.cpp / Metal)",
          "input": ["text"],
          "contextWindow": 32768,
          "reasoning": false
        }
      ]
    }
  }
}
JSON

  # Merge ours into whatever is already there, preserving foreign providers and
  # any top-level keys pi owns. Atomic via tmp + os.replace, as settings.json is.
  #
  # The preserved-provider list goes to a file rather than through $(...): bash
  # 3.2 — which is what /bin/bash still is on macOS — mis-parses a heredoc nested
  # inside a command substitution once the body carries quotes and parens, and
  # fails the whole file with a syntax error pointing at an unrelated line far
  # below. A plain heredoc plus a read is what _pi_merge_settings already does.
  local _pi_preserved_file="$models_file.coding-preserved"
  python3 - "$models_file" "$ours_file" > "$_pi_preserved_file" <<'PYMODELS'
import io, json, os, sys

path, ours_path = sys.argv[1], sys.argv[2]

with io.open(ours_path, encoding="utf-8") as fh:
    ours = json.load(fh)["providers"]

try:
    with io.open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    if not isinstance(doc, dict):
        raise ValueError("not an object")
except (OSError, ValueError):
    doc = {}

providers = doc.get("providers")
if not isinstance(providers, dict):
    providers = {}

# We own these two ids outright and rewrite them every launch (the port, the
# headers and the qwen URL all move). Every other provider is the user's own and
# is left exactly as found.
foreign = [k for k in providers if k not in ours]
providers.update(ours)
doc["providers"] = providers

tmp = path + ".tmp"
with io.open(tmp, "w", encoding="utf-8") as fh:
    json.dump(doc, fh, indent=2)
    fh.write("\n")
os.replace(tmp, path)

print(",".join(foreign))
PYMODELS

  local _pi_preserved=""
  [ -f "$_pi_preserved_file" ] && _pi_preserved="$(cat "$_pi_preserved_file")"
  rm -f "$ours_file" "$_pi_preserved_file"
  if [ -n "$_pi_preserved" ]; then
    _agent_log "Merged pi provider config into $models_file (rapid-proxy-pi + qwen-laptop; preserved: $_pi_preserved)"
  else
    _agent_log "Wrote pi provider config: $models_file (rapid-proxy-pi + qwen-laptop)"
  fi
}

# Merge our provider/model pins into pi's settings.json, preserving keys pi owns.
#
# $1 = the pi config directory.
_pi_merge_settings() {
  local cfg_dir="$1"
  local settings_file="$cfg_dir/settings.json"

  mkdir -p "$cfg_dir"
  python3 - "$settings_file" <<'PYSETTINGS'
import io, json, os, sys

path = sys.argv[1]
try:
    with io.open(path, encoding="utf-8") as fh:
        settings = json.load(fh)
    if not isinstance(settings, dict):
        settings = {}
except (OSError, ValueError):
    settings = {}

settings["defaultProvider"] = "rapid-proxy-pi"
settings["defaultModel"] = "claude-sonnet-5"
# Keep the Ctrl+P picker honest: the proxy decides the real model, so offering
# other PROXY ids here would advertise a choice that routing discards.
#
# qwen3.8-27b-local is the one exception, and for the opposite reason — it is
# offered BECAUSE the proxy will not route to it on request. The laptop server is
# loopback, unmetered and holds no credential, so selecting it spends nothing and
# sends nothing off the machine; what it does cost is a token_usage row, since a
# direct dial does not pass the proxy's tap. That is an acceptable trade for a
# model you have to deliberately pick, and it is NOT the default: the default
# stays on the proxy, so a launch that touches nothing behaves exactly as before.
settings["enabledModels"] = ["claude-sonnet-5", "qwen3.8-27b-local"]

tmp = path + ".tmp"
with io.open(tmp, "w", encoding="utf-8") as fh:
    json.dump(settings, fh, indent=2)
    fh.write("\n")
os.replace(tmp, path)
PYSETTINGS
  _agent_log "Pinned pi provider/model in $settings_file (rapid-proxy-pi/claude-sonnet-5)"
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
  # as it did before the project was installed — nothing we write is even on the
  # path it reads.
  #
  # Under CODING_AGENT_SCOPE=global there is no such separation: cfg_dir IS
  # ~/.pi/agent, and we write models.json and settings.json directly into it.
  # This comment used to claim we never touch a user-authored models.json, which
  # was true only for as long as wrapper was the only scope — the global branch
  # below then clobbered it wholesale. Both writers now MERGE (see
  # _pi_write_models_json and _pi_merge_settings): we own specific providers and
  # specific keys, rewrite those every launch, and leave every other provider and
  # key exactly as found. That is the property the old wording was reaching for,
  # and it now holds in both scopes rather than only one.
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
  _pi_install_extensions "$_pi_cfg_dir"
  _pi_write_append_system "$_pi_cfg_dir" "${_pi_scope:-wrapper}"

  # Deny the direct-provider escape hatch.
  #
  # tmux-session-wrapper.sh propagates ANTHROPIC_API_KEY into the agent session
  # (opencode needs it). pi treats an authenticated provider as selectable, and
  # with a key present it picked `anthropic` over our proxy provider outright —
  # observed live: the TUI came up on "(anthropic) claude-opus-4-8" and billed
  # the user's Anthropic account directly until it hit a credit error. That is a
  # silent egress bypass of the one audited path, which is exactly what the T1-T4
  # lockdown exists to prevent.
  #
  # Unsetting here (agent_pre_launch runs BEFORE the wrapper builds its env list,
  # and the wrapper skips empty vars) means pi holds no credential for any
  # METERED account. If the proxy is down pi fails loudly rather than quietly
  # spending on a different one — the intended trade, and the same reason the
  # claude launcher pins its base URL.
  #
  # "Metered" is doing real work in that sentence since qwen-laptop joined
  # models.json (2026-08-29). That provider carries an apiKey, so on the letter
  # of the paragraph above it is an authenticated provider pi could prefer at
  # startup. Two reasons it is not the same hazard, in order of how much they
  # are worth relying on:
  #
  #   1. The settings.json pin below sets defaultProvider/defaultModel, which is
  #      what actually decides the startup provider. The anthropic incident
  #      predates that pin. VERIFIED, not assumed: a headless `pi -p` with both
  #      providers declared produced one token_usage row against
  #      gh-copilot/claude-sonnet-4.6 — through the proxy, band declared by
  #      thinkingLevelMap — and nothing against the laptop.
  #   2. Even if it were selected, the failure mode is absent rather than
  #      merely smaller: the endpoint is llama.cpp on loopback with no auth, the
  #      key is a non-secret placeholder that authenticates nothing, and there is
  #      no account behind it to bill. A silent egress bypass needs egress.
  #
  # So the invariant this block protects is unchanged — no launch may quietly
  # move spend to an account the proxy is not measuring — while "pi can only
  # reach a model through the proxy" is no longer literally true, and the earlier
  # wording said so. Reaching the laptop still takes a deliberate Ctrl+P.
  unset ANTHROPIC_API_KEY

  # Pin provider + model for this launch via settings.json.
  #
  # NOT via PI_PROVIDER/PI_MODEL: those look like the obvious seam and are not.
  # pi EXPORTS them into its own tool environment so a bash tool can report which
  # model is running; it does not read them to choose one (the PI_PROVIDER=...
  # form in pi's docs belongs to its evals package, not the CLI). Setting them
  # had no effect — pi came up on whatever provider it found a credential for.
  #
  # Merged, not overwritten: pi owns this file too (it stores
  # lastChangelogVersion here), so clobbering it would fight the agent for its
  # own state on every launch.
  _pi_merge_settings "$_pi_cfg_dir"

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
