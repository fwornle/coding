#!/bin/bash

# Stop coding services script
# Graceful shutdown of all live logging and service processes

set -e

echo "🛑 Stopping Coding Services..."

# Function to gracefully stop a process
stop_process() {
    local pid=$1
    local name=$2
    local timeout=${3:-10}
    
    if [ -n "$pid" ] && [ "$pid" != "stdio" ] && ps -p "$pid" > /dev/null 2>&1; then
        echo "🔴 Stopping $name (PID: $pid)..."
        
        # Send SIGTERM first
        kill -TERM "$pid" 2>/dev/null || true
        
        # Wait for graceful shutdown
        for i in $(seq 1 $timeout); do
            if ! ps -p "$pid" > /dev/null 2>&1; then
                echo "✅ $name stopped gracefully"
                return 0
            fi
            sleep 1
        done
        
        # Force kill if still running
        echo "⚠️ $name not responding, force killing..."
        kill -KILL "$pid" 2>/dev/null || true
        echo "✅ $name force stopped"
    else
        echo "ℹ️ $name not running"
    fi
}

# Read current services if available
SERVICES_FILE=".services-running.json"
if [ -f "$SERVICES_FILE" ]; then
    echo "📋 Reading current services from $SERVICES_FILE"
    
    # Extract PIDs using simple parsing
    TRANSCRIPT_PID=$(grep -o '"transcript-monitor": [0-9]*' "$SERVICES_FILE" 2>/dev/null | cut -d: -f2 | tr -d ' ' || echo "")
    LIVE_LOGGING_PID=$(grep -o '"live-logging": [0-9]*' "$SERVICES_FILE" 2>/dev/null | cut -d: -f2 | tr -d ' ' || echo "")
    VKB_PID=$(grep -o '"vkb-server": [0-9]*' "$SERVICES_FILE" 2>/dev/null | cut -d: -f2 | tr -d ' ' || echo "")
    
    # Stop services gracefully
    stop_process "$TRANSCRIPT_PID" "Transcript Monitor" 15
    stop_process "$LIVE_LOGGING_PID" "Live Logging Coordinator" 10
    stop_process "$VKB_PID" "VKB Server" 10
else
    echo "⚠️ No services file found, using process name search"
fi

# Additional cleanup - search by process name
echo "🧹 Additional process cleanup..."

# Kill by process name patterns
pkill -f "transcript-monitor.js" 2>/dev/null && echo "✅ Killed remaining transcript monitors" || echo "ℹ️ No transcript monitors found"
pkill -f "start-live-logging.js" 2>/dev/null && echo "✅ Killed remaining live-logging coordinators" || echo "ℹ️ No live-logging coordinators found"
pkill -f "live-logging-coordinator.js" 2>/dev/null && echo "✅ Killed remaining live-logging processes" || echo "ℹ️ No live-logging processes found"
pkill -f "statusline-health-monitor.js" 2>/dev/null && echo "✅ Killed remaining health monitors" || echo "ℹ️ No health monitors found"
pkill -f "health-verifier.js" 2>/dev/null && echo "✅ Killed health verifier" || echo "ℹ️ No health verifier found"
pkill -f "vkb.*server" 2>/dev/null && echo "✅ Killed remaining VKB servers" || echo "ℹ️ No VKB servers found"

# Clean up port conflicts
echo "🔌 Checking for port conflicts..."
for port in 8080 8001; do
    if lsof -i :$port >/dev/null 2>&1; then
        local pid=$(lsof -t -i :$port 2>/dev/null || echo "")
        if [ -n "$pid" ]; then
            echo "🔥 Killing process on port $port (PID: $pid)"
            kill -9 "$pid" 2>/dev/null || true
        fi
    fi
done

# Log shutdown
echo "$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ") - Services stopped" >> logs/live-logging.log

# Remove services tracking file
if [ -f "$SERVICES_FILE" ]; then
    rm "$SERVICES_FILE"
    echo "🗑️ Removed services tracking file"
fi

# Show final status
echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "🛑 SERVICES SHUTDOWN COMPLETE"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""
echo "✅ All coding services stopped"
echo "📝 Shutdown logged to live-logging.log"
echo ""
echo "To restart services, run: ./start-services.sh or coding"
echo "═══════════════════════════════════════════════════════════════════════"