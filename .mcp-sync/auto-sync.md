# MCP Memory Auto-Sync Operations

This file contains automatic sync operations to load shared-memory.json into the MCP memory server.

## Sync Instructions for Claude Code

Please execute these MCP memory operations to sync the knowledge base:

### 1. Load All Entities

```typescript
// Execute this operation to load all entities from shared-memory.json
const entities = JSON.parse(await fs.readFile('shared-memory.json', 'utf8')).entities;

for (const entity of entities) {
  await mcp__memory__create_entities([{
    name: entity.name,
    entityType: entity.entityType,
    observations: entity.observations || [entity.content || ""],
    metadata: {
      significance: entity.significance,
      created: entity.created,
      project: entity.project,
      documentation_link: entity.documentation_link
    }
  }]);
}
```

### 2. Load All Relations

```typescript
// Execute this operation to load all relationships
const relations = JSON.parse(await fs.readFile('shared-memory.json', 'utf8')).relations;

for (const relation of relations) {
  await mcp__memory__create_relations([{
    from: relation.from,
    to: relation.to,
    relationType: relation.relationType
  }]);
}
```

### 3. Verify Sync

```typescript
// Verify the sync completed successfully
const graphState = await mcp__memory__read_graph();
console.log(`✅ MCP Memory loaded: ${graphState.nodes?.length || 0} entities, ${graphState.edges?.length || 0} relations`);
```

## Current Knowledge Base Summary

**Entities to sync:** 13
**Relations to sync:** 26

**Key Patterns Available:**
- ConditionalLoggingPattern (significance: 8)
- ViewportCullingPattern (significance: 8)
- ReduxStateManagementPattern (significance: 8)
- KnowledgePersistencePattern (significance: 9)
- NetworkAwareInstallationPattern (significance: 9)
- StateDrivenAnimationPipelinePattern (significance: 8)
- ClaudeCodeStartupPattern (significance: 10)
- StrategyBasedModularRoutingPattern (significance: 8)

**Sync prepared at:** Sun Jun 15 18:25:07 CEST 2025
