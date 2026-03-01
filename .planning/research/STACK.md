# Stack Research

**Domain:** Multi-agent knowledge graph pipeline (UKB) — v2.0 Hierarchical Restructuring
**Researched:** 2026-03-01
**Confidence:** HIGH — sourced from direct codebase inspection and npm registry verification

---

## What This Milestone Adds

This document extends the existing stack documentation (originally 2026-02-26) with additions required
for the v2.0 hierarchical restructuring. The existing stack is sound and documented below in full;
this section highlights **net-new additions only**.

---

## New Stack Additions

### 1. Hierarchy Traversal — graphology-traversal

**Package:** `graphology-traversal` ^0.3.1
**Install in:** `integrations/mcp-server-semantic-analysis/` (MCP server submodule)

**Why:** The existing Graphology ^0.25.4 graph already stores all hierarchy via `storeRelationship()`
edges (relation_type: 'parent-of'). However there is no package currently installed that provides
BFS/DFS traversal from a root node. `graphology-traversal` is the official Graphology standard
library package for this — it is peer-compatible with graphology ^0.25.4 and exports
`bfs`, `bfsFromNode`, `dfs`, `dfsFromNode`.

**What it enables:**
- Migration script: walk the graph from 'Coding' root to L2 components to L3 sub-components to leaf entities
- Hierarchy assignment during pipeline: classify any new entity by traversing from the target parent node
- VKB API: serve `/api/entities/tree?team=coding` by doing BFS from root

**Compatibility confirmed:** graphology-traversal peer dependency is `graphology-types >=0.20.0`;
current graphology ^0.25.4 satisfies this (verified via `npm view graphology-traversal peerDependencies`).

```bash
# In integrations/mcp-server-semantic-analysis/
npm install graphology-traversal@^0.3.1
```

**Usage pattern:**
```typescript
import { bfsFromNode } from 'graphology-traversal/bfs';

bfsFromNode(graph, 'coding:Coding', (nodeId, attributes, depth) => {
  console.log(`${depth}: ${attributes.name} (${attributes.entityType})`);
});
```

Note: `graphology-utils` ^2.5.2 is already installed at the root level and provides helpers
like `subgraph()` — available but not needed for the primary hierarchy traversal case.

---

### 2. Tree Navigation UI — react-arborist

**Package:** `react-arborist` ^3.4.3
**Install in:** `integrations/memory-visualizer/` (VKB viewer)

**Why:** The VKB viewer is a React 18 + D3 + Redux app with Tailwind CSS and Vite.
The current view is a D3 force-directed graph — flat, no drill-down, no expand/collapse.
For the hierarchy milestone the viewer needs a separate tree panel that shows
Coding to L2 to L3 to leaf nodes with click-to-drill-down behavior.

`react-arborist` is the right choice over alternatives because:
- It is built for React 18 (peer dep `react >= 16.14`, tested against 18)
- Virtualizes rendering — handles 126 entities today, scales to 1000+
- TypeScript definitions are built-in (no separate `@types` package needed)
- Supports click selection, keyboard navigation, expand/collapse out of the box
- Does NOT require MUI, Syncfusion, or any design system — integrates cleanly with Tailwind
- Shadcn tree view alternatives are not npm packages; they are registry snippets that
  must be copied and maintained by hand — wrong choice for this project

**Peer dependency check confirmed:** react-arborist ^3.4.3 requires `react >= 16.14`;
current VKB viewer uses React 18.2.0 which satisfies this (verified via `npm view react-arborist peerDependencies`).

```bash
# In integrations/memory-visualizer/
npm install react-arborist@^3.4.3
```

**Usage pattern:**
```tsx
import { Tree } from 'react-arborist';

type HierarchyNode = {
  id: string;
  name: string;
  children?: HierarchyNode[];
  entityType: string;
  level: number;
};

<Tree<HierarchyNode>
  data={hierarchyData}
  onSelect={(nodes) => dispatch(selectNode(nodes[0].data))}
  rowHeight={32}
>
  {({ node, style }) => (
    <div style={style} onClick={() => node.toggle()}>
      {node.data.name}
    </div>
  )}
</Tree>
```

---

### 3. Entity Schema Extensions — parentId, level, hierarchyPath

**No new packages needed.** Graphology node attributes are a free-form object — adding
`parentId`, `level`, and `hierarchyPath` fields to `storeEntity()` requires only a
TypeScript type change, not a new library.

