# Serena

AST-based semantic code analysis (read-only).

## Overview

| Property | Value |
|----------|-------|
| Component | `serena` |
| Type | MCP Server |
| Protocol | stdio (native only) |
| Purpose | Code analysis and search |

## What It Does

Serena provides AST-based code analysis for reading and searching code:

- **Semantic Search** - Find code by meaning, not just text
- **Code Navigation** - Jump to definitions on declarations
- **Symbol Analysis** - Understand code structure
- **Documentation Search** - Search within comments and docs

!!! warning "Read-Only"
    Serena is for **analysis only**. Never use Serena for editing files.
    Use standard Edit/Write tools for file modifications.

## Usage

### Search Documentation

```
search_serena_documentation {
  "query": "authentication flow"
}
```

### Search Code

```
search_serena_code {
  "query": "UserService"
}
```

### Fetch Documentation

```
fetch_serena_documentation {}
```

Returns full documentation from the repository.

## Configuration

```json
{
  "mcpServers": {
    "serena": {
      "command": "node",
      "args": ["/path/to/serena/build/index.js"]
    }
  }
}
```

## When to Use

**Use Serena for**:

- Searching for code patterns
- Understanding unfamiliar code
- Finding symbol definitions
- Exploring code structure

**Don't use Serena for**:

- Editing files (use Edit tool)
- Creating files (use Write tool)
- Running code (use Bash tool)

## Best Practices

1. **Search before reading** - Use Serena to find relevant files first
2. **Combine with Read** - After finding files, use Read tool for full content
3. **Semantic over text** - Prefer semantic search for better results

## Comparison with Code Graph RAG

| Feature | Serena | Code Graph RAG |
|---------|--------|----------------|
| AST Analysis | Yes | Yes |
| Graph Database | No | Yes (Memgraph) |
| Call Graph | No | Yes |
| Natural Language | Limited | Full |
| File Operations | No | Yes |
| Requires Docker | No | Yes (Memgraph) |

Use Serena for quick searches; use Code Graph RAG for deep analysis.

## Troubleshooting

### Server not starting

```bash
# Check if Serena is built
ls integrations/serena/build/

# Rebuild if needed
cd integrations/serena && npm run build
```

### Search not finding results

- Check that the repository is indexed
- Try broader search terms
- Use exact symbol names for precise matches
