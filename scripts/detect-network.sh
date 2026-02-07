#!/bin/bash

# Shared CN/Proxy Detection for Coding Launcher
# Sourced by agent-common-setup.sh
#
# Provides:
#   detect_corporate_network()   - Sets INSIDE_CN=true/false
#   test_proxy_connectivity()    - Sets PROXY_WORKING=true/false
#   configure_proxy_if_needed()  - Auto-configures proxy if proxydetox available
#
# Environment overrides:
#   CODING_FORCE_CN=true/false   - Skip CN detection, force result (for testing)

# Avoid re-sourcing
if [ -n "$_DETECT_NETWORK_LOADED" ]; then
  return 0 2>/dev/null || true
fi
_DETECT_NETWORK_LOADED=true

# Defaults
INSIDE_CN=false
PROXY_WORKING=true

# ============================================
# Corporate Network Detection
# ============================================
detect_corporate_network() {
  # Allow forcing for testing
  if [ "$CODING_FORCE_CN" = "true" ]; then
    INSIDE_CN=true
    log "CN detection forced: INSIDE_CN=true (via CODING_FORCE_CN)"
    export INSIDE_CN
    return 0
  elif [ "$CODING_FORCE_CN" = "false" ]; then
    INSIDE_CN=false
    log "CN detection forced: INSIDE_CN=false (via CODING_FORCE_CN)"
    export INSIDE_CN
    return 0
  fi

  log "Detecting network location (CN vs Public)..."

  # Test BMW GitHub accessibility via SSH
  local bmw_response
  bmw_response=$(timeout 5 ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=no -T git@cc-github.bmwgroup.net 2>&1 || true)
  if echo "$bmw_response" | grep -q -iE "(successfully authenticated|Welcome to GitLab|You've successfully authenticated)"; then
    INSIDE_CN=true
    log "Inside Corporate Network - SSH access to cc-github.bmwgroup.net works"
  else
    # Fallback: try HTTPS
    if timeout 5 curl -s --connect-timeout 5 https://cc-github.bmwgroup.net >/dev/null 2>&1; then
      INSIDE_CN=true
      log "Inside Corporate Network - cc-github.bmwgroup.net accessible via HTTPS"
    else
      INSIDE_CN=false
      log "Outside Corporate Network - cc-github.bmwgroup.net not accessible"
    fi
  fi

  export INSIDE_CN
}

# ============================================
# Proxy Connectivity Test
# ============================================
test_proxy_connectivity() {
  if [ "$INSIDE_CN" = "false" ]; then
    PROXY_WORKING=true  # Outside CN, assume direct access works
    export PROXY_WORKING
    return 0
  fi

  log "Testing proxy connectivity for external access..."
  if timeout 5 curl -s --connect-timeout 5 https://google.de >/dev/null 2>&1; then
    PROXY_WORKING=true
    log "Proxy is working - external access available"
  else
    PROXY_WORKING=false
    log "WARNING: Proxy not working or external access blocked"
  fi

  export PROXY_WORKING
}

# ============================================
# Auto-Configure Proxy
# ============================================
# If inside CN and proxy not working, check for proxydetox and configure
configure_proxy_if_needed() {
  # Skip if not inside CN
  if [ "$INSIDE_CN" = "false" ]; then
    return 0
  fi

  # Skip if proxy is already working
  if [ "$PROXY_WORKING" = "true" ]; then
    return 0
  fi

  # Skip if HTTP_PROXY is already set
  if [ -n "$HTTP_PROXY" ] || [ -n "$http_proxy" ]; then
    log "HTTP_PROXY already set: ${HTTP_PROXY:-$http_proxy}"
    return 0
  fi

  # Check if proxydetox is listening on 127.0.0.1:3128
  if curl -s --connect-timeout 2 -o /dev/null -w "%{http_code}" http://127.0.0.1:3128 2>/dev/null | grep -q -E "^(000|407|403|200)"; then
    log "Proxydetox detected on 127.0.0.1:3128 - auto-configuring proxy..."
    export HTTP_PROXY="http://127.0.0.1:3128"
    export HTTPS_PROXY="http://127.0.0.1:3128"
    export http_proxy="http://127.0.0.1:3128"
    export https_proxy="http://127.0.0.1:3128"
    export NO_PROXY="localhost,127.0.0.1,.bmwgroup.net"
    export no_proxy="localhost,127.0.0.1,.bmwgroup.net"

    # Re-test with proxy configured
    if timeout 5 curl -s --connect-timeout 5 https://google.de >/dev/null 2>&1; then
      PROXY_WORKING=true
      export PROXY_WORKING
      log "Proxy auto-configured and working"
    else
      log "WARNING: Proxy auto-configured but external access still failing"
    fi
  else
    log "WARNING: Inside CN but no proxy available"
    log "  HTTP_PROXY is not set and proxydetox not detected on 127.0.0.1:3128"
    log "  Docker pulls, npm installs, and external API calls may fail"
    log "  Start proxydetox or set HTTP_PROXY/HTTPS_PROXY manually"
  fi
}

# ============================================
# Combined Detection (convenience)
# ============================================
detect_network_and_configure_proxy() {
  detect_corporate_network
  test_proxy_connectivity
  configure_proxy_if_needed
}
