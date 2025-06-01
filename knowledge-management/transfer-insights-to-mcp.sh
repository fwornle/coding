#!/bin/bash

# Transfer Insights to MCP Script
# Transfers locally stored insights to MCP memory graph

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Directories
INSIGHTS_DIR="$HOME/Claude/knowledge-management/insights"
RELATIONS_DIR="$HOME/Claude/knowledge-management/relations"

echo -e "${BLUE}🔄 Transferring insights to MCP memory graph...${NC}"

# Check if insights directory exists
if [ ! -d "$INSIGHTS_DIR" ]; then
    echo -e "${YELLOW}⚠️  No insights directory found - nothing to transfer${NC}"
    exit 0
fi

# Count insights to transfer
INSIGHT_COUNT=$(find "$INSIGHTS_DIR" -name "*.json" | wc -l)
if [ "$INSIGHT_COUNT" -eq 0 ]; then
    echo -e "${YELLOW}⚠️  No insights found to transfer${NC}"
    exit 0
fi

echo -e "${GREEN}📊 Found $INSIGHT_COUNT insights to transfer${NC}"

# Process each insight file
for insight_file in "$INSIGHTS_DIR"/*.json; do
    if [ -f "$insight_file" ]; then
        insight_name=$(basename "$insight_file" .json)
        echo -e "${BLUE}📝 Processing: $insight_name${NC}"
        
        # Extract data from JSON file
        name=$(jq -r '.name' "$insight_file")
        entity_type=$(jq -r '.entityType' "$insight_file")
        observations=$(jq -r '.observations[]' "$insight_file")
        
        echo -e "${GREEN}  ✓ Creating MCP entity: $name${NC}"
        # The actual MCP transfer will be done by the calling Claude Code session
        echo "INSIGHT_TRANSFER:$insight_file"
    fi
done

# Process relations if they exist
if [ -f "$RELATIONS_DIR/pending_relations.csv" ]; then
    echo -e "${BLUE}🔗 Processing relations...${NC}"
    while IFS=',' read -r from relation_type to; do
        echo -e "${GREEN}  ✓ Creating relation: $from $relation_type $to${NC}"
        echo "RELATION_TRANSFER:$from,$relation_type,$to"
    done < "$RELATIONS_DIR/pending_relations.csv"
fi

echo -e "${GREEN}✅ Insight transfer preparation complete${NC}"
echo -e "${YELLOW}💡 Claude Code session will now process these transfers${NC}"