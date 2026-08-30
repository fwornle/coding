#!/bin/bash

# Shared CN/Proxy Detection for Coding Launcher
# Sourced by agent-common-setup.sh
#
# Provides:
#   detect_corporate_network()       - Sets INSIDE_CN=true/false
#   test_proxy_connectivity()        - Sets PROXY_WORKING=true/false
#   configure_proxy_if_needed()      - Auto-configures proxy if proxydetox available
#   detect_network_and_configure_proxy() - Combined detection (convenience)
#   validate_agent_connectivity()    - Validate that the chosen agent can reach its API
#
# Exported state (after detect_network_and_configure_proxy):
#   INSIDE_CN       - true if on corporate VPN
#   PROXY_WORKING   - true if external APIs are reachable
#   PROXY_REQUIRED  - true if proxy is needed for external access (= inside CN)
#
# Environment overrides:
#   CODING_FORCE_CN=true/false   - Skip CN detection, force result (for testing)
#
# === CONNECTIVITY MATRIX ===
#
# | Scenario       | Proxy needed | Anthropic API | GH Copilot API | GH Enterprise |
# |----------------|-------------|---------------|----------------|---------------|
# | Inside VPN     | YES         | via proxy     | via proxy      | direct        |
# | Outside VPN    | NO          | direct        | direct         | unreachable   |
#
# All external APIs (Anthropic, GitHub, OpenAI) require the proxy when inside CN.
# Direct connections time out (000) inside CN. Outside CN, direct works fine.

# Avoid re-sourcing
if [ -n "$_DETECT_NETWORK_LOADED" ]; then
  return 0 2>/dev/null || true
fi
_DETECT_NETWORK_LOADED=true

# Defaults
INSIDE_CN=false
PROXY_WORKING=true
PROXY_REQUIRED=false

# Generic internet-reachability probe target.
# Must NOT be api.github.com: GitHub is intermittently throttled/blocked by the
# GFW on the CN corporate network, producing false "no internet" results and
# proxy on/off flapping. captive.apple.com is a tiny fixed "Success" page on
# Apple's global CDN, reachable in mainland China, returns HTTP 200 fast.
# Override with HEALTH_REACHABILITY_HOST. (Service-specific checks below still
# probe api.github.com / api.anthropic.com directly — those are intentional.)
REACHABILITY_HOST="${HEALTH_REACHABILITY_HOST:-captive.apple.com}"

