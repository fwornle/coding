# Browser Access MCP Server for Claude Code

A customized Model Context Protocol (MCP) server that provides AI-powered web automation capabilities using [Stagehand](https://github.com/browserbase/stagehand), configured specifically for Claude Code and Anthropic's Claude models. This server enables Claude to interact with web pages, perform actions, extract data, and observe possible actions in a real browser environment.

## Quick Setup

1. **Build the server**:
   ```bash
   ./setup-browser-access.sh
   ```

2. **Set environment variables**:
   ```bash
   export ANTHROPIC_API_KEY="your-anthropic-api-key"
   
   # For cloud browser (optional):
   export BROWSERBASE_API_KEY="your-browserbase-api-key"
   export BROWSERBASE_PROJECT_ID="your-project-id"
   
   # For local browser (optional):
   export LOCAL_CDP_URL="ws://localhost:9222"
   ```

3. **Test the setup**:
   ```bash
   ./test-browser-access.sh
   ```

## Browser Setup Options

### Option 1: Local Browser (Recommended for development)

Start Chrome with debugging enabled using the provided script:
```bash
# Global command (available anywhere):
browser                    # Start Chrome in debug mode
browser google.com         # Start Chrome and navigate to Google

# Or run directly:
./start-chrome-debug.sh    # Start Chrome in debug mode
./start-chrome-debug.sh https://example.com  # Start and navigate to URL
```

### Option 2: Browserbase Cloud

Sign up at [Browserbase](https://www.browserbase.com/) and get your API key and project ID:
```bash
export BROWSERBASE_API_KEY="your-api-key"
export BROWSERBASE_PROJECT_ID="your-project-id"
```

## Chrome Debug Script Features

The `start-chrome-debug.sh` script (aliased as `browser`) provides:

- ✅ **Auto-detection** of Chrome/Chromium installation
- ✅ **Port conflict handling** - detects if Chrome debug is already running
- ✅ **Clean profile** - uses temporary profile for clean debugging
- ✅ **Optimal flags** - pre-configured for automation compatibility
- ✅ **URL support** - optionally navigate to a URL on startup
- ✅ **Cross-platform** - works on macOS, Linux, and WSL

### Usage Examples:
```bash
browser                           # Start with blank page
browser google.com               # Start and go to Google  
browser https://github.com       # Start and go to GitHub
browser --help                   # Show help
```

## Claude Code Integration

### For Claude Desktop
The MCP server has been automatically configured in Claude Desktop at:
`~/Library/Application Support/Claude/claude_desktop_config.json`

### For Claude Code CLI
Use the convenience script to start Claude Code with browser automation:

```bash
# Quick start with browser tools
./claude-browser

# Or manually specify the MCP config
claude code --mcp-config ./claude-code-mcp.json
```

The MCP configuration includes:
```json
{
  "mcpServers": {
    "browser-access": {
      "command": "node", 
      "args": ["/Users/q284340/Claude/browser-access/dist/index.js"],
      "env": {
        "LOCAL_CDP_URL": "ws://localhost:9222",
        "ANTHROPIC_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Available Tools

In Claude Code CLI, the tools are prefixed with `mcp__browser-access__`:

- `mcp__browser-access__stagehand_navigate`: Navigate to URLs
- `mcp__browser-access__stagehand_act`: Perform actions (click, type, etc.)  
- `mcp__browser-access__stagehand_extract`: Extract data from web pages
- `mcp__browser-access__stagehand_observe`: Get page information
- `mcp__browser-access__stagehand_screenshot`: Take screenshots

Note: In Claude Desktop, the tools appear without the MCP prefix.

## Usage Examples

Once integrated with Claude Code, you can use natural language commands like:

- "Take a screenshot of google.com"
- "Navigate to example.com and click the login button"
- "Extract all the product names from this e-commerce page"
- "Fill out the contact form with my information"

## Workflow

### For Claude Code CLI:
1. **Start Chrome**: `browser` (or `browser <url>`)
2. **Start Claude Code**: `./claude-browser` (from browser-access directory)
3. **Use browser automation** with natural language commands
4. **Stop Chrome**: `pkill -f 'remote-debugging-port=9222'`

### For Claude Desktop:
1. **Start Chrome**: `browser` (or `browser <url>`)
2. **Restart Claude Desktop** (if not done already)
3. **Use browser automation** with natural language
4. **Stop Chrome**: `pkill -f 'remote-debugging-port=9222'`

## Troubleshooting

1. **Build Issues**: Make sure TypeScript is installed and run `npm install`
2. **Browser Connection**: Ensure Chrome is running with `browser` command
3. **API Keys**: Verify your ANTHROPIC_API_KEY is valid in the MCP config
4. **Permissions**: Make sure scripts are executable (`chmod +x *.sh`)
5. **Command Issues**: Make sure `/Users/q284340/Claude/knowledge-management` is in your PATH

## Configuration

The server is configured in `src/server.ts` with Claude-specific settings:
- Model: `claude-3-5-sonnet-20241022`
- Provider: Anthropic API
- Base URL: `https://api.anthropic.com`

## Development

To modify the server:
1. Edit files in `src/`
2. Run `npm run build` (or `npx tsc && chmod +x dist/*.js`)
3. Test with `./test-browser-access.sh`

## Credits

Based on the original Stagehand MCP server by Browserbase, modified for Claude Code integration.