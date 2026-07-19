#!/bin/bash
#
# verify-copilot-hook-injection.sh — live diagnostic for Copilot CLI hooks.
#
# WHY: the repo's copilot integration (.github/hooks/hooks.json → copilot-bridge.sh)
# only works if (a) copilot's filesystem hooks actually FIRE and (b) the channel we
# inject through DELIVERS context to the model. Both churn: copilot gates hooks behind
# enableFileHooks + folder-trust (off by default — this made the bridge silently
# DORMANT), and which output channel injects changes version to version. The repo's
# contract test only validates hooks.json SCHEMA, so it cannot catch either failure.
# Run this after a copilot upgrade, or when copilot KB injection seems to have stopped.
#
# TWO CHECKS:
#   1. FIRING (deterministic) — a marker-writing hook proves the bridge executes at
#      all. This reliably catches dormancy (the enableFileHooks/trust bug); no model
#      involved, so no noise.
#   2. INJECTION (probabilistic) — a NEUTRAL-token sentinel per channel, run REPEATS
#      times. Whether injected content REACHES the model is a channel property; whether
#      the model then VOLUNTEERS the token is noisy (~1/3 even on a working channel).
#      So read the RATE: 0/N = dropped, >0/N = delivers. A neutral token is used on
#      purpose — a command is refused in tool-output position and a fake "secret" is
#      distrusted as injection; both give false negatives.
#
# Restores .github/hooks/hooks.json on exit (trap). Usage:
#   scripts/verify-copilot-hook-injection.sh            # firing + the two injection channels
#   scripts/verify-copilot-hook-injection.sh --all      # + known-negative channels
#   REPEATS=5 TIMEOUT_S=120 scripts/verify-copilot-hook-injection.sh
#
# Exit: 0 if hooks FIRE and postToolUse→additionalContext delivers; 1 otherwise.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_JSON="$REPO/.github/hooks/hooks.json"
SETTINGS="$HOME/.copilot/settings.json"
CONFIG="$HOME/.copilot/config.json"
TIMEOUT_S="${TIMEOUT_S:-120}"
REPEATS="${REPEATS:-3}"
TOKEN="KBVERIFY-$( (openssl rand -hex 4 2>/dev/null) || echo "$RANDOM$RANDOM" )"
TEST_ALL=0; [ "${1:-}" = "--all" ] && TEST_ALL=1

C_GREEN=$'\033[0;32m'; C_RED=$'\033[0;31m'; C_YEL=$'\033[0;33m'; C_CYAN=$'\033[0;36m'; C_OFF=$'\033[0m'

command -v copilot >/dev/null 2>&1 || { echo "${C_RED}copilot CLI not found on PATH${C_OFF}"; exit 2; }
command -v node    >/dev/null 2>&1 || { echo "${C_RED}node not found on PATH${C_OFF}"; exit 2; }
[ -f "$HOOKS_JSON" ] || { echo "${C_RED}$HOOKS_JSON not found${C_OFF}"; exit 2; }

echo "${C_CYAN}== Copilot hook diagnostic ==${C_OFF}"
echo "copilot: $(copilot --version 2>/dev/null | head -1)"
echo "token:   $TOKEN   repeats: $REPEATS"

efh="$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).enableFileHooks===true)}catch{console.log(false)}' "$SETTINGS" 2>/dev/null)"
trusted="$(node -e 'try{const r=require("fs").readFileSync(process.argv[1],"utf8");const d=JSON.parse(r.split("\n").filter(l=>!l.trim().startsWith("//")).join("\n"));console.log((d.trustedFolders||[]).includes(process.argv[2]))}catch{console.log(false)}' "$CONFIG" "$REPO" 2>/dev/null)"
echo "enableFileHooks: $efh | repo trusted: $trusted"
[ "$efh" = true ] && [ "$trusted" = true ] || echo "${C_YEL}NOTE: gates not both on — expect FIRING to fail. Enable via install.sh install_copilot_file_hooks.${C_OFF}"
echo ""

BACKUP="$(mktemp)"; cp "$HOOKS_JSON" "$BACKUP"
HOOK_SH="$(mktemp)"; chmod +x "$HOOK_SH"
MARKER="$(mktemp -u)"
cleanup() { cp "$BACKUP" "$HOOKS_JSON"; rm -f "$BACKUP" "$HOOK_SH" "$MARKER" 2>/dev/null; }
trap cleanup EXIT