**Fields to add to `KGEntity` interface in `kg-operators.ts`:**
```typescript
export interface KGEntity {
  // ... existing fields ...
  parentId?: string;          // node ID of parent entity (e.g., 'coding:KnowledgeManagement')
  level?: number;             // 0=root, 1=L2 component, 2=L3 sub-component, 3=leaf
  hierarchyPath?: string[];   // breadcrumb from root ['Coding', 'KnowledgeManagement', 'ManualLearning']
}
```

**In `GraphDatabaseService.storeEntity()`:** The spread `...entityWithoutRelationships` already
passes through any extra fields to Graphology node attributes. The fields will persist
automatically to LevelDB on the next flush cycle. No storage schema migration is required —
Graphology + LevelDB stores attributes as arbitrary JSON.

**VKB API `GET /api/entities` response:** `lib/vkb-server/api-routes.js` already returns all
node attributes. The new fields appear in the response immediately once stored — no API
route changes are needed for basic entity reads.

**New API endpoint needed:** `GET /api/entities/tree?team=coding` — serves a tree-shaped
JSON response for `react-arborist`. This needs one new route in `lib/vkb-server/api-routes.js`
that calls `bfsFromNode` from root and builds a nested structure.

---

### 4. Migration Tooling — Node.js Script (no new packages)

**Pattern:** Follow `scripts/purge-knowledge-entities.js` — plain Node.js ESM script that calls
the VKB HTTP API at `http://localhost:8080`. No new packages required.

**Why API-based, not direct DB:** The purge script established this pattern correctly.
Calling the VKB HTTP API ensures LevelDB locking is handled by the server and the JSON
export stays in sync via `GraphKnowledgeExporter`. Writing directly to LevelDB from a
migration script would fight the lock and risk corrupting the export files.

**Script location:** `scripts/knowledge-management/migrate-to-hierarchy.js`

**What the script does:**
1. `GET /api/entities?team=coding&limit=1000` — load all 126 entities
2. Apply classification rules: assign each entity to a parent L2 component based on
   `entity_type`, `entity_name`, and keyword heuristics
3. `PUT /api/entities/:name` — write `parentId`, `level`, `hierarchyPath` attributes back
4. `POST /api/relations` — create 'parent-of' edges for each parent-child pair
5. Create curated L2 nodes (LSL, LLMAbstraction, DockerizedServices, Trajectory,
   KnowledgeManagement, CodingPatterns) via `POST /api/entities` if they do not exist
6. Merge generic entities into CodingPatterns via observation consolidation and delete source entities
7. Output a dry-run report before committing any changes (--dry-run flag, same as purge script)

**No new npm packages required** — `fetch` is built into Node.js 18+, and the existing
VKB API surface already covers all needed operations (POST, PUT, DELETE entities; POST relations).

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| graphology-layout / sigma.js | Only needed for force-directed layout; D3 already handles this in the VKB viewer | Existing D3 code |
| graphology-communities | Louvain community detection is overkill for a known, curated hierarchy | Manual parent assignment in migration script |
| Neo4j / ArangoDB | Replacing Graphology + LevelDB breaks 14 pipeline agents and the VKB server | Graphology edges for parent-child relations |
| @mui/x-tree-view | Pulls in the entire MUI package (~450KB) for a component that uses no MUI elsewhere | react-arborist (standalone, no design system) |
| Syncfusion TreeView | Commercial license, adds unnecessary dependency surface | react-arborist |
| graphology-shortest-path | Not needed — hierarchy is a DAG with known roots, BFS suffices | graphology-traversal bfsFromNode |
| better-sqlite3 in migration | Creates LevelDB lock conflicts; root package has it but migration must use HTTP API | VKB HTTP API at localhost:8080 |

---

## Installation Summary

```bash
# Step 1: MCP server submodule — graphology-traversal
cd /Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis
npm install graphology-traversal@^0.3.1

# Step 2: Rebuild submodule (CRITICAL — dist/ must be updated)
npm run build

# Step 3: Docker rebuild (CRITICAL — container runs from dist/)
cd /Users/Q284340/Agentic/coding/docker
docker-compose build coding-services && docker-compose up -d coding-services

# Step 4: VKB viewer — react-arborist (bind-mounted, no Docker rebuild)
cd /Users/Q284340/Agentic/coding/integrations/memory-visualizer
npm install react-arborist@^3.4.3
npm run build
```

