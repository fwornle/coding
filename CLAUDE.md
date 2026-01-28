# CLAUDE.md - Coding Project Guidelines

Essential guidance for Claude Code working in the coding infrastructure project.

---

## 🚨 MANDATORY: SKILLS USAGE

### Documentation-Style Skill

**ALWAYS invoke the `documentation-style` skill when:**
- Creating or modifying PlantUML (.puml) files
- Generating PNG files from PlantUML diagrams
- Working with Mermaid diagrams
- Creating or updating documentation artifacts
- User mentions: diagrams, PlantUML, PUML, PNG, visualization, architecture diagrams

**How to Invoke:**
```
Use Skill tool with command: "documentation-style"
```

**Why:** Enforces naming conventions, prevents incremental naming violations, ensures proper validation workflow, and applies correct style sheets.

---

## 📋 PROJECT CONFIGURATION

### Location & Purpose
- **Path**: `/Users/q284340/Agentic/coding`
- **Purpose**: Development environment with MCP services, knowledge management, and LSL system

### Startup & Services
- **Command**: `claude-mcp` or `coding --claude` (starts all services)
- **Services**: VKB Server (port 8080), Semantic Analysis, Graph Database
- **Never use**: Just `claude` - always start via 'coding' infrastructure

### Knowledge Management
- **Graph Database**: Graphology + Level persistent storage
- **Commands**: `vkb` (visualize)
- **Storage**: `.data/knowledge-graph/`

### Knowledge Entity Purge
**When user asks to delete/purge knowledge entities from a specific date:**

```bash
node scripts/purge-knowledge-entities.js <YYYY-MM-DD> [options]
```

**Options:**
- `--team=<team>` - Team filter (default: coding)
- `--dry-run` - Preview without deleting
- `--verbose` - Show each entity being deleted

**Examples:**
```bash
# Delete all entities created since Dec 23, 2025
node scripts/purge-knowledge-entities.js 2025-12-23

# Dry run to see what would be deleted
node scripts/purge-knowledge-entities.js 2025-12-23 --dry-run

# Delete from specific team with verbose output
node scripts/purge-knowledge-entities.js 2025-12-23 --team=ui --verbose
```

**This script maintains consistency** across Graphology, LevelDB, and JSON exports by using the proper VKB DELETE API.

### Session Logging (LSL)
- **Primary**: Live Session Logging with enhanced transcript monitor
- **Location**: `.specstory/history/`
- **Format**: `YYYY-MM-DD_HHMM-HHMM-<user-hash>[_from-<project>].md`

### Technical Standards
- **TypeScript**: Mandatory with strict type checking
- **Working Directory**: Always start in top-level project directory
- **File Interference**: Avoid `.mcp-sync/` for importable modules
- **API Design**: Never modify working APIs for TypeScript; fix types instead

### MCP & Tools
- **Serena MCP**: ONLY for reading/searching/analyzing code
- **File Operations**: Use standard Edit/Write tools, NEVER Serena for editing
- **Memory**: `.serena/memories/` for context persistence

### Playwright for E2E Testing (Browser UIs)

Use the Playwright MCP tools for visual verification and e2e testing of browser-based UIs:

**Available Tools:**
- `mcp__playwright__browser_navigate` - Navigate to URL
- `mcp__playwright__browser_snapshot` - Get accessibility tree (preferred for actions)
- `mcp__playwright__browser_take_screenshot` - Capture visual screenshot
- `mcp__playwright__browser_click` - Click elements by ref
- `mcp__playwright__browser_fill_form` - Fill form inputs

**Usage Pattern:**
```
# 1. Navigate to the UI
mcp__playwright__browser_navigate url="http://localhost:3032"

# 2. Take snapshot to get element refs
mcp__playwright__browser_snapshot

# 3. Interact with elements using refs from snapshot
mcp__playwright__browser_click ref="e42" element="Submit button"

# 4. Take screenshot for visual documentation
mcp__playwright__browser_take_screenshot filename="feature-screenshot.png"
```

**Screenshots:** Saved to `.playwright-mcp/` directory. Copy to docs folder as needed.

**Best Practices:**
- Use `browser_snapshot` (accessibility tree) for reliable element targeting
- Include descriptive `element` parameter for click actions
- Close browser with `browser_close` when done

### UKB Workflow Control (MANDATORY)

**ALWAYS use the `mcp__semantic-analysis__` MCP tools for workflow operations:**

```
# Start workflow (debug mode with single-stepping)
mcp__semantic-analysis__execute_workflow
  workflow_name: "complete-analysis" or "batch-analysis"
  async_mode: true
  debug: true
  parameters: {team: "coding", singleStepMode: true, mockLLM: true, stepIntoSubsteps: true}

# Check status
mcp__semantic-analysis__get_workflow_status
  workflow_id: "<workflow_id>"

# Advance single-step (via dashboard or progress file)
```

**NEVER use curl/cat/direct file manipulation** to control workflows:
- Direct curl to localhost:3033 does NOT properly sync with dashboard checkboxes
- Progress file manipulation bypasses proper state initialization
- MCP server ensures proper initialization of singleStepMode, mockLLM, stepIntoSubsteps flags

**Why:** The MCP server handles proper progress file initialization that syncs with the VKB dashboard checkboxes. Direct API calls skip this initialization.

### Code Graph Analysis

For complex code analysis, understanding call graphs, or finding related code:

**Tool:** `mcp__semantic-analysis__analyze_code_graph`

**Actions:**
- `nl_query` + `question`: Natural language query - "What functions call PSM?"
- `query` + `query`: Search entities by name pattern
- `call_graph` + `entity_name`: Get function dependency graph
- `similar` + `code_snippet`: Find similar code patterns

**When to use:**
- Understanding unfamiliar code areas
- Finding all callers/callees of a function
- Locating related implementations
- Debugging complex call chains

**Prerequisite:** Memgraph must be running (`docker ps | grep memgraph`)

**Auto-update:** Code graph is incrementally updated during `ukb` runs.

---

## 🎯 DEVELOPMENT PRACTICES

### Quality & Verification
- Always verify results with actual command output
- Never assume success - check and report actual state
- Follow quality gates before considering work complete

### Session Continuity
- Maintain context via LSL system (started via coding/bin/coding)
- Use `/sl` command to read session history for continuity

### Git & Commits
- Descriptive commit messages with clear context
- Commit after small increments/milestones
- Follow project-specific branch strategies

---

**Note**: Code quality constraints (parallel versions, naming patterns, etc.) are enforced by the constraint monitoring system.
