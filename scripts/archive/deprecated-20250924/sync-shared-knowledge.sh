#!/bin/bash
# Auto-sync shared-memory.json to MCP memory server at startup
# This script creates sync operations that Claude Code will execute automatically

set -euo pipefail

# Get the coding repo directory
if [[ -n "${CODING_REPO:-}" ]]; then
    CODING_REPO_DIR="$CODING_REPO"
else
    # Script is in scripts/ subdirectory, so parent is repo root
    CODING_REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

SHARED_MEMORY="$CODING_REPO_DIR/shared-memory.json"
SYNC_DIR="$CODING_REPO_DIR/.mcp-sync"
SYNC_SCRIPT="$SYNC_DIR/auto-sync.md"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Create sync directory
mkdir -p "$SYNC_DIR"

# Check if shared memory exists
if [[ ! -f "$SHARED_MEMORY" ]]; then
    echo -e "${YELLOW}⚠️  No shared-memory.json found - skipping knowledge sync${NC}"
    exit 0
fi

# Count entities and relations
entity_count=$(jq '.entities | length' "$SHARED_MEMORY" 2>/dev/null || echo "0")
relation_count=$(jq '.relations | length' "$SHARED_MEMORY" 2>/dev/null || echo "0")

if [[ "$entity_count" -eq 0 && "$relation_count" -eq 0 ]]; then
    echo -e "${YELLOW}⚠️  Empty knowledge base - skipping sync${NC}"
    exit 0
fi

echo -e "${BLUE}🔄 Preparing MCP memory sync ($entity_count entities, $relation_count relations)${NC}"

# Create sync operations file that Claude will execute
cat > "$SYNC_SCRIPT" << 'EOF'
# MCP Memory Auto-Sync Operations

This file contains automatic sync operations to load shared-memory.json into the MCP memory server.

## Sync Instructions for Claude Code

Please execute these MCP memory operations to sync the knowledge base:

### 1. Load All Entities

```typescript
// Execute this operation to load all entities from shared-memory.json
const entities = JSON.parse(await fs.readFile('shared-memory.json', 'utf8')).entities;

for (const entity of entities) {
  await mcp__memory__create_entities([{
    name: entity.name,
    entityType: entity.entityType,
    observations: entity.observations || [entity.content || ""],
    metadata: {
      significance: entity.significance,
      created: entity.created,
      project: entity.project,
      documentation_link: entity.documentation_link
    }
  }]);
}
```

### 2. Load All Relations

```typescript
// Execute this operation to load all relationships
const relations = JSON.parse(await fs.readFile('shared-memory.json', 'utf8')).relations;

for (const relation of relations) {
  await mcp__memory__create_relations([{
    from: relation.from,
    to: relation.to,
    relationType: relation.relationType
  }]);
}
```

### 3. Verify Sync

```typescript
// Verify the sync completed successfully
const graphState = await mcp__memory__read_graph();
console.log(`✅ MCP Memory loaded: ${graphState.nodes?.length || 0} entities, ${graphState.edges?.length || 0} relations`);
```

## Current Knowledge Base Summary

EOF

# Add current knowledge base summary to sync file
echo "**Entities to sync:** $entity_count" >> "$SYNC_SCRIPT"
echo "**Relations to sync:** $relation_count" >> "$SYNC_SCRIPT"
echo "" >> "$SYNC_SCRIPT"

# Add key patterns summary
echo "**Key Patterns Available:**" >> "$SYNC_SCRIPT"
jq -r '.entities[] | select(.entityType == "TransferablePattern" or .entityType == "WorkflowPattern" or .entityType == "TransferableKnowledge") | "- \(.name) (significance: \(.significance))"' "$SHARED_MEMORY" 2>/dev/null | head -10 >> "$SYNC_SCRIPT"

echo "" >> "$SYNC_SCRIPT"
echo "**Sync prepared at:** $(date)" >> "$SYNC_SCRIPT"

echo -e "${GREEN}✅ MCP sync operations prepared at: $SYNC_SCRIPT${NC}"
echo -e "${BLUE}💡 Claude Code will auto-execute these operations on startup${NC}"

# Create a simple sync trigger file for Claude to detect
cat > "$SYNC_DIR/sync-required.json" << EOF
{
  "sync_required": true,
  "entity_count": $entity_count,
  "relation_count": $relation_count,
  "prepared_at": "$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")",
  "shared_memory_path": "$SHARED_MEMORY",
  "sync_script_path": "$SYNC_SCRIPT"
}
EOF

echo -e "${GREEN}🔔 Sync trigger created - Claude will detect and execute automatically${NC}"