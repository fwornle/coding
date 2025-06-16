#!/bin/bash

# Launch CoPilot with fallback services

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

log() {
  echo "[CoPilot] $1"
}

# Set environment variables
export CODING_AGENT="copilot"
export CODING_TOOLS_PATH="$PROJECT_DIR"
export CODING_TOOLS_GRAPH_DB="$HOME/.coding-tools/memory.graph"

# Start fallback services
log "Starting fallback services..."

# Create a service manager script
SERVICE_SCRIPT="$PROJECT_DIR/lib/start-fallback-services.js"

if [ ! -f "$SERVICE_SCRIPT" ]; then
  log "Creating fallback services manager..."
  cat > "$SERVICE_SCRIPT" << 'EOF'
#!/usr/bin/env node

const { CoPilotAdapter } = require('./adapters/copilot');

async function startServices() {
  try {
    console.log('Initializing CoPilot fallback services...');
    
    const adapter = new CoPilotAdapter();
    await adapter.initialize();
    
    console.log('✓ All fallback services started successfully');
    console.log('Services running in background...');
    
    // Keep the process alive
    process.on('SIGINT', async () => {
      console.log('\nShutting down fallback services...');
      await adapter.cleanup();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('\nShutting down fallback services...');
      await adapter.cleanup();
      process.exit(0);
    });
    
    // Keep alive
    setInterval(() => {}, 1000);
    
  } catch (error) {
    console.error('Failed to start fallback services:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  startServices();
}

module.exports = { startServices };
EOF
  chmod +x "$SERVICE_SCRIPT"
fi

# Start the services in background
node "$SERVICE_SCRIPT" &
FALLBACK_PID=$!

# Store PID for cleanup
echo $FALLBACK_PID > "$PROJECT_DIR/.coding-tools/fallback-services.pid"

# Ensure cleanup on exit
cleanup() {
  log "Cleaning up fallback services..."
  if [ -n "$FALLBACK_PID" ]; then
    kill $FALLBACK_PID 2>/dev/null || true
  fi
  rm -f "$PROJECT_DIR/.coding-tools/fallback-services.pid"
}

trap cleanup EXIT INT TERM

# Give services time to start
sleep 2

# Check if running in service-only mode
if [[ "$1" == "--service-only" ]]; then
  log "Running in service-only mode for VSCode integration..."
  
  # Start HTTP server for VSCode extension
  cat > "$PROJECT_DIR/lib/start-http-server.js" << 'EOF'
#!/usr/bin/env node

const { CopilotHTTPServer } = require('./adapters/copilot-http-server');

async function startHTTPServer() {
  try {
    const port = process.env.FALLBACK_SERVICE_PORT || 8765;
    const server = new CopilotHTTPServer(port);
    await server.start();
    
    console.log(`✓ HTTP server started on port ${port}`);
    
    // Handle shutdown
    process.on('SIGINT', async () => {
      console.log('\nShutting down HTTP server...');
      await server.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('\nShutting down HTTP server...');
      await server.stop();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Failed to start HTTP server:', error.message);
    process.exit(1);
  }
}

startHTTPServer();
EOF
  
  # Run the HTTP server
  exec node "$PROJECT_DIR/lib/start-http-server.js"
fi

# Check if CoPilot is available
if ! command -v gh &> /dev/null; then
  log "Error: GitHub CLI (gh) not found. Please install it first."
  exit 1
fi

if ! gh extension list | grep -q copilot; then
  log "Error: GitHub CoPilot extension not installed."
  log "Install it with: gh extension install github/gh-copilot"
  exit 1
fi

# Launch CoPilot
log "Launching GitHub CoPilot..."
exec gh copilot "$@"