# ============================================
# Corporate Network Detection
# ============================================
detect_corporate_network() {
  # Allow forcing for testing
  if [ "$CODING_FORCE_CN" = "true" ]; then
    INSIDE_CN=true
    PROXY_REQUIRED=true
    log "CN detection forced: INSIDE_CN=true (via CODING_FORCE_CN)"
    export INSIDE_CN PROXY_REQUIRED
    return 0
  elif [ "$CODING_FORCE_CN" = "false" ]; then
    INSIDE_CN=false
    PROXY_REQUIRED=false
    log "CN detection forced: INSIDE_CN=false (via CODING_FORCE_CN)"
    export INSIDE_CN PROXY_REQUIRED
    return 0
  fi

  log "Detecting network location (CN vs Public)..."

  # Strategy: Use DNS-based detection (no proxy needed, no chicken-and-egg).
  # If we can resolve BMW-internal hostnames, we're on the corporate network
  # (either VPN or office LAN — both have corporate DNS).

  # 1. Primary: DNS resolve of PAC host (only resolvable from corporate DNS)
  local pac_ip
  pac_ip=$(dig +short +timeout=2 +tries=1 muc.proxy-pac.bmwgroup.net 2>/dev/null | head -1)
  if [ -n "$pac_ip" ] && [[ "$pac_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    INSIDE_CN=true
    PROXY_REQUIRED=true
    log "🏢 Inside Corporate Network (PAC DNS resolves to $pac_ip)"
  else
    # 2. Fallback: DNS resolve of corporate GitHub
    local gh_ip
    gh_ip=$(dig +short +timeout=2 +tries=1 cc-github.bmwgroup.net 2>/dev/null | head -1)
    if [ -n "$gh_ip" ] && [[ "$gh_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      INSIDE_CN=true
      PROXY_REQUIRED=true
      log "🏢 Inside Corporate Network (cc-github DNS resolves to $gh_ip)"
    else
      # 3. Fallback: Check health coordinator if running
      local coord_location
      coord_location=$(curl -s --connect-timeout 1 http://localhost:3034/health/state 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['network']['location'])" 2>/dev/null || true)
      if [ "$coord_location" = "corporate" ]; then
        INSIDE_CN=true
        PROXY_REQUIRED=true
        log "🏢 Inside Corporate Network (health coordinator confirms)"
      else
        INSIDE_CN=false
        PROXY_REQUIRED=false
        log "🌐 Outside Corporate Network"
      fi
    fi
  fi

  export INSIDE_CN PROXY_REQUIRED
}

# ============================================
# Proxy Connectivity Test
# ============================================
test_proxy_connectivity() {
  if [ "$INSIDE_CN" = "false" ]; then
    # Outside CN: verify internet works (try direct first, then via proxy if set)
    if timeout 5 curl -s --connect-timeout 3 --noproxy '*' "https://${REACHABILITY_HOST}" >/dev/null 2>&1; then
      PROXY_WORKING=true
      log "✅ Direct internet access working"
    elif [ -n "${https_proxy:-${HTTPS_PROXY:-}}" ] && timeout 5 curl -s --connect-timeout 3 "https://${REACHABILITY_HOST}" >/dev/null 2>&1; then
      # Proxy is set and works — internet IS available (just via proxy)
      PROXY_WORKING=true
      log "✅ Internet access working (via proxy, outside CN)"
    else
      PROXY_WORKING=false
      log "⚠️  No internet access (neither proxy nor direct)"
    fi
    export PROXY_WORKING
    return 0
  fi

  # Inside CN: proxy is required for external access
  log "Testing proxy connectivity for external access..."

  # Test with current proxy settings (may already be in environment)
  if timeout 5 curl -s --connect-timeout 3 "https://${REACHABILITY_HOST}" >/dev/null 2>&1; then
    PROXY_WORKING=true
    log "✅ External access working (via proxy)"
  else
    PROXY_WORKING=false
    log "⚠️  External access not working — proxy may need configuration"
  fi

  export PROXY_WORKING
}

# ============================================
# proxydetox Liveness Guarantee (2026-08-02)
# ============================================
# The 2026-07-25 redesign pins every session to the ALWAYS-ON local adaptive
# proxy on 127.0.0.1:3128. That invariant only holds if proxydetox is actually
# alive — otherwise the pin points a session at a dead proxy and /login OAuth
# fails with `ECONNREFUSED 127.0.0.1:3128` (observed 2026-08-02).
#
# proxydetox is a *socket-activated* launchd job (cc.colorto.proxydetox):
# launchd owns the :3128 listening socket and spawns proxydetox on demand; the
# process exits when idle. So a high `runs` count and `job state = exited` are
# NORMAL, not a fault.
#
# The failure mode this heals: the launchd job is LOADED but the :3128 socket is
# no longer bound (nothing listens → every request ECONNREFUSED). Empirically a
# plain `launchctl kickstart` does NOT rebind the socket — only a full
# `bootout` + `bootstrap` re-registers it (the bootstrap may print a benign
# "Input/output error" (rc 5) mid-re-registration; ignored on purpose). The OLD
# guard ("bootstrap only if the job is absent from `launchctl list`") never
# fired in this loaded-but-dead state, so a crashed proxydetox stayed dead.
# Requires no sudo: a user can bootstrap the root-owned /Library/LaunchAgents
# plist into their own gui/<uid> domain (verified live).
#
# Returns 0 iff a real request THROUGH :3128 succeeds (ground truth, not a mere
# port check — a bound-but-broken proxy must count as down); 1 otherwise.
ensure_proxydetox_up() {
  local px_url="http://127.0.0.1:3128"
  local plist="/Library/LaunchAgents/cc.colorto.proxydetox.plist"
  local label="cc.colorto.proxydetox"
  local uid_gui="gui/$(id -u)"

  # Fast path: already functional — no launchd surgery on the happy path.
  if timeout 8 curl -s --connect-timeout 4 -x "$px_url" -o /dev/null "https://${REACHABILITY_HOST}" 2>/dev/null; then
    return 0
  fi

  # Only macOS ships the launchd job; elsewhere we cannot heal it.
  if [ "$(uname -s)" != "Darwin" ]; then
    return 1
  fi
  if [ ! -f "$plist" ]; then
    log "proxydetox plist missing ($plist) — cannot heal; will fall back to direct"
    return 1
  fi

  # ── Do not tear down a daemon that is not the problem (2026-08-30) ─────────
  #
  # The probe above is a PROXIED request to an EXTERNAL host, so it fails for
  # two completely different reasons — proxydetox is broken, or the network
  # behind it is unreachable — and only the first is fixable here. This function
  # used to answer both with bootout + bootstrap + kickstart, three times, on
  # every launch, with no debounce. On 2026-08-30 09:35 that ran on a healthy
  # daemon whose socket was bound the whole time (see .logs/health-coordinator.log
  # and lib/network/proxydetox-heal-decision.mjs), while the VPN was mid-
  # transition, and three `coding --pi` launches failed inside the window.
  #
  # There are TWO healers: this one and the coordinator's pollNetworkStatus().
  # The coordinator is the better-informed of the two — it debounces, it probes
  # continuously, and it now classifies the cause — so it owns the heal and this
  # function defers to it. That also ends the race where a launch tore the
  # daemon down in the middle of the coordinator's own heal.
  local bound=1
  timeout 2 bash -c 'exec 3<>/dev/tcp/127.0.0.1/3128' 2>/dev/null && bound=0

  # A dead socket outranks the coordinator, and is NOT debounced. No network
  # condition un-binds a local listener, so this is always the daemon — and the
  # coordinator's verdict can be up to one poll (30s) stale, which is exactly
  # long enough for it to still say `healthy` about a daemon that has just died.
  # Same rule ordering as decideProxydetoxHeal(), for the same reason.
  local cause=""
  if [ "$bound" -eq 0 ]; then
    cause=$(curl -s -m 3 http://localhost:3034/health/state 2>/dev/null \
              | jq -r '.network.proxy_heal_cause // empty' 2>/dev/null) || cause=""
  else
    log "proxydetox: nothing bound on :3128 — unambiguously the daemon"
  fi

  if [ -n "$cause" ]; then
    case "$cause" in
      healthy)
        # The coordinator proved a request through :3128 worked, and our own
        # probe above did not. One of the two is a transient miss, and tearing
        # the daemon down on that basis is precisely the self-reinforcing
        # kickstart the coordinator's hysteresis block exists to prevent.
        log "proxydetox probe missed but the coordinator reports it healthy — keeping the pin"
        return 0
        ;;
      upstream|offline)
        # The daemon is forwarding fine; what is down is the network past it.
        # The pin to :3128 stays VALID — proxydetox re-decides per request and
        # is exactly what you want in force when the network comes back. This
        # is why we return 0 here: the question this function answers is "is
        # proxydetox up?", not "does the internet work?", and conflating the
        # two is what un-pinned a working proxy during every VPN transition.
        log "proxydetox is up but egress is failing (cause=${cause}) — keeping the pin, not healing"
        return 0
        ;;
      indeterminate)
        log "proxydetox probe failed but the cause is not yet attributable — deferring to the coordinator"
        [ "$bound" -eq 0 ] && return 0
        return 1
        ;;
    esac
    log "proxydetox heal needed (cause=${cause}) — attempting one local kickstart"
  elif [ "$bound" -eq 0 ]; then
    # We asked and got nothing back. Only reachable when the socket IS bound —
    # a dead socket skips the query above, and must not be reported as though
    # the coordinator had been consulted and stayed silent.
    log "health coordinator did not answer — one local heal attempt"
  fi

  # Coordinator unreachable, or it says the DAEMON is at fault. One attempt, and
  # bootout only when nothing is bound: `kickstart -k` re-spawns a live job
  # without dropping the listener, whereas bootout unregisters the socket and is
  # only the right tool when the socket is already gone.
  if [ "$bound" -ne 0 ] && ! launchctl print "$uid_gui/$label" >/dev/null 2>&1; then
    log "  proxydetox: not loaded — bootstrapping launchd job"
    launchctl bootstrap "$uid_gui" "$plist" 2>/dev/null \
      || launchctl load "$plist" 2>/dev/null || true
  elif [ "$bound" -ne 0 ]; then
    log "  proxydetox: loaded but :3128 not bound — bootout + bootstrap"
    launchctl bootout "$uid_gui/$label" 2>/dev/null || true
    sleep 1
    launchctl bootstrap "$uid_gui" "$plist" 2>/dev/null || true
  fi
  launchctl kickstart -k "$uid_gui/$label" 2>/dev/null || true
  sleep 1

  if timeout 10 curl -s --connect-timeout 4 -x "$px_url" -o /dev/null "https://${REACHABILITY_HOST}" 2>/dev/null; then
    log "✅ proxydetox healed — :3128 functional"
    return 0
  fi

  # Still nothing. If the socket is at least bound, the pin remains the right
  # thing to have in force (see the upstream/offline case above).
  timeout 2 bash -c 'exec 3<>/dev/tcp/127.0.0.1/3128' 2>/dev/null && {
    log "proxydetox listening on :3128 but egress still failing — keeping the pin"
    return 0
  }
  log "⚠️  proxydetox could not be brought up on :3128"
  return 1
}

# ============================================
# Auto-Configure Proxy (2026-07-25 redesign)
# ============================================
# Agent sessions freeze their env at launch, but the user roams CN/VPN/home
# WHILE sessions run. Pinning the network-of-the-moment into the session
# (corporate proxy at the office, nothing at home) breaks the session the
# moment the network changes — /login dials a dead proxy, or CN blocks direct.
#
# The fix: pin every session to the ALWAYS-ON local adaptive proxy
# (proxydetox on 127.0.0.1:3128). proxydetox re-decides PER REQUEST:
#   - on CN/VPN: PAC → corporate upstream proxy
#   - off CN (PAC unreachable / upstream dead): DIRECT (--direct-fallback)
# So a session env pinned to 127.0.0.1:3128 is correct in EVERY network state,
# including transitions mid-session. NO_PROXY keeps local services
# (rapid-llm-proxy :12435, obs-api, dashboard) and BMW-internal hosts direct.
#
# We deliberately do NOT touch ~/.bash_profile anymore — the old enable/
# disable sync fought the user's `px` toggle and left stale pins behind.
configure_proxy_if_needed() {
  local px_url="http://127.0.0.1:3128"
  local no_proxy_val="localhost,127.0.0.1,::1,.bmwgroup.net"

  # Guarantee the always-on local adaptive proxy is actually alive — heals a
  # crashed / socket-unbound proxydetox rather than merely probing it. Runs
  # regardless of px on/off intent and regardless of CN: the whole point of the
  # redesign is that a session pinned to :3128 is correct in EVERY network
  # state, so :3128 must be up for the pin to be valid (this is what the user's
  # `px` toggle being OFF must NOT undermine — the daemon stays live either way).
  if ensure_proxydetox_up; then
    export HTTP_PROXY="$px_url" HTTPS_PROXY="$px_url"
    export http_proxy="$px_url" https_proxy="$px_url"
    export NO_PROXY="$no_proxy_val" no_proxy="$no_proxy_val"
    log "✅ Session pinned to local adaptive proxy $px_url (survives CN/VPN/home transitions)"
    return 0
  fi

  # proxydetox is genuinely unreachable even after healing — DO NOT pin a dead
  # proxy (pinning one is exactly what made /login fail with
  # ECONNREFUSED 127.0.0.1:3128). Fall back to direct: correct off-CN; on CN it
  # fails loudly in validate_agent_connectivity, which is the honest outcome —
  # nothing we could pin here would work either.
  unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy
  export NO_PROXY="$no_proxy_val" no_proxy="$no_proxy_val"
  if [ "$INSIDE_CN" = "true" ]; then
    log "⚠️  proxydetox on $px_url not functional and we are INSIDE CN — external APIs will fail until it is restored (try: px)"
  else
    log "proxydetox on $px_url not functional — using direct connection (outside CN)"
  fi
}

# ============================================
# Agent Connectivity Validation
# ============================================
# Call AFTER detect_network_and_configure_proxy and AFTER agent config is loaded.
# Validates that the chosen agent can actually reach its API endpoint.
validate_agent_connectivity() {
  local agent_name="$1"

  if [ "$PROXY_WORKING" = "false" ]; then
    log "⚠️  WARNING: No external API access — $agent_name will likely fail"
    log "   Network: $([ "$INSIDE_CN" = "true" ] && echo "Inside CN (proxy required)" || echo "Outside CN")"
    return 1
  fi

  case "$agent_name" in
    claude)
      # Claude Code uses OAuth (Max subscription) or ANTHROPIC_API_KEY
      # Both need to reach api.anthropic.com
      if ! timeout 5 curl -s --connect-timeout 3 -o /dev/null https://api.anthropic.com 2>/dev/null; then
        log "⚠️  Cannot reach api.anthropic.com — Claude Code may not work"
        return 1
      fi
      log "✅ Anthropic API reachable"
      ;;
    opencode)
      # OpenCode uses GitHub Copilot (inside CN) or Anthropic (outside CN)
      if [ "$INSIDE_CN" = "true" ]; then
        if ! timeout 5 curl -s --connect-timeout 3 -o /dev/null https://api.github.com 2>/dev/null; then
          log "⚠️  Cannot reach api.github.com — OpenCode (Copilot) may not work"
          return 1
        fi
        log "✅ GitHub API reachable (for Copilot provider)"
      else
        if ! timeout 5 curl -s --connect-timeout 3 -o /dev/null https://api.anthropic.com 2>/dev/null; then
          log "⚠️  Cannot reach api.anthropic.com — OpenCode (Anthropic) may not work"
          return 1
        fi
        log "✅ Anthropic API reachable"
      fi
      ;;
    copilot)
      # GitHub Copilot CLI needs api.github.com
      if ! timeout 5 curl -s --connect-timeout 3 -o /dev/null https://api.github.com 2>/dev/null; then
        log "⚠️  Cannot reach api.github.com — Copilot CLI may not work"
        return 1
      fi
      log "✅ GitHub API reachable (for Copilot CLI)"
      ;;
    *)
      # Unknown agent — skip validation
      ;;
  esac

  return 0
}

# ============================================
# Combined Detection (convenience)
# ============================================
detect_network_and_configure_proxy() {
  detect_corporate_network
  configure_proxy_if_needed
  test_proxy_connectivity
}
