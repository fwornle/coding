#!/bin/bash
# Agent definition: OpenCode
# Sourced by launch-agent-common.sh
#
# Model selection based on network:
#   Inside VPN → GitHub Copilot Enterprise (corporate subscription, free)
#   Outside VPN → Anthropic direct (personal Claude Max / API key)

AGENT_NAME="opencode"
AGENT_DISPLAY_NAME="OpenCode"
AGENT_COMMAND="opencode"
AGENT_SESSION_PREFIX="opencode"
AGENT_SESSION_VAR="OPENCODE_SESSION_ID"
AGENT_TRANSCRIPT_FMT="opencode"
AGENT_ENABLE_PIPE_CAPTURE=true
AGENT_PROMPT_REGEX='>\s+([^\n\r]+)[\n\r]'
AGENT_REQUIRES_COMMANDS="opencode"
AGENT_INSTALL_COMMAND="go install github.com/opencode-ai/opencode@latest"

# Verify opencode CLI is available
agent_check_requirements() {
  if ! command -v opencode &>/dev/null; then
    _agent_log "Error: opencode CLI is not installed or not in PATH"
    return 1
  fi
  _agent_log "✅ opencode CLI detected ($(opencode --version 2>/dev/null || echo 'unknown'))"
}

# Configure OpenCode model based on network location
# Prepend a JSON fragment (no surrounding braces) to OPENCODE_CONFIG_CONTENT.
#
# The two call sites used to inline `{${frag},${OPENCODE_CONFIG_CONTENT#\{}`,
# which is correct only while the value is guaranteed to be a non-empty object —
# a guarantee the network branches happened to provide. On `{}` that expression
# yields `{frag,}`: a trailing comma, and invalid JSON. Handled once, here.
_oc_splice_config() {
  local _frag="$1"
  local _cur="${OPENCODE_CONFIG_CONTENT:-}"
  if [ "$_cur" = '{}' ] || [ -z "$_cur" ]; then
    OPENCODE_CONFIG_CONTENT="{${_frag}}"
  else
    OPENCODE_CONFIG_CONTENT="{${_frag},${_cur#\{}"
  fi
  export OPENCODE_CONFIG_CONTENT
}

