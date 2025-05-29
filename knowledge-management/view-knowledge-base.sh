#!/bin/bash

# Memory Visualizer Launcher for Coding Knowledge Base
# This script launches the memory-visualizer with the MCP memory data

# Configuration
MEMORY_JSON="/Users/q284340/.npm/_npx/15b07286cbcc3329/node_modules/@modelcontextprotocol/server-memory/dist/memory.json"
VISUALIZER_DIR="/Users/q284340/Agentic/memory-visualizer/dist"
PORT=8080

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}           Coding Knowledge Base Visualizer${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# Check if memory.json exists
if [ ! -f "$MEMORY_JSON" ]; then
    echo -e "${YELLOW}Warning: memory.json not found at expected location${NC}"
    echo "Looking for alternative locations..."
    
    # Try to find memory.json
    FOUND_MEMORY=$(find ~/.npm/_npx -name "memory.json" -path "*/server-memory/*" 2>/dev/null | head -1)
    
    if [ -n "$FOUND_MEMORY" ]; then
        MEMORY_JSON="$FOUND_MEMORY"
        echo -e "${GREEN}Found memory.json at: $MEMORY_JSON${NC}"
    else
        echo -e "${YELLOW}No memory.json found. The MCP server may not be initialized.${NC}"
        exit 1
    fi
fi

# Check if visualizer exists
if [ ! -d "$VISUALIZER_DIR" ]; then
    echo -e "${YELLOW}Error: Memory visualizer not found at $VISUALIZER_DIR${NC}"
    exit 1
fi

# Copy memory.json to visualizer directory (if needed by the app)
echo -e "${GREEN}Preparing data...${NC}"
cp "$MEMORY_JSON" "$VISUALIZER_DIR/memory.json" 2>/dev/null || true

# Change to visualizer directory
cd "$VISUALIZER_DIR"

# Check if a simple HTTP server is already running on the port
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}Port $PORT is already in use. Trying port $((PORT + 1))...${NC}"
    PORT=$((PORT + 1))
fi

# Start a simple HTTP server
echo -e "${GREEN}Starting visualizer on http://localhost:$PORT${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop the server${NC}"
echo ""

# Try Python 3 first, then Python 2, then fallback to other options
if command -v python3 &> /dev/null; then
    echo -e "${BLUE}Using Python 3 HTTP server...${NC}"
    python3 -m http.server $PORT
elif command -v python &> /dev/null; then
    echo -e "${BLUE}Using Python 2 SimpleHTTPServer...${NC}"
    python -m SimpleHTTPServer $PORT
elif command -v npx &> /dev/null; then
    echo -e "${BLUE}Using npx http-server...${NC}"
    npx -y http-server -p $PORT
else
    echo -e "${YELLOW}No suitable HTTP server found. Please install Python or Node.js.${NC}"
    exit 1
fi