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

  # Fast check: try HTTPS to corporate GitHub (2s timeout)
  if timeout 3 curl -s --connect-timeout 2 https://cc-github.bmwgroup.net >/dev/null 2>&1; then
    INSIDE_CN=true
    PROXY_REQUIRED=true
    log "🏢 Inside Corporate Network (cc-github.bmwgroup.net reachable)"
  else
    # Fallback: SSH test (slower but more reliable through some firewalls)
    local bmw_response
    bmw_response=$(timeout 5 ssh -o BatchMode=yes -o ConnectTimeout=3 -o StrictHostKeyChecking=no -T git@cc-github.bmwgroup.net 2>&1 || true)
    if echo "$bmw_response" | grep -q -iE "(successfully authenticated|Welcome to GitLab|You've successfully authenticated)"; then
      INSIDE_CN=true
      PROXY_REQUIRED=true
      log "🏢 Inside Corporate Network (SSH to cc-github.bmwgroup.net)"
    else
      INSIDE_CN=false
      PROXY_REQUIRED=false
      log "🌐 Outside Corporate Network"
    fi
  fi

  export INSIDE_CN PROXY_REQUIRED
}

# ============================================
# Proxy Connectivity Test
# ============================================
test_proxy_connectivity() {
  if [ "$INSIDE_CN" = "false" ]; then
    # Outside CN: verify direct internet works
    if timeout 5 curl -s --connect-timeout 3 --noproxy '*' https://api.github.com >/dev/null 2>&1; then
      PROXY_WORKING=true
      log "✅ Direct internet access working"
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
  if timeout 5 curl -s --connect-timeout 3 https://api.github.com >/dev/null 2>&1; then
    PROXY_WORKING=true
    log "✅ External access working (via proxy)"
  else
    PROXY_WORKING=false
    log "⚠️  External access not working — proxy may need configuration"
  fi

  export PROXY_WORKING
}

# ============================================
# Bash Profile Proxy Toggle
# ============================================
# Ensures ~/.bash_profile proxy lines match the current network state,
# so child processes (Claude Code, etc.) inherit the correct environment.
_sync_bash_profile_proxy() {
  local desired_state="$1"  # "enabled" or "disabled"
  local profile="$HOME/.bash_profile"

  [ -f "$profile" ] || return 0

  if [ "$desired_state" = "disabled" ]; then
    # Comment out active http_proxy= line (if not already commented)
    if grep -qF -- 'http_proxy=' "$profile" && grep -q '^http_proxy=' "$profile" 2>/dev/null; then
      sed -i.bak 's/^http_proxy=/#http_proxy=/' "$profile"
      log "Disabled proxy in ~/.bash_profile"
    fi
  elif [ "$desired_state" = "enabled" ]; then
    # Uncomment http_proxy= line (if currently commented)
    if grep -q '^#http_proxy=' "$profile" 2>/dev/null; then
      sed -i.bak 's/^#http_proxy=/http_proxy=/' "$profile"
      log "Enabled proxy in ~/.bash_profile"
    fi
  fi
}

# ============================================
# Auto-Configure Proxy
# ============================================
# Mirrors the user's proven toggle script:
#   Inside CN  → uncomment proxy in ~/.bash_profile, source it, restart proxydetox
#   Outside CN → comment out proxy in ~/.bash_profile, unset env vars
#
# The key insight: editing ~/.bash_profile alone does NOTHING for the current shell.
# We must also source it (enable) or unset vars (disable), AND restart proxydetox
# so it picks up the new state.
configure_proxy_if_needed() {
  local profile="$HOME/.bash_profile"

  # Outside CN: disable proxy
  if [ "$INSIDE_CN" = "false" ]; then
    _sync_bash_profile_proxy disabled
    if [ -n "$HTTP_PROXY" ] || [ -n "$HTTPS_PROXY" ] || [ -n "$http_proxy" ] || [ -n "$https_proxy" ]; then
      log "Outside CN — disabling proxy (was: ${HTTP_PROXY:-${http_proxy:-'(unknown)'}})"
    fi
    unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy no_proxy NO_PROXY
    # Restart proxydetox so it doesn't hold stale state (macOS only)
    if [ "$PLATFORM" = "macos" ]; then
      launchctl stop cc.colorto.proxydetox 2>/dev/null || true
      launchctl start cc.colorto.proxydetox 2>/dev/null || true
    fi
    return 0
  fi

  # Inside CN: enable proxy
  _sync_bash_profile_proxy enabled

  # Source the profile to load proxy vars into THIS shell process
  if [ -f "$profile" ]; then
    # shellcheck disable=SC1090
    source "$profile"
    log "Sourced ~/.bash_profile (proxy vars loaded into current shell)"
  fi

  # Restart proxydetox to ensure it's running with current config (macOS only)
  if [ "$PLATFORM" = "macos" ]; then
    log "Restarting proxydetox..."
    launchctl stop cc.colorto.proxydetox 2>/dev/null || true
    launchctl start cc.colorto.proxydetox 2>/dev/null || true
    sleep 1
  fi

  # Verify we have proxy vars set
  if [ -z "$http_proxy" ] && [ -z "$HTTP_PROXY" ]; then
    # Profile didn't set them — fall back to known default
    log "Proxy vars not set after sourcing profile — using default 127.0.0.1:3128"
    export HTTP_PROXY="http://127.0.0.1:3128"
    export HTTPS_PROXY="http://127.0.0.1:3128"
    export http_proxy="http://127.0.0.1:3128"
    export https_proxy="http://127.0.0.1:3128"
    export NO_PROXY="localhost,127.0.0.1,.bmwgroup.net"
    export no_proxy="localhost,127.0.0.1,.bmwgroup.net"
  fi

  log "Proxy active: ${HTTP_PROXY:-${http_proxy}}"
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