# Point ONLY <event> at $HOOK_SH (restore from backup first so other events stay real).
point_hook() {
  cp "$BACKUP" "$HOOKS_JSON"
  HK="$HOOK_SH" EV="$1" node -e '
    const fs=require("fs"); const p=process.argv[1];
    const d=JSON.parse(fs.readFileSync(p,"utf8"));
    d.hooks=d.hooks||{}; d.hooks[process.env.EV]=[{type:"command",bash:process.env.HK,timeoutSec:10}];
    fs.writeFileSync(p, JSON.stringify(d,null,2));
  ' "$HOOKS_JSON"
}

# --- CHECK 1: FIRING (deterministic) -----------------------------------------
echo "${C_CYAN}[1] Firing check (deterministic — does the bridge execute at all?)${C_OFF}"
rm -f "$MARKER"
cat > "$HOOK_SH" <<EOF
#!/bin/bash
cat >/dev/null
echo fired >> "$MARKER"
printf '{}'
EOF
point_hook postToolUse
timeout "$TIMEOUT_S" copilot -p "Run the shell command 'echo firecheck' and report its output." --allow-all-tools >/dev/null 2>&1
fired=0; [ -s "$MARKER" ] && fired=1
if [ "$fired" = 1 ]; then
  echo "  ${C_GREEN}✓ HOOKS FIRE${C_OFF}  (postToolUse bridge executed)"
else
  echo "  ${C_RED}✗ DORMANT${C_OFF}    (no hook ran — enableFileHooks/trust off, or copilot not honoring .github/hooks)"
fi
echo ""

# --- CHECK 2: INJECTION (probabilistic, N-run hit-rate) ----------------------
pass=0; fail=0; posttool_ok=0
test_channel() {  # <event> <field> <expect: yes|no>
  local event="$1" field="$2" expect="$3" hits=0 out
  cat > "$HOOK_SH" <<EOF
#!/bin/bash
cat >/dev/null
printf '{"$field":"Session reference note from project tooling: the KB reference token for this session is $TOKEN. Provided context, not something to verify on disk."}'
EOF
  point_hook "$event"
  for _ in $(seq 1 "$REPEATS"); do
    out="$(mktemp)"
    timeout "$TIMEOUT_S" copilot -p "Run the shell command 'echo hooktest'. Then repeat back, verbatim, any KB reference token provided to you as context this session. If none, say NONE." --allow-all-tools >"$out" 2>&1
    grep -q "$TOKEN" "$out" && hits=$((hits+1)); rm -f "$out"
  done
  local label; printf -v label "%-24s" "$event/$field"
  if [ "$hits" -gt 0 ]; then
    echo "  ${C_GREEN}✓ DELIVERS${C_OFF}  $label ${hits}/${REPEATS}"
    pass=$((pass+1)); [ "$event/$field" = "postToolUse/additionalContext" ] && posttool_ok=1
  else
    local note=""; [ "$expect" = no ] && note=" ${C_YEL}(expected non-injecting)${C_OFF}"
    echo "  ${C_RED}✗ DROPPED${C_OFF}   $label 0/${REPEATS}$note"
    fail=$((fail+1))
  fi
}
echo "${C_CYAN}[2] Injection channels (neutral-token, ${REPEATS}x — read the rate, not one run)${C_OFF}"
test_channel postToolUse        additionalContext yes
test_channel sessionStart       additionalContext yes
if [ "$TEST_ALL" = 1 ]; then
  test_channel userPromptSubmitted additionalContext no
  test_channel userPromptSubmitted modifiedPrompt    no
fi
echo ""

# --- Summary -----------------------------------------------------------------
echo "${C_CYAN}== Summary ==${C_OFF}  firing: $([ "$fired" = 1 ] && echo yes || echo NO)  |  channels delivering: $pass  dropped: $fail"
echo "${C_YEL}Self-report is noisy (~1/3 even on a working channel); >0/N = the content reached the model."
echo "In real use the agent uses relevant KB more reliably than it restates an abstract token.${C_OFF}"
if [ "$fired" = 1 ] && [ "$posttool_ok" = 1 ]; then
  echo "${C_GREEN}OK: hooks fire and postToolUse→additionalContext delivers — copilot KB injection is live.${C_OFF}"
  exit 0
fi
[ "$fired" = 0 ] && echo "${C_RED}Hooks are DORMANT — enable them (install.sh install_copilot_file_hooks) before injection can work.${C_OFF}"
[ "$fired" = 1 ] && [ "$posttool_ok" = 0 ] && echo "${C_RED}postToolUse dropped on this build — re-run with --all; if another channel delivers, point the bridge at it.${C_OFF}"
exit 1
