# Phase 4: Schema & Configuration Foundation - Research

**Researched:** 2026-03-01
**Domain:** TypeScript interface extension, YAML config authoring, JSON ontology extension
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Component taxonomy**
- 8 L1 components: LiveLoggingSystem, LLMAbstraction, DockerizedServices, Trajectory, KnowledgeManagement, CodingPatterns, ConstraintSystem, SemanticAnalysis
- L2 sub-components defined only where natural subsystems exist (e.g., KnowledgeManagement -> ManualLearning, OnlineLearning; SemanticAnalysis -> Pipeline, Ontology, Insights). Don't force L2s on flat components
- PascalCase naming for all component names (matches existing entity naming convention)
- CodingPatterns serves as the catch-all for entities that don't clearly fit any other component

**Manifest content depth**
- Rich entries per component: name, description (1-2 sentences), aliases (alternate names), keywords (for heuristic matching in Phase 6), children (L2 sub-components)
- Descriptions should be enough for an LLM or human to understand the component's scope without reading code
- Manifest defines the component tree only - level semantics (what L0/L1/L2/L3 mean) are defined in TypeScript interfaces
- File location: `integrations/mcp-server-semantic-analysis/config/component-manifest.yaml` (bind-mounted into Docker, no rebuild needed to iterate)

**Hierarchy depth and levels**
- 4 levels: L0 (Project root "Coding"), L1 (Component), L2 (SubComponent), L3 (Detail/individual entities)
- Level stored as numeric integer 0-3 (not string enum)
- `hierarchyPath` uses slash-separated PascalCase names: "Coding/KnowledgeManagement/OnlineLearning/BatchAnalysisPattern"
- Scaffold nodes (Coding root, L1 components, L2 sub-components) are full knowledge graph entities with type 'Component'/'SubComponent', descriptions, and aggregated observations - not lightweight structural stubs

**Interface consolidation**
- Hierarchy fields added to all three interface layers: KGEntity (parentId, level, hierarchyPath), SharedMemoryEntity (hierarchyLevel, parentEntityName, childEntityNames, isScaffoldNode), EntityMetadata (keeps audit fields only)
- All new hierarchy fields are optional (?) for backward compatibility - existing entities without hierarchy data pass through cleanly
- Do NOT fix the existing type/entityType disconnect in this phase - add hierarchy fields alongside, don't bundle unrelated refactoring
- Ontology file (`coding-ontology.json`) extended with `Component` and `SubComponent` entity types

### Claude's Discretion
- Which file becomes the canonical location for KGEntity (kg-operators.ts vs agent-dataflow.ts vs new shared file)
- Exact field names on EntityMetadata if any hierarchy audit fields are needed
- How to structure the `Component` and `SubComponent` entity definitions in the ontology JSON
- Whether to add a TypeScript enum/const for hierarchy level names alongside the numeric type

### Deferred Ideas (OUT OF SCOPE)
None - discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCHM-01 | KGEntity interface extended with optional `parentId`, `level`, `hierarchyPath` fields (backward-compatible) | Two copies exist at kg-operators.ts:31 and agent-dataflow.ts:389 -- both need identical additions. Spread storage in GraphDatabaseService ensures fields persist automatically. |
| SCHM-02 | SharedMemoryEntity/EntityMetadata extended with `hierarchyLevel`, `parentEntityName`, `childEntityNames`, `isScaffoldNode` fields | SharedMemoryEntity at persistence-agent.ts:40. EntityMetadata at persistence-agent.ts:69 already has ontology sub-object pattern. processEntity() in persistEntities() must also forward fields. |
| SCHM-03 | `Component` and `SubComponent` entity types added to `coding-ontology.json` so ontology validation accepts scaffold nodes | File at .data/ontologies/lower/coding-ontology.json. Entities key is the entry point. Uses extendsEntity for inheritance. Lenient validation mode catches unknown types without blocking, but proper entries eliminate spurious warnings. |
| SCHM-04 | `component-manifest.yaml` defines L1/L2 component hierarchy (names, aliases, descriptions) as the source of truth for classification | Config directory at integrations/mcp-server-semantic-analysis/config/ is bind-mounted read-only -- no Docker rebuild needed. yaml package (^2.8.2) already available. Loading pattern established in workflow-loader.ts. |
</phase_requirements>

