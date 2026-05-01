#!/bin/bash
# Pre-flight check: kill any non-Docker process holding a coding-services
# host port. Run this before `docker compose up` / Docker Desktop "Start"
# to avoid the cryptic "bind: address already in use" failure mode.
#
# The launcher (bin/coding, bin/claude-mcp) already does this automatically
# via _resolve_port_conflicts() in scripts/launch-agent-common.sh. This
# script is for the "I bypassed the launcher" path.

set -e

CODING_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$CODING_REPO/docker/docker-compose.yml"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Error: $COMPOSE_FILE not found" >&2
  exit 1
fi

# Stop respawning daemons FIRST. Without this, killing the leaf next-server
# below is futile — the global-service-coordinator's 15s health-check loop
# respawns it within seconds of the kill. We wipe the watchdog before
# touching its children so the kills stick long enough for Docker to bind.
# The coordinator itself is slated for removal in Phase B; this is bridge
# scaffolding.
coordinator_pids=$(pgrep -f 'global-service-coordinator\.js' 2>/dev/null || true)
if [ -n "$coordinator_pids" ]; then
  echo "🔧 Stopping global-service-coordinator (PIDs: $coordinator_pids) so kills below stick"
  echo "$coordinator_pids" | xargs kill 2>/dev/null || true
  sleep 1
fi

# Extract host ports from "HOST:CONTAINER" mappings in docker-compose.yml
host_ports=$(grep -oE '^\s+- "([0-9]+):' "$COMPOSE_FILE" | grep -oE '[0-9]+' || true)

if [ -z "$host_ports" ]; then
  echo "No host ports found in $COMPOSE_FILE — nothing to check"
  exit 0
fi

conflicts_found=false
checked=0

for port in $host_ports; do
  checked=$((checked + 1))
  pid=$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null | head -1 || true)
  [ -z "$pid" ] && continue

  proc_name=$(ps -p "$pid" -o comm= 2>/dev/null || true)
  # Leave docker-proxy / com.docker.* alone — those are expected
  if [[ "$proc_name" == *docker* ]] || [[ "$proc_name" == *com.docker* ]]; then
    continue
  fi

  proc_cmd=$(ps -p "$pid" -o args= 2>/dev/null | head -c 120 || true)
  echo "⚠️  Port $port blocked by PID $pid: $proc_cmd"

  if kill "$pid" 2>/dev/null; then
    echo "   Killed PID $pid to free port $port"
    conflicts_found=true
  else
    echo "   Failed to kill PID $pid — try: sudo kill $pid" >&2
  fi
done

if [ "$conflicts_found" = true ]; then
  sleep 1  # give the kernel a moment to release sockets
  echo "✅ Conflicts resolved — safe to run 'docker compose up'"
else
  echo "✅ No conflicts — $checked port(s) clear"
fi
