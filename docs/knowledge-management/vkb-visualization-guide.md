# VKB - View Knowledge Base Visualization

**Version**: 3.0 (Phase 4)
**Last Updated**: 2025-10-24
**New Architecture**: GraphDB Primary Storage with JSON Git-Tracked Persistence

## Overview

VKB (View Knowledge Base) is an interactive web-based visualization tool for exploring knowledge graphs stored in the centralized GraphDB (Graphology + LevelDB). It uses D3.js force-directed graphs to visualize entities, relationships, and observations in an intuitive and interactive way.

**Phase 4 Architecture**:
- **Primary Storage**: GraphDB at `.data/knowledge-graph/` (runtime access)
- **Git-Tracked Exports**: JSON files at `.data/knowledge-export/*.json` (team collaboration)
- **Default Mode**: `online` - reads directly from GraphDB
- **Legacy Support**: `batch` mode for JSON file access (deprecated)

## What's New in v3.0 (Phase 4)

### GraphDB-First Architecture

VKB now reads directly from the centralized GraphDB:

1. **GraphDB Direct Access** (Default - `online` mode)
   - Real-time access to graph database
   - Reads entities from `GraphDB.queryEntities()`
   - Reads relations from `GraphDB.queryRelations()`
   - No intermediate JSON files needed for runtime
   - Team-scoped via node ID pattern: `${team}:${entityName}`

2. **JSON Export Files** (Git-Tracked Persistence)
   - Located at `.data/knowledge-export/*.json`
   - Auto-exported with 5-second debounce from GraphDB
   - Used for cross-project and cross-team collaboration
   - Imported back to GraphDB on startup
   - **NOT used for VKB runtime access**

3. **Legacy Batch Mode** (Deprecated)
   - Old JSON file-based access
   - Still supported via `VKB_DATA_SOURCE=batch`
   - Will be removed in future versions

### Visual Color Coding

| Node Type | Batch (Blue) | Online (Green) |
|-----------|--------------|----------------|
| Project | `#1e90ff` | `#059669` |
| Key Insight | `#87ceeb` | `#34d399` |
| Derived Concept | `#ccc` | `#a7f3d0` |
| Base Entity | `#3b82f6` | `#10b981` |
| System Entity | `#3cb371` (both sources) | |

---

## Quick Start

### Starting VKB Server

```bash
# Default: GraphDB direct access (online mode)
vkb start

# Legacy JSON file mode (deprecated)
VKB_DATA_SOURCE=batch vkb start

# Start in foreground for debugging
vkb fg

# Team-scoped visualization
KNOWLEDGE_VIEW=coding,ui vkb start
```

### Access the Visualization

Once started, open your browser to:
```
http://localhost:8080
```

The visualization will automatically load the appropriate memory file based on the selected data source.

---

## Usage Guide

### Data Source Selection

The VKB interface includes a **Knowledge Source** selector with three options:

1. **📘 Batch (Manual)**
   - Displays only manually curated knowledge from UKB
   - File: `/memory.json`

2. **🌐 Online (Auto-learned)**
   - Displays only automatically extracted knowledge
   - File: `/memory-online.json`

3. **🔄 Combined (Both)**
   - Displays merged knowledge from both sources
   - File: `/memory-combined.json`
   - Color-coded to distinguish sources

### Entity Information Panel

When you click on a node, the sidebar displays:

- **Entity Name**: The name of the knowledge item
- **Type**: Entity type (Pattern, Architecture, Solution, etc.)
- **Source Badge**:
  - 🌐 Online (Auto-learned) - green badge
  - 📘 Batch (Manual) - blue badge
- **Confidence Score**: For online knowledge (0-100%)
- **Extraction Timestamp**: When the knowledge was captured
- **Observations**: Detailed information and insights
- **Relations**: Inbound and outbound connections

### Stats and Legend

The interface displays:

- **Entity/Relation Counts**: Total nodes and connections
- **Source Breakdown**: Number of batch vs online entities
- **Color Legend**: Visual guide to node colors
- **Search Results**: When filtering is active

### Interactive Features

- **Search**: Filter entities by name or content
- **Entity Type Filter**: Show only specific types
- **Relation Type Filter**: Show only specific relationships
- **Node Selection**: Click to view details and navigate
- **Back/Forward**: Navigate through selection history
- **Zoom/Pan**: Mouse wheel to zoom, drag to pan
- **Drag Nodes**: Reposition nodes in the graph

