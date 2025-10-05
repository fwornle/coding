#!/bin/bash
# Enhanced sync script for shared knowledge with pattern verification

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Configuration
CODING_REPO_DIR="${CODING_TOOLS_PATH:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SHARED_MEMORY="$CODING_REPO_DIR/shared-memory.json"
SYNC_DIR="$CODING_REPO_DIR/.mcp-sync"
SYNC_REQUIRED_FILE="$SYNC_DIR/sync-required.json"
AUTO_SYNC_FILE="$SYNC_DIR/auto-sync.md"
PATTERN_CHECK_FILE="$SYNC_DIR/pattern-check.json"

# Ensure sync directory exists
mkdir -p "$SYNC_DIR"

# Check if shared memory exists
if [[ ! -f "$SHARED_MEMORY" ]]; then
    echo -e "${YELLOW}⚠️  No shared memory file found${NC}"
    exit 0
fi

# Create sync required indicator with enhanced info
echo -e "${BLUE}🔍 Analyzing knowledge base...${NC}"

# Get entity and relation counts
entity_count=$(jq '.entities | length' "$SHARED_MEMORY" 2>/dev/null || echo "0")
relation_count=$(jq '.relations | length' "$SHARED_MEMORY" 2>/dev/null || echo "0")

# Get high-priority patterns
high_priority_patterns=$(jq -r '.entities[] | select(.entityType == "TransferablePattern" and .significance >= 8) | {name, significance, problem: .problem.description}' "$SHARED_MEMORY" 2>/dev/null | jq -s '.')

# Get critical workflow patterns
workflow_patterns=$(jq -r '.entities[] | select(.entityType == "WorkflowPattern") | .name' "$SHARED_MEMORY" 2>/dev/null | jq -R -s 'split("\n") | map(select(length > 0))')

# Create enhanced sync required file
cat > "$SYNC_REQUIRED_FILE" << EOF
{
  "sync_required": true,
  "entity_count": $entity_count,
  "relation_count": $relation_count,
  "high_priority_patterns": $high_priority_patterns,
  "workflow_patterns": $workflow_patterns,
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "schema_version": "2.0.0"
}
EOF

# Create pattern verification checklist
cat > "$PATTERN_CHECK_FILE" << EOF
{
  "mandatory_checks": [
    {
      "pattern": "ConditionalLoggingPattern",
      "check": "Never use console.log",
      "verify_command": "grep -r 'console\\.log' --include='*.js' --include='*.ts' .",
      "fix": "Replace with Logger.log(level, category, message)"
    },
    {
      "pattern": "ReduxStateManagementPattern",
      "check": "Never use React.useState for complex state",
      "verify_command": "grep -r 'useState' --include='*.tsx' --include='*.jsx' .",
      "fix": "Use Redux slices with typed hooks"
    },
    {
      "pattern": "ClaudeCodeStartupPattern",
      "check": "Always query MCP memory at startup",
      "verify_command": "Check if MCP memory was queried",
      "fix": "Run mcp__memory__search_nodes for key patterns"
    }
  ],
  "recommended_patterns": $(jq -r '[.entities[] | select(.entityType == "TransferablePattern" and .significance >= 7) | {name, significance}]' "$SHARED_MEMORY")
}
EOF

# Generate enhanced auto-sync instructions
cat > "$AUTO_SYNC_FILE" << 'EOF'
# 🚨 AUTOMATIC KNOWLEDGE BASE SYNC REQUIRED 🚨

## CRITICAL: Execute these MCP operations immediately

### Step 1: Load all entities into MCP memory

```javascript
// Load high-priority patterns first
const syncData = require('.mcp-sync/sync-required.json');
const sharedMemory = require('shared-memory.json');

// Filter and load entities by priority
const highPriorityEntities = sharedMemory.entities
  .filter(e => e.significance >= 8 || e.entityType === 'WorkflowPattern')
  .map(entity => ({
    name: entity.name,
    entityType: entity.entityType,
    observations: entity.observations || [
      `Problem: ${entity.problem?.description || 'N/A'}`,
      `Solution: ${entity.solution?.approach || 'N/A'}`,
      `Significance: ${entity.significance}/10`
    ]
  }));

await mcp__memory__create_entities({ entities: highPriorityEntities });

// Then load remaining entities
const remainingEntities = sharedMemory.entities
  .filter(e => (e.significance < 8 && e.entityType !== 'WorkflowPattern'))
  .map(entity => ({
    name: entity.name,
    entityType: entity.entityType,
    observations: entity.observations || [`${entity.entityType}: ${entity.name}`]
  }));

await mcp__memory__create_entities({ entities: remainingEntities });
```