---

## Summary

Phase 4 is a pure schema and configuration authoring phase. No data migration, no pipeline logic, no UI changes. The work involves extending four TypeScript interfaces, adding two entity types to an existing JSON ontology file, and authoring a new YAML manifest file. All targets are in two submodules: `mcp-server-semantic-analysis` (TypeScript + config) and `memory-visualizer` (TypeScript VKB viewer).

The critical discovery is that `KGEntity` has two duplicate definitions that must be kept in sync: `kg-operators.ts:31` (used by the coordinator pipeline) and `types/agent-dataflow.ts:389` (used by the quality assurance agent via the types/index.ts re-export). Both must receive identical additions. The `SharedMemoryEntity` at `persistence-agent.ts:40` and its construction in `persistEntities()` at line 3177 must also be updated -- the entity object literal at that line explicitly enumerates fields, so hierarchy fields passed in will silently be dropped unless the literal is extended.

The VKB viewer's `Entity` interface (databaseClient.ts:8) and `Node` interface (navigationSlice.ts:11) need hierarchy fields added. The VKB viewer currently has `strict: false` in its tsconfig -- the success criterion requires no NEW errors introduced, not that existing errors are fixed. The mcp-server-semantic-analysis has `strict: true` and compiles clean today.

**Primary recommendation:** Add hierarchy fields as optional (`?`) to all four interfaces in a single commit, extend the ontology JSON and author the manifest, run `tsc --noEmit` to verify zero new errors on the MCP server and no increase from the 10 pre-existing errors on the VKB viewer.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ^5.8.3 (MCP server) / ^5.3.3 (VKB viewer) | Interface definitions | Already in use; strict mode already enabled on MCP server |
| `yaml` | ^2.8.2 | Parsing component-manifest.yaml | Already in project dependencies; used by workflow-loader.ts |
| `js-yaml` | devDep, types only | Alternative YAML parser used in dmr-provider | Second option if needed; prefer `yaml` (main dep) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js `fs` | built-in | Loading YAML config at runtime | Use fs.readFileSync + yaml.parse pattern from workflow-loader.ts |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extending existing KGEntity in place | Creating a new HierarchyEntity that extends KGEntity | Extension in place is simpler and avoids breaking all existing usages; new type would require union types everywhere |
| Optional fields on interfaces | Required fields with migration | Optional fields are the only backward-compatible approach given 252 existing entities |

**Installation:**
No new packages needed. `yaml` is already a dependency.

---

## Architecture Patterns

### Recommended Project Structure

Files to edit:

```
integrations/mcp-server-semantic-analysis/src/agents/kg-operators.ts     (KGEntity -- add hierarchy fields)
integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts (SharedMemoryEntity + EntityMetadata)
integrations/mcp-server-semantic-analysis/src/types/agent-dataflow.ts     (duplicate KGEntity -- identical fields)
integrations/mcp-server-semantic-analysis/config/component-manifest.yaml  (NEW FILE)

.data/ontologies/lower/coding-ontology.json  (add Component, SubComponent entity types)

integrations/memory-visualizer/src/api/databaseClient.ts           (Entity interface)
integrations/memory-visualizer/src/store/slices/navigationSlice.ts  (Node interface)
```

### Pattern 1: Optional Field Extension on TypeScript Interfaces

**What:** Add hierarchy fields as `?` (optional) to existing interfaces so existing code compiles without changes.
**When to use:** Backward-compatibility is required and fields will be populated incrementally (Phase 5 adds data, Phase 4 only adds schema).

