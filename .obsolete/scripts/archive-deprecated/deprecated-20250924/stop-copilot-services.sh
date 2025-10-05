#!/bin/bash

# Stop CoPilot fallback services

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Color definitions
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log() {
  echo -e "${BLUE}[CoPilot Stop]${NC} $1"
}

success() {
  echo -e "${GREEN}✓${NC} $1"
}

warn() {
  echo -e "${YELLOW}⚠️${NC} $1"
}

error() {
  echo -e "${RED}✗${NC} $1"
}

# Function to stop services by PID file
stop_by_pid_file() {
  local pid_file="$1"
  local service_name="$2"
  
  if [ -f "$pid_file" ]; then
    local pid=$(cat "$pid_file")
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      log "Stopping $service_name (PID: $pid)..."
      kill "$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null
      sleep 1
      
      # Verify it's stopped
      if kill -0 "$pid" 2>/dev/null; then
        warn "$service_name still running, force killing..."
        kill -9 "$pid" 2>/dev/null
      fi
      success "$service_name stopped"
    else
      warn "$service_name PID file exists but process not running"
    fi
    rm -f "$pid_file"
  else
    log "No PID file found for $service_name"
  fi
}

# Function to stop services by process name
stop_by_process_name() {
  local process_pattern="$1"
  local service_name="$2"
  
  local pids=$(pgrep -f "$process_pattern" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    log "Found running $service_name processes: $pids"
    for pid in $pids; do
      log "Stopping $service_name (PID: $pid)..."
      kill "$pid" 2>/dev/null
      sleep 1
      
      # Check if it's still running and force kill if necessary
      if kill -0 "$pid" 2>/dev/null; then
        warn "Process $pid still running, force killing..."
        kill -9 "$pid" 2>/dev/null
        sleep 1
      fi
    done
    success "All $service_name processes stopped"
  else
    log "No running $service_name processes found"
  fi
}

# Function to clean up lock files
cleanup_locks() {
  log "Cleaning up lock files..."
  rm -f "$PROJECT_DIR/shared-memory.json.lock"
  rm -f "$PROJECT_DIR/.coding-tools"/*.lock 2>/dev/null || true
  success "Lock files cleaned up"
}

log "Stopping CoPilot fallback services..."

# Stop services by PID files
stop_by_pid_file "$PROJECT_DIR/.coding-tools/fallback-services.pid" "Fallback Services"
stop_by_pid_file "$PROJECT_DIR/.coding-tools/http-server.pid" "HTTP Server"

# Stop any remaining processes by name
stop_by_process_name "start-fallback-services.js" "Fallback Services"
stop_by_process_name "start-http-server.js" "HTTP Server"
stop_by_process_name "copilot-http-server" "CoPilot HTTP Server"

# Stop browser processes (playwright)
stop_by_process_name "chromium.*--remote-debugging-port" "Browser Instances"

# Clean up lock files
cleanup_locks

# Verify all processes are stopped
log "Verifying all services are stopped..."
remaining_processes=$(ps aux | grep -E "(start-fallback-services|start-http-server|copilot-http-server)" | grep -v grep || true)

if [ -n "$remaining_processes" ]; then
  warn "Some processes may still be running:"
  echo "$remaining_processes"
  exit 1
else
  success "All CoPilot fallback services stopped successfully"
fi

log "CoPilot services cleanup complete"