# CLAUDE.md - Claude Code Instructions

This file provides essential guidance to Claude Code when working in this repository.

## 🚨 CRITICAL: How to Start Claude Code

**ALWAYS** start Claude Code using the `claude-mcp` command:
```bash
claude-mcp
```

**NEVER** use `claude code` directly - it won't have MCP features!

## 🚨 CRITICAL: Knowledge Base Management Rule

**IMPORTANT: The shared-memory.json knowledge base must ALWAYS be updated using the `ukb` command. Never edit this file directly. The ukb tool ensures proper formatting, validation, and synchronization with MCP memory.**

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
- Conversations automatically logged to `.specstory/history/`
- Each session creates timestamped markdown file
- No manual activation needed when using `claude-mcp`

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