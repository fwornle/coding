#!/usr/bin/env bash
# Record what happens to egress across a network switch.
#
# Shell-only on purpose: during the switch the LLM path is exactly what breaks,
# so nothing that needs an LLM call can observe it. Run this, switch networks,
# then read the file afterwards.
#
#   scripts/record-network-transition.sh &        # or: nohup ... &
#   tail -f .logs/network-transition.log
OUT="${1:-/Users/Q284340/Agentic/coding/.logs/network-transition.log}"
say() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*" >> "$OUT"; }

say "=== recorder started (pid $$) ==="
prev=""
while true; do
  coord=$(curl -s --max-time 2 localhost:3034/health/state 2>/dev/null \
    | python3 -c 'import sys,json
n = json.load(sys.stdin).get("network", {})
print("%s/pending=%s" % (n.get("location"), n.get("location_demotion_pending")))' 2>/dev/null || echo "coordinator:down")
  health=$(curl -s --max-time 3 localhost:12435/health 2>/dev/null \
    | python3 -c 'import sys,json
d = json.load(sys.stdin); e = d["egress"]
print("%s egress=%s degraded=%s" % (d["networkMode"], e["proxy"] or "direct", e["degraded"]))' 2>/dev/null || echo "proxy:down")
  # Does a real provider call get through right now?
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 -X POST localhost:12435/api/complete \
    -H 'Content-Type: application/json' \
    -d '{"process":"fg-chat/pi","complexity":"small","messages":[{"role":"user","content":"ok"}]}' 2>/dev/null || echo 000)
  line="coord=$coord | proxy=$health | call=$code"
  [ "$line" != "$prev" ] && { say "$line"; prev="$line"; }
  sleep 5
done
