# VKB-CLI API Reference

## Overview

VKB-CLI provides both command-line and programmatic interfaces for knowledge visualization server management. This reference covers all available commands, options, and APIs.

## Command Line Interface

### Basic Commands

```bash
vkb [command] [options]
```

#### `vkb` or `vkb start`
Start the visualization server (default command).

**Usage:**
```bash
vkb
vkb start
```

**Options:**
- `--port <number>`: Server port (default: 8080)
- `--foreground`: Start in foreground mode
- `--force`: Force restart if already running
- `--no-browser`: Don't open browser automatically

**Examples:**
```bash
# Start server on default port
vkb

# Start on custom port
vkb start --port 3000

# Start in foreground mode for debugging
vkb start --foreground

# Start without opening browser
vkb start --no-browser
```

#### `vkb stop`
Stop the visualization server.

**Usage:**
```bash
vkb stop
```

**Options:**
- `--force`: Force kill if graceful shutdown fails
- `--timeout <seconds>`: Shutdown timeout (default: 10)

**Examples:**
```bash
# Graceful shutdown
vkb stop

# Force kill if needed
vkb stop --force
```

#### `vkb restart`
Restart the visualization server.

**Usage:**
```bash
vkb restart
```

**Options:**
- `--port <number>`: Server port for restart
- `--force`: Force restart even if not running
- `--no-browser`: Don't open browser after restart

**Examples:**
```bash
# Standard restart
vkb restart

# Restart on different port
vkb restart --port 9000
```

#### `vkb status`
Show current server status.

**Usage:**
```bash
vkb status
```

**Options:**
- `--json`: Output status in JSON format
- `--verbose`: Show detailed status information

**Examples:**
```bash
# Basic status check
vkb status

# Detailed status with JSON output
vkb status --json --verbose
```

**Output Format:**
```json
{
  "running": true,
  "pid": 12345,
  "port": 8080,
  "url": "http://localhost:8080",
  "uptime": "2h 15m",
  "memory": "45.2 MB",
  "logFile": "/tmp/vkb-server.log"
}
```

#### `vkb logs`
Display server logs.

**Usage:**
```bash
vkb logs [options]
```

**Options:**
- `-n, --lines <number>`: Number of lines to show (default: 50)
- `-f, --follow`: Follow log output (tail -f behavior)
- `--level <level>`: Filter by log level (error, warn, info, debug)
- `--since <time>`: Show logs since timestamp
- `--json`: Output logs in JSON format

**Examples:**
```bash
# Show last 50 lines
vkb logs

# Show last 100 lines
vkb logs -n 100

# Follow log output
vkb logs --follow

# Show only errors
vkb logs --level error

# Show logs since 1 hour ago
vkb logs --since "1 hour ago"
```

#### `vkb fg` or `vkb foreground`
Start server in foreground mode.

**Usage:**
```bash
vkb fg
vkb foreground
```

**Options:**
- `--port <number>`: Server port
- `--debug`: Enable debug logging
- `--no-browser`: Don't open browser

**Examples:**
```bash
# Start in foreground
vkb fg

# Start with debug logging
vkb fg --debug
```

#### `vkb port`
Check what's using the server port.

**Usage:**
```bash
vkb port [port]
```

**Options:**
- `--kill`: Kill processes using the port
- `--json`: Output in JSON format

**Examples:**
```bash
# Check default port (8080)
vkb port

# Check specific port
vkb port 3000

# Kill processes using port
vkb port --kill
```

### Advanced Commands

#### `vkb-cli server`
Advanced server management commands.

**Subcommands:**
- `start`: Start server with advanced options
- `stop`: Stop server with advanced options
- `restart`: Restart server with advanced options
- `status`: Detailed server status
- `logs`: Advanced log management
- `health`: Health check endpoint

**Examples:**
```bash
# Start with advanced configuration
vkb-cli server start --port 3000 --workers 4

# Get health status
vkb-cli server health

# Advanced log management
vkb-cli server logs --format json --rotate
```