# Note: agent_pre_launch runs AFTER detect_network_and_configure_proxy,
# so INSIDE_CN and PROXY_WORKING are already set.
agent_pre_launch() {
  # ── Explicit model override (generic escape hatch) ──────────────────────────
  # CODING_OPENCODE_MODEL pins the session to one "<provider>/<model>" and skips
  # the network-based selection below. The provider itself is declared in the
  # user's ~/.config/opencode/opencode.json, so nothing endpoint-specific (host,
  # token) lives in this repo. Set it in the untracked $CODING_REPO/.env (sourced
  # with `set -a` before this hook runs) or inline for a single launch:
  #   CODING_OPENCODE_MODEL=rapid-proxy/claude-sonnet-5 coding --opencode
  #
  # RETIRED 2026-08-28: CODING_OPENCODE_NO_PROXY, which appended a host/IP to
  # NO_PROXY so opencode could dial a self-hosted endpoint DIRECT, bypassing both
  # proxydetox and rapid-llm-proxy. It existed to reach the on-prem Qwen cluster
  # (10.143.241.223) before the proxy could route there itself.
  #
  # It is gone because rapid-llm-proxy now owns that decision. Its
  # `semantic_routing` policy offloads eligible work to the cluster and inserts
  # the original provider as the first fallback, so a cluster that is down or
  # unreachable degrades automatically. A direct dial from the agent gets none of
  # that: no fallback, no token accounting, no capability gate — and it is a
  # SECOND routing mechanism that can silently disagree with the config files
  # that are supposed to be the only place routing is decided.
  #
  # To reach the cluster from opencode now, route opencode through the proxy
  # (provider `rapid-proxy`, or OPENCODE_ANTHROPIC_NATIVE=1 for the
  # /v1/messages path) and let llm-routing.yaml decide. To reach it WITHOUT the
  # proxy, that is a bare `opencode` outside this wrapper, using your own
  # ~/.config/opencode/opencode.json — deliberately not something `coding` sets up.
  # NO network branch here any more, and no model pin. Both are gone because both
  # were dead, and one of them was a bypass:
  #
  #   INSIDE_CN pinned `github-copilot-enterprise/claude-opus-4.6`. `opencode
  #   models` offers ZERO ids under that provider — it does not exist. Verified
  #   2026-08-29.
  #
  #   Outside CN pinned `claude-opus-4-6` with disabled_providers:["copilot"] and
  #   warned about ANTHROPIC_API_KEY — i.e. Anthropic DIRECT, which is the egress
  #   bypass the T1-T4 lockdown closed and which the comment 20 lines above this
  #   already argues against. `anthropic` also offers zero ids today, so it had
  #   stopped working before it stopped being wrong.
  #
  # Nothing needs to replace them. opencode.json's own default is
  # `rapid-proxy/claude-sonnet-5`, and from there llm-routing.yaml decides the
  # provider and the model per call (fg-chat/opencode -> gh-copilot, band from
  # the caller). A network-dependent pin here would be a SECOND routing
  # mechanism that can disagree with the config files that are supposed to be
  # the only place routing is decided — and it did: it named a corporate
  # provider on VPN while routing was sending the same turns to gh-copilot
  # regardless. It also made opencode the odd one out among the three corporate
  # agents; pi and copilot have never had a network branch.
  #
  # `{}` rather than unset: both splices below prepend to this value, and an
  # empty one produces invalid JSON. _oc_splice_config handles that.
  export OPENCODE_CONFIG_CONTENT='{}'
  if [ -n "${CODING_OPENCODE_MODEL:-}" ]; then
    export OPENCODE_CONFIG_CONTENT="{\"model\":\"${CODING_OPENCODE_MODEL}\"}"
    _agent_log "📌 Model override → ${CODING_OPENCODE_MODEL}"
  else
    _agent_log "🔀 Model from ~/.config/opencode/opencode.json; provider+model per call from llm-routing.yaml (fg-chat/opencode)"
  fi


  # OPT-IN (Phase 82, default OFF): anthropic-native provider entry that routes opencode's
  # @ai-sdk/anthropic path through the local rapid-llm-proxy /v1/messages, restoring prompt-cache
  # fidelity AND stamping token_usage agent='opencode' via the x-agent header (else the tap
  # mis-stamps opencode rows as cladpt). Kept OPT-IN this phase (CONTEXT §Deferred): making it the
  # default requires live verification that opencode actually emits cache_control breakpoints on this
  # path. When OPENCODE_ANTHROPIC_NATIVE is unset the OPENCODE_CONFIG_CONTENT above is byte-identical
  # to today. Discretion (CONTEXT §Discretion): chose config-rewrite via env-interpolated string
  # splice over a separate config file — lower risk (single source of truth on the existing
  # OPENCODE_CONFIG_CONTENT seam; byte-identical default guaranteed by only splicing under the flag).
  # baseURL is the proxy /v1 root — the @ai-sdk/anthropic client appends /messages → /v1/messages.
  # Port per CLAUDE.md contract: LLM proxy host port is 12435 (NOT 3033, the Health API).
  # ── Per-turn complexity band (2026-08-30) ──────────────────────────────────
  #
  # fg-chat/opencode is `complexity: from-caller` in llm-routing.yaml, but
  # opencode declared nothing, so EVERY turn fell to defaults.fg-chat (high) and
  # none was ever eligible for the semantic offload. Measured: 770 `high` rows
  # since 2026-08-16 against 4 `small` — and those 4 were opencode's own internal
  # title calls, which already send reasoning_effort themselves.
  #
  # `variants` is opencode's real per-turn seam. A variant is read off the USER
  # MESSAGE each turn (so it is re-read per turn, unlike a provider- or
  # model-level header, which is fixed for the session), and
  # @ai-sdk/openai-compatible maps `reasoningEffort` onto the wire as
  # `reasoning_effort` — which resolveCallerComplexity() already reads and
  # EFFORT_TO_BAND already maps (low/minimal -> small, high -> high).
  #
  # Verified on a capture endpoint 2026-08-30: a bare run sends NO effort field;
  # `--variant cheap` sends "low"; `--variant high` sends "high". And end-to-end
  # through the proxy, `--variant cheap` produced a fg-chat/opencode row with
  # route_band=small on gh-copilot/claude-haiku-4.5 instead of sonnet-5.
  #
  # Spliced here rather than left to ~/.config/opencode/opencode.json so the seam
  # travels with the repo: opencode deep-merges this fragment into the models the
  # file already declares (verified — the file's baseURL survives the merge), so
  # a machine whose global config predates this still gets the variants.
  #
  # This is the exact analogue of pi's thinkingLevelMap in config/agents/pi.sh.
  # Select with `--variant cheap`, the TUI variant picker / variantCycle
  # keybinding, or the provider/model/variant model string.
  local _oc_variants='"variants":{"cheap":{"reasoningEffort":"low"},"standard":{"reasoningEffort":"medium"},"deep":{"reasoningEffort":"high"}}'
  local _oc_models=""
  local _m
  for _m in claude-sonnet-5 claude-sonnet-4.6 claude-haiku-4.5 gpt-4o gpt-4o-mini; do
    [ -n "$_oc_models" ] && _oc_models="${_oc_models},"
    _oc_models="${_oc_models}\"${_m}\":{${_oc_variants}}"
  done
  local _oc_provider_entries="\"rapid-proxy\":{\"models\":{${_oc_models}}}"

  # ONE `provider` fragment, built here and spliced once below. Two separate
  # _oc_splice_config calls would each prepend their own "provider" key, and a
  # duplicate key in one object silently drops whichever the parser resolves
  # second — so the opt-in block below adds to this string instead of splicing.
  if [ "${OPENCODE_ANTHROPIC_NATIVE:-0}" = "1" ]; then
    local _oc_proxy_port="${LLM_CLI_PROXY_PORT:-12435}"
    _oc_provider_entries="${_oc_provider_entries},\"anthropic\":{\"options\":{\"baseURL\":\"http://127.0.0.1:${_oc_proxy_port}/v1\",\"headers\":{\"x-task-id\":\"${TASK_ID:-}\",\"x-agent\":\"opencode\"}}}"
    _agent_log "🧪 opencode ANTHROPIC-NATIVE (opt-in) → proxy http://127.0.0.1:${_oc_proxy_port}/v1/messages (x-agent=opencode; x-task-id=${TASK_ID:-<ambient>})"
  fi
  _oc_splice_config "\"provider\":{${_oc_provider_entries}}"
  _agent_log "🎚  Per-turn band variants available: --variant cheap|standard|deep (cheap → small → offload-eligible)"

  # ───────────────────────────────────────────────────────────────────────────
  # Wrapper-scoped plugins (default since P2).
  #
  # A wrapper-scoped install does NOT copy plugins into ~/.opencode/plugins or
  # edit ~/.config/opencode/opencode.json, so a bare `opencode` behaves exactly
  # as it did before this project was installed. The plugins are instead spliced
  # into OPENCODE_CONFIG_CONTENT here — the same seam already used above for the
  # provider — so they load only for sessions started through `coding`.
  #
  # opencode accepts absolute plugin paths, so these are referenced in place from
  # the repo and stay live rather than going stale as copies under $HOME.
  local _oc_scope="${CODING_AGENT_SCOPE:-}"
  if [ -z "$_oc_scope" ] && [ -f "${CODING_REPO:-}/.env" ]; then
    _oc_scope="$(grep -m1 '^CODING_AGENT_SCOPE=' "${CODING_REPO}/.env" 2>/dev/null | cut -d= -f2- || true)"
  fi
  if [ "${_oc_scope:-wrapper}" != "global" ] && [ -n "${CODING_REPO:-}" ]; then
    local _oc_plugins=""
    for _p in compaction-guard knowledge-injection; do
      if [ -f "${CODING_REPO}/plugins/opencode/${_p}.js" ]; then
        _oc_plugins="${_oc_plugins:+${_oc_plugins},}\"${CODING_REPO}/plugins/opencode/${_p}.js\""
      fi
    done
    if [ -n "$_oc_plugins" ]; then
      # compaction.reserved mirrors what the global installer wrote, so behaviour
      # through the wrapper is unchanged by the scope switch.
      local _oc_extra="\"plugin\":[${_oc_plugins}],\"compaction\":{\"reserved\":40000}"
      _oc_splice_config "${_oc_extra}"
      _agent_log "🔒 Wrapper-scoped: opencode plugins injected for this session only"
    fi
  fi

  # Validate connectivity for the chosen provider (warn only, don't abort)
  validate_agent_connectivity "$AGENT_NAME" || true
}
