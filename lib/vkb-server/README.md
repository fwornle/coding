# VKB Server

Node.js implementation of the VKB (View Knowledge Base) server management system.

## Overview

This module provides:
- HTTP server lifecycle management for the memory visualizer
- Data preparation and NDJSON conversion
- Cross-platform server management
- CLI interface for server control

## Architecture

```
vkb-server/
├── index.js          # Main VKBServer class
├── cli.js            # Commander-based CLI
├── server-manager.js # HTTP server lifecycle
├── data-processor.js # Memory data preparation
└── utils/
    └── logging.js    # Simple logging utility
```

## Usage

### As a Module

```javascript
import { VKBServer } from 'vkb-server';

const server = new VKBServer({
  port: 8080,
  projectRoot: '/path/to/coding'
});

// Start server
await server.start();

// Get status
const status = await server.status();

// Stop server
await server.stop();
```

### As a CLI

```bash
# Start server
vkb-cli server start

# Start in foreground
vkb-cli server start --foreground

# Stop server
vkb-cli server stop

# Get status
vkb-cli server status

# View logs
vkb-cli server logs -n 50
```

## Features

- **Automatic port management**: Detects and handles port conflicts
- **Process management**: Proper PID tracking and cleanup
- **Multi-source data access**: Reads from GraphDB (primary) and JSON exports (git-tracked persistence)
- **Three data modes**:
  - `online` (default) - GraphDB direct access
  - `batch` - Legacy JSON file mode
  - `combined` - Hybrid mode
- **Logging**: Structured logging with timestamps
- **Cross-platform**: Works on macOS, Linux, and Windows (with Python 3)

## Dependencies

- Node.js 14+
- Python 3 (for HTTP server)
- Commander (CLI framework)
- Chalk (terminal colors)
- Node-fetch (HTTP requests)

## Data Architecture (Phase 4)

VKB follows the Phase 4 knowledge management architecture:

- **Primary Runtime Storage**: GraphDB (Graphology + LevelDB) at `.data/knowledge-graph/`
- **Git-Tracked Persistence**: JSON exports at `.data/knowledge-export/*.json`
- **Default Mode**: `online` - reads entities and relations directly from GraphDB
- **Legacy Mode**: `batch` - reads from JSON files (deprecated for runtime use)

### Environment Variables

```bash
# Data source mode (online is default and recommended)
export VKB_DATA_SOURCE=online    # GraphDB (default)
export VKB_DATA_SOURCE=batch     # JSON files (legacy)
export VKB_DATA_SOURCE=combined  # Hybrid mode

# Team-scoped views
export KNOWLEDGE_VIEW=coding,ui  # Multi-team visualization
```

## Integration

This module is designed to work with:
- `GraphDatabaseService`: Primary data source (Graphology + LevelDB)
- `DatabaseManager`: SQLite metadata and optional Qdrant vectors
- `memory-visualizer`: The React visualization app
- `ukb-cli`: For knowledge base updates