#### `vkb-cli data`
Data management commands.

**Subcommands:**
- `refresh`: Refresh knowledge base data
- `validate`: Validate data integrity
- `export`: Export data in various formats
- `import`: Import data from external sources

**Examples:**
```bash
# Refresh data from shared-memory.json
vkb-cli data refresh

# Validate data integrity
vkb-cli data validate

# Export data to JSON
vkb-cli data export --format json --output kb-export.json
```

#### `vkb-cli config`
Configuration management commands.

**Subcommands:**
- `show`: Display current configuration
- `set`: Set configuration values
- `reset`: Reset to default configuration

**Examples:**
```bash
# Show current configuration
vkb-cli config show

# Set default port
vkb-cli config set port 9000

# Reset configuration
vkb-cli config reset
```

## Programmatic JavaScript API

### VKBServer Class

Import the VKBServer class for programmatic control:

```javascript
const { VKBServer } = require('vkb-server');
// or
import { VKBServer } from 'vkb-server';
```

#### Constructor

```javascript
const server = new VKBServer(options)
```

**Options:**
```javascript
{
  port: 8080,                           // Server port
  projectRoot: '/path/to/project',      // Project root directory
  visualizerDir: '/path/to/visualizer', // Memory visualizer location
  sharedMemoryPath: '/path/to/shared-memory.json', // Knowledge base file
  logLevel: 'info',                     // Logging level
  autoRestart: true,                    // Auto-restart on crash
  healthCheckInterval: 30000            // Health check interval (ms)  
}
```

**Example:**
```javascript
const server = new VKBServer({
  port: 3000,
  projectRoot: process.cwd(),
  logLevel: 'debug'
});
```

#### Methods

##### `start(options)`

Start the server with optional configuration override.

**Parameters:**
```javascript
{
  foreground: false,    // Run in foreground
  force: false,         // Force restart if running
  openBrowser: true     // Open browser automatically
}
```

**Returns:** `Promise<ServerStartResult>`

```javascript
{
  success: true,
  pid: 12345,
  port: 8080,
  url: 'http://localhost:8080',
  logFile: '/tmp/vkb-server.log'
}
```

**Example:**
```javascript
try {
  const result = await server.start({
    foreground: false,
    openBrowser: true
  });
  console.log(`Server started at ${result.url}`);
} catch (error) {
  console.error('Failed to start server:', error.message);
}
```

##### `stop(options)`

Stop the server gracefully.

**Parameters:**
```javascript
{
  force: false,         // Force kill if graceful fails
  timeout: 10000        // Shutdown timeout (ms)
}
```

**Returns:** `Promise<ServerStopResult>`

```javascript
{
  success: true,
  pid: 12345,
  graceful: true,
  duration: 2300        // Shutdown duration (ms)
}
```

**Example:**
```javascript
try {
  const result = await server.stop();
  console.log(`Server stopped (PID: ${result.pid})`);
} catch (error) {
  console.error('Failed to stop server:', error.message);
}
```

##### `restart(options)`

Restart the server.

**Parameters:** Same as `start()` options

**Returns:** `Promise<ServerStartResult>`

**Example:**
```javascript
const result = await server.restart({
  force: true,
  openBrowser: false
});
```

##### `status()`

Get current server status.

**Returns:** `Promise<ServerStatus>`

```javascript
{
  running: true,
  pid: 12345,
  port: 8080,
  url: 'http://localhost:8080',
  uptime: 135000,       // Uptime in milliseconds
  memory: {
    rss: 47284224,      // Resident set size
    heapTotal: 32768000, // Heap total
    heapUsed: 18234000,  // Heap used
    external: 1024000    // External memory
  },
  logFile: '/tmp/vkb-server.log',
  healthy: true,
  lastHealthCheck: '2025-06-20T10:30:00.000Z'
}
```