```typescript
// kg-operators.ts -- add to KGEntity at line 31
export interface KGEntity {
  id: string;
  name: string;
  type: string;
  observations: string[];
  significance: number;
  embedding?: number[];
  role?: 'core' | 'non-core';
  batchId?: string;
  timestamp?: string;
  references?: string[];
  enrichedContext?: string;
  // Phase 4: Hierarchy fields -- all optional for backward compatibility
  parentId?: string;       // Entity name of parent (L0/L1/L2 scaffold node)
  level?: number;          // 0=Project, 1=Component, 2=SubComponent, 3=Detail
  hierarchyPath?: string;  // "Coding/KnowledgeManagement/OnlineLearning"
}
```

Note: The identical addition must be made to `types/agent-dataflow.ts:389`.

### Pattern 2: SharedMemoryEntity Hierarchy Fields

**What:** Add hierarchy fields to SharedMemoryEntity.

```typescript
// persistence-agent.ts -- add to SharedMemoryEntity at line 40
export interface SharedMemoryEntity {
  id: string;
  name: string;
  entityType: string;
  significance: number;
  observations: (string | ObservationObject)[];
  relationships: EntityRelationship[];
  metadata: EntityMetadata;
  quick_reference?: {
    trigger: string;
    action: string;
    avoid: string;
    check: string;
  };
  // Phase 4: Hierarchy fields -- all optional for backward compatibility
  hierarchyLevel?: number;          // 0-3
  parentEntityName?: string;        // Name of parent entity (null for root)
  childEntityNames?: string[];      // Names of direct children
  isScaffoldNode?: boolean;         // true for L0-L2 structural nodes
}
```

**Critical:** The `processEntity()` helper inside `persistEntities()` (persistence-agent.ts:3177) constructs a `SharedMemoryEntity` object literal that does NOT spread all input fields. Phase 4 adds the interface shape only. Phase 5 (migration) is when actual hierarchy data flows through, and that phase must update the object literal construction to forward hierarchy fields.

### Pattern 3: EntityMetadata Hierarchy Audit Fields

**What:** EntityMetadata already holds ontology classification metadata in a sub-object. Add minimal hierarchy audit fields.

```typescript
// persistence-agent.ts -- add to EntityMetadata at line 69
export interface EntityMetadata {
  created_at: string;
  last_updated: string;
  // ... existing fields ...
  ontology?: { ... };  // existing ontology sub-object
  // Phase 4: Hierarchy classification audit
  hierarchyClassifiedAt?: string;         // ISO timestamp
  hierarchyClassificationMethod?: string; // 'manifest-keyword' | 'llm-fallback' | 'manual'
}
```

### Pattern 4: Ontology Entity Type Addition

**What:** Add `Component` and `SubComponent` entries to `coding-ontology.json` under the `entities` key.

Neither type uses `extendsEntity` because they are structural scaffold nodes, not code artifacts (File, Service, Config etc. do not apply).

```json
"Component": {
  "description": "A top-level architectural component (L1) of the Coding project hierarchy, grouping related knowledge entities under a named subsystem",
  "properties": {
    "componentName": {
      "type": "string",
      "description": "PascalCase component name matching the component manifest"
    },
    "aliases": {
      "type": "array",
      "description": "Alternative names used to match entities to this component"
    },
    "keywords": {
      "type": "array",
      "description": "Heuristic matching keywords for entity classification"
    },
    "level": {
      "type": "number",
      "description": "Hierarchy level (always 1 for Component)"
    }
  },
  "requiredProperties": ["componentName"],
  "examples": ["LiveLoggingSystem", "KnowledgeManagement", "SemanticAnalysis"]
},
"SubComponent": {
  "description": "A named subsystem (L2) nested within a Component, grouping related Detail entities",
  "properties": {
    "componentName": {
      "type": "string",
      "description": "PascalCase sub-component name"
    },
    "parentComponent": {
      "type": "string",
      "description": "Name of the L1 parent component"
    },
    "level": {
      "type": "number",
      "description": "Hierarchy level (always 2 for SubComponent)"
    }
  },
  "requiredProperties": ["componentName", "parentComponent"],
  "examples": ["ManualLearning", "OnlineLearning", "Pipeline", "Ontology", "Insights"]
}
```

