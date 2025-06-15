# Agent-Agnostic Coding Tools Implementation Plan

## Overview

This plan outlines the steps to make the coding tools work with both Claude Code (with MCP) and GitHub CoPilot (without MCP), while maintaining all core functionality through abstraction layers and fallback mechanisms.

## Phase 1: Foundation (Week 1)

### 1.1 Create Agent Detection System

**File**: `lib/agent-detector.js`

```javascript
class AgentDetector {
  constructor() {
    this.detectionMethods = {
      claude: this.detectClaude.bind(this),
      copilot: this.detectCoPilot.bind(this)
    };
  }

  async detectClaude() {
    // Check for claude command
    const hasClaudeCLI = await this.commandExists('claude');
    // Check for MCP config
    const hasMCPConfig = await this.fileExists('~/.config/claude/claude_desktop_config.json');
    return hasClaudeCLI && hasMCPConfig;
  }

  async detectCoPilot() {
    // Check for GitHub CoPilot CLI
    const hasCoPilotCLI = await this.commandExists('gh');
    const hasCoPilotExt = await this.exec('gh extension list | grep copilot');
    return hasCoPilotCLI && hasCoPilotExt;
  }

  async detectSpecstoryExtension() {
    // Check for VSCode Specstory extension
    const vscodeExtPath = process.platform === 'win32' 
      ? `${process.env.USERPROFILE}\\.vscode\\extensions`
      : `${process.env.HOME}/.vscode/extensions`;
    
    const hasSpecstory = await this.glob(`${vscodeExtPath}/*/specstory*`);
    return hasSpecstory.length > 0;
  }

  async detectAll() {
    const results = {};
    for (const [agent, detector] of Object.entries(this.detectionMethods)) {
      results[agent] = await detector();
    }
    return results;
  }
}
```

**Tasks**:
- [ ] Implement `commandExists` utility
- [ ] Implement `fileExists` utility
- [ ] Add detection for VS Code with CoPilot extension
- [ ] Add detection for Specstory VSCode extension
- [ ] Add detection for other potential agents

### 1.2 Define Abstract Agent Interface

**File**: `lib/agent-adapter.js`

```javascript
class AgentAdapter {
  constructor(config) {
    this.config = config;
  }

  // Abstract methods to be implemented by subclasses
  async initialize() {
    throw new Error('initialize() must be implemented');
  }

  async executeCommand(command, args) {
    throw new Error('executeCommand() must be implemented');
  }

  // Common features that need abstraction
  async memoryCreate(entities) {}
  async memorySearch(query) {}
  async memoryRead() {}
  
  async browserNavigate(url) {}
  async browserAct(action) {}
  async browserExtract() {}
  
  async logConversation(data) {}
  async readConversationHistory() {}
}
```

**Tasks**:
- [ ] Define all abstract methods needed
- [ ] Create consistent error handling
- [ ] Define configuration schema

## Phase 2: Agent-Specific Adapters (Week 1-2)

### 2.1 Claude MCP Adapter

**File**: `lib/adapters/claude-mcp.js`

```javascript
class ClaudeMCPAdapter extends AgentAdapter {
  async initialize() {
    // Verify MCP servers are configured
    this.mcpConfig = await this.loadMCPConfig();
  }

  async executeCommand(command, args) {
    // Launch claude with MCP config
    return await exec(`claude --config ${this.mcpConfig} ${args.join(' ')}`);
  }

  async memoryCreate(entities) {
    // Use MCP memory server directly
    return await this.callMCPTool('mcp__memory__create_entities', { entities });
  }

  async browserNavigate(url) {
    // Use browser-access MCP server
    return await this.callMCPTool('mcp__browser-access__stagehand_navigate', { url });
  }
}
```

**Tasks**:
- [ ] Implement MCP tool calling mechanism
- [ ] Handle MCP server startup/shutdown
- [ ] Implement all memory operations
- [ ] Implement all browser operations

### 2.2 CoPilot Adapter

**File**: `lib/adapters/copilot.js`

```javascript
class CoPilotAdapter extends AgentAdapter {
  async initialize() {
    // Detect available services
    const detector = new AgentDetector();
    this.hasSpecstory = await detector.detectSpecstoryExtension();
    
    // Start fallback services
    await this.startMemoryService();
    await this.startBrowserService();
    
    // Only start logging service if Specstory extension not available
    if (!this.hasSpecstory) {
      await this.startLoggingService();
    }
  }

  async executeCommand(command, args) {
    // Launch CoPilot CLI
    return await exec(`gh copilot ${command} ${args.join(' ')}`);
  }

  async memoryCreate(entities) {
    // Use graph database fallback
    return await this.memoryService.createEntities(entities);
  }

  async browserNavigate(url) {
    // Use Playwright directly
    return await this.browserService.navigate(url);
  }

  async logConversation(data) {
    if (this.hasSpecstory) {
      // Use Specstory extension API
      return await this.specstoryLog(data);
    } else {
      // Use fallback logging service
      return await this.loggingService.logConversation(data);
    }
  }
}
```

**Tasks**:
- [ ] Implement fallback service management
- [ ] Create service initialization
- [ ] Implement all fallback operations
- [ ] Integrate Specstory extension API
- [ ] Create Specstory logging adapter

## Phase 3: Fallback Services (Week 2)

### 3.1 Memory Fallback Service (Graph Database)

**File**: `lib/fallbacks/memory-fallback.js`

```javascript
// Graph Database Options Analysis:
// 1. Neo4j - Full-featured but requires Java, heavyweight
// 2. ArangoDB - Multi-model, good for our use case
// 3. DGraph - Distributed, might be overkill
// 4. LevelGraph - Lightweight, pure JS, perfect for local use
// 5. GunDB - Decentralized, real-time, good for future expansion

// Recommended: LevelGraph for simplicity and portability

const levelgraph = require('levelgraph');
const levelgraphN3 = require('levelgraph-n3');

class MemoryFallbackService {
  constructor(config) {
    this.dbPath = config.dbPath || './.coding-tools/memory.graph';
    this.db = null;
  }

  async initialize() {
    // Create LevelGraph database with N3 support (for RDF-like triples)
    this.db = levelgraphN3(levelgraph(this.dbPath));
  }

  async createEntities(entities) {
    // Store entities as graph nodes
    const triples = [];
    
    for (const entity of entities) {
      // Create entity node
      triples.push({
        subject: entity.name,
        predicate: 'type',
        object: entity.entityType
      });
      
      // Add observations as properties
      entity.observations.forEach((obs, idx) => {
        triples.push({
          subject: entity.name,
          predicate: `observation_${idx}`,
          object: obs
        });
      });
    }
    
    await this.db.put(triples);
  }

  async createRelations(relations) {
    // Store relations as edges
    const triples = relations.map(rel => ({
      subject: rel.from,
      predicate: rel.relationType,
      object: rel.to
    }));
    
    await this.db.put(triples);
  }

  async searchNodes(query) {
    // Search using graph patterns
    const results = await this.db.search([
      {
        subject: this.db.v('entity'),
        predicate: this.db.v('predicate'),
        object: this.db.v('value')
      }
    ], {
      filter: (solution) => {
        return solution.entity.includes(query) || 
               solution.value.includes(query);
      }
    });
    
    return this.formatResults(results);
  }

  async readGraph() {
    // Get all nodes and edges
    const nodes = await this.db.get({});
    return this.formatAsGraph(nodes);
  }
}
```

**Tasks**:
- [ ] Evaluate and choose best graph database (LevelGraph recommended)
- [ ] Design schema compatible with MCP memory graph structure
- [ ] Implement all CRUD operations for entities and relations
- [ ] Add graph traversal queries
- [ ] Implement pattern matching for complex queries
- [ ] Add import/export for MCP compatibility
- [ ] Create migration tools from SQLite to graph DB

### 3.2 Browser Fallback Service

**File**: `lib/fallbacks/browser-fallback.js`

```javascript
class BrowserFallbackService {
  constructor(config) {
    this.browserType = config.browser || 'chromium';
    this.browser = null;
    this.page = null;
  }

  async initialize() {
    const playwright = require('playwright');
    this.browser = await playwright[this.browserType].launch({
      headless: false
    });
    this.page = await this.browser.newPage();
  }

  async navigate(url) {
    await this.page.goto(url);
    return { success: true, url };
  }

  async act(action, variables = {}) {
    // Implement action parsing and execution
    // Similar to Stagehand functionality
  }

  async extract() {
    return await this.page.content();
  }
}
```

**Tasks**:
- [ ] Implement Playwright integration
- [ ] Create action parser
- [ ] Add element selection logic
- [ ] Implement screenshot capability

### 3.3 Logging Service Integration

**File**: `lib/integrations/specstory-adapter.js`

```javascript
// Adapter for VSCode Specstory Extension
class SpecstoryAdapter {
  constructor() {
    this.extensionId = 'specstory.specstory-vscode';
    this.extensionApi = null;
  }

  async initialize() {
    // Connect to Specstory extension via its API
    try {
      // Try multiple connection methods
      this.extensionApi = await this.connectViaIPC() || 
                         await this.connectViaHTTP() ||
                         await this.connectViaFileWatch();
    } catch (error) {
      console.warn('Specstory extension not available:', error);
      return false;
    }
    return true;
  }

  async logConversation(entry) {
    if (!this.extensionApi) return false;
    
    // Format for Specstory
    const specstoryEntry = {
      timestamp: new Date().toISOString(),
      agent: 'copilot',
      type: entry.type || 'conversation',
      content: entry.content,
      metadata: {
        ...entry.metadata,
        project: process.cwd(),
        session: this.sessionId
      }
    };
    
    return await this.extensionApi.log(specstoryEntry);
  }

  async connectViaIPC() {
    // Try Inter-Process Communication
    const ipc = require('node-ipc');
    // Implementation details...
  }

  async connectViaHTTP() {
    // Try HTTP API if extension exposes one
    const axios = require('axios');
    try {
      const response = await axios.get('http://localhost:7357/api/status');
      if (response.data.extensionId === this.extensionId) {
        return {
          log: (data) => axios.post('http://localhost:7357/api/log', data)
        };
      }
    } catch (e) {}
    return null;
  }

  async connectViaFileWatch() {
    // Fallback: Write to watched directory
    const watchDir = path.join(os.homedir(), '.specstory', 'watch');
    await fs.mkdir(watchDir, { recursive: true });
    return {
      log: async (data) => {
        const filename = `${Date.now()}-${process.pid}.json`;
        await fs.writeFile(
          path.join(watchDir, filename),
          JSON.stringify(data, null, 2)
        );
      }
    };
  }
}
```

**File**: `lib/fallbacks/logger-fallback.js`

```javascript
class LoggerFallbackService {
  constructor(config) {
    this.logDir = config.logDir || './.specstory/history';
    this.currentSession = null;
    this.specstoryAdapter = new SpecstoryAdapter();
  }

  async initialize() {
    // Try Specstory first
    this.hasSpecstory = await this.specstoryAdapter.initialize();
    
    // Setup file-based fallback
    await fs.mkdir(this.logDir, { recursive: true });
    this.currentSession = await this.createSession();
  }

  async logConversation(entry) {
    // Try Specstory first
    if (this.hasSpecstory) {
      const logged = await this.specstoryAdapter.logConversation(entry);
      if (logged) return;
    }
    
    // Fallback to file-based logging
    const logPath = path.join(this.logDir, `${this.currentSession}.json`);
    const log = await this.readLog(logPath);
    log.entries.push({
      ...entry,
      timestamp: new Date().toISOString()
    });
    await fs.writeFile(logPath, JSON.stringify(log, null, 2));
  }
}
```

**Tasks**:
- [ ] Research Specstory extension API documentation
- [ ] Implement multiple connection methods (IPC, HTTP, File-watch)
- [ ] Design log format compatible with both Specstory and file-based system
- [ ] Create bidirectional sync between Specstory and local logs
- [ ] Add session management that works with both systems
- [ ] Implement graceful fallback when Specstory unavailable

## Phase 4: Unified Launcher (Week 2-3)

### 4.1 Main Launcher Script

**File**: `coding` (new command)

```bash
#!/bin/bash

# Default to Claude Code
AGENT="claude"
FORCE_AGENT=""
ARGS=()

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --agent)
      FORCE_AGENT="$2"
      shift 2
      ;;
    --copilot)
      FORCE_AGENT="copilot"
      shift
      ;;
    --claude)
      FORCE_AGENT="claude"
      shift
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

# Use forced agent if specified
if [ -n "$FORCE_AGENT" ]; then
  AGENT="$FORCE_AGENT"
else
  # Auto-detect best available agent
  AGENT=$(node lib/agent-detector.js --best)
fi

# Launch appropriate agent
case "$AGENT" in
  claude)
    exec ./scripts/launch-claude.sh "${ARGS[@]}"
    ;;
  copilot)
    exec ./scripts/launch-copilot.sh "${ARGS[@]}"
    ;;
  *)
    echo "Error: No supported agent available"
    exit 1
    ;;
esac
```

**Tasks**:
- [ ] Create argument parser
- [ ] Implement agent detection logic
- [ ] Create agent-specific launchers
- [ ] Add configuration file support

### 4.2 Agent-Specific Launchers

**File**: `scripts/launch-claude.sh`

```bash
#!/bin/bash

# Start MCP servers if needed
if [ -f ".mcp-sync/sync-required.json" ]; then
  node scripts/sync-to-mcp.js
fi

# Launch Claude with MCP config
exec claude --config claude-code-mcp-processed.json "$@"
```

**File**: `scripts/launch-copilot.sh`

```bash
#!/bin/bash

# Start fallback services
node lib/start-fallback-services.js &
FALLBACK_PID=$!

# Ensure cleanup on exit
trap "kill $FALLBACK_PID 2>/dev/null" EXIT

# Set environment for CoPilot mode
export CODING_AGENT="copilot"
export CODING_TOOLS_GRAPH_DB="$HOME/.coding-tools/memory.graph"

# Launch CoPilot
exec gh copilot "$@"
```

**Tasks**:
- [ ] Implement service lifecycle management
- [ ] Add proper cleanup handlers
- [ ] Create service health checks

## Phase 5: Update Existing Tools (Week 3)

### 5.1 Update ukb Command

**File**: `knowledge-management/ukb` (modified)

```javascript
#!/usr/bin/env node

const { AgentDetector } = require('../lib/agent-detector');
const { getAdapter } = require('../lib/agent-registry');

async function main() {
  const detector = new AgentDetector();
  const agent = process.env.CODING_AGENT || await detector.getBest();
  const adapter = await getAdapter(agent);
  
  // Initialize adapter
  await adapter.initialize();
  
  // Existing ukb logic, but using adapter methods
  if (args.includes('--interactive')) {
    await captureInteractiveInsights(adapter);
  } else {
    await captureGitInsights(adapter);
  }
  
  // Sync to agent's memory system
  await syncToMemory(adapter);
}
```

**Tasks**:
- [ ] Refactor ukb to use adapters
- [ ] Update vkb similarly
- [ ] Update all sync scripts
- [ ] Maintain backward compatibility

### 5.2 Update Installation Scripts

**File**: `install.sh` (modified)

```bash
#!/bin/bash

echo "🔍 Detecting available coding agents..."

# Detect agents
AGENTS=$(node lib/agent-detector.js --list-all)

echo "Found agents: $AGENTS"

# Install common components
echo "📦 Installing common components..."
npm install
./scripts/install-common.sh

# Install agent-specific components
if [[ "$AGENTS" == *"claude"* ]]; then
  echo "🤖 Installing Claude Code components..."
  ./scripts/install-claude-mcp.sh
fi

if [[ "$AGENTS" == *"copilot"* ]]; then
  echo "🚁 Installing CoPilot components..."
  ./scripts/install-copilot-fallbacks.sh
fi

# Create unified launcher
echo "🚀 Creating unified launcher..."
ln -sf $(pwd)/bin/coding ~/bin/coding

echo "✅ Installation complete!"
echo "Usage: coding [--agent claude|copilot] [args...]"
```

**Tasks**:
- [ ] Create modular installation scripts
- [ ] Add dependency checking
- [ ] Create uninstall script

## Phase 6: Testing & Migration (Week 3-4)

### 6.1 Test Suite

**File**: `tests/agent-compatibility.test.js`

```javascript
describe('Agent Compatibility', () => {
  test('Claude MCP adapter works correctly', async () => {
    const adapter = new ClaudeMCPAdapter();
    await adapter.initialize();
    
    // Test memory operations
    await adapter.memoryCreate([{
      name: 'TestEntity',
      entityType: 'Test',
      observations: ['Test observation']
    }]);
    
    const results = await adapter.memorySearch('TestEntity');
    expect(results).toHaveLength(1);
  });

  test('CoPilot adapter fallbacks work correctly', async () => {
    const adapter = new CoPilotAdapter();
    await adapter.initialize();
    
    // Test same operations with fallbacks
    await adapter.memoryCreate([{
      name: 'TestEntity',
      entityType: 'Test',
      observations: ['Test observation']
    }]);
    
    const results = await adapter.memorySearch('TestEntity');
    expect(results).toHaveLength(1);
  });
});
```

**Tasks**:
- [ ] Create comprehensive test suite
- [ ] Test all adapter methods
- [ ] Test fallback services
- [ ] Test agent detection
- [ ] Test migration scenarios

### 6.2 Migration Guide

**File**: `docs/migration-to-agent-agnostic.md`

```markdown
# Migration Guide: Agent-Agnostic Coding Tools

## For Existing Users

1. **Backup your data**:
   ```bash
   cp -r .mcp-sync .mcp-sync.backup
   cp shared-memory.json shared-memory.json.backup
   ```

2. **Run the migration**:
   ```bash
   ./scripts/migrate-to-agent-agnostic.sh
   ```

3. **Update your workflow**:
   - Replace `claude-mcp` with `coding`
   - Use `--agent copilot` to force CoPilot
   - All other commands remain the same

## For New Users

1. **Install the tools**:
   ```bash
   ./install.sh
   ```

2. **Start coding**:
   ```bash
   coding  # Uses best available agent
   coding --copilot  # Force CoPilot
   coding --claude   # Force Claude
   ```
```

**Tasks**:
- [ ] Create migration script
- [ ] Document breaking changes
- [ ] Create rollback procedure

## Implementation Timeline

### Week 1: Foundation
- [ ] Agent detection system
- [ ] Abstract interfaces
- [ ] Basic adapter structure

### Week 2: Core Implementation
- [ ] Claude MCP adapter
- [ ] CoPilot adapter
- [ ] Fallback services

### Week 3: Integration
- [ ] Unified launcher
- [ ] Update existing tools
- [ ] Installation scripts

### Week 4: Testing & Polish
- [ ] Comprehensive testing
- [ ] Documentation
- [ ] Migration tools
- [ ] Performance optimization

## Graph Database Recommendation

After analysis, **LevelGraph** is recommended for the CoPilot memory fallback because:

1. **Pure JavaScript** - No external dependencies like Java (Neo4j) or C++ bindings
2. **Lightweight** - Small footprint, perfect for local development
3. **File-based** - Stores data in a local directory, easy to backup/migrate
4. **RDF-compatible** - Supports triple stores similar to MCP's knowledge graph
5. **Good performance** - Fast queries for our use case size
6. **Easy migration** - Can import/export to other formats

Alternative if more features needed: **ArangoDB** (multi-model, includes graph + document store)

## Success Criteria

1. **Seamless agent switching**: Users can switch between Claude and CoPilot with a simple flag
2. **Feature parity**: All features work with both agents (via MCP or fallbacks)
3. **Backward compatibility**: Existing Claude+MCP setups continue to work
4. **Performance**: Fallback services perform acceptably compared to MCP
5. **User experience**: Simple, consistent commands regardless of agent
6. **Specstory integration**: Automatic detection and use of Specstory extension when available
7. **Graph consistency**: Memory graphs compatible between Claude MCP and CoPilot fallback

## Risk Mitigation

1. **Data loss**: Implement robust backup/restore mechanisms
2. **Performance degradation**: Optimize fallback services, add caching
3. **Feature gaps**: Document any limitations clearly
4. **Compatibility issues**: Extensive testing on multiple platforms

## Next Steps

1. Review and approve this plan
2. Set up development branch
3. Begin Phase 1 implementation
4. Weekly progress reviews