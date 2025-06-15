# Agent-Agnostic Coding Tools

This repository now supports both **Claude Code** (with MCP servers) and **GitHub CoPilot** (with fallback services), providing a unified interface regardless of which AI coding agent you use.

## 🚀 Quick Start

### Installation

```bash
# Install the system
../install.sh

# Or install Node.js dependencies only
npm install
```

### Usage

```bash
# Use best available agent (defaults to Claude if available)
../bin/coding

# Force specific agent
../bin/coding --claude
../bin/coding --copilot

# Use with commands
../bin/coding suggest "add error handling"
../bin/coding explain "this code block"
```

## 🏗️ Architecture

### Supported Agents

| Agent | Capabilities | Implementation |
|-------|-------------|----------------|
| **Claude Code** | MCP Memory, Browser, Logging | Native MCP servers |
| **GitHub CoPilot** | Code completion, Chat | Fallback services |

### Fallback Services for CoPilot

When using CoPilot, the system automatically provides:

- **Memory**: Pure JavaScript graph database using [Graphology](https://graphology.github.io/)
- **Browser**: Browser automation using [Playwright](https://playwright.dev/)
- **Logging**: File-based or Specstory extension integration

## 🧠 Memory System

### Claude Code (MCP)
- Uses MCP memory server
- Persistent across sessions
- Shared via git-tracked `shared-memory.json`

### CoPilot (Graphology)
- Pure JavaScript graph database
- No native dependencies
- Stored in `.coding-tools/memory.json`
- Compatible with MCP format

## 📝 Logging Integration

### Automatic Detection
The system automatically detects and integrates with:

- **Specstory VSCode Extension** (preferred for CoPilot)
- **File-based logging** (fallback)
- **MCP Logger** (for Claude)

### Specstory Extension Support
If you have the Specstory VSCode extension installed, CoPilot will automatically use it for conversation logging instead of file-based logging.

## 🛠️ Developer Guide

### Agent Detection

```javascript
const AgentDetector = require('./lib/agent-detector');

const detector = new AgentDetector();
const available = await detector.detectAll();
// { claude: true, copilot: false, specstory: true }

const best = await detector.getBest();
// 'claude'
```

### Using Adapters

```javascript
const { getAdapter } = require('./lib/agent-registry');

// Get adapter for specific agent
const adapter = await getAdapter('copilot');
await adapter.initialize();

// Use memory operations
await adapter.memoryCreate([{
  name: 'MyPattern',
  entityType: 'Pattern',
  observations: ['Key insight here']
}]);

// Search memory
const results = await adapter.memorySearch('pattern');

// Browser operations  
await adapter.browserNavigate('https://example.com');
await adapter.browserAct('click the login button');
```

## 📁 Project Structure

```
../lib/
├── agent-detector.js       # Detects available agents
├── agent-adapter.js        # Abstract base class
├── agent-registry.js       # Manages adapters
├── adapters/
│   ├── claude-mcp.js       # Claude Code + MCP
│   └── copilot.js          # CoPilot + fallbacks
├── fallbacks/
│   ├── memory-fallback.js  # Graphology graph DB
│   ├── browser-fallback.js # Playwright integration
│   └── logger-fallback.js  # File-based logging
├── integrations/
│   └── specstory-adapter.js # Specstory extension
└── utils/
    └── system.js           # System utilities

../scripts/
├── launch-claude.sh        # Claude launcher
└── launch-copilot.sh       # CoPilot launcher

../bin/coding         # Unified launcher script
```

## 🔧 Configuration

### Environment Variables

```bash
export CODING_AGENT="copilot"                    # Force specific agent
export CODING_TOOLS_GRAPH_DB="~/.memory.json"   # Memory database path
```

### Agent Configuration

The system uses `coding-tools-config.json` for agent-specific settings:

```json
{
  "agents": {
    "claude": {
      "features": {
        "memory": "mcp",
        "browser": "mcp", 
        "logging": "mcp"
      }
    },
    "copilot": {
      "features": {
        "memory": "graphology",
        "browser": "playwright",
        "logging": "specstory-or-file"
      }
    }
  }
}
```

## 🧪 Testing

```bash
# Test agent detection
node ../scripts/test-agent-detection.js

# Test memory fallback
node ../scripts/test-memory-fallback.js

# Test full system
npm test
```

## 🔄 Migration from Claude-only

Existing users can migrate seamlessly:

1. **Backup your data**: `cp shared-memory.json shared-memory.json.backup`
2. **Run new installer**: `../install.sh`
3. **Update commands**: Replace `claude-mcp` with `../bin/coding`

All existing functionality continues to work with Claude Code!

## 💡 Knowledge Management

The agent-aware UKB tool works with both agents:

```bash
# Auto-detects agent and syncs appropriately
ukb                    # Capture git insights
ukb --interactive      # Manual insight capture

# View knowledge (works with both)
vkb                    # Web visualization
```

## 🏆 Benefits

### For Claude Users
- **Same experience**: All MCP features continue to work
- **New options**: Can switch to CoPilot when needed
- **Backup agent**: Fallback if Claude unavailable

### For CoPilot Users  
- **Full features**: Memory, browser, logging via fallbacks
- **No setup**: Works out of the box
- **Specstory integration**: Automatic logging if extension available
- **Pure JavaScript**: No native dependencies

### For Teams
- **Flexibility**: Team members can use different agents
- **Consistency**: Same commands and workflows
- **Knowledge sharing**: Shared memory across agents

## 🎯 Future Enhancements

- Support for additional agents (GitHub Copilot Chat, etc.)
- Advanced graph algorithms in memory system  
- Real-time collaboration features
- Enhanced browser automation
- Plugin system for custom adapters

---

**Ready to try it?** Run `../install.sh` and start with `../bin/coding`!