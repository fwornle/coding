# Ontology Integration System API

Welcome to the API documentation for the Ontology Integration System. This system provides ontology-based knowledge management with classification, validation, and querying capabilities.

## Overview

The Ontology Integration System enables:

- **Hierarchical Ontologies**: Upper (domain-level) and lower (team-specific) ontologies with inheritance
- **Hybrid Classification**: Fast heuristic classification with LLM fallback
- **Schema Validation**: Strict and lenient validation modes with detailed error reporting
- **Powerful Querying**: Entity class, property filtering, aggregations, and relationship traversal
- **High Performance**: Caching, batch processing, and optimized query execution

## Quick Start

```typescript
import { createOntologySystem } from './ontology';

// Create ontology system
const system = await createOntologySystem({
  enabled: true,
  upperOntologyPath: '.data/ontologies/upper/cluster-reprocessing-ontology.json',
  team: 'RaaS',
  lowerOntologyPath: '.data/ontologies/lower/raas-ontology.json',
  validation: { mode: 'strict' },
  classification: { enableLLM: true, enableHeuristics: true },
  caching: { enabled: true },
});

// Classify knowledge
const result = await system.classifier.classify('Kubernetes cluster configuration', {
  team: 'RaaS',
  minConfidence: 0.7,
});
// => { entityClass: 'KubernetesCluster', confidence: 0.85, ontology: 'RaaS', method: 'hybrid' }

// Validate against schema
const validation = system.validator.validate('KubernetesCluster', {
  clusterName: 'prod-cluster',
  region: 'us-west-2',
  nodeCount: 50,
}, { mode: 'strict', team: 'RaaS' });
// => { valid: true, errors: [] }

// Query by entity class
const clusters = await system.queryEngine.findByEntityClass('KubernetesCluster', 'RaaS');
// => { results: [...], hasMore: false, total: 5 }
```

## Core Components

### OntologyManager

Central manager for loading and resolving ontologies with inheritance and caching.

**Key Methods:**

- `initialize()` - Load upper and lower ontologies
- `resolveEntityDefinition(entityClass, team?)` - Get merged entity definition
- `getAllEntityClasses(team?)` - List available entity classes
- `reloadOntologies()` - Hot-reload ontology files

### OntologyClassifier

Hybrid heuristic + LLM classification with confidence scoring and team scoping.

**Key Methods:**

- `classify(knowledge, options)` - Classify single knowledge item
- `classifyBatch(knowledgeBatch, options)` - Batch classification for efficiency

### OntologyValidator

Schema validation with strict/lenient modes and detailed error reporting.

**Key Methods:**

- `validate(entityClass, data, options)` - Validate data against entity schema
- `validateProperty(value, propertyDef)` - Validate single property

### OntologyQueryEngine

Powerful ontology-based knowledge retrieval with filtering, aggregation, and relationships.

**Key Methods:**

- `findByEntityClass(entityClass, team?, options?)` - Query by entity class
- `findByProperty(entityClass, propertyPath, value)` - Filter by property values
- `aggregateByEntityClass(team?)` - Count by entity class
- `findRelated(knowledgeId, relationshipType?)` - Follow relationships

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                   Ontology Integration System                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │  Ontology    │    │  Ontology    │    │  Ontology    │       │
│  │   Manager    │───▶│  Validator   │    │  Classifier  │       │
│  │              │    │              │    │              │       │
│  │ • Load       │    │ • Strict     │    │ • Heuristic  │       │
│  │ • Resolve    │    │ • Lenient    │    │ • LLM        │       │
│  │ • Cache      │    │ • Errors     │    │ • Hybrid     │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│         │                                         │             │
│         └─────────────────┬───────────────────────┘             │
│                           │                                     │
│                  ┌────────▼─────────┐                           │
│                  │  Ontology Query  │                           │
│                  │     Engine       │                           │
│                  │                  │                           │
│                  │ • Entity Class   │                           │
│                  │ • Properties     │                           │
│                  │ • Aggregations   │                           │
│                  │ • Relationships  │                           │
│                  └──────────────────┘                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Configuration

```typescript
interface OntologyConfig {
  enabled: boolean;
  upperOntologyPath: string;
  lowerOntologyPath?: string;
  team?: string;
  confidenceThreshold?: number; // Default: 0.7
  validation?: {
    enabled: boolean;
    mode: 'strict' | 'lenient'; // Default: 'lenient'
  };
  caching?: {
    enabled: boolean;
    ttl?: number; // Default: 3600000 (1 hour)
    maxSize?: number; // Default: 1000
  };
  classification?: {
    enableHeuristics: boolean; // Default: true
    enableLLM: boolean; // Default: false
    batchSize?: number; // Default: 10
    heuristicThreshold?: number; // Default: 0.8
  };
}
```

## Performance

The system is designed for high performance:

- **Ontology Loading**: Cached loads 6-10x faster than cold loads
- **Classification**: p95 latency <500ms, heuristic classification >10,000/sec
- **Queries**: Simple queries p95 <100ms, complex queries p95 <500ms
- **Memory**: <1MB overhead for cached ontologies

## Examples

### Classification with Team Scoping