---

## CLI Reference

### Command Options

```bash
# Server Management
vkb start                    # Start server (batch mode)
vkb start --with-online      # Start with combined view
vkb start --online-only      # Start with online-only view
vkb fg                       # Start in foreground (debugging)
vkb stop                     # Stop server
vkb restart                  # Restart server
vkb status                   # Show server status
vkb logs                     # Show server logs
vkb logs -n 50               # Show last 50 log lines

# Utilities
vkb port                     # Check port 8080 usage
vkb help                     # Show help message
```

### Environment Variables

```bash
# Data source mode (batch, online, combined)
export VKB_DATA_SOURCE=combined

# Team-specific knowledge bases
export KNOWLEDGE_VIEW=coding

# Custom knowledge base path
export CODING_KB_PATH=/path/to/knowledge
```

---

## Data Source Modes

### Online Mode (Default) ✅ RECOMMENDED

**What it shows**: Real-time access to GraphDB

**How it works**:
- VKB queries GraphDB directly via `GraphDatabaseService`
- Reads entities: `GraphDB.queryEntities({ team, limit: 5000 })`
- Reads relations: `GraphDB.queryRelations({ team, limit: 5000 })`
- No JSON file dependency for runtime access
- Data is always current with latest GraphDB state

**Usage**:
```bash
# Default mode - no environment variable needed
vkb start

# Explicit online mode
VKB_DATA_SOURCE=online vkb start
```

**Storage**: `.data/knowledge-graph/` (LevelDB + Graphology)

### Batch Mode (Legacy) ⚠️ DEPRECATED

**What it shows**: Static JSON file contents

**When to use**: Only for debugging or when GraphDB is unavailable

**How it works**:
- Reads from `.data/knowledge-export/*.json` files
- These files are git-tracked exports from GraphDB
- Used for cross-project collaboration, NOT runtime access

**Usage**:
```bash
# Legacy mode (not recommended)
VKB_DATA_SOURCE=batch vkb start
```

**Storage**: `.data/knowledge-export/*.json`

### Combined Mode

**What it shows**: Hybrid access (GraphDB + JSON files)

**Usage**:
```bash
VKB_DATA_SOURCE=combined vkb start
```

---

## Knowledge Management Workflow

### Complete Workflow

1. **Auto-Learning** (Online)
   - Work with Claude Code on projects
   - Knowledge automatically extracted and stored

2. **Manual Curation** (Batch)
   - Use `ukb` commands to add curated insights
   - Create structured knowledge entities

3. **Visualization** (VKB)
   - View combined knowledge graph
   - Explore relationships and patterns
   - Navigate entity details

### Example Session

```bash
# 1. Work on a project (online learning happens automatically)
claude-mcp
# ... code and discuss patterns ...

# 2. Add manual insights by typing in Claude chat:
# "ukb" - triggers MCP semantic-analysis workflow

# 3. Visualize combined knowledge
vkb start --with-online
# Open http://localhost:8080

# 4. Switch data sources in UI
# Use radio buttons to switch between batch/online/combined views
```

---

## Advanced Features

### Metadata Display

Online knowledge includes rich metadata:

- **Confidence Score**: How confident the system is about the extracted knowledge
- **Knowledge Type**: Pattern, Architecture, Bug Solution, etc.
- **Extraction Time**: When the knowledge was captured
- **Session ID**: Links back to the originating conversation
- **Project Context**: Which project the knowledge came from

### Similarity Relations

When online knowledge is exported, the system automatically:
- Generates semantic embeddings for each item
- Finds similar knowledge items using vector search
- Creates "related_to" relations based on similarity

**Threshold**: 0.75 similarity score (configurable)

### Search and Filtering

**Search Features**:
- Full-text search across entity names and observations
- Case-insensitive matching
- Real-time result highlighting

**Filter Options**:
- Entity Type (Pattern, Architecture, Solution, etc.)
- Relation Type (related_to, implements, uses, etc.)
- Data Source (via source selector)

---

## Troubleshooting

### Server Won't Start

```bash
# Check if port 8080 is already in use
vkb port

# Check server status
vkb status

# View logs for errors
vkb logs -n 100
```

### No Online Knowledge Shown

**Possible causes**:
1. No online knowledge has been extracted yet
2. Databases not initialized
3. Export failed

