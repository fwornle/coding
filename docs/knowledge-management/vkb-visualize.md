# VKB - Visualize Knowledge Base

**Component**: [vkb-server](../../lib/vkb-server/)
**Type**: Web server (Node.js + Python)
**Purpose**: Interactive knowledge graph visualization

---

## Overview

VKB-CLI is a cross-platform knowledge visualization server that provides interactive web-based exploration of knowledge graphs. It offers comprehensive server lifecycle management, real-time data updates, and programmatic control.

### Key Features

- **Interactive Visualization**: Explore knowledge graphs in browser
- **Server Management**: Start, stop, restart with automatic recovery
- **Real-time Updates**: Refresh data without restart
- **Health Monitoring**: Automatic health checks and status reporting
- **Cross-Platform**: Works on Windows, macOS, and Linux
- **Programmatic API**: Control server from Node.js code

---

## Quick Reference

### Basic Commands

```bash
# Start visualization server (default command)
vkb
vkb start

# Stop server gracefully
vkb stop

# Restart server
vkb restart

# Check server status
vkb status

# View server logs
vkb logs

# Start in foreground for debugging
vkb fg

# Check what's using the port
vkb port
```

### Access Visualization

Once started, visualization is available at:
```
http://localhost:8080
```

Server automatically opens browser on startup (disable with `--no-browser`)

---

## Usage Modes

### 1. Background Server (Default)

```bash
vkb start
```

**What it does:**
- Starts server in background
- Opens browser automatically
- Runs as daemon process
- PID tracked for management
- Logs to `/tmp/vkb-server.log`

**Use when:**
- Daily development sessions
- Long-running visualization access
- Team knowledge sharing
- Production-like deployment

### 2. Foreground Mode

```bash
vkb fg
vkb foreground
```

**What it does:**
- Runs server in foreground
- Logs output to console
- Blocks terminal
- Useful for debugging

**Use when:**
- Debugging server issues
- Development and testing
- Monitoring real-time logs
- Troubleshooting startup problems

### 3. Server Management

```bash
# Check status
vkb status --json --verbose

# View logs
vkb logs -n 100 --follow

# Check port usage
vkb port --kill

# Force restart
vkb stop --force && vkb start
```

---

## Server Lifecycle

### Startup Sequence

1. **Pre-startup Validation**
   - Environment dependency checking (Node.js, Python 3)
   - Project structure validation
   - Port availability verification
   - Existing process detection

2. **Data Preparation**
   - Knowledge base loading and parsing
   - Format conversion (JSON → NDJSON)
   - Symlink creation for file serving
   - Asset verification

3. **Server Initialization**
   - HTTP server process spawning
   - PID tracking and management
   - Health verification
   - Browser integration (optional)

4. **Runtime Monitoring**
   - Process health checks
   - Log monitoring
   - Error detection and recovery
   - Resource usage tracking

### Shutdown Sequence

1. **Graceful Termination**
   - Server process signaling (SIGTERM)
   - Connection draining
   - Resource cleanup
   - PID file removal

2. **Forced Cleanup**
   - Process termination (SIGKILL if needed)
   - Port release verification
   - Temporary file cleanup
   - Log file finalization

---

## Data Management

### Real-time Data Refresh

```bash
# Refresh data without restarting server
vkb-cli data refresh

# Validate data integrity
vkb-cli data validate

# Export data in various formats
vkb-cli data export --format json --output kb-export.json
```

### Workflow Integration

```bash
# Knowledge capture happens via:
# 1. Continuous Learning (automatic during coding)
# 2. MCP Semantic Analysis (type "ukb" in Claude chat)

# Refresh visualization after knowledge updates
vkb-cli data refresh

# Or restart for comprehensive refresh
vkb restart
```

---

## Programmatic API

### VKBServer Class