```typescript
// RaaS team classification
const raasResult = await classifier.classify('Argo workflow template', {
  team: 'RaaS',
  enableHeuristics: true,
  enableLLM: false,
  minConfidence: 0.7
});
// => { entityClass: 'ArgoWorkflowTemplate', team: 'RaaS', confidence: 0.85 }

// ReSi team classification
const resiResult = await classifier.classify('Virtual target ECU configuration', {
  team: 'ReSi',
  enableHeuristics: true,
  minConfidence: 0.7
});
// => { entityClass: 'VirtualTarget', team: 'ReSi', confidence: 0.90 }
```

### Validation with Different Modes

```typescript
const data = {
  clusterName: 'prod-cluster',
  region: 'us-west-2',
  nodeCount: 50,
  extraField: 'not in schema'
};

// Strict mode - fails on unknown properties
const strictResult = validator.validate('KubernetesCluster', data, {
  mode: 'strict',
  team: 'RaaS'
});
// => { valid: false, errors: [{ path: 'extraField', message: 'Unknown property' }] }

// Lenient mode - allows unknown properties
const lenientResult = validator.validate('KubernetesCluster', data, {
  mode: 'lenient',
  team: 'RaaS'
});
// => { valid: true, errors: [] }
```

### Complex Queries

```typescript
// Query with multiple filters
const results = await queryEngine.query({
  entityClass: 'RPU',
  team: 'ReSi',
  properties: {
    'ontology.confidence': 0.9,
    'ontology.properties.virtualTarget': 'ECU-1'
  }
}, {
  sortBy: 'timestamp',
  sortOrder: 'desc',
  limit: 10,
  offset: 0
});

// Aggregation by entity class
const counts = await queryEngine.aggregateByEntityClass('RaaS');
// => { KubernetesCluster: 15, ArgoWorkflowTemplate: 8, PrometheusMetric: 23 }

// Follow relationships
const related = await queryEngine.findRelated('k123', 'references');
// => [{ id: 'k456', relationship: 'references', ... }]
```

## Error Handling

```typescript
try {
  await ontologyManager.initialize();
} catch (error) {
  if (error instanceof OntologyLoadError) {
    console.error('Failed to load ontology:', error.message);
    console.error('File:', error.filePath);
    console.error('Details:', error.details);
  }
}

try {
  const resolved = ontologyManager.resolveEntityDefinition('InvalidEntity', 'RaaS');
} catch (error) {
  if (error instanceof EntityResolutionError) {
    console.error('Entity not found:', error.entityClass);
    console.error('Team:', error.team);
  }
}
```

## Best Practices

### 1. Use Heuristic Classification First

Heuristic classification is 100x faster than LLM classification. Enable it by default and only fall back to LLM when needed:

```typescript
const result = await classifier.classify(knowledge, {
  enableHeuristics: true,
  enableLLM: false, // Only enable when heuristics fail
  minConfidence: 0.7
});
```

### 2. Batch Classification for Efficiency

When processing multiple items, use batch classification to reduce LLM calls:

```typescript
const results = await classifier.classifyBatch(knowledgeItems, {
  enableLLM: true,
  batchSize: 10 // Process 10 items per LLM call
});
```

### 3. Choose Validation Mode Appropriately

- Use **strict mode** for production data where schema compliance is critical
- Use **lenient mode** during development or for exploratory data

```typescript
// Production: strict validation
const productionResult = validator.validate(entityClass, data, {
  mode: 'strict',
  failFast: true // Stop on first error
});

// Development: lenient validation
const devResult = validator.validate(entityClass, data, {
  mode: 'lenient',
  failFast: false // Collect all errors
});
```

### 4. Leverage Caching

Enable ontology caching for better performance:

```typescript
const config = {
  caching: {
    enabled: true,
    ttl: 3600000, // 1 hour
    maxSize: 1000 // Max 1000 entries
  }
};
```

### 5. Use Team Scoping

Specify team when possible to reduce search space and improve accuracy:

```typescript
// Without team - searches all ontologies
const result1 = await classifier.classify(knowledge);

// With team - only searches RaaS + upper ontologies
const result2 = await classifier.classify(knowledge, { team: 'RaaS' });
```

## Troubleshooting

### Classification Returns Low Confidence

**Problem**: Classification confidence is below threshold

**Solutions**:

1. Add more examples to ontology entity definitions
2. Enhance heuristic patterns for better keyword matching
3. Lower confidence threshold (if appropriate)
4. Enable LLM fallback for ambiguous cases

### Validation Fails in Strict Mode

**Problem**: Validation rejects data in strict mode

**Solutions**:

1. Check validation errors for specific property issues
2. Use lenient mode during development
3. Update ontology schema to allow additional properties
4. Remove extra properties from data before validation

### Queries Return No Results

**Problem**: findByEntityClass returns empty results

**Solutions**:

1. Verify entity class name matches ontology definition
2. Check team filter includes correct team (remember "mixed" items)
3. Verify knowledge has ontology metadata stored
4. Check confidence threshold in query options

## Additional Resources

- [User Guide](../ontology-integration-guide.md) - Comprehensive usage guide
- [Requirements](../../.spec-workflow/specs/ontology-integration/requirements.md) - System requirements
- [Design Document](../../.spec-workflow/specs/ontology-integration/design.md) - Architecture and design
- [Migration Guide](../ontology-migration-guide.md) - Deployment guide

## Support

For issues or questions:

- Open an issue on GitHub
- Check the troubleshooting section above
- Review test files for usage examples
