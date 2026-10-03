#!/usr/bin/env bash
# tests/cleanroom/services-inside.sh <tier>... — container side of services.sh.
#
# Runs as `dev`, with systemd as PID 1 and dev's user manager up. Per tier, in the
# order given (each a superset of the last — the upgrade path):
#
#   1. ./install.sh --ci --yes --features=<tier>, proxy service opted in
#   2. the daemons the tier owns (DAEMONS × the resolved features) are installed
#      and ACTIVE under systemctl --user, and have not restarted — an active unit
#      that crash-loops under Restart=always reads "active" between crashes
#   3. no unit for a daemon the tier does not own
#   4. the health coordinator, obs-api and the proxy answer /health when on
#   5. the status line renders
#
# Then ./uninstall.sh, and no coding unit may be left behind.
#
# One PASS/FAIL line per assertion; exit status = number of failures.
set -uo pipefail

for _v in NO_PROXY no_proxy; do   # see inside.sh: loopback must never be proxied
  export "$_v=localhost,127.0.0.1,::1${!_v:+,${!_v}}"
done

TOOLS="$HOME/coding"
OUT="${CLEANROOM_OUT:-/tmp/cleanroom}"
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$OUT"
cd "$TOOLS"

fails=0
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; fails=$((fails + 1)); }
step() { printf '\n── %s\n' "$*"; }

PROXY_BUNDLE=/opt/cleanroom/extras/rapid-llm-proxy.bundle   # see Dockerfile.systemd
[ -f "$PROXY_BUNDLE" ] && export RAPID_LLM_PROXY_REPO="$PROXY_BUNDLE"

wait_http() {  # <port> <seconds>
  local i
  for i in $(seq 1 "$2"); do
    curl -sf -m 2 -o /dev/null "http://127.0.0.1:$1/health" && return 0
    sleep 1
  done
  return 1
}

# "<id> <on|off>" for every daemon, from the features the installer just wrote.
daemon_plan() {
  node --input-type=module -e '
    const { DAEMONS } = await import(process.argv[1] + "/lib/features/daemons.mjs");
    const { loadFeatures } = await import(process.argv[1] + "/lib/features/index.mjs");
    const r = loadFeatures();
    for (const [id, f] of Object.entries(DAEMONS)) console.log(id, r.features[f]?.enabled ? "on" : "off");
  ' "$TOOLS"
}