```javascript
const { VKBServer } = require('vkb-server');

// Create server instance
const server = new VKBServer({
  port: 8080,
  projectRoot: process.cwd(),
  logLevel: 'info',
  autoRestart: true
});

// Start server
await server.start({
  foreground: false,
  openBrowser: true
});

// Get server status
const status = await server.status();
console.log(`Server running on port ${status.port}`);

// Refresh data
const result = await server.refreshData();
console.log(`Loaded ${result.entities} entities, ${result.relations} relations`);

// Health check
const health = await server.healthCheck();
if (!health.healthy) {
  console.error('Server health check failed');
}

// View logs
const logs = await server.logs({ lines: 100, level: 'error' });

// Stop server
await server.stop();
```

### Event Handling

```javascript
server.on('starting', () => {
  console.log('Server is starting...');
});

server.on('started', (result) => {
  console.log(`Server started at ${result.url}`);
});

server.on('stopped', (result) => {
  console.log(`Server stopped (PID: ${result.pid})`);
});

server.on('error', (error) => {
  console.error('Server error:', error);
});

server.on('health-check', (result) => {
  if (!result.healthy) {
    console.warn('Server health check failed');
  }
});
```

---

## Common Use Cases

### 1. Daily Development Session

**Scenario**: Developer starts workday and wants quick access to knowledge base

```bash
# Start development session
cd /path/to/project
vkb start

# Server starts, opens browser automatically
# Developer explores knowledge graph throughout day

# End of day
vkb stop
```

### 2. Knowledge Base Updates

**Scenario**: After capturing new insights, refresh visualization

```bash
# Capture new insights
ukb --interactive

# Refresh without restart
vkb-cli data refresh

# Or full restart
vkb restart
```

### 3. Debugging and Troubleshooting

**Scenario**: Server issues require debugging

```bash
# Start in foreground for debugging
vkb fg --debug

# Monitor logs in real-time
vkb logs --follow

# Check port conflicts
vkb port

# Check health status
vkb status --verbose

# Force restart if needed
vkb stop --force && vkb start
```

### 4. Multi-Project Development

**Scenario**: Working on multiple projects with different knowledge bases

```bash
# Project A
cd /path/to/project-a
vkb start --port 8080

# Project B (different port)
cd /path/to/project-b
vkb start --port 8081

# Check both servers
vkb-cli server status --all

# Access in browser
open http://localhost:8080  # Project A
open http://localhost:8081  # Project B

# Cleanup
vkb-cli server stop --all
```

### 5. Team Knowledge Sharing

**Scenario**: Team explores knowledge base together during session

```bash
# Presenter starts server
vkb start

# Allow network access
vkb-cli config set host 0.0.0.0
vkb restart

# Team accesses via network: http://presenter-ip:8080

# Refresh with latest insights during session
vkb-cli data refresh

# Generate sharing report after session
vkb-cli server logs --since "1 hour ago" > session-log.txt
vkb-cli data export --format json --output session-knowledge.json
```

---

## Advanced Features

### Automated Testing Integration

```javascript
// test-setup.js
const { VKBServer } = require('vkb-server');

let server;

beforeAll(async () => {
  server = new VKBServer({
    port: 8080,
    projectRoot: process.cwd(),
    logLevel: 'error'
  });

  await server.start({
    foreground: false,
    openBrowser: false
  });

  await server.healthCheck();
});

afterAll(async () => {
  await server.stop();
});

// Integration tests
describe('Knowledge Visualization', () => {
  test('server responds to health check', async () => {
    const health = await server.healthCheck();
    expect(health.healthy).toBe(true);
  });

  test('data refresh works correctly', async () => {
    const result = await server.refreshData();
    expect(result.success).toBe(true);
  });
});
```

### Development Tool Integration

```javascript
// VS Code extension integration
const vscode = require('vscode');
const { VKBServer } = require('vkb-server');

class KnowledgeVisualizationProvider {
  constructor() {
    this.server = new VKBServer({
      port: 8080,
      projectRoot: vscode.workspace.rootPath
    });
  }

  async showVisualization() {
    // Start server if not running
    const status = await this.server.status();
    if (!status.running) {
      await this.server.start({ openBrowser: false });
    }

    // Show in VS Code webview
    const panel = vscode.window.createWebviewPanel(
      'knowledgeVisualization',
      'Knowledge Base Visualization',
      vscode.ViewColumn.Two,
      { enableScripts: true }
    );

    panel.webview.html = `
      <iframe src="http://localhost:8080"
              width="100%" height="100%"
              frameborder="0">
      </iframe>
    `;
  }
}
```

