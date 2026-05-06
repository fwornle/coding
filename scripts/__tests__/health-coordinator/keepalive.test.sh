#!/bin/bash
# SPEC AC #11: kill -9 → coordinator respawned within 30s by launchd KeepAlive.
#
# Uses pgrep -f health-coordinator (matches SPEC AC #11 phrasing exactly).
#
# Wave 0 stub: bash -n passes; runtime fails until plan 33-02 lands the
# coordinator script and the launchd plist is loaded.
set -e
old_pid=$(pgrep -f health-coordinator.js | head -1)
[ -n "$old_pid" ] || { echo "FAIL: no coordinator running"; exit 1; }
kill -9 "$old_pid"
for i in $(seq 1 35); do
  new_pid=$(pgrep -f health-coordinator.js | head -1)
  if [ -n "$new_pid" ] && [ "$new_pid" != "$old_pid" ]; then
    echo "PASS: respawned in ${i}s: ${old_pid} -> ${new_pid}"; exit 0
  fi
  sleep 1
done
echo "FAIL: coordinator did not respawn within 35s"; exit 1
