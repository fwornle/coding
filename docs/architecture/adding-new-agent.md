# Adding an Agent to the Coding Infrastructure

This guide explains how to add support for a coding agent (beyond Claude Code and GitHub Copilot CLI) to the agent-agnostic infrastructure.

## Overview

To add an agent, you need to:

1. Create an adapter class extending `BaseAdapter`
2. Implement the required provider classes
3. Register the adapter with the system
4. (Optional) Create native hook bridge scripts

## Step 1: Create the Adapter File

Create a file in `lib/agent-api/adapters/`:

```javascript
// lib/agent-api/adapters/myagent-adapter.js

import { BaseAdapter } from '../base-adapter.js';
import { StatuslineProvider } from '../statusline-api.js';
import { HooksManager, HookEvent } from '../hooks-api.js';
import { TranscriptAdapter, LSLEntryType } from '../transcript-api.js';
import { createLogger } from '../../logging/Logger.js';

const logger = createLogger('myagent-adapter');

class MyAgentAdapter extends BaseAdapter {
  getName() {
    return 'myagent';
  }

  getDisplayName() {
    return 'My Agent';
  }

  getCapabilities() {
    return ['hooks', 'statusline', 'transcripts'];
  }

  async initialize(config) {
    await super.initialize(config);
    logger.info('MyAgent adapter initialized');
    return true;
  }
}
```

## Step 2: Implement StatuslineProvider

```javascript
class MyAgentStatuslineProvider extends StatuslineProvider {
  async getStatus() {
    return {
      text: 'MyAgent: Ready',
      indicators: [{ icon: 'check', label: 'Connected', status: 'ok' }],
      health: 'healthy',
      timestamp: Date.now().toString()
    };
  }
}
```

## Step 3: Implement HooksManager

Map your agent's native events to unified events.

## Step 4: Implement TranscriptAdapter

Convert your agent's transcript format to unified LSL format.

## Step 5: Register the Adapter

Update `lib/agent-api/index.js` to include your adapter in the ADAPTERS registry.

## Step 6: Create Launch Script

Create `scripts/launch-myagent.sh` using the common setup functions. The final agent launch must be wrapped using the shared tmux wrapper for unified status bar rendering:

```bash
# At the end of launch-myagent.sh:
source "$SCRIPT_DIR/tmux-session-wrapper.sh"
tmux_session_wrapper myagent "$@"
```

The `tmux_session_wrapper` function (from `scripts/tmux-session-wrapper.sh`):
- Creates a tmux session named `coding-{agent}-{PID}`
- Configures the tmux status bar to run `combined-status-line.js`
- Propagates all required environment variables into the tmux session
- If already inside tmux, configures the current session's status bar instead of nesting

**Requirement:** `tmux` must be installed (added to `install.sh` prerequisites).

## Best Practices

1. Handle missing capabilities gracefully
2. Use the Logger class instead of console methods
3. Support both user-level and project-level config
4. Always wrap the agent launch in `tmux_session_wrapper` for consistent status bar rendering

## See Also

- [Agent Abstraction API Reference](agent-abstraction-api.md)
