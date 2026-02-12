# Ontology System

Automated knowledge classification with a six-facet upper ontology, team-specific lower ontologies, hybrid classification, and schema validation.

![Six-Facet Ontology Structure](../images/ontology-six-facet-structure.png)

## Six-Facet Upper Ontology

The upper ontology organizes all software knowledge into six orthogonal **facets** -- dimensions along which any software component can be described:

| # | Facet | Question | Entity Types |
|---|-------|----------|-------------|
| 1 | **Structure** | What it IS | File, Service, Feature |
| 2 | **Behavior** | What it DOES | Contract |
| 3 | **Operations** | How it RUNS | RuntimeDiagnostics, StaticDiagnostics, Port, Config, Container, Process |
| 4 | **Resilience** | What goes WRONG | Fault, Limitation |
| 5 | **Quality** | How GOOD it is | *(properties on File/Service/Feature)* |
| 6 | **Evolution** | How it CHANGED | Revision |

**Totals**: 13 entity types, 20 relationships, 6 quality properties.

### Structure Facet

Three-level code hierarchy with explicit composition:

- **File** -- Atomic source file (path, language, purpose)
- **Service** -- Deployable unit composed of files (server, proxy, UI, CLI, library, agent, worker)
- **Feature** -- User-facing capability composed of services

Relations: `part_of` (File/Service to Service/Feature), `depends_on` (Service to Service), `proxies_for` (Service to Service)

### Behavior Facet

- **Contract** -- Specification of what a component promises to do (inputs, outputs, protocol, invariants)

Relations: `fulfills` (Service/File implements a Contract), `depends_on_contract` (Service needs a Contract)

Architectural patterns (proxy, circuit-breaker, observer, etc.) are captured as a `patterns` property on Service.

### Operations Facet

- **RuntimeDiagnostics** -- Observable output while running (log files, stderr, endpoints, docker-logs)
- **StaticDiagnostics** -- Checks without running (type-check, lint, config-validation, schema)
- **Port** -- Network port for inter-component communication
- **Config** -- Configuration source (JSON, YAML, env, shell)
- **Container** -- Docker container or compose service
- **Process** -- Running OS-level process

Relations: `diagnosed_by`, `logs_to`, `connects_to`, `listens_on`, `configured_by`, `runs_in`, `spawns`

### Resilience Facet

- **Fault** -- Known failure mode with symptoms, root cause, resolution, and severity
- **Limitation** -- Known boundary or technical debt (scalability, missing-feature, design-constraint, dependency)

Relations: `affects` (Fault on Service), `revealed_by` (Fault in RuntimeDiagnostics), `prevented_by` (Fault caught by StaticDiagnostics), `caused_by` (Fault chain), `limited_by` (Service/Feature has Limitation)

### Quality Facet

No dedicated nodes. Quality is expressed as **properties** on structure entities:

- **File**: `complexity` (low/medium/high), `testCoverage` (none/partial/full)
- **Service**: `maturity` (prototype/active/stable/deprecated/sunset), `architectureStyle`, `patterns`
- **Feature**: `maturity`

### Evolution Facet

- **Revision** -- Significant change milestone (not every commit, but meaningful structural or behavioral changes)

Relations: `changed_in` (File/Service modified in Revision), `precedes` (chronological ordering), `addressed_in` (Limitation resolved in Revision)

## Upper / Lower Ontology Inheritance

```
Upper Ontology (13 entity types)
  |
  +-- Lower: coding-ontology.json
  |     LSLSession extends File
  |     MCPAgent extends Service
  |     GraphDatabase extends Service
  |     ...
  |
  +-- Lower: raas-ontology.json
  |     EventMeshNode extends Service
  |     KubernetesCluster extends Process
  |     ...
  |
  +-- Lower: resi-ontology.json
  |     EmbeddedFunction extends Service
  |     MF4Container extends File
  |     ...
  |
  +-- Lower: ui-ontology.json
  |     ReactComponent extends Service
  |     AWSLambdaFunction extends Process
  |     ...
  |
  +-- Lower: agentic-ontology.json
  +-- Lower: code-entities-ontology.json
  +-- Lower: cluster-reprocessing-ontology.json
```

