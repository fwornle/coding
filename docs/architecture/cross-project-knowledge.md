# Cross-Project Knowledge System

## Overview

The coding project serves as a central knowledge hub that provides cross-project insights, patterns, and workflows through a **central graph database**. This ensures that learned experiences are available across ALL projects on a developer's machine.

## Architecture

### Knowledge Flow
```
Project Work → Insights → ukb → Central Graph DB (.data/knowledge-graph/) → git exports → Team
     ↓                            ↑
All Projects ←──────────────────┘
```

### Key Components

1. **Central Graph Database** (`coding/.data/knowledge-graph/`)
   - **ONE database per machine** - shared by ALL projects
   - LevelDB for fast persistent storage
   - Graphology for in-memory graph operations
   - Team isolation via node ID pattern: `${team}:${entityName}`
   - Location: ALWAYS at `coding/.data/knowledge-graph/`

2. **Git-Tracked JSON Exports** (`coding/.data/knowledge-export/*.json`)
   - Pretty JSON format for PR review and team collaboration
   - One file per team: `coding.json`, `ui.json`, `resi.json`, etc.
   - Bidirectional sync with graph database
   - Auto-export on changes (5s debounce)
   - Auto-import on startup

3. **Path Resolution** (`knowledge-paths.js`)
   - Uses `CODING_TOOLS_PATH` environment variable (set by `bin/coding`)
   - Ensures ALL projects resolve to same central database
   - No per-project databases - only team isolation via node IDs

## How It Works

### 1. Starting Coding Session (Any Project)

When you run `coding` from ANY project:

```bash
cd /Users/you/Agentic/curriculum-alignment
coding --claude
```

The system:

- Sets `CODING_TOOLS_PATH=/Users/you/Agentic/coding` env variable
- All knowledge operations resolve to `coding/.data/knowledge-graph/`
- Auto-imports latest JSON exports into graph database
- VKB server (if running) shows knowledge from central database

### 2. During Development (Cross-Project Knowledge Access)

From curriculum-alignment project:

```bash
ukb --interactive  # Writes to coding/.data/knowledge-graph/
vkb                # Reads from coding/.data/knowledge-graph/
```

From nano-degree project:

```bash
ukb --interactive  # SAME database: coding/.data/knowledge-graph/
vkb                # SAME database: coding/.data/knowledge-graph/
```

**Result**: ALL projects share the same knowledge base, isolated by team via node IDs.

### 3. Capturing New Knowledge

When you discover something valuable:

```bash
# Automatic capture from git commits
ukb --auto

# Interactive capture for deep insights
ukb --interactive
```

Knowledge is stored in central graph DB with team prefix:

- Working in curriculum-alignment → stores as `curriculum:EntityName`
- Working in coding → stores as `coding:EntityName`

### 4. Knowledge Persistence

- **Runtime**: Central LevelDB at `coding/.data/knowledge-graph/`
- **Auto-export**: Writes pretty JSON to `coding/.data/knowledge-export/${team}.json` (debounced 5s)
- **Git**: Commit and push JSON exports for team sharing
- **Auto-import**: Pulls latest JSON on session startup

## Pattern Categories

### TransferablePattern
Reusable solutions that work across multiple projects:
- ConditionalLoggingPattern
- ViewportCullingPattern
- ReduxStateManagementPattern
- NetworkAwareInstallationPattern

### WorkflowPattern
Standard workflows and processes:
- ClaudeCodeStartupPattern
- UKB Command Execution
- VKB Command Execution

### CodingInsight
Specific learnings from problem-solving:
- Bug fixes with broad applicability
- Performance optimizations
- Architecture decisions

### CoreSystemPattern
Fundamental system behaviors:
- SharedKnowledgeBasePattern
- MCPKnowledgeIntegrationPattern

## Best Practices

### 1. Always Start with `coding` Command

```bash
coding --claude  # Sets CODING_TOOLS_PATH env variable
```

This ensures:

- All knowledge operations point to central database
- Environment variables properly configured
- Services (VKB, LSL) properly initialized

### 2. Check Existing Patterns First

Before solving a problem, check if a pattern exists:

```bash
# Visual browse (works from ANY project)
vkb

# Or check JSON exports
cat /Users/you/Agentic/coding/.data/knowledge-export/coding.json | jq '.entities[] | select(.entityType | contains("Pattern"))'
```

### 3. Capture Valuable Insights

When you solve something that could help in other projects:

```bash
ukb --interactive
# Provide detailed context and mark high significance
# Automatically saved to central database and exported to JSON
```

### 4. Reference Patterns in CLAUDE.md

When creating project-specific CLAUDE.md files:

```markdown
## Related Patterns

- ReduxStateManagementPattern - for React state management
- ConditionalLoggingPattern - for debug logging
```

### 5. Regular Sync

```bash
# Ensure local knowledge is current
cd $PROJECT_ROOT
git pull  # Gets latest JSON exports from team

# Next coding session auto-imports on startup
coding --claude
```

## Team Collaboration

### Sharing Knowledge

1. Capture insights with `ukb` (from any project)
2. Auto-export creates JSON at `coding/.data/knowledge-export/${team}.json`
3. Commit JSON exports:

   ```bash
   cd /Users/you/Agentic/coding
   git add .data/knowledge-export/
   git commit -m "docs: update ${team} knowledge base"
   git push
   ```

4. Team members pull and get instant access on next session startup

### Knowledge Review

Periodically review captured patterns:

```bash
vkb  # Visual review (works from any project)
# Look for patterns that need refinement or consolidation
```

## Troubleshooting

### Knowledge Not Available

If patterns seem missing:

1. Check you started with `coding --claude` (sets `CODING_TOOLS_PATH`)
2. Verify central database exists: `ls -la /Users/you/Agentic/coding/.data/knowledge-graph/`
3. Check JSON exports: `ls -la /Users/you/Agentic/coding/.data/knowledge-export/`
4. Run `vkb` to browse visual knowledge graph

### Sync Issues

If knowledge seems out of sync:

1. Pull latest from git: `cd /Users/you/Agentic/coding && git pull`
2. Restart coding session: `coding --claude` (auto-imports JSON)
3. Check auto-export: Verify `.data/knowledge-export/*.json` files updated
4. Manual sync if needed: Use `graph-sync` CLI tool

### Cross-Project Issues

If knowledge not available across projects:

1. **Verify environment variable**: `echo $CODING_TOOLS_PATH` should show `/Users/you/Agentic/coding`
2. **Check path resolution**: All projects must resolve to same central DB
3. **Verify no per-project databases**: Only `coding/.data/knowledge-graph/` should exist
4. **Team isolation working**: Node IDs should use pattern `${team}:${entityName}`

## Architecture Benefits

### Single Database Per Machine

✅ **Consistency**: All projects see the same knowledge
✅ **No sync issues**: One source of truth
✅ **Fast access**: In-memory graph operations
✅ **Team isolation**: Node ID prefixes prevent conflicts

### Git-Tracked JSON Exports

✅ **Code review**: Pretty JSON diffs in PRs
✅ **Version control**: Full history of knowledge evolution
✅ **Team collaboration**: Push/pull workflow
✅ **Conflict resolution**: Newest-wins automatic merging

### No MCP Memory Dependency

✅ **Agent-agnostic**: Works with Claude, Copilot, Cursor, any tool
✅ **Direct access**: No server dependency
✅ **Portable**: LevelDB files are cross-platform
✅ **Simple**: Fewer moving parts

---

*The central knowledge base is your persistent, cross-project memory shared by ALL development activities on your machine. Use it, contribute to it, and let it accelerate your development across all projects!*