### Pattern 5: Component Manifest YAML Format

File path: `integrations/mcp-server-semantic-analysis/config/component-manifest.yaml`

This location is bind-mounted read-only into Docker (confirmed at docker-compose.yml line 72). No Docker rebuild is needed to change the manifest content.

```yaml
# component-manifest.yaml
# Authoritative source of truth for the L1/L2 component hierarchy.
# Read by: Phase 6 HierarchyClassifier, Phase 5 migration script
# Loaded via: yaml package parse(), same pattern as workflow-loader.ts

version: "1.0"

project:
  name: Coding
  level: 0
  description: "The root coding project node encompassing all development infrastructure knowledge"

components:
  - name: LiveLoggingSystem
    level: 1
    description: "Live session logging infrastructure capturing Claude Code conversations. Handles session windowing, file routing, classification layers, and transcript capture."
    aliases:
      - LSL
      - live-logging
      - session-logging
      - SpecStory
    keywords:
      - session
      - logging
      - transcript
      - LSL
      - classification
      - windowing
    children: []

  - name: LLMAbstraction
    level: 1
    description: "Abstraction layer over LLM providers (Anthropic, OpenAI, Groq) enabling provider-agnostic model calls, tier-based routing, and mock mode for testing."
    aliases:
      - llm-cli
      - llm-proxy
      - model-abstraction
      - DMR
    keywords:
      - LLM
      - provider
      - anthropic
      - openai
      - groq
      - tier
      - model
    children: []

  - name: DockerizedServices
    level: 1
    description: "Docker containerization layer for all coding services including semantic analysis MCP, constraint monitor, code-graph-rag, and supporting databases."
    aliases:
      - docker
      - containers
      - coding-services
    keywords:
      - docker
      - container
      - compose
      - service
      - deployment
    children: []

  - name: Trajectory
    level: 1
    description: "AI trajectory and planning system managing project milestones, GSD workflow, phase planning, and implementation task tracking."
    aliases:
      - GSD
      - planning
      - milestone
      - phases
    keywords:
      - trajectory
      - milestone
      - planning
      - phase
      - GSD
      - roadmap
    children: []

  - name: KnowledgeManagement
    level: 1
    description: "Knowledge graph storage, query, and lifecycle management including the VKB server, graph database, entity persistence, and knowledge decay tracking."
    aliases:
      - knowledge-graph
      - KG
      - VKB
      - UKB
    keywords:
      - knowledge
      - graph
      - entity
      - VKB
      - UKB
      - LevelDB
      - Graphology
      - persistence
    children:
      - name: ManualLearning
        level: 2
        description: "Knowledge created or curated by humans: manually authored entities, direct edits, and hand-crafted observations."
        aliases:
          - manual
          - human-authored
        keywords:
          - manual
          - human
          - authored
          - curated

      - name: OnlineLearning
        level: 2
        description: "Knowledge extracted automatically by the batch analysis pipeline from git history, LSL sessions, and code analysis."
        aliases:
          - automated
          - pipeline-extracted
          - batch-learning
        keywords:
          - batch
          - pipeline
          - automated
          - extracted
          - analysis

  - name: CodingPatterns
    level: 1
    description: "General programming wisdom, design patterns, best practices, and coding conventions applicable across the project. Catch-all for entities not fitting other components."
    aliases:
      - patterns
      - best-practices
      - conventions
    keywords:
      - pattern
      - convention
      - practice
      - design
      - approach
    children: []

  - name: ConstraintSystem
    level: 1
    description: "Constraint monitoring and enforcement system that validates code actions and file operations against configured rules during Claude Code sessions."
    aliases:
      - constraints
      - constraint-monitor
      - enforcement
    keywords:
      - constraint
      - rule
      - validation
      - enforcement
      - hook
    children: []

  - name: SemanticAnalysis
    level: 1
    description: "Multi-agent semantic analysis pipeline (batch-analysis workflow) that processes git history and LSL sessions to extract and persist structured knowledge entities."
    aliases:
      - semantic-analysis
      - MCP
      - pipeline
      - batch-analysis
    keywords:
      - semantic
      - analysis
      - agent
      - pipeline
      - batch
      - ontology
      - classification
    children:
      - name: Pipeline
        level: 2
        description: "The batch processing pipeline agents: coordinator, observation generation, KG operators, deduplication, and persistence."
        aliases:
          - coordinator
          - batch-pipeline
        keywords:
          - coordinator
          - batch
          - observation
          - KG
          - pipeline

      - name: Ontology
        level: 2
        description: "The ontology classification system: upper/lower ontology definitions, entity type resolution, and validation."
        aliases:
          - ontology-classification
          - entity-types
        keywords:
          - ontology
          - classification
          - entity-type
          - validation

      - name: Insights
        level: 2
        description: "Insight generation, pattern catalog extraction, and knowledge report authoring."
        aliases:
          - insight-generation
          - patterns
          - reports
        keywords:
          - insight
          - pattern
          - report
          - generation
          - catalog
```

