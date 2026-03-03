# Phase 5: One-Time Migration - Research

**Researched:** 2026-03-03
**Domain:** Knowledge graph migration -- Graphology/LevelDB hierarchy stamping, VKB HTTP API, component classification
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MIGR-01 | Migration script creates scaffold nodes (Coding project root, L1 components, L2 sub-components) from component manifest | loadComponentManifest() loader ready; scaffold nodes are full entities of type Component/SubComponent; POST /api/entities creates them |
| MIGR-02 | Migration script classifies existing 183 entities into the hierarchy by assigning parentId and level | Manifest keyword/alias lookup first, fallback to CodingPatterns; requires extending PUT /api/entities to persist hierarchy fields |
| MIGR-03 | Generic/low-value entities merged into parent component nodes (observations rolled up, original nodes removed) | DELETE /api/entities/:name + rolling obs into parent via PUT; actual merge set is small (~4-6 entities based on live data) |
| MIGR-04 | Migration has --dry-run mode showing classification and merge decisions before executing | Command-line flag; defer all writes; print report to stdout |
| MIGR-05 | Migration reads from VKB HTTP API (not direct LevelDB) to avoid lock conflicts and keep JSON export in sync | GET /api/entities for reads; VKB running at http://localhost:8080; confirmed health endpoint works |

</phase_requirements>

---

## Summary

Phase 5 is a standalone Node.js migration script (no TypeScript compilation, no Docker rebuild) that transforms the flat knowledge graph into the Phase 4 hierarchy. The schema foundation (TypeScript interfaces, component manifest, ontology types) is already in place from Phase 4. The migration must: (1) create 14 scaffold nodes (1 L0 + 8 L1 + 5 L2), (2) classify 183 existing leaf entities into the hierarchy, (3) merge a small set of low-value entities into CodingPatterns, (4) write 'contains' edges at each hierarchy level, and (5) expose a --dry-run mode.

The critical architectural gap discovered by research: **the existing PUT /api/entities route strips hierarchy fields before they reach GraphDatabaseService**. The handleUpdateEntity handler only destructures and passes { entityType, observations, significance, metadata } to the writer. Any parentEntityName, hierarchyLevel, isScaffoldNode, or childEntityNames fields are silently discarded. This means Plan 1 of this phase must extend the PUT route and UKBDatabaseWriter.updateEntity() before the migration script (Plan 2) can stamp hierarchy fields on existing entities via HTTP, satisfying MIGR-05.

**Primary recommendation:** Two-plan decomposition. Plan 1 extends PUT /api/entities + UKBDatabaseWriter to accept and persist hierarchy fields. Plan 2 is the migration script that uses VKB HTTP API for all reads and writes.

---

## Current State (Facts Verified from Live System)

| Property | Value |
|----------|-------|
| Total entities in graph | 183 (via GET /api/entities?team=coding) |
| Current 'contains' relations | 182 (all Coding to leaf entities, flat topology) |
| Entities with parentEntityName set | 0 |
| Scaffold nodes (isScaffoldNode=true) | 0 |
| Bold formatting in coding.json | 0 occurrences (grep -c returns 0) |
| VKB server URL | http://localhost:8080 |
| LevelDB location | .data/knowledge-graph/ |
| JSON export path | .data/knowledge-export/coding.json |

**Entity type distribution (current):** KnowledgeEntity (53), Component (31), MCPAgent (21), ConstraintRule (14), ConfigurationFile (11), GraphDatabase (9), SemanticAnalyzer (9), Feature (8), Limitation (6), Contract (5), Service (3), HookConfiguration (2), Fault (2), plus 7 singleton types.

**Significance distribution:** 160 entities have significance=5, 23 have significance=0.5. The 0.5 group is a pipeline artifact from early runs where confidence was used as significance. This group includes high-value entities (DecoratorPattern with 50 observations; CodingWorkflow; ApiPattern). Significance alone is NOT a reliable merge criterion.

**Relation structure:** 182 flat "Coding contains leaf" edges were created by a previous migration (migrate-to-hierarchical-graph.js). Success criterion 2 (>100 contains edges) is technically already met before Phase 5 runs; the migration will RESTRUCTURE these into proper hierarchy edges, producing approximately 196 contains edges (183 leaf-to-parent + 13 scaffold hierarchy edges).

