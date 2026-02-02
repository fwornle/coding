# Browser Access

Stagehand browser automation via MCP.

## Overview

| Property | Value |
|----------|-------|
| Component | `browser-access` |
| Type | MCP Server |
| Port (Docker) | 3847 |
| Framework | Stagehand |

## What It Does

Browser automation for web interactions, testing, and data extraction.

- **Navigate** - Load URLs in automated browser
- **Act** - Perform atomic actions (click, type, select)
- **Extract** - Extract text content from pages
- **Observe** - Find actionable elements
- **Screenshot** - Capture page screenshots

## MCP Tools

| Tool | Description |
|------|-------------|
| `stagehand_navigate` | Navigate to URL |
| `stagehand_act` | Perform page actions |
| `stagehand_extract` | Extract page text |
| `stagehand_observe` | Find actionable elements |
| `screenshot` | Capture page screenshot |

## Usage Examples

### Navigate

```
stagehand_navigate {
  "url": "https://example.com"
}
```

### Act

Actions should be atomic and specific:

```
stagehand_act {
  "action": "Click the sign in button"
}

stagehand_act {
  "action": "Type 'hello' into the search input"
}
```

!!! warning "Atomic Actions"
    Avoid compound actions like "Order me pizza" or "Send an email to Paul".
    Break them into specific steps.

### Extract

```
stagehand_extract {}
```

Returns all text content from current page.

### Observe

Use to find elements for subsequent actions:

```
stagehand_observe {
  "instruction": "find the login button"
}
```

### Screenshot

```
screenshot {}
```

## Configuration

**Native Mode**:

```json
{
  "mcpServers": {
    "browser-access": {
      "command": "node",
      "args": ["/path/to/browser-access/build/index.js"],
      "env": {
        "LOCAL_CDP_URL": "ws://localhost:9222"
      }
    }
  }
}
```

**Docker Mode**:

```json
{
  "mcpServers": {
    "browser-access": {
      "command": "node",
      "args": ["/path/to/browser-access/dist/stdio-proxy.js"],
      "env": {
        "BROWSER_ACCESS_SSE_URL": "http://localhost:3847"
      }
    }
  }
}
```

## Docker Benefits

In Docker mode, multiple Claude sessions can share the same browser instance:

- No browser startup overhead per session
- Persistent browser state
- Shared tabs and cookies
- Better resource utilization

## Best Practices

1. **Use observe before act** when unsure about element selectors
2. **Keep actions atomic** - one action per tool call
3. **Extract for scraping** - use when you need text, not interactions
4. **Screenshot sparingly** - prefer observe/extract for data

## Health Check

```bash
# Docker mode
curl http://localhost:3847/health
```

## Troubleshooting

### Browser not connecting

```bash
# Check Chrome DevTools Protocol
curl http://localhost:9222/json/version

# Verify Docker container
docker compose -f docker/docker-compose.yml logs browser-access
```

### Actions failing

- Use `stagehand_observe` first to verify element exists
- Check that action description matches visible text
- Ensure page has fully loaded before acting
