# UKB Unified CLI Documentation

## Overview

UKB Unified CLI (lib/ukb-unified) is a modern, lock-free knowledge management system designed for software development teams. It provides intelligent routing between HTTP API and direct database access, checkpoint-based incremental processing, and seamless integration with the VKB Server.

**Current Version**: 2.0.0
**Location**: `lib/ukb-unified/`
**Documentation**: [ukb-lock-free-architecture.md](../ukb-lock-free-architecture.md)

## Documentation Structure

### 📐 [Architecture](../images/ukb-cli-architecture.png)
System architecture showing:
- UKB Unified CLI components
- Intelligent routing logic
- VKB Server integration
- GraphDB storage (Graphology + LevelDB)

![UKB System Architecture](../images/ukb-cli-architecture.png)

### 📚 [API Reference](./api-reference.md)
Complete API documentation covering:
- CLI commands and options
- VkbApiClient HTTP methods
- Data types and schemas
- Error handling

### 🎯 Use Cases
Real-world scenarios and examples:
- Incremental update workflow
- Entity and relation management
- Team checkpoint coordination
- Lock-free concurrent access

## Quick Start

### Installation

The UKB Unified CLI is installed as part of the coding infrastructure:

```bash
cd /Users/q284340/Agentic/coding
npm install
```

### Basic Usage

```bash
# Incremental update (default command)
ukb

# List all entities
ukb entity list

# Add an entity
ukb entity add "MyPattern" "TechnicalPattern" 8

# Check status
ukb status

# Manage checkpoints
ukb checkpoint
```

## Key Features

### 🌐 Lock-Free Architecture
- Intelligent routing between API and direct DB access
- No file locking or race conditions
- HTTP API for lock-free concurrent operations
- Automatic fallback to direct DB when server unavailable

### 🔄 Incremental Processing
- TeamCheckpointManager tracks last successful runs
- GapAnalyzer identifies what needs processing
- Automatic gap detection and processing
- Per-project checkpoint management

### 🧩 VKB Server Integration
- VkbApiClient for HTTP communication
- REST API endpoints: /api/entities, /api/relations, /api/health
- Real-time server availability checking
- Seamless failover strategy

### 📊 GraphDB Storage
- Graphology graph data structure
- LevelDB for persistent storage
- Efficient graph operations
- No JSON file locking issues

## Architecture Highlights

**System Architecture**:

![UKB Unified CLI Architecture](../images/ukb-cli-architecture.png)

The system follows a layered architecture:
- **CLI Layer**: UKBCli class with command routing
- **Command Layer**: EntityCommand, RelationCommand handlers
- **Core Services**: VkbApiClient, TeamCheckpointManager, GapAnalyzer, WorkflowOrchestrator
- **Intelligent Routing**: Server availability check and route decision
- **VKB Server**: REST API with GraphDB backend

**Class Structure**:

![UKB Class Diagram](../images/ukb-cli-class-diagram.png)

**Data Flow**:

![UKB Data Flow](../images/ukb-cli-data-flow.png)

## Common Workflows

### Incremental Update
```bash
# Run default incremental workflow
ukb

# What happens:
# 1. Load last checkpoint for current project
# 2. Analyze gaps since last run
# 3. Process missing items via VKB API
# 4. Save new checkpoint
```

### Entity Management
```bash
# List entities
ukb entity list

# Add entity
ukb entity add "CachingPattern" "TechnicalPattern" 8

# Remove entity
ukb entity remove "OldPattern"

# Search entities
ukb entity search "authentication"
```

### Relation Management
```bash
# List relations
ukb relation list

# Add relation
ukb relation add "Solution" "Problem" "solves" 9

# Remove relation
ukb relation remove "EntityA" "EntityB"
```

### Status and Checkpoint Management
```bash
# Check system status
ukb status

# View checkpoints
ukb checkpoint

# Clear checkpoint for current project
ukb checkpoint clear
```

## Integration with VKB Server

The UKB Unified CLI requires the VKB Server to be running for full functionality:

```bash
# Start VKB server (in separate terminal)
vkb server start

# Or start via coding infrastructure
./bin/coding --vkb
```

**Intelligent Routing**:
- When VKB server is running: Uses HTTP API (lock-free)
- When VKB server is stopped: Direct database access (requires server restart for full functionality)

**Server Endpoints**:
- `GET /api/health` - Health check
- `GET /api/entities` - List entities
- `POST /api/entities` - Create entity
- `DELETE /api/entities/:name` - Delete entity
- `GET /api/relations` - List relations
- `POST /api/relations` - Create relation
- `DELETE /api/relations` - Delete relation

## Technical Details

### Components

**UKBCli** (`lib/ukb-unified/cli.js`):
- Main entry point
- Command parsing and routing
- Help and version display

**VkbApiClient** (`lib/ukb-unified/core/VkbApiClient.js`):
- HTTP client for VKB Server
- Methods: getEntities, createEntity, deleteEntity, createRelation, etc.
- Server availability checking

**TeamCheckpointManager**:
- Manages checkpoint files per project
- Tracks last successful run timestamps
- Enables incremental processing

**GapAnalyzer**:
- Identifies gaps since last checkpoint
- Calculates missing items count
- Determines what needs processing

**WorkflowOrchestrator**:
- Coordinates incremental update workflow
- Manages retry logic
- Handles checkpoint updates

**EntityCommand** / **RelationCommand**:
- Command handlers for entity and relation operations
- Implements intelligent routing
- Formats output for CLI display

### Data Storage

**GraphDB** (Graphology + LevelDB):
- Graph structure: Nodes (entities) and edges (relations)
- Persistence: LevelDB key-value store
- Location: `.data/knowledge-graph/`

**Checkpoint Files**:
- Format: JSON
- Location: `.data/checkpoints/`
- Per-project tracking

## Comparison with Legacy Systems

| Aspect | lib/knowledge-api (v1.0) | lib/ukb-unified (v2.0) |
|--------|--------------------------|------------------------|
| Storage | JSON files (shared-memory.json) | GraphDB (Graphology + LevelDB) |
| Concurrency | File locking issues | Lock-free HTTP API |
| Architecture | EntityManager, RelationManager | VkbApiClient, Intelligent Routing |
| Processing | Manual/batch | Incremental with checkpoints |
| Server Integration | Optional | Core feature |
| Status | Deprecated (v3.0 removal) | Current |

## Troubleshooting

### Common Issues

```bash
# VKB server not responding
ukb status
# If server down: vkb server start

# Checkpoint issues
ukb checkpoint clear  # Clear and restart

# GraphDB corruption
# Stop VKB server, backup .data/knowledge-graph/, restart
```

## Next Steps

- **[Lock-Free Architecture](../ukb-lock-free-architecture.md)** - Complete technical documentation
- **[API Reference](./api-reference.md)** - Detailed API guide
- **[User Guide](./user-guide.md)** - Usage examples and workflows
- **[VKB Server Documentation](../../vkb-server/README.md)** - Server setup and configuration

## Related Documentation

- **[VKB Server Documentation](../../vkb-server/README.md)** - VKB Server architecture and API
- **[Lock-Free Architecture](../ukb-lock-free-architecture.md)** - Technical implementation details
- **[GraphDB Integration](../graphdb-integration.md)** - Graphology and LevelDB usage

## License

MIT License - see LICENSE file for details.
