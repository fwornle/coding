# Ontology Integration System - User Guide

## Table of Contents

1. [Getting Started](#getting-started)
2. [Ontology Design](#ontology-design)
3. [Classification](#classification)
4. [Validation](#validation)
5. [Querying](#querying)
6. [Common Use Cases](#common-use-cases)
7. [Troubleshooting](#troubleshooting)
8. [Best Practices](#best-practices)

## Getting Started

### What is the Ontology Integration System?

The Ontology Integration System provides structured knowledge management with:

- **Hierarchical Ontologies**: Domain-level (upper) and team-specific (lower) ontologies
- **Automatic Classification**: Hybrid heuristic + LLM classification of knowledge
- **Schema Validation**: Ensure data quality with configurable validation rules
- **Powerful Queries**: Find knowledge by entity class, properties, relationships

### Prerequisites

- Node.js >= 16.0.0
- TypeScript 5.x (for development)
- Optional: LLM provider API key (Anthropic, OpenAI, Groq, or Google) for LLM classification

### Installation

The ontology system is included with the agent-agnostic-coding-tools package:

```bash
npm install agent-agnostic-coding-tools
```

### Basic Configuration

Create or update `config/knowledge-management.json`:

```json
{
  "ontology": {
    "enabled": true,
    "upperOntologyPath": ".data/ontologies/upper/cluster-reprocessing-ontology.json",
    "team": "RaaS",
    "lowerOntologyPath": ".data/ontologies/lower/raas-ontology.json",
    "confidenceThreshold": 0.7,
    "validation": {
      "enabled": true,
      "mode": "lenient"
    },
    "caching": {
      "enabled": true,
      "ttl": 3600000,
      "maxSize": 1000
    },
    "classification": {
      "enableHeuristics": true,
      "enableLLM": false,
      "batchSize": 10,
      "heuristicThreshold": 0.8
    }
  }
}
```

### Your First Classification

```typescript
import { createOntologySystem } from './ontology';

// Initialize the ontology system
const system = await createOntologySystem({
  enabled: true,
  upperOntologyPath: '.data/ontologies/upper/cluster-reprocessing-ontology.json',
  team: 'RaaS',
  lowerOntologyPath: '.data/ontologies/lower/raas-ontology.json',
});

// Classify some knowledge
const result = await system.classifier.classify(
  'Deploy Argo workflow to Kubernetes cluster',
  {
    team: 'RaaS',
    enableHeuristics: true,
    minConfidence: 0.7,
  }
);

console.log('Classification:', result);
// => {
//      entityClass: 'ArgoWorkflowTemplate',
//      team: 'RaaS',
//      confidence: 0.85,
//      method: 'heuristic',
//      evidence: '...'
//    }
```

## Ontology Design

### Upper vs Lower Ontologies

**Upper Ontology** (Domain-Level):

- Defines broad domain concepts shared across all teams
- Example: RecordedData, VirtualTarget, KPIFramework
- Located in `.data/ontologies/upper/`
- One upper ontology per domain

**Lower Ontology** (Team-Specific):

- Extends upper ontology with team-specific entities
- Example: KubernetesCluster (RaaS), EmbeddedFunction (ReSi)
- Located in `.data/ontologies/lower/`
- One lower ontology per team

### Ontology Structure

```json
{
  "name": "RaaS Ontology",
  "version": "1.0.0",
  "type": "lower",
  "description": "Team-specific ontology for RaaS cloud orchestration",
  "extendsOntology": "../upper/cluster-reprocessing-ontology.json",
  "entities": {
    "KubernetesCluster": {
      "description": "Kubernetes cluster for workload orchestration",
      "extendsEntity": "Infrastructure",
      "properties": {
        "clusterName": {
          "type": "string",
          "description": "Unique cluster identifier",
          "required": true
        },
        "region": {
          "type": "string",
          "description": "Cloud region",
          "enum": ["us-east-1", "us-west-2", "eu-central-1"]
        },
        "nodeCount": {
          "type": "number",
          "description": "Number of worker nodes",
          "min": 1,
          "max": 1000
        }
      },
      "examples": [
        "Production Kubernetes cluster in us-west-2",
        "kubectl apply deployment to prod-cluster"
      ]
    }
  },
  "relationships": [
    {
      "from": "ArgoWorkflowTemplate",
      "to": "KubernetesCluster",
      "type": "deploys_to",
      "description": "Workflow deploys to cluster"
    }
  ]
}
```

### Entity Inheritance

Lower ontology entities can extend upper ontology entities:

```json
{
  "ArgoWorkflowTemplate": {
    "extendsEntity": "CompoundReprocessing",
    "properties": {
      // Inherits properties from CompoundReprocessing
      // Plus team-specific properties:
      "dagSpec": {
        "type": "object",
        "description": "Argo DAG specification"
      }
    }
  }
}
```

**Resolution Rules**:

1. Lower ontology properties override upper ontology properties
2. Required properties merge (both must be satisfied)
3. Inheritance chain tracked for debugging

### Property Types

```typescript
// String with enum
{
  "status": {
    "type": "string",
    "enum": ["pending", "running", "completed", "failed"]
  }
}

// Number with range
{
  "cpu": {
    "type": "number",
    "min": 0.1,
    "max": 96,
    "description": "CPU cores"
  }
}

// Boolean
{
  "enabled": {
    "type": "boolean",
    "default": true
  }
}

// Object (nested)
{
  "resourceRequirements": {
    "type": "object",
    "properties": {
      "cpu": { "type": "string" },
      "memory": { "type": "string" }
    }
  }
}

// Array
{
  "tags": {
    "type": "array",
    "items": { "type": "string" },
    "minItems": 1
  }
}

// Reference to another entity
{
  "virtualTarget": {
    "type": "reference",
    "ref": "VirtualTarget",
    "description": "Referenced virtual target"
  }
}
```

### Adding Examples

Examples help classification accuracy:

```json
{
  "examples": [
    "Deploy Argo workflow to production cluster",
    "kubectl apply -f workflow.yaml",
    "Kubernetes cluster with 50 nodes in us-west-2",
    "Scale cluster to handle increased traffic"
  ]
}
```

**Best Practices**:

- Add 3-5 realistic examples per entity
- Use actual terminology from your domain
- Include common variations and phrasings

## Classification

### How Classification Works

The system uses a **5-layer hybrid approach**:

```text
┌─────────────────────────────────────────────────────┐
│                 Classification Pipeline              │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Layer 0: Team Context Filter                       │
│           ↓ (if neutral, <1ms)                      │
│  Layer 1: Entity Pattern Analyzer                   │
│           ↓ (file/artifact detection, <1ms)         │
│  Layer 2: Enhanced Keyword Matcher                  │
│           ↓ (multi-keyword required, <10ms)         │
│  Layer 3: Semantic Embedding Classifier              │
│           ↓ (vector similarity, ~50ms)              │
│  Layer 4: LLM Classification (if enabled)           │
│           ↓ (fallback, ~500ms)                      │
│                                                      │
│  Early Exit: Return immediately if confidence ≥0.85  │
│                                                      │
└─────────────────────────────────────────────────────┘
```

**Performance**: 90% of classifications complete in <100ms using Layers 0-2.

### Heuristic Classification

Fast, no-cost classification using patterns and keywords:

```typescript
const result = await classifier.classify(knowledge, {
  enableHeuristics: true,
  enableLLM: false,
  minConfidence: 0.7,
});
```

**When to Use**:

- Production environments (fast, cost-effective)
- Well-defined domains with clear terminology
- Real-time classification requirements

**Limitations**:

- Requires good examples in ontology
- May miss subtle or ambiguous cases
- Works best with technical terminology

### LLM Classification

High-accuracy classification using language models:

```typescript
const result = await classifier.classify(knowledge, {
  enableHeuristics: false,
  enableLLM: true,
  minConfidence: 0.7,
});
```

**When to Use**:

- Complex or ambiguous knowledge
- Natural language descriptions
- When heuristic confidence is low

**Considerations**:

- Slower (~500ms per classification)
- Costs money (API calls)
- Requires LLM provider configuration

### Hybrid Classification (Recommended)

Try heuristics first, fall back to LLM if needed:

```typescript
const result = await classifier.classify(knowledge, {
  enableHeuristics: true,
  enableLLM: true,
  heuristicThreshold: 0.8, // LLM fallback if heuristic <0.8
  minConfidence: 0.7,
});
```

**Advantages**:

- Best of both worlds: speed + accuracy
- Cost-effective (most classifications use heuristics)
- High confidence results

### Batch Classification

Process multiple items efficiently:

```typescript
const items = [
  { id: 'k1', content: 'Deploy to Kubernetes' },
  { id: 'k2', content: 'Virtual ECU configuration' },
  { id: 'k3', content: 'Argo workflow template' },
];

const results = await classifier.classifyBatch(items, {
  enableLLM: true,
  batchSize: 10, // Process 10 items per LLM call
});
```

**Benefits**:

- 5-10x faster than individual classification
- Reduces LLM API calls
- Better for bulk processing

### Team Scoping

Classify within specific team context:

```typescript
// RaaS team - searches RaaS + upper ontologies
const raasResult = await classifier.classify(knowledge, {
  team: 'RaaS',
});

// ReSi team - searches ReSi + upper ontologies
const resiResult = await classifier.classify(knowledge, {
  team: 'ReSi',
});

// Mixed team - searches all ontologies
const mixedResult = await classifier.classify(knowledge, {
  team: 'mixed',
});
```

### Confidence Thresholds

Control classification quality:

```typescript
// Strict threshold (0.9) - only very confident results
const strictResult = await classifier.classify(knowledge, {
  minConfidence: 0.9,
});

// Lenient threshold (0.5) - accept more results
const lenientResult = await classifier.classify(knowledge, {
  minConfidence: 0.5,
});

// Default (0.7) - balanced
const defaultResult = await classifier.classify(knowledge, {
  minConfidence: 0.7,
});
```

**Guidelines**:

- **0.9+**: Production-critical data
- **0.7-0.8**: General use (recommended)
- **0.5-0.6**: Exploratory analysis
- **<0.5**: Not recommended

## Validation

### Strict vs Lenient Mode

**Strict Mode** - Enforces all rules:

```typescript
const result = validator.validate('KubernetesCluster', {
  clusterName: 'prod-cluster',
  region: 'us-west-2',
  nodeCount: 50,
  extraField: 'not allowed', // ERROR in strict mode
}, {
  mode: 'strict',
  team: 'RaaS',
});

// => { valid: false, errors: [{ path: 'extraField', message: 'Unknown property' }] }
```

**Lenient Mode** - Allows extra properties:

```typescript
const result = validator.validate('KubernetesCluster', {
  clusterName: 'prod-cluster',
  region: 'us-west-2',
  nodeCount: 50,
  extraField: 'allowed', // OK in lenient mode
}, {
  mode: 'lenient',
  team: 'RaaS',
});

// => { valid: true, errors: [] }
```

**When to Use**:

- **Strict**: Production data, API inputs, critical workflows
- **Lenient**: Development, exploratory data, external integrations

### Validation Rules

The validator checks:

1. **Required Properties**: All required fields present
2. **Type Checking**: Values match property types
3. **Enums**: Values in allowed list
4. **Patterns**: String values match regex
5. **Ranges**: Numbers within min/max bounds
6. **Nested Objects**: Recursive validation
7. **Array Items**: Each item validated

### Error Handling

```typescript
const result = validator.validate('KubernetesCluster', data, {
  mode: 'lenient',
  failFast: false, // Collect all errors
});

if (!result.valid) {
  result.errors.forEach(error => {
    console.log(`Path: ${error.path}`);
    console.log(`Message: ${error.message}`);
    console.log(`Value: ${error.value}`);
  });
}

// Example errors:
// Path: nodeCount
// Message: Value must be between 1 and 1000
// Value: 5000

// Path: region
// Message: Value must be one of: us-east-1, us-west-2, eu-central-1
// Value: invalid-region
```

### Nested Property Validation

```typescript
const data = {
  clusterName: 'prod',
  resourceRequirements: {
    cpu: '32 cores',
    memory: '128 GB',
    storage: '1 TB',
  },
  podSpecs: [
    { name: 'frontend', replicas: 3 },
    { name: 'backend', replicas: 5 },
  ],
};

const result = validator.validate('KubernetesCluster', data, {
  mode: 'strict',
});

// Error paths include full nesting:
// - resourceRequirements.cpu
// - podSpecs[0].name
// - podSpecs[1].replicas
```

## Querying

### Query by Entity Class

Find all knowledge of a specific entity class:

```typescript
const results = await queryEngine.findByEntityClass('KubernetesCluster', 'RaaS', {
  limit: 10,
  offset: 0,
  sortBy: 'timestamp',
  sortOrder: 'desc',
});

console.log(results);
// => {
//      results: [{ id: 'k1', content: '...', ontology: {...} }, ...],
//      total: 25,
//      hasMore: true,
//      offset: 0,
//      limit: 10
//    }
```

### Query by Property

Filter by specific property values:

```typescript
// Simple property
const results = await queryEngine.findByProperty(
  'KubernetesCluster',
  'region',
  'us-west-2'
);

// Nested property (dot notation)
const results = await queryEngine.findByProperty(
  'KubernetesCluster',
  'resourceRequirements.cpu',
  '32 cores'
);

// Array index
const results = await queryEngine.findByProperty(
  'KubernetesCluster',
  'podSpecs[0].name',
  'frontend'
);
```

### Aggregation

Count knowledge items by entity class:

```typescript
const counts = await queryEngine.aggregateByEntityClass('RaaS');

console.log(counts);
// => {
//      KubernetesCluster: 15,
//      ArgoWorkflowTemplate: 8,
//      PrometheusMetric: 23,
//      GrafanaDashboard: 5
//    }
```

### Complex Queries

Combine multiple filters:

```typescript
const results = await queryEngine.query({
  entityClass: 'KubernetesCluster',
  team: 'RaaS',
  properties: {
    'region': 'us-west-2',
    'nodeCount': { $gte: 10, $lte: 50 },
    'ontology.confidence': { $gte: 0.9 },
  },
}, {
  sortBy: 'timestamp',
  sortOrder: 'desc',
  limit: 20,
});
```

### Relationship Queries

Follow ontology relationships:

```typescript
// Find all workflows deploying to a cluster
const related = await queryEngine.findRelated('cluster-123', 'deploys_to');

console.log(related);
// => [
//      { id: 'workflow-1', relationship: 'deploys_to', ... },
//      { id: 'workflow-2', relationship: 'deploys_to', ... }
//    ]
```

### Pagination

Handle large result sets:

```typescript
let offset = 0;
const limit = 50;
let hasMore = true;

while (hasMore) {
  const results = await queryEngine.findByEntityClass(
    'KubernetesCluster',
    'RaaS',
    { limit, offset }
  );

  // Process results
  processResults(results.results);

  hasMore = results.hasMore;
  offset += limit;
}
```

## Common Use Cases

### Use Case 1: Knowledge Extraction Pipeline

```typescript
// 1. Extract knowledge from conversation
const knowledge = {
  id: 'k-' + Date.now(),
  content: 'Deploy Argo workflow to production Kubernetes cluster',
  source: 'conversation',
  timestamp: new Date().toISOString(),
};

// 2. Classify knowledge
const classification = await classifier.classify(knowledge.content, {
  team: 'RaaS',
  enableHeuristics: true,
  enableLLM: true,
  minConfidence: 0.7,
});

if (classification) {
  knowledge.ontology = {
    entityClass: classification.entityClass,
    team: classification.team,
    confidence: classification.confidence,
  };

  // 3. Validate against schema
  const validation = validator.validate(
    classification.entityClass,
    knowledge,
    { mode: 'lenient', team: 'RaaS' }
  );

  if (!validation.valid) {
    console.warn('Validation warnings:', validation.errors);
  }

  // 4. Store with ontology metadata
  await graphDb.storeKnowledge(knowledge);
}
```

### Use Case 2: Team-Specific Knowledge Retrieval

```typescript
// Retrieve RaaS team knowledge
const raasKnowledge = await queryEngine.query({
  team: 'RaaS',
  properties: {
    'ontology.confidence': { $gte: 0.8 },
  },
}, {
  sortBy: 'timestamp',
  sortOrder: 'desc',
  limit: 100,
});

// Retrieve ReSi team knowledge
const resiKnowledge = await queryEngine.query({
  team: 'ReSi',
  properties: {
    'ontology.confidence': { $gte: 0.8 },
  },
}, {
  sortBy: 'timestamp',
  sortOrder: 'desc',
  limit: 100,
});
```

### Use Case 3: Quality Monitoring

```typescript
// Monitor classification quality
const allKnowledge = await queryEngine.findByEntityClass('*');

const qualityMetrics = {
  total: allKnowledge.total,
  highConfidence: 0,
  mediumConfidence: 0,
  lowConfidence: 0,
  byTeam: {},
};

allKnowledge.results.forEach(k => {
  const confidence = k.ontology?.confidence || 0;

  if (confidence >= 0.9) qualityMetrics.highConfidence++;
  else if (confidence >= 0.7) qualityMetrics.mediumConfidence++;
  else qualityMetrics.lowConfidence++;

  const team = k.ontology?.team || 'unknown';
  qualityMetrics.byTeam[team] = (qualityMetrics.byTeam[team] || 0) + 1;
});

console.log('Quality Metrics:', qualityMetrics);
```

### Use Case 4: Bulk Reclassification

```typescript
// Reclassify all knowledge after ontology update
const allKnowledge = await queryEngine.findByEntityClass('*');

const reclassified = await classifier.classifyBatch(
  allKnowledge.results.map(k => ({
    id: k.id,
    content: k.content,
  })),
  {
    enableHeuristics: true,
    enableLLM: false,
    batchSize: 50,
  }
);

// Update stored knowledge with new classifications
for (const result of reclassified) {
  if (result.entityClass) {
    await graphDb.updateKnowledge(result.id, {
      ontology: {
        entityClass: result.entityClass,
        confidence: result.confidence,
        reclassifiedAt: new Date().toISOString(),
      },
    });
  }
}
```

## Troubleshooting

### Classification Returns Null

**Symptoms**: classifier.classify() returns null

**Causes**:

1. No matching entity found in ontology
2. Confidence below threshold
3. Heuristics disabled and LLM not configured

**Solutions**:

```typescript
// 1. Lower confidence threshold
const result = await classifier.classify(knowledge, {
  minConfidence: 0.5, // Lower from 0.7
});

// 2. Enable LLM fallback
const result = await classifier.classify(knowledge, {
  enableLLM: true,
});

// 3. Check classification details
console.log('Classification method:', result?.method);
console.log('Confidence:', result?.confidence);
console.log('Evidence:', result?.evidence);
```

### Validation Always Fails

**Symptoms**: validate() always returns valid: false

**Causes**:

1. Strict mode rejecting extra properties
2. Missing required properties
3. Type mismatches

**Solutions**:

```typescript
// 1. Use lenient mode during debugging
const result = validator.validate(entityClass, data, {
  mode: 'lenient',
  failFast: false,
});

// 2. Check all errors
console.log('Validation errors:', result.errors);
result.errors.forEach(error => {
  console.log(`- ${error.path}: ${error.message}`);
});

// 3. Verify entity class exists
const entity = ontologyManager.resolveEntityDefinition(entityClass, team);
console.log('Entity definition:', entity);
```

### Queries Return Empty Results

**Symptoms**: Query returns results: []

**Causes**:

1. Entity class name mismatch
2. Team filter excluding results
3. No knowledge with ontology metadata
4. Confidence threshold too high

**Solutions**:

```typescript
// 1. List all available entity classes
const entityClasses = ontologyManager.getAllEntityClasses('RaaS');
console.log('Available classes:', entityClasses);

// 2. Query without team filter
const results = await queryEngine.findByEntityClass('KubernetesCluster');

// 3. Check for ontology metadata
const allKnowledge = await graphDb.getAllNodes();
const withOntology = allKnowledge.filter(k => k.ontology);
console.log(`${withOntology.length}/${allKnowledge.length} have ontology`);

// 4. Query with low confidence
const results = await queryEngine.query({
  entityClass: 'KubernetesCluster',
  properties: {
    'ontology.confidence': { $gte: 0.1 }, // Very low threshold
  },
});
```

### Performance Issues

**Symptoms**: Classification or queries are slow

**Causes**:

1. LLM enabled for all classifications
2. Caching disabled
3. Large batch sizes
4. Complex queries on large datasets

**Solutions**:

```typescript
// 1. Enable heuristics, use LLM sparingly
const config = {
  classification: {
    enableHeuristics: true,
    enableLLM: false, // Only enable when needed
    heuristicThreshold: 0.8,
  },
};

// 2. Enable caching
const config = {
  caching: {
    enabled: true,
    ttl: 3600000, // 1 hour
    maxSize: 1000,
  },
};

// 3. Use appropriate batch sizes
const results = await classifier.classifyBatch(items, {
  batchSize: 10, // Not too large
});

// 4. Add indices to graph database
await graphDb.createIndex('ontology.entityClass');
await graphDb.createIndex('ontology.team');
```

## Best Practices

### 1. Start with Heuristics

Begin with heuristic classification:

```typescript
// Good: Fast and cost-effective
const result = await classifier.classify(knowledge, {
  enableHeuristics: true,
  enableLLM: false,
});

// Only use LLM if heuristics fail
if (!result || result.confidence < 0.8) {
  const llmResult = await classifier.classify(knowledge, {
    enableHeuristics: false,
    enableLLM: true,
  });
}
```

### 2. Use Lenient Validation for Development

```typescript
// Development: Lenient validation
const devConfig = {
  validation: {
    mode: 'lenient',
    enabled: true,
  },
};

// Production: Strict validation
const prodConfig = {
  validation: {
    mode: 'strict',
    enabled: true,
  },
};
```

### 3. Add Rich Examples to Ontologies

```json
{
  "examples": [
    "Deploy Argo workflow to Kubernetes production cluster",
    "kubectl apply -f deployment.yaml to prod-cluster",
    "Scale Kubernetes cluster to 50 nodes",
    "Production K8s cluster in us-west-2 with 32 nodes"
  ]
}
```

### 4. Monitor Classification Quality

```typescript
// Track classification metrics
const metrics = {
  total: 0,
  heuristic: 0,
  llm: 0,
  avgConfidence: 0,
};

// After each classification
if (result) {
  metrics.total++;
  metrics[result.method]++;
  metrics.avgConfidence += result.confidence;
}

// Periodically report
console.log('Classification Metrics:', {
  ...metrics,
  avgConfidence: metrics.avgConfidence / metrics.total,
});
```

### 5. Use Team Scoping

```typescript
// Specify team when known
const result = await classifier.classify(knowledge, {
  team: 'RaaS', // Faster, more accurate
});

// Only use 'mixed' when team unknown
const result = await classifier.classify(knowledge, {
  team: 'mixed', // Slower, searches all teams
});
```

### 6. Batch Process When Possible

```typescript
// Bad: Individual classification
for (const item of items) {
  await classifier.classify(item.content);
}

// Good: Batch classification
await classifier.classifyBatch(items, {
  batchSize: 10,
});
```

### 7. Handle Errors Gracefully

```typescript
try {
  const result = await classifier.classify(knowledge);

  if (!result) {
    // No classification found
    console.warn('Could not classify knowledge:', knowledge.id);
    // Store without ontology metadata
    await graphDb.storeKnowledge(knowledge);
  } else {
    // Store with ontology
    knowledge.ontology = result;
    await graphDb.storeKnowledge(knowledge);
  }
} catch (error) {
  console.error('Classification error:', error);
  // Store anyway, classify later
  await graphDb.storeKnowledge(knowledge);
}
```

### 8. Version Your Ontologies

```json
{
  "name": "RaaS Ontology",
  "version": "2.1.0", // Semantic versioning
  "changelog": [
    "2.1.0: Added KubernetesCluster.nodeLabels property",
    "2.0.0: Breaking - renamed nodeSize to nodeType",
    "1.0.0: Initial version"
  ]
}
```

## Additional Resources

- [API Documentation](./api/index.html) - Complete API reference
- [Requirements](../.spec-workflow/specs/ontology-integration/requirements.md) - System requirements
- [Design Document](../.spec-workflow/specs/ontology-integration/design.md) - Architecture details
- [Migration Guide](./ontology-migration-guide.md) - Deployment guide
- [Test Examples](../test/ontology/) - Working code examples

## Support

For questions or issues:

- Review this guide and troubleshooting section
- Check API documentation for method signatures
- Examine test files for usage examples
- Open an issue on GitHub with:
  - Ontology configuration
  - Sample knowledge content
  - Expected vs actual results
  - Error messages and stack traces
