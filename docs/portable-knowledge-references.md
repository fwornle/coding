# Portable Knowledge Base References

## Overview

To ensure the Claude knowledge management system works across different installations and team members, we avoid hardcoded paths and use dynamic discovery mechanisms.

## Environment Variables

When Claude Code is started with `claude-mcp`, the following environment variables are set:

- `CLAUDE_KNOWLEDGE_BASE` - Full path to shared-memory.json
- `CLAUDE_TOOLS_PATH` - Root directory of Claude tools installation

## Referencing Knowledge Base

### In Documentation

Instead of:
```markdown
Check ~/Agentic/coding/shared-memory.json for patterns
```

Use:
```markdown
Check the shared-memory.json in your Claude tools installation for patterns
```

### In Scripts

Instead of:
```bash
KNOWLEDGE_BASE="~/Agentic/coding/shared-memory.json"
```

Use:
```bash
# Dynamic discovery based on script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_REPO="$(dirname "$SCRIPT_DIR")"
KNOWLEDGE_BASE="$CLAUDE_REPO/shared-memory.json"

# Or use environment variable if available
KNOWLEDGE_BASE="${CLAUDE_KNOWLEDGE_BASE:-$CLAUDE_REPO/shared-memory.json}"
```

### In CLAUDE.md Files

Instead of:
```markdown
See patterns in ~/Agentic/coding/shared-memory.json
```

Use:
```markdown
See patterns in the central Claude knowledge base (accessed via `vkb` or the shared-memory.json file in your Claude tools installation)
```

## Best Practices

### 1. Use Relative References
When possible, reference files relative to the current script or project:
```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"
```

### 2. Provide Discovery Commands
Instead of giving paths, provide commands that work regardless of installation:
```markdown
# Find your Claude tools installation
which ukb | xargs dirname | xargs dirname

# Or use the visual browser
vkb
```

### 3. Use Tool Commands
The `ukb` and `vkb` commands automatically know where the knowledge base is:
```bash
# These work from any directory
ukb --auto      # Update knowledge base
vkb            # View knowledge base
```

### 4. Document Installation Structure
Explain the structure without assuming paths:
```
claude-tools-installation/
├── shared-memory.json          # Central knowledge base
├── knowledge-management/       # Scripts and tools
├── docs/                      # Documentation
└── bin/                       # Command wrappers
```

## Team Collaboration

### Installation Instructions
Provide flexible installation instructions:
```bash
# Clone to any directory you prefer
git clone <repo> [your-preferred-directory]
cd [your-preferred-directory]
./install.sh
```

### Sharing Knowledge References
When sharing knowledge patterns, use pattern names rather than file paths:
```markdown
# Good: Reference by pattern name
See the ReduxStateManagementPattern for React state solutions

# Avoid: Hardcoded paths
See ~/Agentic/coding/knowledge-management/insights/ReduxStateManagementPattern.md
```

## MCP Memory References

The MCP memory system should store patterns with portable references:
```json
{
  "observation": "Documentation available in knowledge-management/insights/ directory"
  // Not: "Documentation at ~/Agentic/coding/knowledge-management/insights/"
}
```

## Summary

By avoiding hardcoded paths and using dynamic discovery:
- Team members can install Claude tools anywhere
- Knowledge references remain valid across installations
- Documentation stays portable and maintainable
- Scripts work regardless of installation location

Remember: The tools (`ukb`, `vkb`, `claude-mcp`) know where everything is - let them handle the paths!