**Example:**
```javascript
const status = await server.status();
if (status.running) {
  console.log(`Server running on port ${status.port}`);
  console.log(`Uptime: ${status.uptime}ms`);
  console.log(`Memory usage: ${status.memory.heapUsed} bytes`);
}
```

##### `logs(options)`

Retrieve server logs.

**Parameters:**
```javascript
{
  lines: 50,            // Number of lines to retrieve
  level: 'info',        // Log level filter
  since: null,          // Timestamp to start from
  format: 'text'        // Output format (text|json)
}
```

**Returns:** `Promise<LogResult>`

```javascript
{
  lines: [
    {
      timestamp: '2025-06-20T10:30:00.000Z',
      level: 'info',
      message: 'Server started on port 8080',
      meta: {}
    }
  ],
  total: 150,           // Total lines available
  truncated: false      // Whether output was truncated
}
```

**Example:**
```javascript
const logs = await server.logs({
  lines: 100,
  level: 'error',
  format: 'json'
});

logs.lines.forEach(entry => {
  console.log(`[${entry.level}] ${entry.message}`);
});
```

##### `refreshData()`

Refresh knowledge base data without restarting server.

**Returns:** `Promise<RefreshResult>`

```javascript
{
  success: true,
  entities: 45,         // Number of entities loaded
  relations: 123,       // Number of relations loaded
  duration: 1250        // Processing duration (ms)
}
```

**Example:**
```javascript
const result = await server.refreshData();
console.log(`Loaded ${result.entities} entities, ${result.relations} relations`);
```

##### `healthCheck()`

Perform server health check.

**Returns:** `Promise<HealthResult>`

```javascript
{
  healthy: true,
  responseTime: 45,     // Response time in ms
  endpoints: {
    '/': { status: 200, responseTime: 12 },
    '/health': { status: 200, responseTime: 8 },
    '/api/entities': { status: 200, responseTime: 25 }
  },
  timestamp: '2025-06-20T10:30:00.000Z'
}
```

**Example:**
```javascript
const health = await server.healthCheck();
if (!health.healthy) {
  console.error('Server health check failed');
  console.log('Endpoint status:', health.endpoints);
}
```

### Event Handling

The VKBServer class extends EventEmitter and emits events for server lifecycle changes:

```javascript
server.on('starting', () => {
  console.log('Server is starting...');
});

server.on('started', (result) => {
  console.log(`Server started on port ${result.port}`);
});

server.on('stopping', () => {
  console.log('Server is stopping...');
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

### Configuration Management

#### Environment Variables

VKB-CLI respects the following environment variables:

- `VKB_PORT`: Default server port
- `VKB_PROJECT_ROOT`: Project root directory
- `VKB_LOG_LEVEL`: Logging level (debug, info, warn, error)
- `VKB_AUTO_RESTART`: Enable auto-restart on crash
- `VKB_HEALTH_CHECK_INTERVAL`: Health check interval in ms
- `VKB_BROWSER_COMMAND`: Custom browser command
- `VKB_NO_BROWSER`: Disable automatic browser opening

**Example:**
```bash
export VKB_PORT=9000
export VKB_LOG_LEVEL=debug
vkb start
```

#### Configuration File

VKB-CLI can read configuration from a `.vkbrc` file in the project root:

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

### Error Handling

#### Error Types

VKB-CLI defines several error types for different failure scenarios:

```javascript
const { 
  VKBServerError,
  VKBStartupError,
  VKBConfigurationError,
  VKBDataError 
} = require('vkb-server/errors');

