# UKB-CLI API Reference

## Table of Contents
1. [CLI Commands](#cli-commands)
2. [Programmatic API](#programmatic-api)
3. [Configuration](#configuration)
4. [Data Types](#data-types)
5. [Error Handling](#error-handling)

## CLI Commands

### Global Options

```bash
ukb-cli [options] <command>

Options:
  -V, --version     output the version number
  -h, --help        display help for command
```

### Commands Overview

| Command | Description |
|---------|-------------|
| `status` | Show knowledge base status |
| `entity` | Manage entities |
| `relation` | Manage relations |
| `insight` | Process insights |
| `import` | Import data from JSON |
| `export` | Export data to JSON |
| `interactive` | Start interactive mode |

### `ukb-cli status`

Display current knowledge base statistics and configuration.

```bash
ukb-cli status
```

**Output:**
```
Knowledge base status:
Storage: ./shared-memory.json
Entities: 234
Relations: 567
Last Updated: 2024-06-19T10:30:00Z
Version: 1.0.0
```

### `ukb-cli entity`

Manage entities in the knowledge base.

#### `entity list`

List all entities with optional filters.

```bash
ukb-cli entity list [options]

Options:
  -t, --type <type>              Filter by entity type
  -s, --min-significance <n>     Minimum significance score (1-10)
  -v, --verbose                  Show detailed information
```

**Examples:**
```bash
# List all entities
ukb-cli entity list

# List only TechnicalPattern entities
ukb-cli entity list --type TechnicalPattern

# List high-significance entities with details
ukb-cli entity list --min-significance 8 --verbose
```

#### `entity add`

Add a new entity to the knowledge base.

```bash
ukb-cli entity add [options]

Options:
  -n, --name <name>              Entity name (required in non-interactive)
  -t, --type <type>              Entity type
  -s, --significance <n>         Significance score (1-10)
  -o, --observation <text>       Initial observation
  -i, --interactive              Interactive mode
```

**Examples:**
```bash
# Interactive mode
ukb-cli entity add --interactive

# Direct creation
ukb-cli entity add -n "CachingPattern" -t "TechnicalPattern" -s 8 \
  -o "Implement Redis caching for API responses"
```

#### `entity remove`

Remove an entity from the knowledge base.

```bash
ukb-cli entity remove [options]

Options:
  -n, --name <name>              Entity name
  -i, --interactive              Interactive selection
```

#### `entity search`

Search entities by keyword.

```bash
ukb-cli entity search <query> [options]

Options:
  -v, --verbose                  Show detailed information
```

**Examples:**
```bash
# Search for caching-related entities
ukb-cli entity search "cache"

# Detailed search results
ukb-cli entity search "error handling" --verbose
```

### `ukb-cli relation`

Manage relationships between entities.

#### `relation list`

List all relations with optional filters.

```bash
ukb-cli relation list [options]

Options:
  -f, --from <entity>            Filter by source entity
  -t, --to <entity>              Filter by target entity
  -r, --type <type>              Filter by relation type
```

**Examples:**
```bash
# List all relations
ukb-cli relation list

# List relations from specific entity
ukb-cli relation list --from "ReactHooksPattern"

# List all "implements" relations
ukb-cli relation list --type implements
```

#### `relation add`

Create a new relation between entities.

```bash
ukb-cli relation add [options]

Options:
  -f, --from <entity>            Source entity
  -t, --to <entity>              Target entity
  -r, --type <type>              Relation type
  -s, --significance <n>         Significance score (1-10)
  -i, --interactive              Interactive mode
```

**Examples:**
```bash
# Interactive mode
ukb-cli relation add --interactive

# Direct creation
ukb-cli relation add -f "Solution" -t "Problem" -r "solves" -s 9
```

### `ukb-cli insight`

Process insights to create entities and relations.

```bash
ukb-cli insight [options]

Options:
  -i, --interactive              Interactive mode (recommended)
```

**Interactive Flow:**
1. Select insight type (problem-solution, technical-pattern, etc.)
2. Provide insight details
3. System creates entities and relations automatically

### `ukb-cli import/export`

Import or export knowledge base data.

```bash
# Export to file
ukb-cli export <file>

# Import from file
ukb-cli import <file> [options]

Options:
  -m, --merge                    Merge with existing data
```

**Examples:**
```bash
# Backup current knowledge base
ukb-cli export backup-2024-06-19.json

# Import and merge with existing data
ukb-cli import team-patterns.json --merge
```

### `ukb-cli interactive`

Start interactive mode for guided operations.

```bash
ukb-cli interactive
```

**Features:**
- Menu-driven interface
- Guided workflows
- Input validation
- Contextual help

## Programmatic API

### KnowledgeAPI Class

Main entry point for programmatic access.

```javascript
import KnowledgeAPI from 'knowledge-api';

const api = new KnowledgeAPI(options);
```

#### Constructor Options

```typescript
interface KnowledgeAPIOptions {
  storage?: {
    backend?: 'file';
    path?: string;
  };
  logging?: {
    level?: 'error' | 'warn' | 'info' | 'debug';
    console?: boolean;
    file?: boolean;
    filePath?: string;
  };
  integrations?: {
    mcp?: { enabled: boolean; auto_sync: boolean };
    visualizer?: { enabled: boolean; path: string };
  };
}
```

#### Methods

##### `initialize(): Promise<void>`

Initialize the API and storage backend.

```javascript
await api.initialize();
```

##### `getStatus(): Promise<Status>`

Get current knowledge base status.

```javascript
const status = await api.getStatus();
console.log(`Entities: ${status.stats.entities}`);
```

##### `close(): Promise<void>`

Close the API and save pending changes.

```javascript
await api.close();
```

### EntityManager

Accessed via `api.entities`.

#### Methods

##### `create(entityData): Promise<Entity>`

Create a new entity.

```javascript
const entity = await api.entities.create({
  name: 'MyPattern',
  entityType: 'TechnicalPattern',
  observations: ['Pattern implementation details'],
  significance: 8
});
```

##### `findByName(name): Promise<Entity|undefined>`

Find entity by name.

```javascript
const entity = await api.entities.findByName('MyPattern');
```

##### `findById(id): Promise<Entity|undefined>`

Find entity by ID.

```javascript
const entity = await api.entities.findById('uuid-here');
```

##### `getAll(filters): Promise<Entity[]>`

Get all entities with optional filters.

```javascript
// Get all entities
const all = await api.entities.getAll();

// Filter by type
const patterns = await api.entities.getAll({ 
  entityType: 'TechnicalPattern' 
});

// Filter by significance
const important = await api.entities.getAll({ 
  minSignificance: 8 
});

// Search entities
const results = await api.entities.getAll({ 
  search: 'caching' 
});
```

##### `update(nameOrId, updates): Promise<Entity>`

Update an existing entity.

```javascript
const updated = await api.entities.update('MyPattern', {
  significance: 9,
  observations: [...newObservations]
});
```

##### `delete(nameOrId): Promise<boolean>`

Delete an entity.

```javascript
const success = await api.entities.delete('OldPattern');
```

##### `addObservation(nameOrId, observation): Promise<Observation>`

Add observation to entity.

```javascript
const obs = await api.entities.addObservation('MyPattern', {
  type: 'insight',
  content: 'New implementation discovered',
  tags: ['performance', 'optimization']
});
```

##### `search(query, options): Promise<Entity[]>`

Search entities by keyword.

```javascript
const results = await api.entities.search('error handling');
```

### RelationManager

Accessed via `api.relations`.

#### Methods

##### `create(relationData): Promise<Relation>`

Create a new relation.

```javascript
const relation = await api.relations.create({
  from: 'Solution',
  to: 'Problem',
  relationType: 'solves',
  significance: 8
});
```

##### `findRelation(from, to, type?): Promise<Relation|undefined>`

Find specific relation.

```javascript
const relation = await api.relations.findRelation(
  'Solution', 
  'Problem', 
  'solves'
);
```

##### `getAll(filters): Promise<Relation[]>`

Get all relations with filters.

```javascript
// Get all relations
const all = await api.relations.getAll();

// Filter by entity
const entityRelations = await api.relations.getAll({ 
  entity: 'MyPattern' 
});

// Filter by type
const implementations = await api.relations.getAll({ 
  relationType: 'implements' 
});
```

##### `getForEntity(entityName, direction): Promise<Relation[]>`

Get relations for specific entity.

```javascript
// Both directions
const all = await api.relations.getForEntity('MyPattern', 'both');

// Only outgoing
const outgoing = await api.relations.getForEntity('MyPattern', 'outgoing');

// Only incoming
const incoming = await api.relations.getForEntity('MyPattern', 'incoming');
```

##### `getConnectedEntities(entityName, maxDepth): Promise<Connection[]>`

Get transitively connected entities.

```javascript
const connected = await api.relations.getConnectedEntities('MyPattern', 3);
```

##### `findPath(from, to, maxDepth): Promise<string[]|null>`

Find shortest path between entities.

```javascript
const path = await api.relations.findPath('Problem', 'Solution', 5);
// Returns: ['Problem', 'Intermediate', 'Solution'] or null
```

### InsightProcessor

Accessed via `api.insights`.

#### Methods

##### `processInsight(insightData): Promise<ProcessResult>`

Process an insight to create entities and relations.

```javascript
const result = await api.insights.processInsight({
  type: 'problem-solution',
  problem: 'Memory leak in React components',
  solution: 'Implement cleanup in useEffect',
  context: { project: 'webapp' }
});

console.log(`Created ${result.entities.length} entities`);
```

##### `analyzeConversation(text, context): Promise<Insight[]>`

Extract insights from conversation text.

```javascript
const insights = await api.insights.analyzeConversation(
  conversationText,
  { source: 'claude', project: 'myapp' }
);
```

##### `extractPatterns(options): Promise<Pattern[]>`

Extract high-value patterns.

```javascript
const patterns = await api.insights.extractPatterns({
  minSignificance: 8,
  maxResults: 10
});
```

### ValidationService

Accessed via `api.validation`.

#### Methods

##### `validateEntity(data): Promise<ValidationResult>`

Validate entity data.

```javascript
const result = await api.validation.validateEntity({
  name: 'Test',
  entityType: 'Pattern'
});

if (!result.valid) {
  console.error(result.errors);
}
```

#### Constants

```javascript
// Available entity types
ValidationService.ENTITY_TYPES

// Available relation types  
ValidationService.RELATION_TYPES

// Validation patterns
ValidationService.PATTERNS
```

## Configuration

### Configuration Schema

```typescript
interface Configuration {
  storage: {
    backend: 'file';
    path: string;
  };
  integrations: {
    mcp: {
      enabled: boolean;
      auto_sync: boolean;
    };
    visualizer: {
      enabled: boolean;
      path: string;
      auto_sync: boolean;
    };
  };
  analysis: {
    auto_commit_analysis: boolean;
    significance_threshold: number;
    max_commits_per_session: number;
  };
  logging: {
    level: 'error' | 'warn' | 'info' | 'debug';
    console: boolean;
    file: boolean;
    filePath?: string;
  };
  validation: {
    strict_mode: boolean;
    auto_fix: boolean;
  };
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `KNOWLEDGE_API_STORAGE_PATH` | Storage file path | `./shared-memory.json` |
| `KNOWLEDGE_API_LOG_LEVEL` | Logging level | `info` |
| `KNOWLEDGE_API_MCP_ENABLED` | Enable MCP integration | `true` |
| `KNOWLEDGE_API_SIGNIFICANCE_THRESHOLD` | Default significance | `7` |

## Data Types

### Entity

```typescript
interface Entity {
  id: string;
  name: string;
  entityType: EntityType;
  observations: Observation[];
  significance: number;        // 1-10
  created: string;            // ISO timestamp
  updated: string;            // ISO timestamp
  metadata: Record<string, any>;
}
```

### Relation

```typescript
interface Relation {
  id: string;
  from: string;               // Entity name
  to: string;                 // Entity name
  relationType: RelationType;
  significance: number;       // 1-10
  created: string;           // ISO timestamp
  metadata: Record<string, any>;
}
```

### Observation

```typescript
interface Observation {
  type: 'problem' | 'solution' | 'insight' | 'metric' | 'general';
  content: string;
  date: string;              // ISO timestamp
  tags?: string[];
  metadata?: Record<string, any>;
}
```

### Entity Types

```typescript
type EntityType = 
  | 'WorkflowPattern'
  | 'TechnicalPattern'
  | 'ArchitecturePattern'
  | 'Problem'
  | 'Solution'
  | 'Insight'
  | 'Tool'
  | 'Library'
  | 'Framework'
  | 'Best Practice'
  | 'Anti-Pattern'
  | string;  // Custom types allowed
```

### Relation Types

```typescript
type RelationType = 
  | 'implements'
  | 'extends'
  | 'uses'
  | 'requires'
  | 'depends_on'
  | 'related_to'
  | 'solves'
  | 'causes'
  | 'prevents'
  | 'improves'
  | 'replaces'
  | string;  // Custom types allowed
```

## Error Handling

### Error Types

```javascript
// Base error class
class KnowledgeAPIError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// Specific error types
class ValidationError extends KnowledgeAPIError {}
class NotFoundError extends KnowledgeAPIError {}
class DuplicateError extends KnowledgeAPIError {}
class StorageError extends KnowledgeAPIError {}
```

### Error Codes

| Code | Description |
|------|-------------|
| `VALIDATION_FAILED` | Input validation error |
| `ENTITY_NOT_FOUND` | Entity lookup failed |
| `RELATION_NOT_FOUND` | Relation lookup failed |
| `DUPLICATE_ENTITY` | Entity name already exists |
| `DUPLICATE_RELATION` | Relation already exists |
| `STORAGE_ERROR` | Storage operation failed |
| `NOT_INITIALIZED` | API not initialized |

### Error Handling Examples

```javascript
try {
  const entity = await api.entities.create({
    name: 'Test',
    entityType: 'InvalidType'
  });
} catch (error) {
  if (error instanceof ValidationError) {
    console.error('Validation failed:', error.message);
  } else if (error instanceof DuplicateError) {
    console.error('Entity already exists');
  } else {
    console.error('Unexpected error:', error);
  }
}
```

### Best Practices

1. **Always handle errors**: Wrap API calls in try-catch
2. **Check error types**: Use instanceof for specific handling
3. **Log errors**: Use the Logger service for debugging
4. **Validate input**: Use ValidationService before operations
5. **Graceful degradation**: Provide fallbacks for failures