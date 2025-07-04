# CLAUDE.md - Claude Code Instructions

This file provides essential guidance to Claude Code when working in this repository.

## 🚨 CRITICAL: MCP MEMORY KNOWLEDGE BASE ACCESS

**IMPORTANT**: The knowledge base is accessed through the MCP memory service, which provides an internal knowledge graph that automatically syncs with configured topic-specific files (shared-memory-*.json where * could be ui, resi, raas, coding, etc.).

**KNOWLEDGE BASE ARCHITECTURE**:
1. **MCP Memory Service**: Runtime knowledge graph storage and querying
2. **Topic-Specific Files**: shared-memory-coding.json, shared-memory-ui.json, etc. (git-tracked)
3. **Automatic Sync**: MCP memory automatically syncs with configured files
4. **Cross-Session Persistence**: Knowledge persists across Claude sessions

**HOW TO ACCESS KNOWLEDGE**:
```typescript
// Query existing patterns
const patterns = await mcp__memory__search_nodes("ConditionalLoggingPattern");

// Read full knowledge graph
const graph = await mcp__memory__read_graph();

// Create new knowledge entities
await mcp__memory__create_entities({
  entities: [{
    name: "NewPattern",
    entityType: "TransferablePattern",
    observations: ["Pattern description..."]
  }]
});
```

**WHY THIS MATTERS**: The MCP memory service provides immediate access to accumulated knowledge from previous sessions and automatically maintains sync with persistent storage files.

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

## 🚀 CRITICAL: Simplified Startup System

**🔴 AUTOMATIC STARTUP**: The coding services are **AUTOMATICALLY STARTED** when you run `coding` or `claude-mcp`! The system now uses a simple, reliable startup script.

**🚨 STARTUP PROCESS**:
1. **Simple Command**: Just run `coding` or `coding --claude`
2. **Automatic Service Start**: The system starts all required services automatically
3. **No Manual Intervention**: No need to check ports or start services manually

**✅ CORRECT WORKFLOW**:
```bash
# 1. Start coding session (this starts ALL services)
coding
# or
coding --claude
# or  
coding --copilot

# 2. In Claude, use MCP tools directly:
mcp__semantic-analysis__determine_insights(...)
```

**SYSTEM COMPONENTS**:
- VKB Server (port 8080) - Knowledge visualization
- MQTT broker (port 1883) - Message broker
- JSON-RPC server (port 8081) - Remote procedure calls
- MCP server (port 8082) - Model Context Protocol

**🔧 SIMPLE ARCHITECTURE**: The system uses `start-services.sh` for reliable service startup with automatic port conflict resolution.

## 🚨 CRITICAL: Working Directory and File Locations

**WORKING DIRECTORY**: Claude Code should ALWAYS start in the top-level project directory (`/Users/q284340/Agentic/coding`), NOT in subdirectories like `semantic-analysis-system`.

**CONVERSATION HISTORY**: 
- Location: `.specstory/history/` - ALWAYS in the top-level directory, never in subdirectories
- Format: **Markdown files (.md)**, NOT JSON
- Structure: Timestamped conversation logs in markdown format
- Purpose: Cross-session conversation persistence and analysis

**COMMON STARTUP ISSUES**:
- If you start in a subdirectory, you won't find `.specstory/history/` files
- Always check `pwd` and ensure you're in the correct root directory
- Remember: `.specstory/history/*.md` files are the conversation logs, not `.json`

**WHY THIS MATTERS**:
- Knowledge base files are in the root directory
- Conversation history is tracked at the project level
- Scripts and tools expect to run from the root directory

## 🚨 CRITICAL: Bash Command Timeout Configuration

**DEFAULT TIMEOUT**: Bash commands have a default timeout of 2 minutes (120000ms) which is TOO LONG for most operations.

**ALWAYS SPECIFY SHORTER TIMEOUTS**:
```javascript
// ✅ GOOD - Quick operations with appropriate timeouts
Bash({ command: "ps aux | grep node", timeout: 5000 })  // 5 seconds
Bash({ command: "curl localhost:8080", timeout: 3000 }) // 3 seconds

// ❌ BAD - Using default 2-minute timeout
Bash({ command: "semantic-analysis" })  // Will timeout after 2 minutes!
```

**TIMEOUT GUIDELINES**:
- Process checks: 1-5 seconds
- HTTP health checks: 2-5 seconds
- Service status: 3-5 seconds
- Quick commands: 5-10 seconds max
- Only use default timeout for intentionally long operations

**COMMON ISSUES**:
- Starting already-running services (causes 2-minute timeout)
- Health checks failing due to missing methods
- Not checking if services are already running before starting them

## 🚨 CRITICAL: Knowledge Base Management Rule

**IMPORTANT: The knowledge base is managed through MCP memory service and topic-specific shared-memory-*.json files. ALWAYS use the `ukb` command to update knowledge. Never edit the shared-memory files directly. The ukb tool ensures proper formatting, validation, and synchronization with MCP memory.**

### 🔴 MANDATORY: UKB Command Reference Check

**BEFORE ANY UKB COMMAND: ALWAYS check the UkbCli entity in the knowledge base for the complete command reference!**

```javascript
// Query UkbCli documentation before any ukb operation
const ukbDocs = await mcp__memory__search_nodes("UkbCli");
// OR read the insight file directly:
// /Users/q284340/Agentic/coding/knowledge-management/insights/UkbCli.md
```

**NEVER guess ukb commands or use trial-and-error!** The complete API reference is documented in:
- Knowledge base entity: `UkbCli`
- Insight file: `knowledge-management/insights/UkbCli.md`
- Section: "🚨 CRITICAL: Complete UKB Command Reference"

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

# Run semantic analysis from any directory
semantic-analysis
```

## Architecture Overview

### Knowledge Flow
1. **Project Insights** → Captured by `ukb`
2. **MCP Memory Service** → Runtime knowledge graph storage and querying
3. **Topic-Specific Files** → shared-memory-*.json files (git-tracked persistent storage)
4. **Automatic Sync** → MCP memory ↔ persistent files bidirectional sync

### Auto-Logging  
- ✅ **WORKING**: Post-session logging via `post-session-logger.js`
- Smart content routing to appropriate projects
- Post-session conversation capture and processing

### MCP Configuration
- Template: `claude-code-mcp.json` (with placeholders)
- Processed: `claude-code-mcp-processed.json` (with actual paths)
- Location: Also copied to Claude app config directory

## Important Files

- `shared-memory-*.json` - Topic-specific knowledge bases (git-tracked)
- **MCP Memory Service** - Runtime knowledge graph access
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