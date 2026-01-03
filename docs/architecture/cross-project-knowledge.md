# Cross-Project Knowledge System

## Overview

The coding project serves as a central knowledge hub that provides cross-project insights, patterns, and workflows through a **central graph database**. This ensures that learned experiences are available across ALL projects on a developer's machine.

## Architecture

### Knowledge Flow (Dual Capture System)

![Cross-Project Knowledge Flow](../images/cross-project-knowledge-flow.png)

The system provides **two complementary paths** for knowledge capture:

1. **Automatic (Continuous Learning)**: Real-time extraction from live coding sessions via StreamingKnowledgeExtractor
2. **Manual (UKB)**: Deliberate, structured capture via interactive CLI tool

Both paths converge at the central graph database, ensuring all knowledge is available across all projects.

### Dual Knowledge Capture System

The system captures knowledge through **TWO complementary approaches**:

#### 1. **Automatic: Continuous Learning (Real-Time)**

**What**: Automatic extraction during live coding sessions
**When**: As you code, in real-time
**How**: `StreamingKnowledgeExtractor` monitors LSL transcript
**Storage**: `GraphDatabaseService.storeEntity()` → central graph DB

**Example Flow**:
```javascript
// During your coding session:
User: "How do I implement authentication?"
Assistant: [provides solution]

// StreamingKnowledgeExtractor automatically:
1. Classifies exchange type (solution/pattern/problem)
2. Extracts key knowledge
3. Stores to: coding/.data/knowledge-graph/
   with node ID: "curriculum:AuthenticationSolution"
4. Auto-exports to: coding/.data/knowledge-export/curriculum.json
```

**Benefits**:
- ✅ Zero effort - happens automatically
- ✅ Captures in-the-moment context
- ✅ Budget-aware ($8.33/month limit)
- ✅ Privacy-first (sensitive data → local models)

**See**: [Continuous Learning System Documentation](../knowledge-management/continuous-learning-system.md)

#### 2. **Manual: Semantic Analysis (Deliberate Insight Capture)**

**What**: Explicit capture of architectural decisions and deep insights
**When**: End of session, after solving complex problems
**How**: Type "ukb" in Claude chat → Claude calls MCP semantic-analysis tool
**Storage**: Same `GraphDatabaseService.storeEntity()` → central graph DB

**Example Flow**:
```
# After solving a complex problem, in Claude chat:
User: "ukb"

# Claude detects request and calls:
mcp__semantic-analysis__execute_workflow
workflow_name: "incremental-analysis"

# 14-Agent System executes:
1. GitHistoryAgent - analyzes recent commits
2. VibeHistoryAgent - analyzes session logs
3. SemanticAnalysisAgent - extracts insights
4. WebSearchAgent - researches patterns
5. InsightGenerationAgent - creates structured insights
6. ObservationGenerationAgent - adds observations
7. QualityAssuranceAgent - validates quality
8. PersistenceAgent - stores to GraphDB
9. DeduplicationAgent - prevents duplicates
10. CoordinatorAgent - orchestrates workflow

# Stores to central database
# Auto-export: .data/knowledge-export/coding.json (5s debounced)
# Checkpoint: .data/ukb-last-run.json (team-wide sync)
```

**Benefits**:
- ✅ Deep, structured insights via AI analysis
- ✅ Architectural decision records
- ✅ Team-wide knowledge sharing
- ✅ Deliberate, high-quality capture
- ✅ 14-agent semantic analysis workflow

**See**: [MCP Semantic Analysis Documentation](../knowledge-management/mcp-semantic-analysis.md)

#### Why Both Systems?

| Aspect | Continuous Learning | Semantic Analysis |
|--------|-------------------|-------------------|
| **Capture** | Automatic, real-time | Manual trigger, AI-driven |
| **Quality** | Good, contextual | Excellent, AI-analyzed |
| **Effort** | Zero | Low (just type "ukb") |
| **Use Case** | In-the-moment solutions | Architectural decisions |
| **Timing** | During coding | After reflection |

**Result**: Comprehensive knowledge base with both breadth (automatic) and depth (manual).

---

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

### 3. Capturing New Knowledge (Dual System)

#### Automatic Capture (Continuous Learning)

**Happens automatically during every coding session:**

```bash
# Just code normally - knowledge extraction happens automatically!
cd /Users/you/Agentic/curriculum-alignment
coding --claude

# As you interact with Claude:
# - StreamingKnowledgeExtractor monitors LSL transcript
# - Classifies exchanges (solution/pattern/problem/insight)
# - Extracts knowledge in real-time
# - Stores to central graph DB
# - Auto-exports to JSON (5s debounce)
```

**No user action required** - runs in background with budget limits.

#### Manual Capture (UKB)

**For deliberate, structured insights:**

```bash
# Automatic capture from git commits
ukb --auto

# Interactive capture for deep insights
ukb --interactive
```

#### Storage Pattern

**Both systems** store to central graph DB with team prefix:

- Working in curriculum-alignment → stores as `curriculum:EntityName`
- Working in coding → stores as `coding:EntityName`
- Working in nano-degree → stores as `nano-degree:EntityName`

**Same database, same export mechanism, different capture methods.**

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