---

## Standard Stack

### Core

| Library/Component | Version | Purpose | Notes |
|-----------------|---------|---------|-------|
| Node.js ESM script | 18+ | Migration entry point | Same pattern as migrate-to-hierarchical-graph.js |
| VKB HTTP API | http://localhost:8080 | All reads and writes (MIGR-05) | Confirmed running; 8080 serves both SPA and API |
| component-manifest.ts | -- | Manifest loader (already exists) | loadComponentManifest(), flattenManifestEntries() ready to import |
| GraphDatabaseService | -- | Direct DB access (fallback only) | src/knowledge-management/GraphDatabaseService.js |

### Supporting

| Library | Purpose | When to Use |
|---------|---------|-------------|
| yaml package | Parse manifest YAML | Already used in component-manifest.ts; no new dependency |
| native fetch | HTTP calls to VKB API | Node.js 18+ built-in; same pattern as migrate-to-hierarchical-graph.js |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extending PUT route | Pass hierarchy inside metadata sub-object | Verified: metadata is stored nested under originalMetadata key, NOT surfaced as top-level entity fields. Does not work. |
| Extending PUT route | Stop VKB, use GraphDatabaseService directly | Disruptive; violates MIGR-05; requires VKB restart; not the recommended path |
| Plain JS migration script | TypeScript (GraphDatabaseAdapter in MCP submodule) | Requires compiled TS, adds complexity; plain JS is sufficient and consistent with existing migration scripts |

---

## Architecture Patterns

### Recommended Script Structure

```
scripts/
  migrate-hierarchy.js       New migration script (plain ESM JS, no compilation)

lib/vkb-server/
  api-routes.js              Extend PUT /api/entities to accept hierarchy fields

src/knowledge-management/
  UKBDatabaseWriter.js       Extend updateEntity() to pass hierarchy fields through
```

### Pattern 1: VKB API Read + Write (MIGR-05 compliant)

**What:** Fetch entities and relations via GET requests; write changes via PUT/POST/DELETE.
**When to use:** Primary pattern; VKB server is running at localhost:8080.

```javascript
// Source: scripts/migrate-to-hierarchical-graph.js (existing pattern)
const VKB_BASE_URL = process.env.VKB_URL || 'http://localhost:8080';

async function fetchEntities(team) {
  const response = await fetch(`${VKB_BASE_URL}/api/entities?team=${team}&limit=1000`);
  const data = await response.json();
  return data.entities || [];
}

async function createRelation(from, to, type, team) {
  const response = await fetch(`${VKB_BASE_URL}/api/relations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, type, team, confidence: 1.0 })
  });
  return response.json();
}

async function deleteRelation(from, to, team, type) {
  const url = new URL(`${VKB_BASE_URL}/api/relations`);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  url.searchParams.set('team', team);
  if (type) url.searchParams.set('type', type);
  const response = await fetch(url.toString(), { method: 'DELETE' });
  return response.json();
}
```

### Pattern 2: Extending PUT /api/entities for Hierarchy Fields

**What:** The PUT route must be extended to accept and pass through hierarchy fields.
**When to use:** This is Plan 1 scope -- must be done before migration script runs.

Current gap in lib/vkb-server/api-routes.js handleUpdateEntity:
```javascript
// CURRENT (strips hierarchy fields):
const { entityType, observations, significance, team = 'coding', metadata = {} } = req.body;
await writer.updateEntity(name, { entityType, observations, significance, metadata });

