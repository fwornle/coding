# Cross-Project Knowledge System

## Overview

The coding project serves as a central knowledge hub that provides cross-project insights, patterns, and workflows through the `shared-memory.json` file. This ensures that learned experiences are available across all projects.

## Architecture

### Knowledge Flow
```
Project Work → Insights → ukb → shared-memory.json → git → Team
     ↓                                    ↓
Claude Code ← MCP Memory ← Startup Sync ←┘
```

### Key Components

1. **Shared Knowledge Base** (`shared-memory.json` in Claude tools repository)
   - Central repository of transferable patterns
   - Git-tracked for team sharing
   - Contains patterns, insights, and workflows
   - Location determined by Claude tools installation path

2. **MCP Memory Server**
   - Runtime access to knowledge
   - Synchronized at Claude Code startup
   - Persistent across sessions

3. **Startup Integration** (`claude-mcp` script)
   - Displays available patterns at startup
   - Prepares knowledge sync
   - Ensures cross-project awareness

## How It Works

### 1. Starting Claude Code
When you run `claude-mcp`:
- Script checks shared-memory.json
- Displays available patterns and insights
- Prepares MCP memory sync
- Shows count of available knowledge

### 2. During Development
Claude Code has access to:
- All transferable patterns
- Previous solutions to similar problems
- Workflow patterns (like ukb/vkb usage)
- Cross-project best practices

### 3. Capturing New Knowledge
When you discover something valuable:
```bash
# Automatic capture from git commits
ukb --auto

# Interactive capture for deep insights
ukb --interactive
```

### 4. Knowledge Persistence
- Local: Updates shared-memory.json
- MCP: Syncs to memory server
- Git: Commit and push for team sharing

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

### 1. Always Start with claude-mcp
```bash
claude-mcp  # NOT 'claude code'
```
This ensures knowledge base is loaded and MCP features are available.

### 2. Check Existing Patterns First
Before solving a problem, check if a pattern exists:
```bash
# Visual browse
vkb

# Or check specific patterns in shared-memory.json
# (from your Claude tools installation directory)
jq '.entities[] | select(.entityType | contains("Pattern"))' shared-memory.json
```

### 3. Capture Valuable Insights
When you solve something that could help in other projects:
```bash
ukb --interactive
# Provide detailed context and mark high significance
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
cd ~/Agentic/coding
git pull
ukb --auto  # Sync MCP with latest
```

## Team Collaboration

### Sharing Knowledge
1. Capture insights with `ukb`
2. Commit shared-memory.json changes
3. Push to repository
4. Team members pull and get instant access

### Knowledge Review
Periodically review captured patterns:
```bash
vkb  # Visual review
# Look for patterns that need refinement or consolidation
```

## Troubleshooting

### Knowledge Not Available
If patterns seem missing:
1. Check you started with `claude-mcp`
2. Verify shared-memory.json exists
3. Run `ukb --auto` to sync
4. Check MCP memory with test queries

### Sync Issues
If MCP memory seems out of sync:
1. Restart Claude Code with `claude-mcp`
2. Check sync script output
3. Manually verify shared-memory.json content

## Future Enhancements

- [ ] Automatic MCP memory sync at startup
- [ ] Pattern recommendation based on project type
- [ ] Cross-project pattern search
- [ ] Pattern versioning and evolution tracking
- [ ] Team knowledge metrics and insights

---

*The shared knowledge base is your persistent, cross-project memory. Use it, contribute to it, and let it accelerate your development across all projects!*