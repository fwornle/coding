# CLAUDE.md - Claude Code Instructions

This file provides essential guidance to Claude Code when working in this repository.

## 🚨 CRITICAL: AUTO-SYNC KNOWLEDGE BASE TO MCP MEMORY

**IMPORTANT**: Every time you start a `claude-mcp` session, you MUST automatically load the knowledge base into MCP memory by executing the sync operations:

1. **Check for sync trigger**: Look for `.mcp-sync/sync-required.json`
2. **If sync required**: Execute the following MCP operations automatically
3. **Load entities**: Use `mcp__memory__create_entities` with data from shared-memory.json
4. **Load relations**: Use `mcp__memory__create_relations` with relationship data
5. **Verify sync**: Use `mcp__memory__read_graph` to confirm successful loading
6. **Apply patterns**: Query and apply critical patterns immediately

**AUTO-SYNC PROCEDURE**: 
```typescript
// 1. Check if sync is required
const syncPath = process.env.CODING_TOOLS_PATH + '/.mcp-sync/sync-required.json';
if (fileExists(syncPath)) {
  const syncInfo = JSON.parse(readFile(syncPath));
  console.log(`🔄 Auto-syncing ${syncInfo.entity_count} entities, ${syncInfo.relation_count} relations`);
  
  // 2. Load high-priority entities first (enhanced structure support)
  const sharedMemory = JSON.parse(readFile(process.env.CODING_KNOWLEDGE_BASE));
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
  
  // 3. Load remaining entities
  const remainingEntities = sharedMemory.entities
    .filter(e => (e.significance < 8 && e.entityType !== 'WorkflowPattern'))
    .map(entity => ({
      name: entity.name,
      entityType: entity.entityType,
      observations: entity.observations || [`${entity.entityType}: ${entity.name}`]
    }));
  
  await mcp__memory__create_entities({ entities: remainingEntities });
  
  // 4. Load relations
  await mcp__memory__create_relations({ relations: sharedMemory.relations });
  
  // 5. Verify and apply critical patterns
  const graph = await mcp__memory__read_graph();
  console.log(`✅ Knowledge base synced: ${graph.nodes?.length} entities, ${graph.edges?.length} relations`);
  
  // 6. Query and apply critical patterns
  const criticalPatterns = ['ConditionalLoggingPattern', 'ReduxStateManagementPattern', 'ClaudeCodeStartupPattern'];
  for (const pattern of criticalPatterns) {
    const result = await mcp__memory__search_nodes(pattern);
    if (result?.nodes?.length > 0) {
      console.log(`✅ Pattern loaded: ${pattern}`);
    }
  }
  
  // 7. Remove sync trigger
  unlinkFile(syncPath);
}
```

**WHY THIS MATTERS**: Without this sync, Claude sessions cannot access the accumulated knowledge from previous sessions, making the cross-session learning system ineffective.

## 🔴 CRITICAL: AUTOMATIC CONVERSATION LOGGING

**STATUS**: ✅ **WORKING** - Post-session conversation logging is now fully functional.

**HOW IT WORKS**: 
- `claude-mcp` automatically starts conversation logging via `post-session-logger.js`
- **Post-session capture**: After each Claude session ends, the logger processes the session data
- **Session analysis**: The logger analyzes conversation content and extracts meaningful exchanges
- **Smart routing**: Content is intelligently analyzed and routed to appropriate `.specstory/history/` directories
- **Coding-related content** (ukb, vkb, knowledge management, MCP, etc.) always goes to `coding/.specstory/history/`
- **Other content** goes to the current project's `.specstory/history/`

**TECHNICAL IMPLEMENTATION**:
```bash
# Post-session logging triggered after Claude session ends
node /path/to/post-session-logger.js
```

**KEY FEATURES**:
- Post-session conversation capture and processing
- No manual intervention required
- Content-aware logging (coding vs. project-specific)  
- Cross-project knowledge management preservation
- Intelligent exchange detection and formatting
- Automatic conversation classification and routing
- Session completion logging with timestamped files

**ARCHITECTURE**: Post-session logging processes completed Claude sessions to extract and save conversations, ensuring all valuable interactions are preserved for future reference.

## 🚨 CRITICAL: How to Start Claude Code

**ALWAYS** start Claude Code using the `claude-mcp` command:
```bash
claude-mcp
```

**NEVER** use `claude code` directly - it won't have MCP features!

## 🚨 CRITICAL: Knowledge Base Management Rule

**IMPORTANT: The shared-memory.json knowledge base must ALWAYS be updated using the `ukb` command. Never edit this file directly. The ukb tool ensures proper formatting, validation, and synchronization with MCP memory.**

### 🔧 Knowledge Base Update Methods

**When updating the knowledge base from conversation insights:**

1. **For simple entities:** Use direct command line or piped input with `ukb --interactive`
2. **For complex insights:** Use the piped input method with `ukb --interactive` (9-line format)
3. **For automated analysis:** Use the `claude-conversation-analyzer.js` script

#### Method 1: Direct Command Line (Simple Entities)
```bash
# Direct command line approach
ukb --add-entity --name "EntityName" --type "WorkflowPattern" --significance 5 --observation "Description"
```

#### Method 2: Piped Input for Interactive UKB (Simple Entities)
```bash
# Simple entity creation (2-4 lines)
echo "EntityName
WorkflowPattern
5
Optional observation" | ukb --interactive
```