### Custom Automation Workflows

```javascript
// automation-workflow.js
const { VKBServer } = require('vkb-server');
const { execSync } = require('child_process');

class KnowledgeWorkflow {
  constructor() {
    this.server = new VKBServer({
      port: 8080,
      projectRoot: process.cwd(),
      autoRestart: true
    });
  }

  async dailyKnowledgeUpdate() {
    console.log('🔄 Starting daily knowledge update...');

    // Update knowledge base
    console.log('📝 Capturing new insights...');
    execSync('ukb --auto --depth 20', { stdio: 'inherit' });

    // Start visualization server
    console.log('🚀 Starting visualization server...');
    await this.server.start({ openBrowser: false });

    // Refresh data
    console.log('🔄 Refreshing visualization data...');
    const result = await this.server.refreshData();
    console.log(`✅ Loaded ${result.entities} entities, ${result.relations} relations`);

    // Validate health
    const health = await this.server.healthCheck();
    if (!health.healthy) {
      throw new Error('Server health check failed');
    }

    console.log('📈 Daily Knowledge Update Complete!');
    return result;
  }
}
```

---

## Configuration

### Environment Variables

```bash
# Default server port
export VKB_PORT=8080

# Project root directory
export VKB_PROJECT_ROOT=/path/to/project

# Logging level
export VKB_LOG_LEVEL=info

# Enable auto-restart
export VKB_AUTO_RESTART=true

# Disable automatic browser opening
export VKB_NO_BROWSER=true
```

### Configuration File

Create `.vkbrc` in project root:

```json
{
  "port": 8080,
  "logLevel": "info",
  "autoRestart": true,
  "healthCheckInterval": 30000,
  "browser": {
    "enabled": true,
    "command": "open"
  },
  "server": {
    "host": "localhost",
    "workers": 1
  }
}
```

---

## HTTP API Endpoints

When running, VKB exposes HTTP endpoints for integration:

### Health Check

```bash
curl http://localhost:8080/health
```

**Response:**
```json
{
  "status": "healthy",
  "uptime": 135000,
  "version": "2.0.0",
  "timestamp": "2025-06-20T10:30:00.000Z"
}
```

### Server Status

```bash
curl http://localhost:8080/api/status
```

**Response:**
```json
{
  "running": true,
  "pid": 12345,
  "port": 8080,
  "memory": {
    "rss": 47284224,
    "heapTotal": 32768000,
    "heapUsed": 18234000
  }
}
```

### Knowledge Base Info

```bash
curl http://localhost:8080/api/kb/info
```

**Response:**
```json
{
  "entities": 45,
  "relations": 123,
  "lastUpdated": "2025-06-20T10:25:00.000Z"
}
```

### Data Refresh

```bash
curl -X POST http://localhost:8080/api/kb/refresh
```

**Response:**
```json
{
  "success": true,
  "entities": 45,
  "relations": 123,
  "duration": 1250
}
```

---

## Troubleshooting

### Common Issues

```bash
# Port already in use
vkb port --kill
vkb start

# Server not responding
vkb stop --force
vkb start

# Data not updating
vkb-cli data refresh

# Permission issues
sudo vkb start  # or fix file permissions

# Check logs for errors
vkb logs --level error
```

### Debug Mode

```bash
# Start with debug logging
vkb fg --debug

# Check detailed status
vkb status --json --verbose

# Monitor health
watch -n 5 'vkb status'
```

---

## Full Documentation

For complete technical documentation, see:

**[lib/vkb-server/README.md](../../lib/vkb-server/README.md)**

Topics covered:
- Complete architecture documentation
- Server management details
- API reference with all methods
- Cross-platform compatibility
- Development guide

---

## See Also

- [UKB - Update Knowledge Base](./ukb-update.md)
- [Knowledge Workflows](./workflows.md)
- [Knowledge Management Overview](./README.md)
