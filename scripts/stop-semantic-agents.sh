#!/bin/bash

# Stop semantic-analysis agent system

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SEMANTIC_ANALYSIS_DIR="$PROJECT_DIR/semantic-analysis-system"

log() {
  echo "[Semantic-Analysis] $1"
}

# Check for new PID file first
if [ -f "$SEMANTIC_ANALYSIS_DIR/.system.pid" ]; then
  PID=$(cat "$SEMANTIC_ANALYSIS_DIR/.system.pid")
  if kill -0 $PID 2>/dev/null; then
    log "Stopping semantic-analysis system (PID: $PID)..."
    kill $PID
    rm "$SEMANTIC_ANALYSIS_DIR/.system.pid"
    log "Semantic-analysis system stopped"
  else
    log "System not running (stale PID file)"
    rm "$SEMANTIC_ANALYSIS_DIR/.system.pid"
  fi
fi

# Also check for old PID file for backwards compatibility
if [ -f "$SEMANTIC_ANALYSIS_DIR/.agent.pid" ]; then
  PID=$(cat "$SEMANTIC_ANALYSIS_DIR/.agent.pid")
  if kill -0 $PID 2>/dev/null; then
    log "Stopping agent system (PID: $PID)..."
    kill $PID
  fi
  rm "$SEMANTIC_ANALYSIS_DIR/.agent.pid"
fi

# Clean up any remaining processes
PIDS=$(pgrep -f "semantic-analysis-system" || true)
if [ -n "$PIDS" ]; then
  log "Cleaning up remaining semantic-analysis processes..."
  pkill -f "semantic-analysis-system" || true
  log "All semantic-analysis processes stopped"
fi