### Step 2: Load all relations

```javascript
await mcp__memory__create_relations({ relations: sharedMemory.relations });
```

### Step 3: Verify sync and apply patterns

```javascript
// Verify the sync worked
const graph = await mcp__memory__read_graph();
console.log(`✅ Synced ${graph.nodes?.length} entities, ${graph.edges?.length} relations`);

// Query critical patterns
const loggingPattern = await mcp__memory__search_nodes("ConditionalLoggingPattern");
const statePattern = await mcp__memory__search_nodes("ReduxStateManagementPattern");
const startupPattern = await mcp__memory__search_nodes("ClaudeCodeStartupPattern");

// Display pattern summaries
console.log("📌 Critical patterns loaded:");
[loggingPattern, statePattern, startupPattern].forEach(result => {
  if (result?.nodes?.length > 0) {
    console.log(`  ✅ ${result.nodes[0].name}`);
  }
});
```

### Step 4: Pattern compliance check

```javascript
// Run pattern verification
const patternChecks = require('.mcp-sync/pattern-check.json');
console.log("\n🔍 Running pattern compliance checks...");

patternChecks.mandatory_checks.forEach(check => {
  console.log(`\n${check.pattern}:`);
  console.log(`  Rule: ${check.check}`);
  console.log(`  Fix: ${check.fix}`);
});
```

## ⚠️ REMEMBER: Pattern Usage Rules

1. **ConditionalLoggingPattern**: NEVER use console.log
   ```javascript
   // ❌ BAD
   console.log('debug info');
   
   // ✅ GOOD
   Logger.log('debug', 'component', 'debug info');
   ```

2. **ReduxStateManagementPattern**: NEVER use useState for complex state
   ```javascript
   // ❌ BAD
   const [complexState, setComplexState] = useState({...});
   
   // ✅ GOOD
   const complexState = useSelector(selectComplexState);
   const dispatch = useDispatch();
   ```

3. **Knowledge Management**: NEVER edit shared-memory.json directly
   ```bash
   # ❌ BAD
   vim shared-memory.json
   
   # ✅ GOOD
   ukb --interactive  # or ukb --auto
   ```

## 📊 Knowledge Base Summary

EOF

# Append dynamic summary
cat >> "$AUTO_SYNC_FILE" << EOF
- **Total Entities**: $entity_count
- **Total Relations**: $relation_count
- **High Priority Patterns**: $(echo "$high_priority_patterns" | jq '. | length')
- **Workflow Patterns**: $(echo "$workflow_patterns" | jq '. | length')

### High Priority Patterns to Apply:
EOF

# List high priority patterns
jq -r '.[] | "- **\(.name)** (Significance: \(.significance)/10): \(.problem)"' <<< "$high_priority_patterns" >> "$AUTO_SYNC_FILE" 2>/dev/null

cat >> "$AUTO_SYNC_FILE" << 'EOF'

## 🎯 Session Goals

1. Apply all high-priority patterns immediately
2. Query MCP memory before implementing any solution
3. Use pattern verification to ensure compliance
4. Capture new insights with `ukb --interactive`

**Remember**: The knowledge base contains proven solutions. Use them!
EOF

echo -e "${GREEN}✅ Enhanced sync prepared with pattern verification${NC}"
echo -e "${BLUE}📊 Stats: $entity_count entities, $relation_count relations${NC}"
echo -e "${YELLOW}📌 High-priority patterns: $(echo "$high_priority_patterns" | jq '. | length')${NC}"

# Show critical patterns
echo -e "${CYAN}🔑 Critical patterns to remember:${NC}"
jq -r '.entities[] | select(.name == "ConditionalLoggingPattern" or .name == "ReduxStateManagementPattern" or .name == "ClaudeCodeStartupPattern") | "  • \(.name)"' "$SHARED_MEMORY" 2>/dev/null

# Create a session tracking file
SESSION_ID="session_$(date +%Y%m%d_%H%M%S)"
cat > "$SYNC_DIR/current-session.json" << EOF
{
  "session_id": "$SESSION_ID",
  "start_time": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "working_directory": "$(pwd)",
  "knowledge_base_stats": {
    "entities": $entity_count,
    "relations": $relation_count,
    "high_priority_patterns": $(echo "$high_priority_patterns" | jq '. | length')
  },
  "patterns_applied": [],
  "insights_captured": []
}
EOF

echo -e "${GREEN}🆔 Session ID: $SESSION_ID${NC}"