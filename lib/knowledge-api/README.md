# Knowledge API

Agent-agnostic knowledge management system for coding assistants.

## Overview

The Knowledge API provides a stable, cross-platform interface for managing entities, relations, and insights across different coding assistants and platforms. It replaces the monolithic `ukb` bash script with a modular, testable, and maintainable Node.js-based system.

## Features

- **Entity Management**: CRUD operations for knowledge entities
- **Relationship Management**: Graph-based entity relationships
- **Insight Processing**: Automated extraction from conversations and code
- **Cross-platform**: Works on Windows, macOS, and Linux
- **Agent-agnostic**: Compatible with any coding assistant
- **Validation**: Schema validation for data integrity
- **Storage**: Pluggable storage backends (currently JSON file-based)
- **CLI Interface**: Modern command-line interface with interactive mode

## Installation

```bash
cd lib/knowledge-api
npm install
```

## Usage

### CLI Interface

```bash
# Show status
./bin/ukb-cli.js status

# List entities
./bin/ukb-cli.js entity list

# Add entity interactively
./bin/ukb-cli.js entity add --interactive

# Search entities
./bin/ukb-cli.js entity search "pattern"

# List relations
./bin/ukb-cli.js relation list

# Add relation interactively
./bin/ukb-cli.js relation add --interactive

# Process insight
./bin/ukb-cli.js insight --interactive

# Interactive mode
./bin/ukb-cli.js interactive

# Import/Export
./bin/ukb-cli.js import data.json
./bin/ukb-cli.js export backup.json
```

### Programmatic API

```javascript
import KnowledgeAPI from './index.js';

// Initialize API
const api = new KnowledgeAPI({
  storage: {
    path: './my-knowledge-base.json'
  }
});

await api.initialize();

// Create entity
const entity = await api.entities.create({
  name: 'React Hook Pattern',
  entityType: 'TechnicalPattern',
  observations: ['Custom hooks for state logic'],
  significance: 8
});

// Create relation
const relation = await api.relations.create({
  from: 'React Hook Pattern',
  to: 'React',
  relationType: 'implements'
});

// Process insight
const result = await api.insights.processInsight({
  type: 'problem-solution',
  problem: 'State management complexity',
  solution: 'Use custom hooks for reusable logic'
});

// Close API
await api.close();
```

## Architecture

### Core Components

- **EntityManager**: CRUD operations for entities
- **RelationManager**: Graph-based relationship management
- **InsightProcessor**: Automated insight extraction and processing
- **ValidationService**: Schema validation and data integrity
- **FileStorageAdapter**: JSON file-based storage backend
- **ConfigManager**: Cross-platform configuration management
- **Logger**: Structured logging with multiple outputs

### Data Model

#### Entity Schema
```json
{
  "id": "unique-id",
  "name": "Entity Name",
  "entityType": "WorkflowPattern|Problem|Solution|...",
  "observations": [
    {
      "type": "problem|solution|insight|...",
      "content": "Observation text",
      "date": "ISO date string"
    }
  ],
  "significance": 1-10,
  "created": "ISO date string",
  "updated": "ISO date string",
  "metadata": {}
}
```

#### Relation Schema
```json
{
  "id": "unique-id",
  "from": "Source Entity Name",
  "to": "Target Entity Name",
  "relationType": "implements|uses|solves|...",
  "significance": 1-10,
  "created": "ISO date string",
  "metadata": {}
}
```

## Configuration

The API uses a layered configuration system:

1. **Default configuration** (built-in)
2. **Project configuration** (`.knowledge-api.json` in project root)
3. **User configuration** (`~/.config/knowledge-api/config.json`)
4. **Environment variables** (override any setting)
5. **Constructor options** (highest precedence)

### Configuration Example

```json
{
  "storage": {
    "backend": "file",
    "path": "./shared-memory.json"
  },
  "integrations": {
    "mcp": {
      "enabled": true,
      "auto_sync": true
    },
    "visualizer": {
      "enabled": true,
      "path": "../memory-visualizer/dist/memory.json"
    }
  },
  "analysis": {
    "auto_commit_analysis": true,
    "significance_threshold": 7
  },
  "logging": {
    "level": "info",
    "console": true,
    "file": false
  }
}
```

### Environment Variables

- `KNOWLEDGE_API_STORAGE_PATH`: Override storage file path
- `KNOWLEDGE_API_LOG_LEVEL`: Set logging level
- `KNOWLEDGE_API_MCP_ENABLED`: Enable/disable MCP integration
- `KNOWLEDGE_API_SIGNIFICANCE_THRESHOLD`: Set significance threshold

## Testing

```bash
# Run all tests
npm test

# Run specific test file
node --test test/entities.test.js

# Run with verbose output
node --test --reporter=spec test/
```

## Migration from Legacy UKB

The new system maintains backwards compatibility with existing data:

1. **Data Format**: Existing `shared-memory.json` files work without changes
2. **Legacy Commands**: The `ukb-refactored` script provides compatibility layer
3. **Migration**: Automatic schema migration for enhanced features

### Migration Steps

1. Install the new API:
   ```bash
   cd lib/knowledge-api
   npm install
   ```

2. Test with existing data:
   ```bash
   ./bin/ukb-cli.js status
   ```

3. Replace old script (optional):
   ```bash
   mv knowledge-management/ukb knowledge-management/ukb-legacy
   ln -s ukb-refactored knowledge-management/ukb
   ```

## Development

### Project Structure

```
lib/knowledge-api/
├── index.js              # Main API entry point
├── package.json          # Dependencies and scripts
├── bin/
│   └── ukb-cli.js        # CLI interface
├── core/                 # Core business logic
│   ├── entities.js       # Entity management
│   ├── relations.js      # Relationship management
│   ├── insights.js       # Insight processing
│   └── validation.js     # Schema validation
├── adapters/             # Storage adapters
│   └── file-storage.js   # JSON file backend
├── analyzers/            # Content analyzers (future)
├── utils/                # Utilities
│   ├── config.js         # Configuration management
│   └── logging.js        # Structured logging
└── test/                 # Test suite
    ├── entities.test.js
    ├── relations.test.js
    └── knowledge-api.test.js
```

### Adding New Features

1. **New Entity Types**: Add to `ValidationService.ENTITY_TYPES`
2. **New Relation Types**: Add to `ValidationService.RELATION_TYPES`
3. **New Storage Backends**: Implement storage adapter interface
4. **New Analyzers**: Add to `analyzers/` directory
5. **New CLI Commands**: Extend `bin/ukb-cli.js`

### Contributing

1. Write tests for new features
2. Follow existing code style
3. Update documentation
4. Ensure backwards compatibility
5. Test on multiple platforms

## Future Roadmap

- **Graph Database Backend**: Neo4j/ArangoDB support
- **Real-time Sync**: Multi-user collaboration
- **Advanced Analytics**: Pattern mining and recommendation
- **Plugin System**: Extensible analyzers and exporters
- **Web Interface**: Browser-based knowledge management
- **API Server**: REST/GraphQL endpoints
- **Cloud Storage**: Remote storage backends

## License

MIT License - see LICENSE file for details.