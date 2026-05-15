#!/usr/bin/env bash
# start-llm-cli-proxy.sh — launchd wrapper for integrations/llm-cli-proxy
#
# Probes BMW corporate PAC server. If reachable (=> on corporate network):
#   - fetches the PAC, regex-extracts the first PROXY directive
#   - exports HTTPS_PROXY / HTTP_PROXY / NO_PROXY before exec'ing the bridge
# If not reachable (=> off corporate network, e.g. at home):
#   - leaves env unset, exec's the bridge directly
#
# Why: launchd does not inherit shell env, so the bridge has no HTTPS_PROXY
# set when on corporate. Child CLI processes (claude, copilot) need it to
# reach Anthropic/GitHub through the corporate proxy. Without this wrapper,
# both CLIs fall back to direct HTTPS → blocked by corporate firewall →
# observation enrichment falls back to "[Raw]".
#
# Replaces the older _work/rapid-llm-proxy/bin/start-llm-proxy.sh; the
# in-monorepo location makes this script discoverable and versioned along
# with the proxy code it starts.

set -u

# launchd's PATH is minimal — ensure dig/curl/grep/awk are findable on macOS+Linux
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

PAC_HOST="${PAC_HOST:-muc.proxy-pac.bmwgroup.net}"
PROXY_BRIDGE="/Users/Q284340/Agentic/coding/integrations/llm-cli-proxy/dist/server.js"
NODE_BIN="${NODE_BIN:-/opt/homebrew/bin/node}"

log() { printf '[start-llm-cli-proxy] %s\n' "$*" >&2; }

probe_corp_network() {
  # Returns 0 (success) when on corporate network, else 1.
  # Check 1: Is px running AND can it actually reach the corporate proxy upstream?
  # Just checking the port isn't enough — px may be running but unable to reach upstream.
  if curl -so /dev/null --max-time 4 --proxy http://127.0.0.1:3128 https://api.github.com 2>/dev/null; then
    log "px proxy on 127.0.0.1:3128 can reach upstream — assuming corporate network"
    return 0
  fi
  # Check 2: PAC host resolves to a corporate IP
  local resolved
  resolved=$(dig +short +time=2 +tries=1 "$PAC_HOST" 2>/dev/null | head -5 || true)
  if [ -z "$resolved" ]; then
    log "PAC host '$PAC_HOST' did not resolve and no local proxy — assuming public network"
    return 1
  fi
  if echo "$resolved" | grep -qE '^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|160\.50\.)'; then
    log "PAC host '$PAC_HOST' resolved to corporate IP(s): $(echo $resolved | tr '\n' ' ')— assuming corporate network"
    return 0
  fi
  log "PAC host '$PAC_HOST' resolved to non-corporate IP(s): $(echo $resolved | tr '\n' ' ')— assuming public network"
  return 1
}

extract_proxy_url() {
  # Fetches the PAC file and extracts the first 'PROXY host:port' from any
  # FindProxyForURL return statement. Falls through to empty string if the
  # PAC is unreachable, malformed, or contains only DIRECT.
  local pac
  pac=$(curl -fsS --max-time 5 "https://$PAC_HOST/proxy.pac" 2>/dev/null || true)
  if [ -z "$pac" ]; then
    log "PAC fetch failed (https://$PAC_HOST/proxy.pac unreachable or empty)"
    return 1
  fi
  local proxy
  proxy=$(echo "$pac" | grep -oE 'PROXY[[:space:]]+[A-Za-z0-9._-]+:[0-9]+' | head -1 | awk '{print $2}')
  if [ -z "$proxy" ]; then
    log "PAC parsed but no PROXY directive found (likely DIRECT-only)"
    return 1
  fi
  printf '%s' "$proxy"
  return 0
}

if probe_corp_network; then
  # Tell the bridge's network detector unambiguously — single source of truth.
  export LLM_NETWORK_MODE=corporate
  if proxy_url=$(extract_proxy_url) && [ -n "$proxy_url" ]; then
    export HTTPS_PROXY="http://${proxy_url}"
    export HTTP_PROXY="http://${proxy_url}"
    export NO_PROXY="localhost,127.0.0.1,::1"
    log "exported HTTPS_PROXY=$HTTPS_PROXY LLM_NETWORK_MODE=corporate (corporate network)"
  else
    log "corporate network detected but no usable proxy from PAC — exporting LLM_NETWORK_MODE=corporate but HTTPS_PROXY unset"
  fi
else
  unset HTTPS_PROXY HTTP_PROXY NO_PROXY
  export LLM_NETWORK_MODE=public
  log "public network — HTTPS_PROXY unset, LLM_NETWORK_MODE=public"
fi

log "exec node $PROXY_BRIDGE"
exec "$NODE_BIN" "$PROXY_BRIDGE"
