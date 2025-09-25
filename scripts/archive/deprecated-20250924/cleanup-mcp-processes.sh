#!/bin/bash

# Cleanup MCP Processes Script
# Kills all accumulated MCP server processes that may be left running

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🧹 Cleaning up accumulated MCP processes...${NC}"

# Function to count and display processes before cleanup
count_processes() {
    local browser_count=$(ps aux | grep -c "browser-access/dist/index.js" | grep -v grep || echo "0")
    local memory_count=$(ps aux | grep -c "mcp-server-memory" | grep -v grep || echo "0") 
    local semantic_count=$(ps aux | grep -c "semantic-analysis-system/mcp-server" | grep -v grep || echo "0")
    
    # Subtract 1 from each count to account for the grep process itself
    browser_count=$((browser_count > 0 ? browser_count - 1 : 0))
    memory_count=$((memory_count > 0 ? memory_count - 1 : 0))
    semantic_count=$((semantic_count > 0 ? semantic_count - 1 : 0))
    
    echo -e "${YELLOW}📊 Found processes:${NC}"
    echo -e "  • Browser-access: $browser_count processes"
    echo -e "  • Memory server: $memory_count processes"
    echo -e "  • Semantic analysis: $semantic_count processes"
    
    total=$((browser_count + memory_count + semantic_count))
    echo -e "  • Total MCP processes: $total"
    
    return $total
}

# Count existing processes
count_processes
total_found=$?

if [ $total_found -eq 0 ]; then
    echo -e "${GREEN}✅ No MCP processes found running${NC}"
    exit 0
fi

echo -e "\n${BLUE}🔄 Terminating MCP processes...${NC}"

# Graceful termination first
echo -e "${BLUE}  ➤ Attempting graceful shutdown...${NC}"
pkill -TERM -f "mcp-server-memory" 2>/dev/null || true
pkill -TERM -f "browser-access/dist/index.js" 2>/dev/null || true  
pkill -TERM -f "semantic-analysis-system/mcp-server" 2>/dev/null || true

# Give processes time to shutdown gracefully
echo -e "${BLUE}  ➤ Waiting for graceful shutdown...${NC}"
sleep 3

# Force kill any remaining processes
echo -e "${BLUE}  ➤ Force killing remaining processes...${NC}"
pkill -9 -f "mcp-server-memory" 2>/dev/null || true
pkill -9 -f "browser-access/dist/index.js" 2>/dev/null || true
pkill -9 -f "semantic-analysis-system/mcp-server" 2>/dev/null || true

# Wait a moment for system cleanup
sleep 1

# Count remaining processes
echo -e "\n${BLUE}📊 Post-cleanup process count:${NC}"
count_processes
remaining=$?

if [ $remaining -eq 0 ]; then
    echo -e "\n${GREEN}✅ All MCP processes successfully cleaned up!${NC}"
    echo -e "${GREEN}   Cleaned up $total_found processes${NC}"
else
    echo -e "\n${YELLOW}⚠️  Warning: $remaining MCP processes may still be running${NC}"
    echo -e "${YELLOW}   You may need to check manually with: ps aux | grep -E '(browser-access|mcp-server)'${NC}"
fi

# Optional: Clean up any orphaned temp files
echo -e "\n${BLUE}🗑️  Cleaning up temporary files...${NC}"
rm -f /tmp/claude-conversation-*.json 2>/dev/null || true
rm -f /tmp/mcp-*.tmp 2>/dev/null || true

echo -e "${GREEN}✅ MCP process cleanup completed${NC}"