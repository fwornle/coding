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

**Entities to sync:** 20
**Relations to sync:** 40

**Key Patterns Available:**
- ConditionalLoggingPattern (significance: 5)
- ViewportCullingPattern (significance: 5)
- ReduxStateManagementPattern (significance: 5)
- KnowledgePersistencePattern (significance: 5)
- NetworkAwareInstallationPattern (significance: 5)
- StateDrivenAnimationPipelinePattern (significance: 5)
- StrategyBasedModularRoutingPattern (significance: 5)
- MCPMemoryLoggingIntegrationPattern (significance: 5)
- UKBComprehensiveAnalysisPattern (significance: 5)
- VSCodeExtensionBridgePattern (significance: 5)

**Sync prepared at:** Thu Jun 19 11:55:48 CEST 2025
