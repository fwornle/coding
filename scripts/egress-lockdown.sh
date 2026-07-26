#!/usr/bin/env bash
# T1 network-level egress lockdown for LLM provider clouds.
#
# Blackholes the raw provider API hostnames in /etc/hosts so that the ONLY
# host process able to reach them is the rapid-llm-proxy daemon (:12435),
# which resolves exactly these names via direct nameserver queries
# (dns.Resolver in proxy-bridge/server.mjs — c-ares ignores /etc/hosts).
# Any other caller — a stray `new OpenAI()`, a bare `claude` CLI launched
# outside bin/coding, a future SDK someone wires up directly — fails at
# connect time instead of silently egressing. This flips the launcher's
# fail-open daemon health gate into a network-enforced fail-closed.
#
# Deliberately NOT blackholed:
#   - bmw.ghe.com / api.githubcopilot.com  (Copilot is BYOK by design; also
#     used interactively by VS Code)
#   - claude.ai / console.anthropic.com    (web login + OAuth token refresh)
#
# Usage:
#   sudo scripts/egress-lockdown.sh install     # activate the blackhole
#   sudo scripts/egress-lockdown.sh uninstall   # remove it
#   scripts/egress-lockdown.sh status           # show block + resolution state
#   scripts/egress-lockdown.sh verify           # direct egress must FAIL, daemon routes must WORK
#
# Keep this host list in sync with LLM_PROXY_DNS_BYPASS_HOSTS default in
# rapid-llm-proxy proxy-bridge/server.mjs.
set -euo pipefail

HOSTS_FILE="/etc/hosts"
BEGIN_MARK="# BEGIN coding-llm-egress-lockdown (managed by scripts/egress-lockdown.sh)"
END_MARK="# END coding-llm-egress-lockdown"
LOCKDOWN_HOSTS=(
  api.anthropic.com
  api.openai.com
  api.groq.com
  generativelanguage.googleapis.com
)
PROXY_PORT="${LLM_CLI_PROXY_PORT:-12435}"

require_root() {
  if [[ "$(id -u)" != "0" ]]; then
    echo "ERROR: '$1' modifies ${HOSTS_FILE} and must run under sudo." >&2
    exit 1
  fi
}

flush_dns() {
  dscacheutil -flushcache || true
  killall -HUP mDNSResponder 2>/dev/null || true
  echo "DNS cache flushed."
}

remove_block() {
  # Delete the managed block in place (idempotent if absent).
  if grep -qF "$BEGIN_MARK" "$HOSTS_FILE"; then
    local tmp
    tmp="$(mktemp)"
    awk -v b="$BEGIN_MARK" -v e="$END_MARK" '
      $0 == b { skip = 1; next }
      $0 == e { skip = 0; next }
      !skip { print }
    ' "$HOSTS_FILE" > "$tmp"
    cat "$tmp" > "$HOSTS_FILE"
    rm -f "$tmp"
  fi
}

cmd_install() {
  require_root install
  remove_block
  {
    echo "$BEGIN_MARK"
    for h in "${LOCKDOWN_HOSTS[@]}"; do
      echo "0.0.0.0 $h"
      echo ":: $h"
    done
    echo "$END_MARK"
  } >> "$HOSTS_FILE"
  flush_dns
  echo "Egress lockdown INSTALLED for: ${LOCKDOWN_HOSTS[*]}"
  echo "Run 'scripts/egress-lockdown.sh verify' (no sudo) to prove enforcement."
}

cmd_uninstall() {
  require_root uninstall
  remove_block
  flush_dns
  echo "Egress lockdown REMOVED."
}

cmd_status() {
  if grep -qF "$BEGIN_MARK" "$HOSTS_FILE"; then
    echo "Lockdown block PRESENT in ${HOSTS_FILE}:"
    sed -n "/^$(printf '%s' "$BEGIN_MARK" | sed 's/[][\\.*^$(){}?+|/]/\\&/g')\$/,/^$(printf '%s' "$END_MARK" | sed 's/[][\\.*^$(){}?+|/]/\\&/g')\$/p" "$HOSTS_FILE"
  else
    echo "Lockdown block ABSENT — direct provider egress is possible."
  fi
  echo
  for h in "${LOCKDOWN_HOSTS[@]}"; do
    local_res="$(dscacheutil -q host -a name "$h" 2>/dev/null | awk '/^ip_address:/ {print $2; exit}')"
    echo "  $h → ${local_res:-<no A record via system resolver>}"
  done
}

cmd_verify() {
  local fail=0

  echo "--- 1) Direct egress must FAIL (system resolver blackholed) ---"
  for h in "${LOCKDOWN_HOSTS[@]}"; do
    # --noproxy '*' forces a direct connection: we are testing the raw path,
    # not whatever HTTPS_PROXY happens to be set in this shell.
    if curl --noproxy '*' -s -m 4 -o /dev/null "https://$h/" 2>/dev/null; then
      echo "  LEAK: direct connection to $h SUCCEEDED"
      fail=1
    else
      echo "  OK: direct connection to $h blocked/failed"
    fi
  done

  echo "--- 2) Daemon routes must WORK ---"
  if curl --noproxy '*' -s -m 5 "http://127.0.0.1:${PROXY_PORT}/health" | grep -q '"status"'; then
    echo "  OK: daemon /health responding"
  else
    echo "  FAIL: daemon /health not responding on :${PROXY_PORT}"
    fail=1
  fi
  code="$(curl --noproxy '*' -s -m 60 -o /tmp/egress-verify-complete.json -w '%{http_code}' \
    -X POST "http://127.0.0.1:${PROXY_PORT}/api/complete" \
    -H 'content-type: application/json' \
    -d '{"process":"egress-lockdown-verify","messages":[{"role":"user","content":"Reply with exactly: OK"}]}')"
  if [[ "$code" == "200" ]] && grep -q '"content"' /tmp/egress-verify-complete.json; then
    echo "  OK: /api/complete returned a completion ($(sed -n 's/.*"provider":"\([^"]*\)".*/provider=\1/p' /tmp/egress-verify-complete.json | head -1))"
  else
    echo "  FAIL: /api/complete HTTP $code"
    fail=1
  fi
  # Passthrough reachability: ANY HTTP status (401/400/200) proves the daemon
  # reached api.anthropic.com through its bypass resolver; connect failure = broken.
  code="$(curl --noproxy '*' -s -m 15 -o /dev/null -w '%{http_code}' \
    -X POST "http://127.0.0.1:${PROXY_PORT}/v1/messages" \
    -H 'content-type: application/json' -d '{}')"
  if [[ "$code" == "000" || "$code" == "502" ]]; then
    echo "  FAIL: /v1/messages passthrough cannot reach api.anthropic.com (HTTP $code)"
    fail=1
  else
    echo "  OK: /v1/messages passthrough reached upstream (HTTP $code)"
  fi

  echo
  if [[ "$fail" == "0" ]]; then
    echo "VERIFY PASSED: providers unreachable directly, reachable only via the daemon."
  else
    echo "VERIFY FAILED — see lines above."
  fi
  exit "$fail"
}

case "${1:-}" in
  install)   cmd_install ;;
  uninstall) cmd_uninstall ;;
  status)    cmd_status ;;
  verify)    cmd_verify ;;
  *) echo "Usage: [sudo] $0 {install|uninstall|status|verify}" >&2; exit 2 ;;
esac
