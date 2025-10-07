# MCP Server Setup

Guide to setting up the semantic analysis MCP server for Claude Code integration.

## Prerequisites

- Node.js 18 or higher
- npm or yarn
- Anthropic API key
- Claude Code installed

## Installation

### 1. Install Dependencies

```bash
cd integrations/mcp-server-semantic-analysis
npm install
```

### 2. Build the Server

```bash
npm run build
```

**Verify build**:
```bash
ls build/index.js  # Should exist
```

### 3. Configure API Keys

Add to your shell profile (`~/.bashrc`, `~/.zshrc`):

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."  # Optional fallback
```

Reload your shell:
```bash
source ~/.bashrc  # or ~/.zshrc
```

## Claude Code Integration

### Configure MCP Server

Edit `~/.config/claude-code/mcp.json`:

```json
{
  "mcpServers": {
    "semantic-analysis": {
      "command": "node",
      "args": [
        "/Users/yourusername/Agentic/coding/integrations/mcp-server-semantic-analysis/build/index.js"
      ],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

**Important**: Use absolute paths, not relative or `~`.

### Verify Configuration

```bash
# Validate JSON syntax
cat ~/.config/claude-code/mcp.json | jq .

# Check paths exist
jq -r '.mcpServers.["semantic-analysis"].args[]' ~/.config/claude-code/mcp.json | while read path; do
  [ -f "$path" ] && echo "✅ $path" || echo "❌ $path"
done
```

### Test Server

```bash
# Manual test
node build/index.js

# Should output:
# MCP Semantic Analysis Server started
# Listening on stdio
```

Press Ctrl+C to stop.

### Restart Claude Code

After configuration:
1. Quit Claude Code completely
2. Restart Claude Code
3. Server will connect automatically

## Verify Integration

### In Claude Code

Run these commands to verify the server is connected:

```
# List available tools
list_tools

# Should show:
# - analyze_repository
# - analyze_code
# - execute_workflow
# - etc.

# Test basic functionality
analyze_code {
  "code": "function test() { return true; }",
  "language": "javascript"
}
```

### Check Logs

**Server logs**:
```bash
# If LOG_LEVEL=debug in config
tail -f /tmp/semantic-analysis.log
```

**Claude Code logs**:
```bash
# macOS
tail -f ~/Library/Logs/Claude/main.log

# Linux
tail -f ~/.local/share/claude/logs/main.log
```

## Configuration Options

### Environment Variables

Add to the `env` section in `mcp.json`:

```json
{
  "env": {
    "ANTHROPIC_API_KEY": "sk-ant-...",
    "OPENAI_API_KEY": "sk-...",
    "LOG_LEVEL": "info",
    "CACHE_DIR": ".cache/semantic-analysis",
    "MAX_CONCURRENT_AGENTS": "4",
    "ANALYSIS_TIMEOUT": "300000"
  }
}
```

**Available options**:
- `LOG_LEVEL`: error, warn, info, debug
- `CACHE_DIR`: Cache directory path
- `MAX_CONCURRENT_AGENTS`: Parallel agent execution (default: 4)
- `ANALYSIS_TIMEOUT`: Timeout in milliseconds (default: 300000)

### Server Options

Advanced configuration via command-line args:

```json
{
  "args": [
    "/path/to/build/index.js",
    "--cache",
    "--port", "8765",
    "--timeout", "300000"
  ]
}
```

## Troubleshooting

### Server Not Connecting

**Symptom**: Claude Code shows no semantic analysis tools

**Solutions**:
1. Verify build: `ls build/index.js`
2. Test manually: `node build/index.js`
3. Check API key: `echo $ANTHROPIC_API_KEY | wc -c`
4. Validate config: `cat ~/.config/claude-code/mcp.json | jq .`
5. Restart Claude Code completely

### Permission Errors

**Symptom**: `EACCES` or permission denied errors

**Solution**:
```bash
chmod +x build/index.js
chmod -R 755 integrations/mcp-server-semantic-analysis
```

### Module Not Found

**Symptom**: `Cannot find module` errors

**Solution**:
```bash
cd integrations/mcp-server-semantic-analysis
rm -rf node_modules package-lock.json
npm install
npm run build
```

### API Key Issues

**Symptom**: `Invalid API key` errors

**Solution**:
1. Verify key format (should start with `sk-ant-`)
2. Test key:
   ```bash
   curl https://api.anthropic.com/v1/messages \
     -H "x-api-key: $ANTHROPIC_API_KEY" \
     -H "anthropic-version: 2023-06-01" \
     -H "content-type: application/json" \
     -d '{"model":"claude-3-5-sonnet-20241022","max_tokens":10,"messages":[{"role":"user","content":"test"}]}'
   ```

### Memory Issues

**Symptom**: `JavaScript heap out of memory`

**Solution**:

Add Node.js memory options:
```json
{
  "args": [
    "--max-old-space-size=4096",
    "/path/to/build/index.js"
  ]
}
```

## Updating the Server

### Rebuild After Changes

```bash
cd integrations/mcp-server-semantic-analysis
npm run build
```

### Update Dependencies

```bash
npm update
npm audit fix
npm run build
```

### Restart Integration

1. Quit Claude Code
2. Rebuild server
3. Restart Claude Code

## Multiple Projects

### Separate Configurations

Each project can have its own MCP configuration:

**Project 1**:
```json
{
  "mcpServers": {
    "semantic-analysis": {
      "args": ["/path/to/project1/coding/..."],
      "env": {...}
    }
  }
}
```

**Project 2**:
```json
{
  "mcpServers": {
    "semantic-analysis": {
      "args": ["/path/to/project2/coding/..."],
      "env": {...}
    }
  }
}
```

### Shared Installation

Use symbolic links:
```bash
# In each project
ln -s ~/Agentic/coding/integrations/mcp-server-semantic-analysis ./semantic-analysis

# Reference in MCP config
"args": ["./semantic-analysis/build/index.js"]
```

## Best Practices

1. **Use absolute paths** in MCP configuration
2. **Set appropriate log levels** (info for production, debug for troubleshooting)
3. **Monitor resource usage** with appropriate limits
4. **Keep dependencies updated** regularly
5. **Test after changes** by running manual server test

## See Also

- [Installation Guide](installation.md) - Full installation process
- [API Reference](api-reference.md) - Tool documentation
- [Integration Patterns](../../integrations/mcp-server-semantic-analysis/docs/architecture/integration.md)
- [Troubleshooting](../../integrations/mcp-server-semantic-analysis/docs/troubleshooting/README.md)