---

## Version Compatibility Matrix

| Package | Version | Compatible With | Verified |
|---------|---------|----------------|---------|
| graphology | ^0.25.4 (installed) | graphology-traversal ^0.3.1 | YES — peer dep graphology-types >=0.20.0 satisfied |
| graphology-traversal | ^0.3.1 (new) | graphology ^0.25.4 | YES — npm view peerDependencies |
| react | 18.2.0 (installed) | react-arborist ^3.4.3 | YES — peer dep react >= 16.14 satisfied |
| react-arborist | ^3.4.3 (new) | React 18, TypeScript 5.3.3 | YES — built-in types, no @types/ needed |
| level | ^10.0.0 (installed) | No changes — not modified | N/A |
| graphology-utils | ^2.5.2 (root, installed) | graphology ^0.25.4 | YES — already in root package.json |

---

## Existing Stack (Unchanged)

The following documents the production stack from the v1.0 milestone. Nothing below this line
changes for v2.0 — reproduced here so this file remains the single authoritative stack reference.

---

### Agent Framework

**Pattern:** Custom multi-agent framework — NOT LangChain, AutoGen, or any third-party agent library.

| Agent | ID | LLM? | Tier |
|---|---|---|---|
| Batch Scheduler | batch_scheduler | No | fast |
| Git History | git_history | Yes | standard |
| Vibe History | vibe_history | Yes | standard |
| Semantic Analysis | semantic_analysis | Yes | standard (premium for batch) |
| Observation Generation | observation_generation | Yes | premium |
| Ontology Classification | ontology_classification | Yes | standard |
| KG Operators | kg_operators | Yes | mixed per operator |
| Quality Assurance | quality_assurance | Yes | premium |
| Batch Checkpoint | batch_checkpoint_manager | No | fast |
| Code Graph | code_graph | Yes (external) | standard |
| Documentation Linker | documentation_linker | Yes | standard |
| Web Search | web_search | Yes (optional) | fast |
| Insight Generation | insight_generation | Yes | premium |
| Persistence | persistence | No | fast |
| Deduplication | deduplication | No (embeddings only) | standard |
| Content Validation | content_validation | Yes | standard |

---

### LLM Integration Layer

**Library:** Custom `@coding/llm` shared library at `lib/llm/` — NOT a third-party routing library.

**Mode system:** mock / local (Docker Model Runner) / public (cloud APIs per provider priority chain).

---

### LLM Providers

All configured in `config/llm-providers.yaml`. Priority chain (first available wins):

| Provider | Models | Notes |
|---|---|---|
| copilot | claude-haiku-4.5 / claude-sonnet-4.5 / claude-opus-4.6 | Primary |
| claude-code | sonnet / opus | Secondary subscription provider |
| groq | llama-3.1-8b / llama-3.3-70b | API, per-token |
| anthropic | claude-haiku/sonnet/opus | API, per-token |
| openai | gpt-4.1-mini / gpt-4.1 / o4-mini | API, per-token |
| gemini | gemini-2.5-flash / gemini-2.5-pro | API, per-token |
| DMR | localhost:12434 | Local Docker Model Runner |

---

### SDK Bindings

| SDK | Package | Version |
|---|---|---|
| Anthropic SDK | @anthropic-ai/sdk | ^0.57.0 |
| OpenAI SDK | openai | ^4.52.0 |
| Groq SDK | groq-sdk | ^0.36.0 |
| Google Generative AI | @google/generative-ai | ^0.24.1 |

---

### Knowledge Graph Storage

**In-memory graph:** Graphology ^0.25.4 — multi-edge directed graph.
**Persistence:** Level (LevelDB) ^10.0.0 — single key `graph` stores serialized Graphology state.
**Node ID schema:** `{team}:{entityName}` pattern for team isolation.
**Database path:** `.data/knowledge-graph/` (relative to CODING_ROOT).

Access routing:
- `GraphDatabaseService` — core service (`src/knowledge-management/GraphDatabaseService.js`)
- `GraphDatabaseAdapter` — uses VKB HTTP API when vkb-server is running (lock-free), falls back to direct access
- `lib/vkb-server/api-routes.js` — Express API server, exposes `/api/entities`, `/api/relations`, `/api/stats`, `/api/teams`
- JSON export: `.data/knowledge-export/{team}.json` kept in sync via `GraphKnowledgeExporter`