try {
  await server.start();
} catch (error) {
  if (error instanceof VKBStartupError) {
    console.error('Server startup failed:', error.message);
  } else if (error instanceof VKBConfigurationError) {
    console.error('Configuration error:', error.message);
  } else {
    console.error('Unexpected error:', error.message);
  }
}
```

#### Error Codes

Common error codes and their meanings:

- `VKB_PORT_IN_USE`: Port already in use
- `VKB_PERMISSION_DENIED`: Permission denied for operation
- `VKB_DATA_INVALID`: Invalid knowledge base data
- `VKB_SERVER_CRASHED`: Server process crashed
- `VKB_TIMEOUT`: Operation timed out
- `VKB_NOT_RUNNING`: Server not running when expected
- `VKB_ALREADY_RUNNING`: Server already running when starting

## HTTP API Endpoints

When running, VKB-CLI exposes several HTTP endpoints for integration.

### Startup State & Health

VKB uses a **lazy initialization pattern** where the HTTP server starts immediately and initialization happens in the background. This enables robust health checks during startup.

#### Liveness Check (Health)
```
GET /health
```

Returns immediately with startup state. Always returns HTTP 200 if server process is alive.

**Response during startup:**
```json
{
  "status": "starting",
  "timestamp": "2026-01-22T09:00:00.000Z",
  "startupTimeMs": 1250,
  "ready": false,
  "details": {
    "databaseManagerReady": true,
    "dataProcessorReady": false
  }
}
```

**Response when ready:**
```json
{
  "status": "ready",
  "timestamp": "2026-01-22T09:00:05.000Z",
  "startupTimeMs": 5234,
  "ready": true
}
```

**Response on error (server still serves cached data):**
```json
{
  "status": "error",
  "timestamp": "2026-01-22T09:00:05.000Z",
  "startupTimeMs": 5234,
  "ready": false,
  "error": "Failed to connect to GraphDB"
}
```

#### Readiness Check
```
GET /ready
```

Returns HTTP 200 only when fully initialized. Returns HTTP 503 during startup.

**Response when ready (HTTP 200):**
```json
{
  "status": "ready",
  "timestamp": "2026-01-22T09:00:05.000Z",
  "startupTimeMs": 5234,
  "ready": true
}
```

**Response during startup (HTTP 503):**
```json
{
  "status": "starting",
  "timestamp": "2026-01-22T09:00:00.000Z",
  "startupTimeMs": 1250,
  "ready": false,
  "details": {
    "databaseManagerReady": true,
    "dataProcessorReady": false
  }
}
```

#### Database Health Check
```
GET /api/health
```

Comprehensive database connectivity check. Returns detailed backend status.

**Response:**
```json
{
  "status": "healthy",
  "backends": {
    "graphDB": { "available": true, "entities": 45, "relations": 123 },
    "sqlite": { "available": true },
    "qdrant": { "available": true, "collections": 4 }
  },
  "timestamp": "2026-01-22T09:00:05.000Z"
}
```

### Startup State Diagram

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  starting   │ ──► │    ready    │     │    error    │
│             │     │             │     │             │
│ HTTP alive  │     │ Fully init  │     │ Init failed │
│ Init in bg  │     │ All backends│     │ Cached data │
└─────────────┘     └─────────────┘     └─────────────┘
     │                                        ▲
     └────────────────────────────────────────┘
                  (on init error)
```

### Legacy Health Check

### Server Status
```
GET /api/status
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
```
GET /api/kb/info
```

**Response:**
```json
{
  "entities": 45,
  "relations": 123,
  "lastUpdated": "2025-06-20T10:25:00.000Z",
  "version": "1.2.3"
}
```

### Data Refresh
```
POST /api/kb/refresh
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

## WebSocket API (Future)

Planned WebSocket endpoints for real-time updates:

### Connection
```javascript
const ws = new WebSocket('ws://localhost:8080/ws');

ws.on('message', (data) => {
  const event = JSON.parse(data);
  switch (event.type) {
    case 'kb_updated':
      console.log('Knowledge base updated');
      break;
    case 'server_status':
      console.log('Server status:', event.data);
      break;
  }
});
```

### Events
- `kb_updated`: Knowledge base data changed
- `server_status`: Server status update
- `health_check`: Health check result
- `error`: Server error occurred

This API reference provides comprehensive coverage of all VKB-CLI interfaces for both command-line usage and programmatic integration.