#### Method 3: Piped Input for Complex Insights (9-line format)
```bash
# Create input file with responses (EXACTLY 9 lines required)
cat > /tmp/ukb-input.txt << 'EOF'
Problem description here
Solution description here  
Rationale for approach
Key learnings
Applicability
Technologies,comma,separated
https://reference-urls.com
code-file1.js,code-file2.js
8
EOF

# Pipe to UKB interactive mode
ukb --interactive < /tmp/ukb-input.txt
```

#### Method 4: Automated Conversation Analysis
```bash
# Use the conversation analyzer script
node scripts/claude-conversation-analyzer.js
```

**🚨 CRITICAL SUCCESS PATTERNS**:
- **READ ERROR MESSAGES**: When ukb --interactive fails, the error shows EXACTLY what format to use!
- **For complex insights**: ALWAYS use Method 3 (9-line format) - this is the most reliable approach
- **Never skip lines**: Each line must have content  
- **Exact format**: Line 9 must be significance number only (1-10)
- **Use piped input**: Much more reliable than typing manually
- **Stop struggling**: The error message tells you the format - follow it exactly!

**WORKING EXAMPLE** (copy this pattern):
```bash
cat > /tmp/insight.txt << 'EOF'
VKB CLI Refactoring: Node.js server management
Complete refactoring to modular Node.js architecture  
Follows UKB pattern for better maintainability
Modular architecture improves maintainability significantly  
Pattern applies to other complex bash script refactoring
Node.js,Commander.js,Architecture
https://github.com/tj/commander.js/
lib/vkb-server/index.js,lib/vkb-server/cli.js
8
EOF

ukb --interactive < /tmp/insight.txt
```

## 🔍 CRITICAL: Pattern Verification and Compliance

**MANDATORY**: At the start of every session and before committing code, verify pattern compliance:

### Pattern Compliance Checklist

1. **ConditionalLoggingPattern**
   - ❌ NEVER use `console.log`
   - ✅ ALWAYS use `Logger.log(level, category, message)`
   - Verify: `grep -r "console\.log" --include="*.js" --include="*.ts" .`

2. **ReduxStateManagementPattern** (React projects)
   - ❌ NEVER use `useState` for complex state
   - ✅ ALWAYS use Redux slices with typed hooks
   - Verify: `grep -r "useState" --include="*.tsx" --include="*.jsx" .`

3. **Enhanced Entity Structure** (Knowledge Management)
   - ❌ NEVER create flat observation arrays
   - ✅ ALWAYS use structured observations with types
   - Example:
     ```json
     "observations": [
       {"type": "problem", "content": "...", "date": "..."},
       {"type": "solution", "content": "...", "date": "..."},
       {"type": "metric", "content": "...", "date": "..."}
     ]
     ```

### Pattern Verification Tools

```bash
# Run pattern verification
./knowledge-management/scripts/verify-patterns.sh

# Migrate entities to enhanced format
ukb --migrate

# Capture structured insights
ukb --interactive
```

### Code Snippet Embedding

When capturing patterns, always include code examples:
```javascript
// Pattern implementation example
const pattern = {
  solution: {
    code_example: "actual working code here"
  }
};
```

## Why This Matters

Starting with `claude-mcp`:
- ✅ Enables MCP memory server (persistent knowledge graph)
- ✅ Enables automatic conversation logging to `.specstory/history/`
- ✅ Enables browser automation tools
- ✅ Provides access to `ukb` and `vkb` commands via MCP
- ✅ Maintains cross-session knowledge persistence

## Key Commands

### Knowledge Management
```bash
# Update knowledge base - captures insights
ukb           # Auto mode (analyzes git commits)
ukb --interactive  # Manual deep insight capture

# View knowledge base - web visualization
vkb           # Opens localhost:8080
```

### Development
```bash
# Install/update the system
./install.sh

# Update MCP configuration after changes
./install.sh --update-mcp-config

# Activate commands in current shell
source .activate
```

## Architecture Overview

### Knowledge Flow
1. **Project Insights** → Captured by `ukb`
2. **MCP Memory** → Runtime knowledge graph storage
3. **shared-memory.json** → Git-tracked persistent storage

### Auto-Logging  
- ✅ **WORKING**: Post-session logging via `post-session-logger.js`
- Smart content routing to appropriate projects
- Post-session conversation capture and processing

### MCP Configuration
- Template: `claude-code-mcp.json` (with placeholders)
- Processed: `claude-code-mcp-processed.json` (with actual paths)
- Location: Also copied to Claude app config directory

## Important Files

- `shared-memory.json` - Knowledge base (git-tracked)
- `.specstory/history/` - Conversation logs
- `knowledge-management/` - Scripts and insights
- `docs/` - Comprehensive documentation

## Team Collaboration

This system is designed for team use:
- Use `./install.sh` to set up on any machine
- Knowledge base syncs via git
- All paths use placeholders for portability

## Remember

1. **Always use `claude-mcp` to start Claude Code**
2. **Run `ukb` regularly to capture insights**
3. **Check `.specstory/history/` for past conversations**
4. **The MCP memory persists across sessions when started correctly**
5. **Post-session logging is now working** - conversations are automatically saved after sessions complete