# UKB Unified CLI API Reference (v2.0)

Complete API documentation for lib/ukb-unified - the current implementation with lock-free architecture and VKB Server integration.

## Table of Contents
1. [CLI Commands](#cli-commands)
2. [VkbApiClient API](#vkbapiclient-api)
3. [Data Types](#data-types)
4. [Configuration](#configuration)
5. [Error Handling](#error-handling)

## CLI Commands

### Global Usage

```bash
ukb [command] [options]
```

### Commands Overview

| Command | Description |
|---------|-------------|
| (default) | Run incremental update workflow |
| `status` | Show knowledge base and server status |
| `checkpoint` | Manage project checkpoints |
| `entity` | Manage entities (list, add, remove, search) |
| `relation` | Manage relations (list, add, remove) |

### Default Command (Incremental Update)

Run intelligent incremental update based on checkpoints.

```bash
ukb
```

**Workflow:**
1. Load last checkpoint for current project
2. Analyze gaps since last run (GapAnalyzer)
3. Process missing items via VKB Server API
4. Save new checkpoint with timestamp

**Output:**
```
✅ Incremental update complete
   Processed 5 items
   Next run will continue from: 2024-11-22T12:00:00.000Z
```

### `ukb status`

Display current knowledge base and VKB Server status.

```bash
ukb status
```

**Output:**
```
VKB Status:
  Server: Running (port 8080)
  Entities: 234
  Relations: 567
  Last update: 2024-11-22T12:00:00.000Z
  Projects tracked: 3
```

### `ukb checkpoint`

Manage project checkpoints for incremental processing.

```bash
# View current checkpoint
ukb checkpoint

# Clear checkpoint (forces full reprocess next run)
ukb checkpoint clear
```

**Output:**
```
Checkpoint for project 'coding':
  Last run: 2024-11-22T12:00:00.000Z
  Processed: 234 items
```

### `ukb entity`

Manage entities in the knowledge base.

#### `entity list`

List all entities with optional filters.

```bash
ukb entity list
ukb entity list --type TechnicalPattern
ukb entity list --min-significance 8
```

**Output:**
```
Entities (234 total):
┌────────────────────┬─────────────────┬──────────────┐
│ Name               │ Type            │ Significance │
├────────────────────┼─────────────────┼──────────────┤
│ CachingPattern     │ TechnicalPattern│ 8            │
│ ErrorHandling      │ Solution        │ 9            │
└────────────────────┴─────────────────┴──────────────┘
```

#### `entity add`

Add a new entity to the knowledge base.

```bash
ukb entity add "CachingPattern" "TechnicalPattern" 8
ukb entity add "ErrorHandling" "Solution" 9 --observation "Implement try-catch"
```

**Arguments:**
1. Entity name (required)
2. Entity type (required)
3. Significance score 1-10 (required)

**Options:**
- `--observation <text>`: Add initial observation

**Output:**
```
✅ Entity created: CachingPattern
```

#### `entity remove`

Remove an entity from the knowledge base.

```bash
ukb entity remove "OldPattern"
```

**Output:**
```
✅ Entity removed: OldPattern
```

#### `entity search`

Search entities by keyword.

```bash
ukb entity search "authentication"
```

**Output:**
```
Found 3 entities matching 'authentication':
- UserAuthentication (TechnicalPattern, significance: 9)
- AuthErrorHandling (Solution, significance: 8)
- JWTValidation (TechnicalPattern, significance: 8)
```

### `ukb relation`

Manage relationships between entities.

#### `relation list`

List all relations with optional filters.

```bash
ukb relation list
ukb relation list --from "Solution"
ukb relation list --type "solves"
```

**Output:**
```
Relations (567 total):
┌─────────────┬────────────┬──────────┬──────────────┐
│ From        │ To         │ Type     │ Significance │
├─────────────┼────────────┼──────────┼──────────────┤
│ Solution    │ Problem    │ solves   │ 9            │
│ PatternA    │ PatternB   │ uses     │ 8            │
└─────────────┴────────────┴──────────┴──────────────┘
```

#### `relation add`

Create a new relation between entities.

```bash
ukb relation add "Solution" "Problem" "solves" 9
```

**Arguments:**
1. From entity name (required)
2. To entity name (required)
3. Relation type (required)
4. Significance score 1-10 (required)

**Output:**
```
✅ Relation created: Solution → Problem (solves)
```

#### `relation remove`

Delete a relation between entities.

```bash
ukb relation remove "EntityA" "EntityB"
```

**Output:**
```
✅ Relation removed: EntityA → EntityB
```

## VkbApiClient API

HTTP client for communicating with VKB Server.

![UKB Class Diagram](../images/ukb-cli-class-diagram.png)

### Constructor

```javascript
const VkbApiClient = require('lib/ukb-unified/core/VkbApiClient');

const client = new VkbApiClient('http://localhost:8080', {
  timeout: 5000,
  logger: console
});
```

**Parameters:**
- `baseUrl` (string): VKB Server URL (default: http://localhost:8080)
- `options` (object):
  - `timeout` (number): Request timeout in ms (default: 5000)
  - `logger` (object): Logger instance (default: console)

### Server Availability

#### `isServerAvailable(): Promise<boolean>`

Check if VKB Server is running.

```javascript
const isAvailable = await client.isServerAvailable();
// Returns: true or false
```

**HTTP Request:**
```
GET /api/health
```

**Response:**
```json
{"status": "ok"}
```

### Entity Operations

#### `getEntities(params): Promise<Entity[]>`

Retrieve all entities with optional filtering.

```javascript
const entities = await client.getEntities({
  type: 'TechnicalPattern',
  minSignificance: 8,
  count: true
});
```

**HTTP Request:**
```
GET /api/entities?type=TechnicalPattern&minSignificance=8&count=true
```

#### `createEntity(entity, params): Promise<Entity>`

Create a new entity.

```javascript
const entity = await client.createEntity({
  name: 'CachingPattern',
  entityType: 'TechnicalPattern',
  significance: 8,
  observations: ['Implement Redis caching']
}, {save: true});
```

**HTTP Request:**
```
POST /api/entities
Content-Type: application/json

{
  "name": "CachingPattern",
  "entityType": "TechnicalPattern",
  "significance": 8,
  "observations": ["Implement Redis caching"]
}
```

#### `updateEntity(name, updates, params): Promise<Entity>`

Update an existing entity.

```javascript
const updated = await client.updateEntity('CachingPattern', {
  significance: 9,
  observations: ['Updated implementation']
}, {save: true});
```

**HTTP Request:**
```
PUT /api/entities/CachingPattern
Content-Type: application/json

{
  "significance": 9,
  "observations": ["Updated implementation"]
}
```

#### `deleteEntity(name, params): Promise<void>`

Delete an entity.

```javascript
await client.deleteEntity('OldPattern', {save: true});
```

**HTTP Request:**
```
DELETE /api/entities/OldPattern?save=true
```

#### `searchEntities(query, params): Promise<Entity[]>`

Search entities by keyword.

```javascript
const results = await client.searchEntities('authentication', {
  limit: 10
});
```

**HTTP Request:**
```
GET /api/entities/search?q=authentication&limit=10
```

### Relation Operations

#### `getRelations(params): Promise<Relation[]>`

Retrieve all relations with optional filtering.

```javascript
const relations = await client.getRelations({
  from: 'Solution',
  type: 'solves'
});
```

**HTTP Request:**
```
GET /api/relations?from=Solution&type=solves
```

#### `createRelation(relation, params): Promise<Relation>`

Create a new relation.

```javascript
const relation = await client.createRelation({
  from: 'Solution',
  to: 'Problem',
  relationType: 'solves',
  significance: 9
}, {save: true});
```

**HTTP Request:**
```
POST /api/relations
Content-Type: application/json

{
  "from": "Solution",
  "to": "Problem",
  "relationType": "solves",
  "significance": 9
}
```

#### `deleteRelation(from, to, params): Promise<void>`

Delete a relation.

```javascript
await client.deleteRelation('EntityA', 'EntityB', {save: true});
```

**HTTP Request:**
```
DELETE /api/relations?from=EntityA&to=EntityB&save=true
```

## Data Types

### Entity

```typescript
interface Entity {
  name: string;                  // Unique entity name
  entityType: string;            // Type: TechnicalPattern, Solution, etc.
  observations: string[];        // Array of observations
  significance: number;          // 1-10 significance score
  created: string;               // ISO timestamp
  updated: string;               // ISO timestamp
}
```

### Relation

```typescript
interface Relation {
  from: string;                  // Source entity name
  to: string;                    // Target entity name
  relationType: string;          // Type: solves, uses, implements, etc.
  significance: number;          // 1-10 significance score
  created: string;               // ISO timestamp
}
```

### Checkpoint

```typescript
interface Checkpoint {
  projectKey: string;            // Project identifier
  lastRun: string;               // ISO timestamp
  processedCount: number;        // Number of items processed
  metadata: object;              // Additional metadata
}
```

### Query Parameters

```typescript
interface QueryParams {
  type?: string;                 // Filter by entity/relation type
  minSignificance?: number;      // Minimum significance threshold
  count?: boolean;               // Return count instead of items
  limit?: number;                // Maximum results
  offset?: number;               // Pagination offset
}
```

### Save Parameters

```typescript
interface SaveParams {
  save?: boolean;                // Whether to persist immediately
  skipValidation?: boolean;      // Skip validation checks
}
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VKB_SERVER_URL` | VKB Server base URL | `http://localhost:8080` |
| `VKB_TIMEOUT` | Request timeout (ms) | `5000` |
| `UKB_PROJECT_KEY` | Project identifier | Derived from cwd |
| `UKB_CHECKPOINT_DIR` | Checkpoint storage | `.data/checkpoints` |

### Configuration File

Location: `.ukb-config.json` (project root)

```json
{
  "server": {
    "url": "http://localhost:8080",
    "timeout": 5000
  },
  "checkpoint": {
    "enabled": true,
    "directory": ".data/checkpoints"
  },
  "logging": {
    "level": "info"
  }
}
```

## Error Handling

### Error Types

```javascript
// Server not available
{
  error: 'SERVER_UNAVAILABLE',
  message: 'VKB Server not responding',
  suggestion: 'Start server with: vkb server start'
}

// Entity not found
{
  error: 'ENTITY_NOT_FOUND',
  message: 'Entity "MyPattern" not found'
}

// Duplicate entity
{
  error: 'DUPLICATE_ENTITY',
  message: 'Entity "MyPattern" already exists'
}

// Validation failed
{
  error: 'VALIDATION_ERROR',
  message: 'Invalid entity data',
  details: ['Significance must be 1-10']
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `SERVER_UNAVAILABLE` | VKB Server not running or unreachable |
| `ENTITY_NOT_FOUND` | Entity lookup failed |
| `RELATION_NOT_FOUND` | Relation lookup failed |
| `DUPLICATE_ENTITY` | Entity name already exists |
| `DUPLICATE_RELATION` | Relation already exists |
| `VALIDATION_ERROR` | Input validation failed |
| `TIMEOUT_ERROR` | Request exceeded timeout |

### Error Handling Examples

```javascript
try {
  const entity = await client.createEntity({
    name: 'Test',
    entityType: 'InvalidType',
    significance: 15  // Invalid
  });
} catch (error) {
  if (error.code === 'VALIDATION_ERROR') {
    console.error('Validation failed:', error.details);
  } else if (error.code === 'SERVER_UNAVAILABLE') {
    console.error('Server not running:', error.suggestion);
  } else {
    console.error('Unexpected error:', error.message);
  }
}
```

## Architecture Diagrams

### System Architecture
![UKB Architecture](../images/ukb-cli-architecture.png)

### Data Flow
![UKB Data Flow](../images/ukb-cli-data-flow.png)

### Entity Creation Sequence
![Entity Creation](../images/ukb-cli-sequence-entity-creation.png)

### Incremental Workflow
![Incremental Workflow](../images/ukb-cli-sequence-insight-processing.png)

## Best Practices

1. **Always check server availability** before operations
2. **Use checkpoints** for incremental processing
3. **Handle errors gracefully** with appropriate fallbacks
4. **Validate input** before API calls
5. **Use save parameter** to control persistence
6. **Monitor checkpoint gaps** to track processing status

## See Also

- **[README](./README.md)** - Overview and quick start
- **[User Guide](./user-guide.md)** - Detailed usage examples
- **[Lock-Free Architecture](../ukb-lock-free-architecture.md)** - Technical details
- **[VKB Server API](../../vkb-server/README.md)** - Server documentation
