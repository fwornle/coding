#!/bin/bash
# Sync shared knowledge base to MCP memory at Claude Code startup

set -euo pipefail

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_REPO="$(dirname "$SCRIPT_DIR")"
SHARED_MEMORY="$CLAUDE_REPO/shared-memory.json"

# Create MCP sync instructions file
MCP_SYNC_FILE="/tmp/claude-mcp-sync-$(date +%s).md"

cat > "$MCP_SYNC_FILE" << 'EOF'
# MCP Memory Initialization

Please synchronize the MCP memory with the shared knowledge base by:

1. Loading all entities from `~/Agentic/coding/shared-memory.json`
2. Ensuring critical patterns are available:
   - ClaudeCodeStartupPattern
   - TransferablePatterns
   - WorkflowPatterns
   - All cross-project knowledge

This ensures consistent knowledge across all projects.
EOF

# Extract key patterns for quick reference
if [[ -f "$SHARED_MEMORY" ]]; then
    echo -e "${BLUE}📊 Analyzing shared knowledge base...${NC}"
    
    # Count different types of knowledge
    pattern_count=$(jq '[.entities[] | select(.entityType | contains("Pattern"))] | length' "$SHARED_MEMORY" 2>/dev/null || echo "0")
    insight_count=$(jq '[.entities[] | select(.entityType == "CodingInsight")] | length' "$SHARED_MEMORY" 2>/dev/null || echo "0")
    workflow_count=$(jq '[.entities[] | select(.entityType == "WorkflowPattern")] | length' "$SHARED_MEMORY" 2>/dev/null || echo "0")
    
    echo -e "${GREEN}Found:${NC}"
    echo -e "  • ${pattern_count} transferable patterns"
    echo -e "  • ${insight_count} coding insights"
    echo -e "  • ${workflow_count} workflow patterns"
    
    # Create a summary of critical knowledge
    cat >> "$MCP_SYNC_FILE" << EOF

## Critical Knowledge Summary

### Transferable Patterns
$(jq -r '.entities[] | select(.entityType | contains("Pattern")) | "- **\(.name)**: \(.observations[0] // "No description")"' "$SHARED_MEMORY" 2>/dev/null | head -5)

### Workflow Patterns
$(jq -r '.entities[] | select(.entityType == "WorkflowPattern") | "- **\(.name)**: \(.observations[0] // "No description")"' "$SHARED_MEMORY" 2>/dev/null | head -5)

### Recent Insights
$(jq -r '.entities[] | select(.entityType == "CodingInsight") | "- **\(.name)**: \(.observations[0] // "No description")"' "$SHARED_MEMORY" 2>/dev/null | head -3)
EOF
    
    echo -e "${GREEN}✅ Knowledge summary prepared${NC}"
else
    echo -e "${YELLOW}⚠️  No shared knowledge base found${NC}"
fi

echo -e "${BLUE}📝 MCP sync instructions: $MCP_SYNC_FILE${NC}"

# Note: In a future version, this could directly call MCP operations
# For now, it prepares the context for Claude Code to load