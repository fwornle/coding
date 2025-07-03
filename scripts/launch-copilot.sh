#!/bin/bash

# Launch CoPilot with fallback services

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Color definitions
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log() {
  echo -e "${BLUE}[CoPilot]${NC} $1"
}

colored_log() {
  echo -e "$1"
}

# Set environment variables
export CODING_AGENT="copilot"
export CODING_TOOLS_PATH="$PROJECT_DIR"
export CODING_TOOLS_GRAPH_DB="$HOME/.coding-tools/memory.graph"

# Enable Graphology service for SynchronizationAgent integration
export GRAPHOLOGY_SERVICE_ENABLED=true
export GRAPHOLOGY_SERVICE_PORT=8765

# Load environment configuration
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

if [ -f "$PROJECT_DIR/.env.ports" ]; then
  set -a
  source "$PROJECT_DIR/.env.ports"
  set +a
fi

# Start all services using new lifecycle management
log "Starting coding services for CoPilot..."

# Check if Node.js is available
if ! command -v node &> /dev/null; then
  log "Error: Node.js is required but not found in PATH"
  exit 1
fi

# Start services using the new lifecycle manager
if ! node "$PROJECT_DIR/lib/services/start-services.js" --agent copilot --verbose; then
  log "Error: Failed to start services"
  exit 1
fi

# Display colorful startup banner
echo ""
colored_log "${BLUE}🚀 Starting GitHub CoPilot with Knowledge Management Integration${NC}"
colored_log "${CYAN}📋 All services started successfully${NC}"

# Setup cleanup handler
cleanup() {
  colored_log "${CYAN}🧹 Stopping all services...${NC}"
  node "$PROJECT_DIR/lib/services/stop-services.js" --agent copilot --verbose
}

trap cleanup EXIT INT TERM

# Check if running in service-only mode
if [[ "$1" == "--service-only" ]]; then
  colored_log "${CYAN}🔧 Running in service-only mode for VSCode integration...${NC}"
  
  # Start HTTP server for VSCode extension
  cat > "$PROJECT_DIR/lib/start-http-server.js" << 'EOF'
#!/usr/bin/env node

import { CopilotHTTPServer } from './adapters/copilot-http-server.js';

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
  
  # Run the HTTP server and store PID
  node "$PROJECT_DIR/lib/start-http-server.js" &
  HTTP_PID=$!
  echo $HTTP_PID > "$PROJECT_DIR/.coding-tools/http-server.pid"
  wait $HTTP_PID
fi

# Check if CoPilot is available
if ! command -v gh &> /dev/null; then
  colored_log "${YELLOW}⚠️  Error: GitHub CLI (gh) not found. Please install it first.${NC}"
  exit 1
fi

if ! gh extension list | grep -q copilot; then
  colored_log "${YELLOW}⚠️  Error: GitHub CoPilot extension not installed.${NC}"
  colored_log "Install it with: ${CYAN}gh extension install github/gh-copilot${NC}"
  exit 1
fi

# Launch CoPilot
colored_log "${GREEN}🎯 GitHub CoPilot ready! Knowledge Management services running in background...${NC}"
colored_log ""
colored_log "${YELLOW}🔧 VSCode Extension Integration Available:${NC}"
colored_log "  • ${CYAN}@KM ukb${NC} - Update Knowledge Base (capture insights during chat)"
colored_log "  • ${CYAN}@KM vkb${NC} - View Knowledge Base (visualize knowledge graph)"
colored_log "  • ${CYAN}@KM search${NC} - Search knowledge for relevant patterns"
colored_log "  • ${CYAN}@KM stats${NC} - View knowledge base statistics"
colored_log ""
colored_log "${YELLOW}💡 Usage in VSCode CoPilot Chat:${NC}"
colored_log "  • Start questions with ${CYAN}@KM${NC} to use Knowledge Management"
colored_log "  • Example: ${CYAN}@KM ukb 'How do I handle async errors in React?'${NC}"
colored_log "  • Example: ${CYAN}@KM search 'logging patterns'${NC}"
colored_log ""
colored_log "${BLUE}🚀 Launching GitHub CoPilot CLI...${NC}"
exec gh copilot "$@"