// EXTENDED (passes hierarchy fields):
const {
  entityType, observations, significance, team = 'coding', metadata = {},
  parentEntityName, hierarchyLevel, isScaffoldNode, childEntityNames  // ADD
} = req.body;
await writer.updateEntity(name, {
  entityType, observations, significance, metadata,
  parentEntityName, hierarchyLevel, isScaffoldNode, childEntityNames  // ADD
});
```

Current gap in src/knowledge-management/UKBDatabaseWriter.js updateEntity:
```javascript
// EXTENDED (passes hierarchy fields to storeEntity which spreads to Graphology node):
const entityData = {
  name: entityName,
  entityType: updates.entityType,
  observations: updates.observations,
  significance: updates.significance,
  metadata: { ...updates.metadata, last_updated: new Date().toISOString() },
  // ADD -- GraphDatabaseService.storeEntity() spreads all non-relationship fields
  // so these become node attributes automatically:
  parentEntityName: updates.parentEntityName,
  hierarchyLevel: updates.hierarchyLevel,
  isScaffoldNode: updates.isScaffoldNode,
  childEntityNames: updates.childEntityNames
};
```

**Why this works:** GraphDatabaseService.storeEntity() does `const { relationships, ...entityWithoutRelationships } = entity` then merges `entityWithoutRelationships` into Graphology node attributes via replaceNodeAttributes. Any field in the object lands on the node.

### Pattern 3: Manifest-First Classification

**What:** Match entity name and observations against component keywords and aliases before deciding placement.
**When to use:** For every existing leaf entity during MIGR-02 classification.

```javascript
// Source: component-manifest.yaml keywords/aliases (Phase 4 output)
function classifyByManifest(entity, manifestEntries) {
  const nameLower = entity.entity_name.toLowerCase();
  const obsText = (entity.observations || []).join(' ').toLowerCase();
  let bestMatch = null;
  let bestScore = 0;

  for (const entry of manifestEntries) {
    let score = 0;
    for (const kw of entry.keywords) {
      if (nameLower.includes(kw.toLowerCase())) score += 2;
      if (obsText.includes(kw.toLowerCase())) score += 1;
    }
    for (const alias of entry.aliases) {
      if (nameLower.includes(alias.toLowerCase())) score += 3;
    }
    if (score > bestScore) { bestScore = score; bestMatch = entry; }
  }

  // Require score >= 2 (at least one name keyword match) to accept
  // Unmatched entities fall back to CodingPatterns -- no LLM needed for Phase 5
  return bestScore >= 2 ? bestMatch : null;
}
```

### Pattern 4: Scaffold Node Creation (upsert safe)

**What:** Create 14 scaffold entities from the manifest, then wire 'contains' edges. Use upsert logic (PUT if exists, POST if new).
**When to use:** Must run BEFORE classifying existing entities (parents must exist for relation creation).

```javascript
async function ensureScaffoldNode(name, entityType, description, parentName, level, childNames, dryRun) {
  const existing = await fetchEntityByName(name, 'coding');
  const body = {
    entityType,
    observations: existing ? existing.observations : [description],
    significance: existing ? (existing.significance || 9) : 9,
    team: 'coding',
    parentEntityName: parentName,
    hierarchyLevel: level,
    isScaffoldNode: true,
    childEntityNames: childNames
  };

  if (dryRun) {
    console.log(`[DRY RUN] Would ${existing ? 'update' : 'create'} scaffold: ${name} (${entityType}, level=${level})`);
    return;
  }

  if (existing) {
    await fetch(`${VKB_BASE_URL}/api/entities/${encodeURIComponent(name)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } else {
    await fetch(`${VKB_BASE_URL}/api/entities`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ...body })
    });
  }
}
```

### Pattern 5: --dry-run Mode

**What:** Collect all operations; print a report; execute zero writes.
**When to use:** When --dry-run flag is passed (MIGR-04).

```javascript
// Source: scripts/purge-knowledge-entities.js pattern
async function applyOperation(type, description, writeFn, dryRun) {
  if (dryRun) {
    console.log(`[DRY RUN] Would ${type}: ${description}`);
    return;
  }
  await writeFn();
}

// Usage:
await applyOperation(
  'SET parentEntityName',
  `${entity.entity_name} -> SemanticAnalysis (manifest keyword: "agent")`,
  () => updateEntityHierarchy(entity.entity_name, { parentEntityName: 'SemanticAnalysis', hierarchyLevel: 3 }),
  options.dryRun
);
```

### Pattern 6: Direct GraphDatabaseService (Fallback ONLY)

**What:** When VKB server is NOT running, use GraphDatabaseService directly with GraphKnowledgeExporter attached for JSON sync.
**When to use:** Documented escape hatch only. Not the primary path.

```javascript
// Source: scripts/migrate-graph-db-entity-types.js
import { GraphDatabaseService } from '../src/knowledge-management/GraphDatabaseService.js';
const dbService = new GraphDatabaseService({
  dbPath: '.data/knowledge-graph',
  config: { autoPersist: false }
});
await dbService.initialize();
// Direct graph manipulation:
dbService.graph.setNodeAttribute('coding:EntityName', 'parentEntityName', 'LiveLoggingSystem');
dbService.graph.setNodeAttribute('coding:EntityName', 'hierarchyLevel', 3);
dbService.isDirty = true;
await dbService._persistGraphToLevel();
// Must also attach GraphKnowledgeExporter to keep JSON export in sync
```

**WARNING:** Cannot run while VKB server holds LevelDB open. Migration script must check server health and exit with clear instructions if direct mode is attempted while server is running.

### Anti-Patterns to Avoid

- **Passing hierarchy fields inside metadata sub-object via POST /api/entities**: Verified that metadata is stored nested under originalMetadata key in GraphDatabaseService. Hierarchy fields stored there are NOT accessible as top-level entity properties.
- **Using GraphDatabaseAdapter from MCP submodule**: Requires compiled TypeScript; its API-mode path calls VkbApiClient.createEntity which hits POST /api/entities which also strips hierarchy fields via the handleCreateEntity route handler (same gap as PUT).
- **Classifying Coding and CollectiveKnowledge as merge candidates**: These are system nodes. Update hierarchy fields only; preserve entityType and existing observations.
- **Using significance < 2 as sole merge criterion**: 23 entities have significance=0.5 including DecoratorPattern (50 obs). This is a pipeline artifact, not quality signal.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Manifest loading | Custom YAML parser | Inline parse(readFileSync('component-manifest.yaml')) using yaml package | yaml already used in component-manifest.ts; 3-line implementation |
| Entity fetching | Direct LevelDB read | GET /api/entities (VKB HTTP API) | Lock safety; JSON export stays consistent |
| Relation creation | Direct Graphology edge manipulation | POST /api/relations | Dedup logic, event emission, JSON sync built-in |
| Entity deletion | Graphology node removal | DELETE /api/entities/:name | Handles cascade, JSON export, event system |
| Dry-run report | Separate reporting framework | Inline console.log with [DRY RUN] prefix | Consistent with purge-knowledge-entities.js pattern |

**Key insight:** The VKB HTTP API handles all side effects (Graphology in-memory, LevelDB persistence, JSON export sync, event emission). The migration script should be a thin orchestrator that calls HTTP endpoints, not a direct database operator.

---

## Common Pitfalls

### Pitfall 1: VKB API PUT Route Strips Hierarchy Fields (CONFIRMED GAP)

**What goes wrong:** Calling PUT /api/entities/:name with parentEntityName, hierarchyLevel, isScaffoldNode in the request body returns HTTP 200 but these fields are NOT persisted. handleUpdateEntity() only destructures { entityType, observations, significance, metadata }.
**Why it happens:** PUT route was written before Phase 4 hierarchy schema extension.
**How to avoid:** Plan 1 extends handleUpdateEntity in api-routes.js and updateEntity in UKBDatabaseWriter.js. Plan 2 depends on Plan 1 completion.
**Warning signs:** PUT returns 200 but GET on entity shows parentEntityName as undefined.

### Pitfall 2: processEntity() in PersistenceAgent Does NOT Map Hierarchy Fields

**What goes wrong:** Calling persistEntities() through the MCP pipeline drops parentId/level silently. Phase 4 plan explicitly prohibited modifying processEntity() -- it is Phase 6 scope (PIPE-05).
**Why it happens:** processEntity() constructs SharedMemoryEntity object literal without spreading hierarchy fields from KGEntity.
**How to avoid:** Migration script does NOT call persistEntities(). It uses direct HTTP API calls instead. This is correct by design.
**Warning signs:** Entities exist but hierarchy fields are null after any pipeline run.

### Pitfall 3: 'Coding' Entity Already Exists -- Cannot POST

**What goes wrong:** There is already a 'Coding' entity with entityType='Project', 7 observations, significance=0.5. Migration must UPDATE this entity (PUT), not CREATE it (POST which would fail or behave unexpectedly).
**Why it happens:** System has always had a 'Coding' Project node as the graph root.
**How to avoid:** Before creating scaffold nodes, fetch entity list. For each scaffold node name: if entity exists, use PUT; if not, use POST. The ensureScaffoldNode() pattern handles this.
**Warning signs:** Duplicate entities or errors when creating 'Coding' scaffold.

### Pitfall 4: Generic Entity Merge Criteria Must Not Use Significance Alone

**What goes wrong:** 23 entities have significance=0.5 including DecoratorPattern (50 obs), CodingWorkflow (8 obs), Coding itself. Deleting all sig=0.5 entities destroys real knowledge.
**Why it happens:** Significance=0.5 is a pipeline artifact from early runs where confidence was normalized differently.
**How to avoid:** Define "generic/low-value" as conjunction of: (1) significance < 2 AND (2) fewer than 3 observations AND (3) name ends in Problem/Decision/Issue without specific technical context. From live data this yields ~4-6 entities. Use conservative criteria.
**Warning signs:** Deleting entities with many observations or substantive technical names.

### Pitfall 5: 182 Flat Contains Edges Must Be REPLACED Not Added To

**What goes wrong:** Current state has 182 flat "Coding contains ALL_ENTITIES" edges. Success criterion 2 says ">100 contains edges after migration." If migration only ADDS hierarchy edges without removing flat ones, the graph has duplicate contains paths from Coding to every entity.
**Why it happens:** Earlier migration (migrate-to-hierarchical-graph.js) created flat edges to establish graph structure before the hierarchy schema existed.
**How to avoid:** Migration steps in order: (1) Create scaffold nodes and L0->L1->L2 hierarchy edges. (2) For each leaf entity, delete "Coding contains leaf" edge, then create "ParentComponent contains leaf" edge. Final state: hierarchical contains edges only.
**Warning signs:** 'Coding' still directly contains all leaf entities after migration.

### Pitfall 6: mergeEntities() in KGOperators Will Overwrite parentId on Future Runs

**What goes wrong:** STATE.md documents: "Dedup collapse: mergeEntities() overwrites parentId with undefined -- needs null-coalesce fix." This affects FUTURE pipeline runs (Phase 6 concern), not the migration itself.
**Why it happens:** mergeEntities() spreads ...existing but the return object overrides specific fields; incoming entity has no parentId so it may be lost.
**How to avoid:** NOT a Phase 5 blocker. Document as known issue for Phase 6 (PIPE-04). Migration script does not call mergeEntities().
**Warning signs:** After running `ukb full` post-migration, parentEntityName disappears from entities.

### Pitfall 7: Node.js ESM Cannot Import .ts Files Directly

**What goes wrong:** component-manifest.ts is TypeScript; migration is plain JS. Cannot `import ... from '...component-manifest.ts'` in Node.js ESM scripts.
**Why it happens:** TypeScript files require compilation; Node.js runs compiled .js only.
**How to avoid:** Two options: (a) Import from compiled dist/ file at `integrations/mcp-server-semantic-analysis/dist/types/component-manifest.js`. (b) Inline manifest loading in migration script using `import { parse } from 'yaml'; parse(readFileSync('...component-manifest.yaml'))` -- the manifest structure is simple enough to inline in ~5 lines.
**Warning signs:** SyntaxError or MODULE_NOT_FOUND when importing component-manifest.ts directly.

---

## Code Examples

### Full Migration Script Skeleton

```javascript
// Source: derived from scripts/migrate-to-hierarchical-graph.js and scripts/purge-knowledge-entities.js
// Location: scripts/migrate-hierarchy.js
// Usage: node scripts/migrate-hierarchy.js [--dry-run] [--verbose] [--team=coding]

import { parse } from 'yaml';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VKB_BASE_URL = process.env.VKB_URL || 'http://localhost:8080';

function loadManifest() {
  const manifestPath = path.resolve(
    __dirname,
    '../integrations/mcp-server-semantic-analysis/config/component-manifest.yaml'
  );
  return parse(readFileSync(manifestPath, 'utf-8'));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!(await checkHealth())) {
    console.error('VKB server not running at', VKB_BASE_URL);
    process.exit(1);
  }

  const manifest = loadManifest();
  const entities = await fetchEntities(options.team);
  console.log(`Loaded ${entities.length} entities from VKB API`);

  // Step 1: Create/update scaffold nodes (L0, L1, L2)
  await createScaffoldNodes(manifest, options);

  // Step 2: Classify existing leaf entities and stamp hierarchy fields
  const classificationMap = await classifyAndStampEntities(entities, manifest, options);

  // Step 3: Merge generic/low-value entities into CodingPatterns
  await mergeGenericEntities(entities, classificationMap, options);

  // Step 4: Rewire contains edges (remove flat Coding->leaf, add hierarchical parent->leaf)
  await rewireContainsEdges(classificationMap, options);

  if (options.dryRun) {
    console.log('\nDry run complete. No changes made.');
  } else {
    console.log('\nMigration complete.');
    await printFinalStats(options);
  }
}
```

### Classification Logic (MIGR-02)

```javascript
// Source: manifest keyword/alias pattern from component-manifest.yaml
function flattenManifestEntries(manifest) {
  const entries = [];
  for (const component of manifest.components) {
    entries.push(component);
    for (const child of (component.children || [])) entries.push(child);
  }
  return entries;
}

function classifyEntity(entity, manifestEntries) {
  // Skip system/scaffold nodes that should not be reclassified
  const skipNames = ['Coding', 'CollectiveKnowledge'];
  const skipTypes = ['Component', 'SubComponent', 'Project', 'System'];
  if (skipNames.includes(entity.entity_name)) return null;
  if (skipTypes.includes(entity.entity_type)) return null;

  const nameLower = entity.entity_name.toLowerCase();
  const obsText = (entity.observations || []).join(' ').toLowerCase();
  let bestMatch = null;
  let bestScore = 0;

  for (const entry of manifestEntries) {
    let score = 0;
    for (const kw of entry.keywords) {
      if (nameLower.includes(kw.toLowerCase())) score += 2;
      if (obsText.includes(kw.toLowerCase())) score += 1;
    }
    for (const alias of entry.aliases) {
      if (nameLower.includes(alias.toLowerCase())) score += 3;
    }
    if (score > bestScore) { bestScore = score; bestMatch = entry; }
  }

  return {
    entity: entity.entity_name,
    parentName: bestScore >= 2 ? bestMatch.name : 'CodingPatterns',
    method: bestScore >= 2 ? 'manifest' : 'fallback-CodingPatterns',
    score: bestScore,
    hierarchyLevel: 3
  };
}
```

### Generic Entity Merge Criteria (MIGR-03)

```javascript
// Conservative merge criteria to avoid false positives
function isGenericEntity(entity) {
  const protectedTypes = ['Component', 'SubComponent', 'Project', 'System'];
  if (protectedTypes.includes(entity.entity_type)) return false;

  const sig = entity.significance || 5;
  const obsCount = (entity.observations || []).length;
  const name = entity.entity_name;

  // Must satisfy ALL three criteria to be considered generic:
  const isLowValue = sig < 2 && obsCount <= 2;
  // Pure abstract label: ends in Problem/Issue/Decision with no specific technical qualifier
  const isAbstractLabel = /^[A-Z][a-z]+(Problem|Issue|Decision)$/.test(name);

  return isLowValue && isAbstractLabel;
}

async function mergeEntityIntoParent(entity, parentName, dryRun) {
  if (dryRun) {
    console.log(`[DRY RUN] Would merge ${entity.entity_name} into ${parentName}`);
    return;
  }
  // Fetch parent and add this entity's observations
  const parent = await fetchEntityByName(parentName, 'coding');
  const mergedObs = [...new Set([...(parent.observations || []), ...(entity.observations || [])])];
  await fetch(`${VKB_BASE_URL}/api/entities/${encodeURIComponent(parentName)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entityType: parent.entity_type, observations: mergedObs, team: 'coding' })
  });
  // Delete the generic entity
  await fetch(`${VKB_BASE_URL}/api/entities/${encodeURIComponent(entity.entity_name)}?team=coding`,
    { method: 'DELETE' });
}
```

### VKB API Route Extension (Plan 1)

```javascript
// Source: lib/vkb-server/api-routes.js handleUpdateEntity -- extend to accept hierarchy fields
async handleUpdateEntity(req, res) {
  try {
    const { name } = req.params;
    const {
      entityType,
      observations,
      significance,
      team = 'coding',
      metadata = {},
      parentEntityName,    // NEW: hierarchy fields
      hierarchyLevel,      // NEW
      isScaffoldNode,      // NEW
      childEntityNames     // NEW
    } = req.body;

    if (!entityType || !observations) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'entityType and observations are required'
      });
    }

    const writer = this.writers[team] || this.writers['coding'];
    const entityId = await writer.updateEntity(name, {
      entityType, observations, significance, metadata,
      parentEntityName, hierarchyLevel, isScaffoldNode, childEntityNames  // NEW
    });

    res.status(200).json({ success: true, id: entityId, message: `Updated entity: ${name}` });
  } catch (error) {
    logger.error('Update entity failed', { error: error.message });
    res.status(500).json({ error: 'Failed to update entity', message: error.message });
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct LevelDB via GraphDatabaseService | VKB HTTP API when server running | Phase 1 (v1.0) | Lock safety; JSON export sync guaranteed |
| No hierarchy schema | Hierarchy fields on all 4 interface layers | Phase 4 (v1.0 shipped) | parentId, level, hierarchyPath fields ready |
| No component manifest | component-manifest.yaml as source of truth | Phase 4 (v1.0 shipped) | loadComponentManifest() ready to use |
| Flat star topology (all entities to Coding) | Hierarchical (Coding to L1 to L2 to leaf) | This phase (Phase 5) | Tree navigation enabled for Phase 7 |

**Deprecated/outdated for this phase:**
- Calling persistEntities() from migration script: Drops hierarchy fields silently (extended in Phase 6 PIPE-05)
- Using significance=0.5 as quality filter: Artifact of early pipeline normalization, not a quality signal

---

## Open Questions

1. **Scaffold node creation: POST vs PUT for 'Coding' entity**
   - What we know: 'Coding' entity already exists with entityType='Project', 7 observations
   - What is unclear: Does POST /api/entities for an existing name silently merge or error?
   - Recommendation: Fetch entity list first; use PUT for existing names, POST for new scaffold names. The ensureScaffoldNode() upsert pattern handles this safely.

2. **childEntityNames list: direct children only vs all descendants**
   - What we know: SharedMemoryEntity.childEntityNames is a string array; no length limit documented
   - What is unclear: L1 component 'SemanticAnalysis' could have 30+ leaf entities assigned. Should childEntityNames hold all of them?
   - Recommendation: Store only DIRECT children. L1 nodes store [L2 child names]. L2 nodes store [leaf entity names assigned to them]. 'contains' edges are the authoritative relationship.

3. **LLM fallback for ambiguous entities**
   - What we know: Manifest-first classification covers entities whose names/observations contain component keywords/aliases
   - What is unclear: Coverage percentage for the full 183-entity corpus
   - Recommendation: Skip LLM fallback entirely for Phase 5. Use 'CodingPatterns' as the universal fallback for unclassified entities. This satisfies MIGR-02 without LLM cost and keeps the migration deterministic. LLM classification is Phase 6 scope (PIPE-02).

---

## Validation Architecture

> nyquist_validation key is absent from .planning/config.json -- treating as enabled.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest v29.7.0 (jest.config.js at root) |
| Config file | jest.config.js |
| Quick run command | `NODE_OPTIONS='--experimental-vm-modules --no-warnings' jest tests/unit/knowledge-management/ --testNamePattern="hierarchy"` |
| Full suite command | `npm run test` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MIGR-01 | Scaffold nodes created with correct entityType and isScaffoldNode=true | Integration (live VKB API) | curl GET /api/entities and filter Component+SubComponent types | manual |
| MIGR-02 | Entities classified with parentEntityName set and hierarchyLevel=3 | Integration (live graph) | curl GET /api/entities and check parentEntityName not null | manual |
| MIGR-03 | Generic entities removed; CodingPatterns observations count increased | Integration (VKB API) | Check entity count before/after + CodingPatterns obs count | manual |
| MIGR-04 | --dry-run prints report with zero writes | Unit (mock dry run) | `node scripts/migrate-hierarchy.js --dry-run 2>&1 \| grep "DRY RUN"` | new file |
| MIGR-05 | Script uses only fetch() calls to VKB API | Code review | Inspect script -- no GraphDatabaseService import when VKB running | code review |

### Sampling Rate

- **Per task commit:** Run success criteria checks manually: entity count, contains edge count (>100 via GET /api/relations?relationType=contains), parentEntityName presence
- **Per wave merge:** Full verification: scaffold node count, contains edge count, parentEntityName coverage %, bold formatting check (grep)
- **Phase gate:** All 5 ROADMAP.md success criteria verified before /gsd:verify-work

### Wave 0 Gaps

- [ ] `lib/vkb-server/api-routes.js` -- extend PUT /api/entities to accept hierarchy fields (Plan 1 deliverable)
- [ ] `src/knowledge-management/UKBDatabaseWriter.js` -- extend updateEntity() to pass hierarchy fields (Plan 1 deliverable)
- [ ] `scripts/migrate-hierarchy.js` -- the migration script itself (Plan 2 deliverable)
- [ ] `tests/unit/knowledge-management/migration-classifier.test.js` -- unit test for classifyEntity() logic (unit-testable without live VKB)

---

## Sources

### Primary (HIGH confidence)

- Direct code inspection: `lib/vkb-server/api-routes.js` -- PUT route confirmed strips hierarchy fields at handleUpdateEntity (lines 292-330)
- Direct code inspection: `src/knowledge-management/UKBDatabaseWriter.js` -- updateEntity confirmed strips hierarchy fields (lines 88-114)
- Direct code inspection: `src/knowledge-management/GraphDatabaseService.js` -- storeEntity() spreads all non-relationship fields into Graphology node attributes (spread pattern at line 229)
- Direct code inspection: `integrations/mcp-server-semantic-analysis/config/component-manifest.yaml` -- 8 L1 + 5 L2 scaffold nodes confirmed
- Direct code inspection: `integrations/mcp-server-semantic-analysis/src/types/component-manifest.ts` -- loadComponentManifest, flattenManifestEntries confirmed ready
- Live system probe: GET /api/entities confirmed 183 entities, 0 with parentEntityName
- Live system probe: GET /api/relations?relationType=contains confirmed 182 flat Coding-to-leaf edges
- Live system probe: grep -c '\*\*' on coding.json confirmed 0 bold-format occurrences
- Live system probe: PUT /api/entities test confirmed hierarchy fields are NOT persisted (gap confirmed)

### Secondary (MEDIUM confidence)

- Pattern analysis: `scripts/migrate-to-hierarchical-graph.js` -- VKB HTTP API migration script pattern for reads, creates, and deletes
- Pattern analysis: `scripts/migrate-graph-db-entity-types.js` -- direct GraphDatabaseService pattern for fallback reference
- Pattern analysis: `scripts/purge-knowledge-entities.js` -- --dry-run flag and fetchEntities patterns
- STATE.md documented pitfalls: processEntity() hierarchy gap, mergeEntities() parentId overwrite, LevelDB/JSON sync recommendation

### Tertiary (LOW confidence)

- Classification coverage estimate (80% manifest, 20% CodingPatterns fallback): Based on spot-checking entity names against manifest keywords, not exhaustive scan of all 183 entities

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- code inspected directly, all components verified in live system
- Architecture: HIGH -- API gap confirmed via live probe and code inspection; fix approach verified via GraphDatabaseService.storeEntity() spread analysis
- Pitfalls: HIGH -- STATE.md documents known pitfalls; confirmed with code inspection
- Classification coverage: MEDIUM -- keyword-to-entity mapping estimated from spot-checking, not exhaustive

**Research date:** 2026-03-03
**Valid until:** 2026-04-03 (stable domain; VKB API version or manifest changes would invalidate)