### Pattern 6: Loading the Manifest in TypeScript

Follow the exact pattern from workflow-loader.ts:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { getConfigDir } from './workflow-loader.js';

export interface ComponentManifestEntry {
  name: string;
  level: number;
  description: string;
  aliases: string[];
  keywords: string[];
  children?: ComponentManifestEntry[];
}

export interface ComponentManifest {
  version: string;
  project: { name: string; level: number; description: string };
  components: ComponentManifestEntry[];
}

export function loadComponentManifest(configDir?: string): ComponentManifest {
  const dir = configDir || getConfigDir();
  const manifestPath = path.join(dir, 'component-manifest.yaml');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Component manifest not found: ${manifestPath}`);
  }
  const content = fs.readFileSync(manifestPath, 'utf-8');
  return parse(content) as ComponentManifest;
}
```

### Anti-Patterns to Avoid

- **Making hierarchy fields required:** All new fields MUST be `?` optional. 252 existing entities have no hierarchy data. Required fields break all existing construction sites.
- **Syncing only one KGEntity copy:** The two definitions at kg-operators.ts and agent-dataflow.ts MUST be updated identically. Partial addition causes type errors in files importing from types/index.ts.
- **Forgetting persistEntities() object literal at line 3177:** This explicit literal drops any field not named in it. Phase 4 is interface-only; Phase 5 must update the literal when data flows.
- **Using extendsEntity on Component/SubComponent:** They are structural scaffold nodes, not code artifacts. Do not inherit from File, Service, Config, or any upper ontology type.
- **Placing the manifest outside config/:** The manifest MUST live in `integrations/mcp-server-semantic-analysis/config/` (bind-mounted). Placing it in src/ requires Docker rebuild to take effect.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing | Custom string parser for manifest | `yaml` package (already installed) | Handles nested objects, arrays, multi-line strings, comments correctly |
| TypeScript interface breakage discovery | Manual grep | `tsc --noEmit` | Compiler finds all construction sites with line numbers immediately |
| Ontology validation testing | Custom test harness | Existing lenient-mode validation in persistence-agent.ts:479 | Already handles EntityResolutionError gracefully in catch block |

**Key insight:** The storage layer already handles arbitrary fields automatically. `GraphDatabaseService.storeEntity()` uses `...entityWithoutRelationships` spread at line 227, so any fields added to `SharedMemoryEntity` that are passed into `storeEntityToGraph()` persist to LevelDB without any storage code changes.

---

## Common Pitfalls

### Pitfall 1: Dual KGEntity Definitions Not Kept in Sync

**What goes wrong:** Hierarchy fields added to `kg-operators.ts:31` but not to `types/agent-dataflow.ts:389`. The quality-assurance agent imports from `types/index.ts` which re-exports from agent-dataflow. TypeScript silently drops the fields at the type level or produces subtle union errors in the QA agent.
**Why it happens:** The duplication is not obvious from a casual scan; the names are identical and the exports look the same.
**How to avoid:** Edit both files in the same commit. Run `tsc --noEmit` in the mcp-server-semantic-analysis submodule before committing.
**Warning signs:** `Property 'hierarchyPath' does not exist on type 'KGEntity'` errors only in quality-assurance-agent.ts or files importing from `../types/`.

### Pitfall 2: persistEntities() Object Literal Drops Hierarchy Fields

**What goes wrong:** The `sharedMemoryEntity` object literal inside `processEntity()` at persistence-agent.ts:3177 enumerates only specific fields. Hierarchy fields on the input are dropped here.
**Why it happens:** Same mechanism as the known type/entityType disconnect fix already documented in STATE.md accumulated context.
**How to avoid:** Phase 4 adds interfaces only. Phase 5 must update the literal. This is expected and documented -- do not treat it as a Phase 4 bug.
**Warning signs:** Phase 5 round-trip integration test fails -- entity created with hierarchy fields, getEntity() returns entity without them.

### Pitfall 3: VKB Viewer Pre-Existing TypeScript Errors

**What goes wrong:** The VKB viewer currently has 10 pre-existing TypeScript errors (confirmed by tsc run). If interface additions introduce new errors, they are obscured.
**Why it happens:** VKB viewer tsconfig has strict: false -- not all type issues are caught. Existing errors include unused imports, missing content properties on union types.
**How to avoid:** Run `tsc --noEmit` in memory-visualizer BEFORE making changes and record baseline (10 errors). Run again after. Any increase is a regression.
**Warning signs:** Error count increases from 10 after interface additions.

### Pitfall 4: Ontology extendsEntity Pointing to Non-Existent Types

**What goes wrong:** If Component or SubComponent uses `extendsEntity: "SomeType"` not in the upper ontology, `resolveEntityDefinition()` throws EntityResolutionError during validation.
**Why it happens:** Upper ontology types are: File, Service, Feature, Contract, RuntimeDiagnostics, StaticDiagnostics, Port, Config, Container, Process, Fault, Limitation, Revision. None fit structural hierarchy nodes.
**How to avoid:** Do NOT use `extendsEntity` on Component or SubComponent entries.
**Warning signs:** Ontology validation logs EntityResolutionError for Component or SubComponent entities.

### Pitfall 5: Manifest File Location and Docker Visibility

**What goes wrong:** Manifest placed in src/ or dist/ instead of config/, requiring Docker rebuild.
**Why it happens:** Developers place the file near the reading code in src/.
**How to avoid:** File MUST be at `integrations/mcp-server-semantic-analysis/config/component-manifest.yaml`. Confirmed bind-mount at docker-compose.yml line 72: `${CODING_REPO:-.}/integrations/mcp-server-semantic-analysis/config:/coding/integrations/mcp-server-semantic-analysis/config:ro`.
**Warning signs:** Manifest changes not reflected until Docker rebuild.

### Pitfall 6: snake_case vs camelCase in VKB API Response

**What goes wrong:** Hierarchy fields stored as camelCase in LevelDB (e.g., `parentId`) may surface as `parent_id` in the VKB HTTP API response, depending on whether the API layer normalizes field names.
**Why it happens:** The existing Entity interface already has `entity_name`, `entity_type`, `extracted_at` in snake_case -- suggesting the API layer transforms keys. But this is not confirmed for metadata fields passed through the spread.
**How to avoid:** For Phase 4, add both forms as optional fields on the VKB Entity interface, OR add as `metadata?: any` and resolve field naming in Phase 5 when real data flows.
**Warning signs:** Phase 5 round-trip test shows hierarchy fields exist on stored entity but not on fetched entity, or appear under different key name.

---

## Code Examples

Verified patterns from the actual codebase:

### Existing KGEntity at kg-operators.ts:31 (reference for what to add to)
```typescript
export interface KGEntity {
  id: string;
  name: string;
  type: string;
  observations: string[];
  significance: number;
  embedding?: number[];
  role?: 'core' | 'non-core';
  batchId?: string;
  timestamp?: string;
  references?: string[];
  enrichedContext?: string;
  // ADD AFTER enrichedContext:
  parentId?: string;
  level?: number;
  hierarchyPath?: string;
}
```

### Existing SharedMemoryEntity at persistence-agent.ts:40 (reference)
```typescript
export interface SharedMemoryEntity {
  id: string;
  name: string;
  entityType: string;
  significance: number;
  observations: (string | ObservationObject)[];
  relationships: EntityRelationship[];
  metadata: EntityMetadata;
  quick_reference?: { trigger: string; action: string; avoid: string; check: string; };
  // ADD AFTER quick_reference:
  hierarchyLevel?: number;
  parentEntityName?: string;
  childEntityNames?: string[];
  isScaffoldNode?: boolean;
}
```

### Existing Entity interface at databaseClient.ts:8 (VKB viewer)
```typescript
export interface Entity {
  id: string;
  entity_name: string;
  entity_type: string;
  observations: string[];
  classification: string;
  confidence: number;
  source: 'manual' | 'auto';
  team: string;
  extracted_at: string;
  last_modified: string;
  metadata?: any;
  // ADD AFTER metadata:
  parent_id?: string;        // snake_case to match API response format
  level?: number;
  hierarchy_path?: string;
}
```

### YAML Loading Pattern (from workflow-loader.ts -- use the same)
```typescript
import { parse } from 'yaml';
import * as fs from 'fs';

const content = fs.readFileSync(manifestPath, 'utf-8');
const manifest = parse(content) as ComponentManifest;
```

### TypeScript Compilation Check Commands
```bash
# MCP server (strict: true -- must be 0 errors before and after)
cd integrations/mcp-server-semantic-analysis && npx tsc --noEmit

# VKB viewer (strict: false -- baseline 10 errors, must not increase)
cd integrations/memory-visualizer && npx tsc --noEmit
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| KGEntity in single location | Two duplicate definitions (kg-operators.ts + agent-dataflow.ts) | Pre-existing | Both must be updated identically |
| Flat knowledge graph | Hierarchical model (L0-L3) | Phase 4 introduces schema | Schema-only in Phase 4; data populated in Phase 5 and 6 |
| Unknown entity types blocked in strict mode | Lenient mode allows unknown types with warnings | Pre-existing | Component/SubComponent would not block pipeline today, but adding to ontology eliminates spurious warnings |

**Existing technical debt (do not fix in Phase 4):**
- Two duplicate KGEntity definitions: Claude's discretion per CONTEXT.md whether to consolidate
- VKB viewer has 10 pre-existing TypeScript errors: not in Phase 4 scope
- type/entityType disconnect in coordinator: explicitly deferred per CONTEXT.md locked decisions

---

## Open Questions

1. **Does the VKB API layer convert camelCase field names to snake_case?**
   - What we know: GraphDatabaseService stores fields via `...entityWithoutRelationships` spread (so `parentId` stored as-is in LevelDB). The existing Entity interface uses snake_case (`entity_name`, `entity_type`), suggesting the API transforms keys.
   - What's unclear: Whether transformation applies to all fields or only top-level known fields.
   - Recommendation: For Phase 4, add hierarchy fields to VKB Entity interface as both forms (snake_case) matching the existing convention. Verify actual behavior in Phase 5 round-trip test.

2. **Should KGEntity be consolidated into a single canonical location?**
   - What we know: Two identical definitions exist. CONTEXT.md marks this as Claude's discretion.
   - Recommendation: Create `src/types/shared-interfaces.ts` and re-export from both current locations. Eliminates future sync issues. Run `tsc --noEmit` to verify zero regressions after re-export. This is low-risk since the compiler catches all import mismatches.

3. **Does EntityMetadata need hierarchy audit fields?**
   - What we know: CONTEXT.md says "EntityMetadata (keeps audit fields only)" and marks exact field names as Claude's discretion.
   - Recommendation: Add `hierarchyClassifiedAt?: string` and `hierarchyClassificationMethod?: string`. Minimal cost, useful for Phase 6 debugging when keyword vs LLM classification decisions need to be traced.

---

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `integrations/mcp-server-semantic-analysis/src/agents/kg-operators.ts` -- KGEntity at line 31, mergeEntities at line 396
- Direct code inspection: `integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts` -- SharedMemoryEntity at line 40, EntityMetadata at line 69, persistEntities at line 3067, processEntity object literal at line 3177, validateEntity at line 479, PROTECTED_ENTITY_TYPES at line 1070
- Direct code inspection: `integrations/mcp-server-semantic-analysis/src/types/agent-dataflow.ts` -- duplicate KGEntity at line 389
- Direct code inspection: `integrations/mcp-server-semantic-analysis/src/knowledge-management/GraphDatabaseService.js` -- storeEntity uses `...entityWithoutRelationships` spread at line 227 confirming arbitrary field persistence
- Direct code inspection: `integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts` -- GraphEntity interface, storeEntity routing
- Direct code inspection: `integrations/mcp-server-semantic-analysis/src/utils/workflow-loader.ts` -- YAML loading pattern with `yaml` package
- Direct code inspection: `integrations/memory-visualizer/src/api/databaseClient.ts` -- Entity interface at line 8, snake_case field naming convention
- Direct code inspection: `integrations/memory-visualizer/src/store/slices/navigationSlice.ts` -- Node interface at line 11
- Direct inspection: `.data/ontologies/lower/coding-ontology.json` -- entity type structure with description, properties, requiredProperties, examples keys
- Direct inspection: `.data/ontologies/upper/development-knowledge-ontology.json` -- upper ontology type list (File, Service, Feature, etc.)
- Direct inspection: `docker/docker-compose.yml` line 72 -- bind-mount topology confirming config/ directory is read-only mounted
- Direct inspection: `integrations/mcp-server-semantic-analysis/tsconfig.json` -- strict: true confirmed
- Direct inspection: `integrations/memory-visualizer/tsconfig.json` -- strict: false confirmed
- `tsc --noEmit` run -- MCP server: 0 errors; VKB viewer: 10 pre-existing errors
- Direct inspection: `integrations/mcp-server-semantic-analysis/package.json` -- yaml ^2.8.2 confirmed as dependency

### Secondary (MEDIUM confidence)
- Ontology validation behavior: inferred from OntologyValidator.ts catch block and persistence-agent.ts validateEntity() catch block (line 527-540) -- lenient mode allows unknown entity types with logged warning, never blocks persistence
- snake_case field naming: inferred from existing Entity interface pattern in databaseClient.ts, not confirmed for metadata fields passed through spread

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- yaml package and TypeScript versions confirmed from package.json and tsconfig files
- Architecture patterns: HIGH -- derived from direct code inspection, not assumptions
- Pitfalls: HIGH -- dual-KGEntity and persistEntities() literal issues verified by direct code reading; VKB error count from actual tsc run
- Ontology structure: HIGH -- derived from actual coding-ontology.json structure and OntologyManager resolveEntityDefinition logic

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (stable codebase; changes to persistence-agent.ts or kg-operators.ts would require re-read)
