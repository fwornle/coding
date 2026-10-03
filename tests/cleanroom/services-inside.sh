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
#   5. the status line renders, with the badges of the tier's features and none
#      of another's (docs/architecture/features.md, "Status-line badges")
#   6. the coordinator's /features is exactly the tier (an oracle written out
#      here, not read back from config/feature-profiles.yaml)
#   7. harness only — the one Docker-free tier, so the dashboard runs on the
#      host (scripts/start-services-robust.js): its OWN origin serves
#      /api/features as JSON, which is what the nav bar drops tabs from
#
# Installed as a colleague would (--scope=team-a), next to a planted sentinel
# tenant `coding` (the developer's data home) that must be byte-identical at the
# end. Then ./uninstall.sh, and no coding unit may be left behind.
#
# One PASS/FAIL line per assertion; exit status = number of failures.
set -uo pipefail

for _v in NO_PROXY no_proxy; do   # see inside.sh: loopback must never be proxied
  export "$_v=localhost,127.0.0.1,::1${!_v:+,${!_v}}"
done

TOOLS="$HOME/coding"
OUT="${CLEANROOM_OUT:-/tmp/cleanroom}"
UNIT_DIR="$HOME/.config/systemd/user"
SCOPE=team-a
SENTINEL="$HOME/.coding/data/coding"
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

# The tier → feature oracle (per-repo tenancy T1). Deliberately literal.
tier_features() {
  case "$1" in
    harness)       echo "health llm-proxy statusline" ;;
    learning)      echo "health knowledge llm-proxy lsl observations statusline" ;;
    learning-perf) echo "health knowledge llm-proxy lsl observations performance statusline" ;;
    everything)    echo "codegraph constraints health knowledge llm-proxy lsl observations performance statusline" ;;
  esac
}

fingerprint() { (cd "$1" && find . -type f -print0 | sort -z | xargs -0 -r sha256sum); }

step "sentinel tenant $SENTINEL"
mkdir -p "$SENTINEL/history/2026/10" "$SENTINEL/kb/knowledge-graph/exports" "$SENTINEL/var/knowledge-graph"
echo "the developer's session"            > "$SENTINEL/history/2026/10/2026-10-01_0900-1000_dev.md"
echo '{"entities":[{"name":"DevOnly"}]}' > "$SENTINEL/kb/knowledge-graph/exports/general.json"
echo "leveldb stand-in"                   > "$SENTINEL/var/knowledge-graph/CURRENT"
fingerprint "$SENTINEL" > "$OUT/sentinel.before"

for tier in "$@"; do
  step "tier $tier: ./install.sh --ci --yes --scope=$SCOPE --features=$tier"
  CODING_INSTALL_SYSTEM_SERVICES=1 ./install.sh --ci --yes --scope="$SCOPE" --features="$tier" > "$OUT/install-$tier.log" 2>&1
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

  want="$(tier_features "$tier")"
  on() { case " $want " in *" $1 "*) return 0 ;; esac; return 1; }

  # Badges. A disabled feature's badge is omitted outright; of the enabled
  # ones, only health renders something in every state (offline included).
  for b in "health:[🏥" "lsl:[LSL" "lsl:[📋" "observations:[📚" "constraints:[🔒"; do
    f="${b%%:*}"; mark="${b#*:}"
    case "$line" in *"$mark"*) has=yes ;; *) has=no ;; esac
    if on "$f"; then
      [ "$f" != health ] && continue
      [ "$has" = yes ] && pass "[$tier] badge $mark present ($f on)" || fail "[$tier] badge $mark missing although $f is on"
    else
      [ "$has" = no ] && pass "[$tier] badge $mark absent ($f off)" || fail "[$tier] badge $mark shown although $f is off"
    fi
  done

  # The coordinator serves exactly this tier (lsl-redirect is in no tier).
  got="$(curl -sf -m 5 http://127.0.0.1:3034/features | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { console.log(JSON.parse(s).enabled.filter((f) => f !== "lsl-redirect").sort().join(" ")); } catch { console.log("unparseable"); }
    });')"
  [ "$got" = "$want" ] && pass "[$tier] coordinator /features = the tier ($got)" \
    || fail "[$tier] coordinator /features = '$got', want '$want'"

  if [ "$tier" = harness ]; then
    # What the launcher does when no enabled feature needs Docker.
    timeout 180 node scripts/start-services-robust.js > "$OUT/start-services-$tier.log" 2>&1
    echo "start-services-robust exit=$?"
    for _ in $(seq 1 90); do curl -sf -m 2 -o /dev/null http://127.0.0.1:3032/ && break; sleep 1; done
    ctype="$(curl -s -m 5 -o "$OUT/dash-features-$tier.json" -w '%{content_type}' http://127.0.0.1:3032/api/features)"
    dash="$(node -e 'try { const j = require(process.argv[1]); console.log(j.enabled.filter((f) => f !== "lsl-redirect").sort().join(" ")); } catch { console.log("unparseable"); }' "$OUT/dash-features-$tier.json")"
    [[ "$ctype" == application/json* ]] && [ "$dash" = "$want" ] \
      && pass "[$tier] host dashboard :3032/api/features is JSON = the tier (nav tabs: Health + Token Usage only)" \
      || fail "[$tier] host dashboard :3032/api/features: $ctype, '$dash' — the nav fails open and shows every tab"
    pkill -f 'system-health-dashboard' 2>/dev/null; pkill -f 'vite' 2>/dev/null
  fi
done

step "sentinel"
fingerprint "$SENTINEL" > "$OUT/sentinel.after"
diff -q "$OUT/sentinel.before" "$OUT/sentinel.after" >/dev/null \
  && pass "the sentinel tenant is byte-identical after every tier" \
  || { fail "the sentinel tenant changed:"; diff "$OUT/sentinel.before" "$OUT/sentinel.after" | head -10; }
[ -d "$HOME/.coding/data/$SCOPE" ] && pass "this install's data went to its own scope ($SCOPE)" \
  || fail "no data home for scope $SCOPE"

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