---

### VKB Viewer Stack

**Location:** `integrations/memory-visualizer/`
**Framework:** React 18.2.0 + Vite 6 + TypeScript 5.3.3
**State:** Redux Toolkit ^2.9.2 + React-Redux ^9.2.0
**Visualization:** D3 ^7.8.5 (force-directed graph, current view)
**Styling:** Tailwind CSS ^3.4.1
**Markdown:** react-markdown ^10.1.0 + mermaid ^11.6.0 + highlight.js ^11.11.1
**Bind-mounted:** no Docker rebuild needed after source changes — `npm run build` only

---

### Infrastructure

| Component | Technology | Port |
|---|---|---|
| MCP SSE server | Node.js 20 + Express | 3848 |
| VKB server | Node.js | 8080 |
| System health dashboard | React (bind-mounted) | 3032 |
| Memgraph (code graph) | Memgraph graph DB | Docker internal |
| Docker Model Runner | llama.cpp local LLM | 12434 |

---

### Supporting Libraries (MCP Server)

| Library | Version | Purpose |
|---|---|---|
| express | ^4.21.0 | SSE server HTTP layer |
| yaml | ^2.8.2 | Config file parsing |
| graphology | ^0.25.4 | In-memory knowledge graph |
| level | ^10.0.0 | LevelDB persistence |
| axios | ^1.6.0 | HTTP client |
| cheerio | ^1.0.0-rc.12 | HTML parsing for web search scraping |
| typescript | ^5.8.3 | Language (strict mode, ES2022 target) |

---

### Key Configuration Files

| File | Purpose |
|---|---|
| config/llm-providers.yaml | Provider priority chain, model assignments |
| config/agents.yaml | Agent registry |
| config/workflows/batch-analysis.yaml | Primary workflow DAG |
| .data/workflow-progress.json | Runtime state |
| .data/batch-checkpoints.json | Per-batch completion state for resume |

---

## Sources

**Directly inspected (HIGH confidence):**
- `integrations/mcp-server-semantic-analysis/package.json` — confirmed graphology ^0.25.4, level ^10.0.0
- `integrations/memory-visualizer/package.json` — confirmed React 18.2.0, D3 7.8.5, Tailwind 3.4.1, TypeScript 5.3.3
- `package.json` (root) — confirmed graphology-utils ^2.5.2 already present
- `src/knowledge-management/GraphDatabaseService.js` — storeEntity, storeRelationship, attribute spread pattern, LevelDB persistence
- `lib/vkb-server/api-routes.js` — confirmed existing API surface (GET/POST/PUT/DELETE entities, POST relations)
- `integrations/memory-visualizer/src/api/databaseClient.ts` — Entity interface, no hierarchy fields
- `integrations/mcp-server-semantic-analysis/src/agents/kg-operators.ts` — KGEntity interface, no parentId/level fields
- `integrations/memory-visualizer/src/components/KnowledgeGraph/GraphVisualization.tsx` — D3 force-directed, no tree panel
- `scripts/purge-knowledge-entities.js` — established VKB HTTP API pattern for migration scripts
- Runtime: `node -e "..."` confirmed Graphology ^0.25.4 supports addNode, addEdge, getNodeAttributes correctly

**npm registry (HIGH confidence, verified live 2026-03-01):**
- `npm view graphology-traversal version` → 0.3.1
- `npm view graphology-traversal peerDependencies` → `{ 'graphology-types': '>=0.20.0' }`
- `npm view react-arborist version` → 3.4.3
- `npm view react-arborist peerDependencies` → `{ react: '>= 16.14', 'react-dom': '>= 16.14' }`
- `npm view graphology version` → 0.26.0 (latest; project uses 0.25.4 — both satisfy traversal peer dep)
- `npm view react version` → 19.2.4 (latest; project uses 18.2.0 — satisfies react-arborist peer dep)

**Web search (MEDIUM confidence):**
- graphology-traversal npm page — BFS/DFS API: `bfsFromNode(graph, startNode, callback(node, attrs, depth))`
- react-arborist GitHub — React 18 compatibility confirmed, built-in TypeScript types, virtualized rendering
- Shadcn tree view — confirmed: not an npm package, registry snippet only — not suitable for this project

---
*Stack research for: v2.0 Hierarchical Knowledge Restructuring*
*Researched: 2026-03-01*
