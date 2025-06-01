#!/bin/bash

# Export Live MCP Memory to JSON
# This script exports the current live MCP memory data to memory.json format

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Output file
OUTPUT_FILE="$1"
if [ -z "$OUTPUT_FILE" ]; then
    OUTPUT_FILE="/Users/q284340/Agentic/memory-visualizer/dist/memory.json"
fi

echo -e "${BLUE}🔄 Exporting live MCP memory data...${NC}"
echo -e "${BLUE}📄 Output: $OUTPUT_FILE${NC}"

# This script needs to be called from within a Claude Code session with MCP access
# The actual export will be done by Claude Code using MCP tools

echo "EXPORT_LIVE_MEMORY_TO:$OUTPUT_FILE"
echo -e "${GREEN}✅ Export request prepared${NC}"
echo -e "${YELLOW}💡 This script signals Claude Code to export live MCP memory${NC}"