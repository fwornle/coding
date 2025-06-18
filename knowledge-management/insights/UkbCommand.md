# UKB Command

## Overview

**Type:** Development Tool  
**Purpose:** Command-line tool for updating the shared knowledge base with development insights, patterns, and architectural decisions  
**Significance:** 9/10 - Essential for maintaining persistent AI context across development sessions and team members

## Complete Command Reference

### Basic Modes

**Automatic Mode**
```bash
ukb --auto
ukb -a
```
- Analyzes recent commits and Claude conversation files
- Captures insights since last recorded analysis (incremental)
- Best for: Quick session summaries after coding

**Interactive Mode**
```bash
ukb --interactive
ukb -i
```
- Prompts for detailed problem/solution/learnings
- Allows significance rating (1-10)
- Best for: Capturing deep architectural decisions and complex solutions

**Agent Mode**
```bash
ukb --agent
ukb -g
```
- Enables semantic analysis within AI coding agents
- Creates analysis request in `/tmp/ukb-XXXXX/`
- Complete with: `ukb --agent-complete /tmp/ukb-XXXXX`
- Best for: AI-assisted pattern extraction

### History Analysis

**Full History Analysis**
```bash
ukb --full-history
```
- Analyzes entire git history for comprehensive understanding
- Extracts patterns from all commits
- Best for: Initial project analysis or team onboarding

**Limited History Analysis**
```bash
ukb --full-history --history-depth 100
```
- Analyzes last N commits only
- Useful for focused analysis of recent changes

**Force Reprocessing**
```bash
ukb --full-history --force-reprocess
```
- Ignores incremental state (.ukb-state file)
- Reprocesses all files and commits
- Best for: When codebase structure changes significantly

### Entity Management

**List Entities**
```bash
ukb --list-entities
```
- Shows all entities in knowledge base with significance ratings
- Useful for knowledge base inspection

**Remove Single Entity**
```bash
ukb --remove-entity "PatternName"
```
- Removes entity and all its relations
- Use quotes if name contains spaces

**Remove Multiple Entities**
```bash
ukb --remove-entities "Pattern1,Pattern2,Pattern3"
```
- Comma-separated list, no spaces between commas
- Batch removal for cleanup

### Relationship Management

**Add Single Relation**
```bash
ukb --add-relation "FromEntity,ToEntity,relationType"
```
- Format: from,to,relationType (no spaces)
- Example: `ukb --add-relation "LoginPattern,SecuritySystem,implements"`

**Add Multiple Relations**
```bash
ukb --add-relations "Pattern1,Project1,implements" "Pattern2,CodingKnowledge,contains"
```
- Space-separated, each relation in quotes
- Efficient for connecting multiple entities

**Remove Relation**
```bash
ukb --remove-relation "FromEntity,ToEntity,relationType"
```
- Must match existing relation exactly

**List Relations**
```bash
ukb --list-relations
```
- Shows all relationships in knowledge base
- Useful for understanding connections

### System Operations

**Schema Upgrade**
```bash
ukb --upgrade
```
- Upgrades existing entities to latest schema format
- Run after ukb tool updates

**Help**
```bash
ukb --help
ukb -h
```
- Shows complete command reference

## Common Usage Patterns

### Daily Workflow
```bash
# Start of session - check what's new
ukb --auto

# After solving complex problem
ukb --interactive

# End of session - capture everything
ukb --auto
```

### Team Onboarding
```bash
# Understand project patterns
ukb --full-history --history-depth 500

# View knowledge graph
vkb start
```

### Adding New Pattern with Relations
```bash
# First create the pattern
ukb --interactive
# Enter details when prompted...

# Then connect it to project and system
ukb --add-relation "NewPattern,MyProject,implements"
ukb --add-relation "NewPattern,CodingKnowledge,contains"
```

### Knowledge Base Cleanup
```bash
# List all entities
ukb --list-entities

# Remove low-value patterns
ukb --remove-entities "TrivialPattern1,TrivialPattern2"
```

## Technical Details

### File Locations
- **Knowledge Base:** `/Users/q284340/Agentic/coding/shared-memory.json`
- **Incremental State:** `.ukb-state` (tracks last analyzed commit)
- **Temporary Files:** `/tmp/ukb-XXXXX/` (agent analysis)
- **MCP Sync:** Auto-syncs with MCP memory for AI persistence

### Integration Points
- **MCP Memory:** Automatic synchronization for AI agent access
- **Git Integration:** Reads commit history and file changes
- **Specstory:** Analyzes `.specstory/history/` conversation files
- **VSCode Extension:** `@km` command in Copilot chat

### Quality Filters
- Significance threshold: Only patterns rated 5+ are retained
- Deduplication: Prevents duplicate observations
- Pattern validation: Ensures meaningful insights only

## Best Practices

1. **Always use ukb to update knowledge base** - Never edit shared-memory.json directly
2. **Run ukb --auto regularly** - Captures incremental insights
3. **Use ukb --interactive for breakthroughs** - Deep insights need context
4. **Connect patterns to projects** - No isolated entities
5. **Review with vkb periodically** - Visual inspection helps maintain quality

## Troubleshooting

**MCP Sync Failed**
- Check `/tmp/ukb-XXXXX/mcp_sync_operations.md`
- Manually process if needed

**Port 8080 Busy (for vkb)**
```bash
kill -9 $(lsof -ti:8080) && vkb start
```

**Missing Commits in Analysis**
- Check `.ukb-state` for last processed commit
- Use `--force-reprocess` to reanalyze

## Related Tools
- **vkb**: Visualization server for knowledge graph
- **Claude Code**: AI assistant with MCP integration
- **GitHub Copilot**: VSCode extension with @km command

---

*Part of the Knowledge Management System - Essential for team knowledge continuity*