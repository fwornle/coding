#!/bin/bash

# Start Constraint Monitoring Service
# Integrates real-time constraint checking with development workflow

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
CODING_TOOLS_PATH="${CODING_TOOLS_PATH:-${SCRIPT_DIR}/..}"
TRANSCRIPT_SOURCE_PROJECT="${TRANSCRIPT_SOURCE_PROJECT:-$(pwd)}"

echo "🛡️ Starting Constraint Monitoring Service"
echo "Project: $TRANSCRIPT_SOURCE_PROJECT"
echo "Tools Path: $CODING_TOOLS_PATH"

# Check if chokidar is available
if ! node -e "require('chokidar')" 2>/dev/null; then
    echo "⚠️ chokidar not found, installing..."
    cd "$CODING_TOOLS_PATH" && npm install chokidar
fi

# Start constraint monitoring in background
CONSTRAINT_LOG="$CODING_TOOLS_PATH/.logs/constraint-monitor.log"
mkdir -p "$CODING_TOOLS_PATH/.logs"

echo "$(date): Starting constraint monitor for $TRANSCRIPT_SOURCE_PROJECT" >> "$CONSTRAINT_LOG"

# Export environment variables and start monitoring
export TRANSCRIPT_SOURCE_PROJECT
export CODING_TOOLS_PATH

node "$SCRIPT_DIR/constraint-monitor-integration.js" start >> "$CONSTRAINT_LOG" 2>&1 &
MONITOR_PID=$!

echo "🛡️ Constraint monitor started (PID: $MONITOR_PID)"
echo "$MONITOR_PID" > "$CODING_TOOLS_PATH/.constraint-monitor.pid"

# Create status file
cat > "$CODING_TOOLS_PATH/.constraint-monitor-status.json" << EOF
{
  "status": "running",
  "pid": $MONITOR_PID,
  "started_at": "$(date -Iseconds)",
  "project": "$TRANSCRIPT_SOURCE_PROJECT",
  "log_file": "$CONSTRAINT_LOG"
}
EOF

echo "✅ Constraint monitoring is now active"
echo "📝 Logs: $CONSTRAINT_LOG"
echo "🔍 Monitor file changes and check for violations automatically"

# If running interactively, wait for Ctrl+C
if [ -t 1 ]; then
    echo ""
    echo "Press Ctrl+C to stop monitoring..."
    trap "echo ''; echo '🛡️ Stopping constraint monitor...'; kill $MONITOR_PID 2>/dev/null; rm -f '$CODING_TOOLS_PATH/.constraint-monitor.pid' '$CODING_TOOLS_PATH/.constraint-monitor-status.json'; echo '✅ Constraint monitor stopped'; exit 0" INT
    wait $MONITOR_PID
fi