for tier in "$@"; do
  step "tier $tier: ./install.sh --ci --yes --features=$tier"
  CODING_INSTALL_SYSTEM_SERVICES=1 ./install.sh --ci --yes --features="$tier" > "$OUT/install-$tier.log" 2>&1
  echo "installer exit=$?"
  grep -E '\[install-systemd-daemons\]' "$OUT/install-$tier.log" | sed 's/^/  /'

  # Long-running units get a settle period before the restart count means anything.
  sleep 20

  while read -r id want; do
    # The proxy is opt-in and needs its private repo: checked on its own below.
    [ "$id" = llm-cli-proxy ] && continue
    unit="$id.service"; [ -f "$UNIT_DIR/$id.timer" ] && unit="$id.timer"
    if [ "$want" = off ]; then
      [ ! -f "$UNIT_DIR/$id.service" ] && pass "[$tier] $id: not installed (feature off)" \
        || fail "[$tier] $id: installed although its feature is off"
      continue
    fi
    if [ ! -f "$UNIT_DIR/$id.service" ]; then
      fail "[$tier] $id: no unit in $UNIT_DIR"
      continue
    fi
    state="$(systemctl --user is-active "$unit" 2>/dev/null)"
    enabled="$(systemctl --user is-enabled "$unit" 2>/dev/null)"
    if [ "$unit" = "$id.timer" ]; then
      [ "$state" = active ] && [ "$enabled" = enabled ] \
        && pass "[$tier] $id: timer active + enabled" \
        || fail "[$tier] $id: timer is $state/$enabled"
      # A RunAtLoad job has run once by now (OnActiveSec=1s); it must have succeeded.
      if grep -q '^OnActiveSec=1s$' "$UNIT_DIR/$id.timer"; then
        result="$(systemctl --user show "$id.service" -p Result --value)"
        code="$(systemctl --user show "$id.service" -p ExecMainStatus --value)"
        [ "$result" = success ] && [ "$code" = 0 ] \
          && pass "[$tier] $id: first run succeeded" \
          || fail "[$tier] $id: first run result=$result status=$code ($(tail -3 "$TOOLS/.data/$id.log" 2>/dev/null | tr '\n' ' '))"
      fi
    else
      restarts="$(systemctl --user show "$unit" -p NRestarts --value)"
      [ "$state" = active ] && [ "$enabled" = enabled ] && [ "${restarts:-0}" = 0 ] \
        && pass "[$tier] $id: active + enabled, 0 restarts" \
        || fail "[$tier] $id: $state/$enabled, NRestarts=$restarts — $(journalctl --user -u "$unit" -n 3 --no-pager 2>/dev/null | tail -3 | tr '\n' ' ')"
    fi
  done < <(daemon_plan | tee "$OUT/plan-$tier.txt")

  if grep -q '^health-coordinator on' "$OUT/plan-$tier.txt"; then
    wait_http 3034 60 && pass "[$tier] health coordinator answers :3034/health" \
      || fail "[$tier] health coordinator not answering :3034 (tail: $(tail -3 .logs/health-coordinator.log 2>/dev/null | tr '\n' ' '))"
  fi
  if grep -q '^obs-api on' "$OUT/plan-$tier.txt"; then
    wait_http 12436 120 && pass "[$tier] obs-api answers :12436/health" \
      || fail "[$tier] obs-api not answering :12436 (tail: $(tail -3 .logs/obs-api.log 2>/dev/null | tr '\n' ' '))"
  fi
  if grep -q '^llm-cli-proxy on' "$OUT/plan-$tier.txt"; then
    if [ ! -f "$PROXY_BUNDLE" ]; then
      echo "SKIP  [$tier] proxy: no bundle"
    else
      [ -f "$UNIT_DIR/llm-cli-proxy.service" ] && pass "[$tier] the proxy's systemd unit is installed" \
        || fail "[$tier] no llm-cli-proxy.service (see install-$tier.log)"
      wait_http 12435 90 && pass "[$tier] the proxy answers :12435/health" \
        || fail "[$tier] proxy not answering :12435 (tail: $(tail -3 .logs/llm-proxy-service.log 2>/dev/null | tr '\n' ' '))"
    fi
  fi

  line="$(timeout 30 node scripts/combined-status-line.js 2>"$OUT/statusline-$tier.err")"
  rc=$?
  [ $rc -eq 0 ] && [ -n "$line" ] && pass "[$tier] status line renders: $(printf '%s' "$line" | tr -s '\n' ' ' | cut -c1-160)" \
    || fail "[$tier] status line rc=$rc, output '${line:0:80}' ($(head -c 200 "$OUT/statusline-$tier.err"))"
done

step "uninstall"
printf 'ynn' | ./uninstall.sh > "$OUT/uninstall.log" 2>&1
echo "uninstall exit=$?"
left="$(ls "$UNIT_DIR" 2>/dev/null | grep -E '\.(service|timer)$' || true)"
[ -z "$left" ] && pass "uninstall removed every unit" || fail "units left after uninstall: $(echo $left)"
active="$(systemctl --user list-units --type=service,timer --state=active --no-legend --plain 2>/dev/null \
          | awk '{print $1}' | grep -E "^($(ls "$TOOLS/systemd" | sed 's/\.[a-z]*$//' | sort -u | paste -sd'|'))\." || true)"
[ -z "$active" ] && pass "no coding unit still active" || fail "still active after uninstall: $(echo $active)"

printf '\n%s\n' "────────────────────────────────────────"
if [ "$fails" -eq 0 ]; then echo "SERVICES: all assertions passed"; else echo "SERVICES: $fails assertion(s) FAILED"; fi
exit "$fails"