**Solutions**:
```bash
# Check if databases exist
ls -la /Users/q284340/Agentic/coding/*.db

# Check for memory-online.json
ls -la /Users/q284340/Agentic/coding/memory-visualizer/dist/memory-online.json

# Restart server with debugging
vkb stop
VKB_DATA_SOURCE=online vkb fg
```

### Combined View Shows Only One Source

**Check**:
1. Both `memory.json` and `memory-online.json` exist
2. Server restarted after data updates
3. Correct data source selected in UI

**Solution**:
```bash
# Restart to regenerate combined view
vkb restart --with-online
```

### Node Colors Not Showing Correctly

**Issue**: Metadata might be missing from entities

**Check**: Click on a node and verify the "Source" badge appears

**Fix**: Ensure knowledge was exported with metadata:
- Batch knowledge: Always has implicit "batch" source
- Online knowledge: Should have `metadata.source = "online"`

---

## Configuration

### Server Configuration

VKB server configuration is managed through environment variables and options passed to the `DataProcessor` class.

**Key Settings**:
```javascript
{
  dataSourceMode: 'online',  // default: GraphDB direct access
  // dataSourceMode: 'batch' | 'combined',  // legacy modes
  port: 8080,
  projectRoot: '/Users/q284340/Agentic/coding',
  visualizerDir: 'memory-visualizer/',
  graphDbPath: '.data/knowledge-graph/',  // PRIMARY storage
  exportDir: '.data/knowledge-export/'    // git-tracked persistence
}
```

### Export Configuration

Online knowledge export settings (in `KnowledgeExportService`):

```javascript
{
  limit: 5000,              // Max items to export
  minConfidence: 0.5,       // Minimum confidence threshold (0-1)
  includeRelations: true,   // Generate similarity relations
  similarityThreshold: 0.75 // Minimum similarity for relations
}
```

---

## Best Practices

### 1. Regular Visualization Review

```bash
# Review knowledge weekly
vkb start --with-online

# Look for:
# - Duplicate patterns (batch vs online)
# - Low-confidence online knowledge to verify
# - Gaps in knowledge coverage
```

### 2. Curate High-Value Online Knowledge

When you see valuable auto-learned knowledge:
1. Review confidence scores
2. Verify accuracy
3. Consider promoting to batch with `ukb` for permanence

### 3. Use Combined View for Discovery

The combined view helps:
- See how auto-learned patterns relate to curated knowledge
- Identify redundant manual entries
- Find knowledge gaps to fill with UKB

### 4. Source-Specific Workflows

**Batch (Manual)**:
- High-value architectural decisions
- Project-specific patterns
- Curated best practices

**Online (Auto-learned)**:
- Emerging patterns from recent work
- Code-specific solutions
- Experimental approaches

### 5. Monitor Knowledge Quality

Use the metadata panel to:
- Check confidence scores
- Verify extraction timestamps
- Review session context

---

## API Integration (Future)

Future versions will support:
- REST API for programmatic access
- Knowledge export in multiple formats
- Direct database queries
- Knowledge merging and deduplication

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Click | Select node and show details |
| Drag | Pan the graph |
| Mouse Wheel | Zoom in/out |
| Backspace | Go back in selection history |
| Escape | Deselect current node |

---

## File Locations

**VKB Server**:
- Binary: `/Users/q284340/Agentic/coding/bin/vkb-cli.js`
- Wrapper: `/Users/q284340/Agentic/coding/knowledge-management/vkb`

**Data Storage (Phase 4 Architecture)**:
- **GraphDB** (PRIMARY): `/Users/q284340/Agentic/coding/.data/knowledge-graph/`
  - Graphology (in-memory)
  - LevelDB (persistent)
  - Runtime access via GraphDatabaseService
- **JSON Exports** (git-tracked): `/Users/q284340/Agentic/coding/.data/knowledge-export/*.json`
  - Auto-exported from GraphDB (5s debounce)
  - Auto-imported to GraphDB on startup
  - Team collaboration via git
  - NOT used for VKB runtime access
- **Visualization Cache** (generated): `/Users/q284340/Agentic/coding/memory-visualizer/dist/memory*.json`
  - Created from GraphDB queries (online mode)
  - Or from JSON exports (batch mode - deprecated)

**Visualizer**:
- Directory: `/Users/q284340/Agentic/coding/memory-visualizer/`
- Built Files: `/Users/q284340/Agentic/coding/memory-visualizer/dist/`

---

**Document Version**: 2.0
**Feature Release**: 2025-10-19
**Next Review**: 2025-11-19
