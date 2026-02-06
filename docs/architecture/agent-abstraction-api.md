# Agent Abstraction API Reference

The Agent Abstraction API provides a unified interface for integrating multiple coding agents (Claude Code, GitHub Copilot CLI, future agents) into the coding infrastructure.

## Overview

The API consists of four main interfaces:

1. **BaseAdapter** - Abstract base class for agent adapters
2. **StatuslineProvider** - Interface for status line display
3. **HooksManager** - Interface for hook event management
4. **TranscriptAdapter** - Interface for transcript/session log handling

## Module Location

All agent API code is located in `lib/agent-api/`:

- `index.js` - Main export module
- `base-adapter.js` - Abstract base adapter class
- `statusline-api.js` - StatuslineProvider interface
- `hooks-api.js` - HooksManager interface
- `transcript-api.js` - TranscriptAdapter interface

## BaseAdapter Interface

The `BaseAdapter` class defines the contract that all agent adapters must implement.

### Methods

```javascript
// Returns agent identifier (e.g., 'claude', 'copilot')
getName()

// Returns human-readable display name
getDisplayName()

// Returns array of supported capabilities
// Options: 'mcp', 'hooks', 'statusline', 'transcripts'
getCapabilities()

// Initialize the adapter with configuration
async initialize(config)

// Launch the agent with provided arguments
async launch(args)

// Perform clean shutdown
async shutdown()

// Get the StatuslineProvider instance
getStatuslineProvider()

// Get the HooksManager instance
getHooksManager()

// Get the TranscriptAdapter instance
getTranscriptAdapter()
```

## StatuslineProvider Interface

The `StatuslineProvider` class handles status display for the agent.

### Methods

```javascript
// Returns StatusData object with text, indicators, health
async getStatus()

// Returns tmux-formatted status string
async formatForTmux()

// Returns CLI-formatted status string (with ANSI codes)
async formatForCLI()

// Returns cached status with configurable TTL
async getCachedStatus(ttlMs = 5000)
```

### StatusData Structure

```javascript
{
  text: string,          // Main status text
  indicators: [          // Status indicators
    { icon: string, label: string, status: 'ok'|'warning'|'error' }
  ],
  health: 'healthy' | 'degraded' | 'unhealthy',
  timestamp: ISO string
}
```

## HooksManager Interface

The `HooksManager` class handles hook event registration and triggering.

### Hook Events

| Event | Description | Claude Native | Copilot Native |
|-------|-------------|---------------|----------------|
| `STARTUP` | Agent session starts | (launcher) | `sessionStart` |
| `SHUTDOWN` | Agent session ends | EXIT trap | `sessionEnd` |
| `PRE_TOOL` | Before tool execution | `PreToolUse` | `preToolUse` |
| `POST_TOOL` | After tool execution | `PostToolUse` | `postToolUse` |
| `PRE_PROMPT` | Before user prompt | (custom) | `userPromptSubmitted` |
| `ERROR` | Error occurred | (custom) | `errorOccurred` |

### Methods

```javascript
// Register a hook handler for an event
registerHook(event, handler, priority = 0)

// Remove a registered hook
unregisterHook(event, handlerId)

// Trigger a hook event with context
async triggerHook(event, context)

// List all registered hooks
getRegisteredHooks()
```

### Hook Handler Signature

```javascript
async function hookHandler(context) {
  // context contains: event, agent, timestamp, toolName, args, result, etc.
  return {
    allow: true,  // false to block (for pre-hooks)
    modified: {},  // modified context (optional)
    message: ''   // message to display (optional)
  };
}
```

## TranscriptAdapter Interface

The `TranscriptAdapter` class handles reading and converting session transcripts.

### LSL Entry Types

- `USER` - User message
- `ASSISTANT` - Assistant response
- `TOOL_USE` - Tool invocation
- `TOOL_RESULT` - Tool execution result
- `SYSTEM` - System message
- `ERROR` - Error entry

### Methods

```javascript
// Read transcripts with filtering options
async readTranscripts({ limit, since, until, projectPath })

// Watch for new transcript entries in real-time
async watchTranscripts(callback)

// Convert agent-native format to LSL
convertToLSL(agentFormatEntry)

// Get current active session
async getCurrentSession()
```

### LSLSession Structure

```javascript
{
  metadata: {
    agent: string,        // 'claude', 'copilot'
    sessionId: string,
    projectPath: string,
    startTime: ISO string,
    endTime: ISO string,
    userHash: string
  },
  entries: [
    {
      type: LSLEntryType,
      timestamp: ISO string,
      content: string,
      metadata: object
    }
  ]
}
```

## Using the API

### Get an Adapter

```javascript
import { getAdapter, getCurrentAdapter } from './lib/agent-api/index.js';

// Get adapter by type
const claudeAdapter = await getAdapter('claude', { projectPath: '/path/to/project' });

// Get current adapter based on CODING_AGENT env var
const adapter = await getCurrentAdapter({ projectPath: '/path/to/project' });
```

### Using the Adapter

```javascript
// Initialize
await adapter.initialize({ projectPath: '/my/project' });

// Get status
const statusProvider = adapter.getStatuslineProvider();
const status = await statusProvider.getStatus();

// Register a hook
const hooks = adapter.getHooksManager();
hooks.registerHook('PRE_TOOL', async (ctx) => {
  // Log tool execution using Logger
  logger.info(`Tool ${ctx.toolName} about to execute`);
  return { allow: true };
});

// Read transcripts
const transcripts = adapter.getTranscriptAdapter();
const sessions = await transcripts.readTranscripts({ limit: 10 });
```

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `CODING_AGENT` | Active agent type | `claude`, `copilot` |
| `CODING_AGENT_ADAPTER_PATH` | Path to adapter modules | `lib/agent-api/adapters` |
| `CODING_HOOKS_CONFIG` | Path to hooks config | `config/hooks-config.json` |
| `CODING_TRANSCRIPT_FORMAT` | Agent's native format | `claude`, `copilot` |

## Hook Configuration

Hooks can be configured at two levels:

1. **User-level**: `~/.coding-tools/hooks.json`
2. **Project-level**: `{project}/.coding/hooks.json`

Project configuration overrides user configuration.

### Example Configuration

```json
{
  "hooks": {
    "startup": [
      {
        "id": "startup-log",
        "type": "script",
        "script": "scripts/log-startup.sh",
        "enabled": true
      }
    ],
    "pre-tool": [
      {
        "id": "tool-audit",
        "type": "module",
        "module": "lib/hooks/audit-tools.js",
        "enabled": true
      }
    ]
  }
}
```

## See Also

- [Adding a New Agent](adding-new-agent.md) - Guide for implementing new adapters
- [Unified Hooks System](../components/unified-hooks.md) - Hook system details
- [LSL Format](../reference/lsl-format.md) - Session log format specification