!!! info "Inheritance Rules"
    - Lower ontology entities extend upper ontology entities via `extendsEntity`
    - Properties merge (lower overrides upper)
    - Required properties accumulate
    - Lower ontologies are team-scoped

**File locations**:

- Upper: `.data/ontologies/upper/development-knowledge-ontology.json`
- Lower: `.data/ontologies/lower/{team}-ontology.json`
- Schema: `.data/ontologies/schemas/ontology-schema.json`

## 4-Layer Classification Pipeline

The classification system determines entity types for knowledge items:

| Layer | Method | Speed | Description |
|-------|--------|-------|-------------|
| 1 | Heuristic Patterns | >10,000/sec | Fast pattern matching, early exit at >=0.85 confidence |
| 2 | Enhanced Keyword Matcher | <10ms | Multi-keyword scoring with domain terminology |
| 3 | Semantic Embedding | ~50ms | 384-dim vector similarity against ontology definitions |
| 4 | LLM Classification | ~500ms | Fallback via Groq, OpenAI, Anthropic, or Google |

### Classification Examples

```typescript
// Heuristic-only (fast, no cost)
const result = await classifier.classify('MCP proxy restart failure', {
  team: 'coding',
  enableHeuristics: true,
  enableLLM: false,
  minConfidence: 0.7,
});
// => { entityClass: 'Fault', confidence: 0.88, method: 'heuristic' }

// Hybrid (try heuristics, fall back to LLM)
const result = await classifier.classify(knowledge, {
  enableHeuristics: true,
  enableLLM: true,
  minConfidence: 0.7,
});
```

## Configuration

```json
{
  "ontology": {
    "enabled": true,
    "upperOntologyPath": ".data/ontologies/upper/development-knowledge-ontology.json",
    "team": "coding",
    "confidenceThreshold": 0.7,
    "validation": {
      "enabled": true,
      "mode": "lenient"
    },
    "classification": {
      "enableHeuristics": true,
      "enableLLM": false,
      "heuristicThreshold": 0.85
    }
  }
}
```

## Validation

**Strict mode** -- Enforces all rules, rejects unknown properties (production use).

**Lenient mode** -- Allows extra properties (development, exploration).

The validator checks: required properties, type checking, enum constraints, pattern matching (regex), range constraints (min/max), nested objects, and array items.

## Querying

```typescript
// By entity class
const results = await queryEngine.findByEntityClass('Service', 'coding');

// By property
const results = await queryEngine.findByProperty('Fault', 'severity', 'critical');

// Aggregation
const counts = await queryEngine.aggregateByEntityClass('coding');
// => { Service: 12, File: 45, Config: 8, Fault: 3, ... }
```

## Design Decisions

1. **Six facets** -- Prevents the ontology from becoming a flat grab-bag. Each facet answers a clear question.
2. **Node vs property** -- Nodes have relationships to other things. Properties are scalar attributes of one thing. This prevents bloat.
3. **File granularity** -- File is the atomic level. Functions/classes are delegated to code-graph-rag. Features are the coarsest level.
4. **Contract as a node** -- Contracts are reusable (multiple services fulfill one contract) and testable independently.
5. **Limitation as a node** -- Limitations are shared across services, linked to planned revisions, and can chain causally.
6. **Quality as properties** -- Complexity, maturity, and test coverage are scalar measurements. Promote to nodes only if relationships are needed.
7. **Revision over git commits** -- Semantic change milestones that an agent can reason about, not per-commit noise.

## Related

- [Knowledge Management](ukb-vkb.md) -- UKB integrates with ontology classification
- [Knowledge Workflows](../guides/knowledge-workflows.md) -- UKB analysis workflows use the classification pipeline
- [Semantic Analysis](../integrations/semantic-analysis.md) -- MCP tools for ontology operations
