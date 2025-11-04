# Design Document: Ontology Integration for Knowledge Management

**Status**: Draft
**Created**: 2025-11-03
**Related Requirements**: `.spec-workflow/requirements/ontology-integration.md`

---

## 1. Executive Summary

This design document describes the architecture for integrating a configurable ontology system into the existing knowledge management infrastructure. The system will support upper (domain-level) and lower (team-specific) ontologies across multiple domains, with flexible validation and optional team-scoped classification.

The system supports five teams with distinct domain ontologies:
- **RaaS**: Cloud orchestration for vehicle data reprocessing
- **ReSi**: Virtual target development for embedded ADAS functions
- **Coding**: Knowledge management infrastructure (LSL, constraints, trajectory, MCP)
- **Agentic**: AI agent frameworks, RAG systems, and communication protocols
- **UI**: Multi-agent curriculum alignment system with AWS serverless architecture

### Key Design Principles

1. **Non-Breaking Integration**: Work seamlessly with existing StreamingKnowledgeExtractor
2. **Optional Enhancement**: Ontology classification is opt-in, doesn't affect existing functionality
3. **Flexible Validation**: Teams can choose strict or lenient validation
4. **Inheritance Model**: Lower ontologies extend upper ontology entities
5. **LLM-Powered Classification**: Use UnifiedInferenceEngine with heuristic fallback
6. **Agent-Agnostic Storage**: Store ontology metadata in existing graph database

---

## 2. System Architecture

### 2.1 Component Overview

![Ontology System Architecture](../../../docs/presentation/images/ontology-system-architecture.png)

*Figure 1: Component architecture showing the integration of the Ontology System with existing Knowledge Management infrastructure*

### 2.2 Component Responsibilities

#### OntologyManager
**Purpose**: Central management of ontology lifecycle and resolution

**Responsibilities**:
- Load and parse ontology files (upper and lower)
- Resolve entity inheritance (lower extends upper)
- Cache parsed ontologies for performance
- Provide entity definitions to other components
- Handle ontology reloading on file changes

**Key Methods**:
```typescript
class OntologyManager {
  async loadOntology(path: string): Promise<Ontology>
  async resolveEntity(entityClass: string, team?: string): Promise<EntityDefinition>
  async getUpperOntology(): Promise<Ontology>
  async getLowerOntology(team: string): Promise<Ontology>
  async getAllEntityClasses(team?: string): Promise<string[]>
  async reloadOntologies(): Promise<void>
}
```

#### OntologyValidator
**Purpose**: Validate knowledge extractions against ontology schemas

**Responsibilities**:
- Validate entity structure (required properties, types)
- Check property value constraints
- Validate relationships between entities
- Support strict/lenient validation modes
- Generate detailed validation errors

**Key Methods**:
```typescript
class OntologyValidator {
  validate(
    knowledge: Knowledge,
    entityClass: string,
    options: ValidationOptions
  ): ValidationResult

  validateProperty(
    value: any,
    propertyDef: PropertyDefinition
  ): PropertyValidationResult

  validateRelationship(
    relationship: Relationship,
    ontology: Ontology
  ): ValidationResult
}

interface ValidationOptions {
  strict: boolean;
  team?: string;
  allowUnknownProperties?: boolean;
}
```

#### OntologyClassifier
**Purpose**: Classify knowledge extractions using LLM and ontology context

**Responsibilities**:
- Build classification prompt with ontology context
- Call UnifiedInferenceEngine for classification
- Apply heuristic fallback for known patterns
- Handle mixed/flexible team scope
- Return confidence scores

**Key Methods**:
```typescript
class OntologyClassifier {
  async classify(
    knowledge: Knowledge,
    options: ClassificationOptions
  ): Promise<OntologyClassification>

  async classifyBatch(
    knowledgeBatch: Knowledge[]
  ): Promise<OntologyClassification[]>

  private buildClassificationPrompt(
    knowledge: Knowledge,
    entityClasses: string[]
  ): string

  private applyHeuristicFallback(
    knowledge: Knowledge
  ): OntologyClassification | null
}

interface ClassificationOptions {
  team?: string; // 'ReSi' | 'RaaS' | 'mixed'
  confidenceThreshold?: number;
  useHeuristicFallback?: boolean;
}
```

#### OntologyQueryEngine
**Purpose**: Enhanced knowledge retrieval with ontology-based filtering

**Responsibilities**:
- Query knowledge by ontology entity class
- Filter by ontology properties
- Support inheritance-aware queries
- Integrate with existing vector/graph search
- Provide aggregations by entity type

**Key Methods**:
```typescript
class OntologyQueryEngine {
  async findByEntityClass(
    entityClass: string,
    team?: string
  ): Promise<Knowledge[]>

  async findByProperty(
    entityClass: string,
    propertyPath: string,
    value: any
  ): Promise<Knowledge[]>

  async aggregateByEntityClass(
    team?: string
  ): Promise<Map<string, number>>

  async findRelated(
    knowledgeId: string,
    relationshipType?: string
  ): Promise<Knowledge[]>
}
```

---

## 3. Data Model Design

### 3.1 Ontology File Schema

```typescript
interface Ontology {
  name: string;
  version: string;
  type: 'upper' | 'lower';
  team?: string; // For lower ontologies
  extendsOntology?: string; // Path to upper ontology

  entities: Record<string, EntityDefinition>;
  relationships: Record<string, RelationshipDefinition>;

  metadata: {
    description: string;
    domain: string;
    createdAt: string;
    updatedAt: string;
  };
}

interface EntityDefinition {
  description: string;
  extendsEntity?: string; // For lower ontology entities
  properties: Record<string, PropertyDefinition>;
  requiredProperties?: string[];
  examples?: any[];
}

interface PropertyDefinition {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'reference';
  description: string;
  required?: boolean;

  // For arrays
  items?: PropertyDefinition;

  // For references
  refersTo?: string; // Entity class name

  // For enums
  enum?: string[];

  // For validation
  pattern?: string;
  min?: number;
  max?: number;
}

interface RelationshipDefinition {
  from: string; // Entity class
  to: string; // Entity class
  type: string; // Relationship type
  description: string;
  cardinality: '1:1' | '1:N' | 'N:M';
}
```

### 3.2 Knowledge Storage Model

**Existing Knowledge Schema** (unchanged):
```typescript
interface Knowledge {
  id: string;
  type: KnowledgeType;
  content: string;
  context: {
    file?: string;
    symbols?: string[];
    tags?: string[];
  };
  timestamp: string;
  source: string;

  // NEW: Ontology metadata (optional)
  ontology?: OntologyMetadata;
}
```

**New Ontology Metadata**:
```typescript
interface OntologyMetadata {
  entityClass: string;
  team?: string; // 'ReSi' | 'RaaS' | 'mixed'
  properties: Record<string, any>;
  relationships: OntologyRelationship[];

  classification: {
    confidence: number;
    method: 'llm' | 'heuristic' | 'manual';
    modelUsed?: string;
    timestamp: string;
  };

  validation?: {
    validated: boolean;
    strict: boolean;
    errors?: ValidationError[];
  };
}

interface OntologyRelationship {
  type: string;
  targetId: string;
  targetEntityClass: string;
  metadata?: Record<string, any>;
}

interface ValidationError {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}
```

### 3.3 File Structure

```
.data/ontologies/
├── upper/
│   └── cluster-reprocessing-ontology.json
├── lower/
│   ├── raas-ontology.json
│   ├── resi-ontology.json
│   ├── coding-ontology.json
│   ├── agentic-ontology.json
│   └── ui-ontology.json
└── schemas/
    ├── ontology-schema.json
    └── validation-rules.json

src/ontology/
├── OntologyManager.ts
├── OntologyValidator.ts
├── OntologyClassifier.ts
├── OntologyQueryEngine.ts
├── types.ts
└── heuristics/
    ├── raas-heuristics.ts
    ├── resi-heuristics.ts
    ├── coding-heuristics.ts
    ├── agentic-heuristics.ts
    └── ui-heuristics.ts
```

---

## 4. Integration Design

### 4.1 StreamingKnowledgeExtractor Integration

**Modification Points** in `src/knowledge-management/StreamingKnowledgeExtractor.js`:

```typescript
class StreamingKnowledgeExtractor {
  private ontologyManager?: OntologyManager;
  private ontologyClassifier?: OntologyClassifier;
  private ontologyValidator?: OntologyValidator;

  constructor(config: KnowledgeConfig) {
    // Existing initialization

    // NEW: Initialize ontology system if configured
    if (config.ontology?.enabled) {
      this.ontologyManager = new OntologyManager(config.ontology);
      this.ontologyClassifier = new OntologyClassifier(
        this.ontologyManager,
        this.inferenceEngine
      );
      if (config.ontology.validation?.enabled) {
        this.ontologyValidator = new OntologyValidator(this.ontologyManager);
      }
    }
  }

  async processExchange(exchange: Exchange): Promise<void> {
    // Existing extraction logic (unchanged)
    const knowledge = await this.extractKnowledge(exchange);

    // NEW: Classify with ontology if enabled
    if (this.ontologyClassifier) {
      const classification = await this.ontologyClassifier.classify(
        knowledge,
        {
          team: this.config.ontology?.team,
          confidenceThreshold: this.config.ontology?.confidenceThreshold,
          useHeuristicFallback: true
        }
      );

      if (classification.confidence >= (this.config.ontology?.confidenceThreshold || 0.7)) {
        knowledge.ontology = {
          entityClass: classification.entityClass,
          team: classification.team,
          properties: classification.properties,
          relationships: [],
          classification: {
            confidence: classification.confidence,
            method: classification.method,
            modelUsed: classification.modelUsed,
            timestamp: new Date().toISOString()
          }
        };

        // Validate if configured
        if (this.ontologyValidator && this.config.ontology?.validation?.enabled) {
          const validationResult = this.ontologyValidator.validate(
            knowledge,
            classification.entityClass,
            {
              strict: this.config.ontology.validation.strict || false,
              team: this.config.ontology.team
            }
          );

          knowledge.ontology.validation = {
            validated: validationResult.valid,
            strict: this.config.ontology.validation.strict || false,
            errors: validationResult.errors
          };

          if (!validationResult.valid && this.config.ontology.validation.strict) {
            console.warn('Ontology validation failed (strict mode)', validationResult.errors);
            // Still store, but with validation errors
          }
        }
      }
    }

    // Existing storage logic (unchanged)
    await this.storeKnowledge(knowledge);
  }
}
```

**Configuration Extension**:

```typescript
interface KnowledgeConfig {
  // Existing config fields...

  ontology?: {
    enabled: boolean;

    // Ontology paths
    upperOntologyPath: string;
    lowerOntologyPath?: string;

    // Team scope
    team?: 'ReSi' | 'RaaS' | 'mixed';

    // Classification
    confidenceThreshold?: number; // Default: 0.7

    // Validation
    validation?: {
      enabled: boolean;
      strict: boolean; // Fail on validation errors?
    };
  };
}
```

### 4.2 GraphDatabaseService Integration

**Enhancement** in `src/knowledge-management/GraphDatabaseService.js`:

```typescript
class GraphDatabaseService {
  // Existing methods...

  // NEW: Ontology-aware indexing
  async storeKnowledge(knowledge: Knowledge): Promise<void> {
    // Existing storage logic
    await this.addNode(knowledge.id, {
      type: knowledge.type,
      content: knowledge.content,
      // ... existing fields
    });

    // NEW: Index ontology metadata if present
    if (knowledge.ontology) {
      // Add ontology node attributes
      await this.updateNodeAttributes(knowledge.id, {
        'ontology.entityClass': knowledge.ontology.entityClass,
        'ontology.team': knowledge.ontology.team,
        'ontology.confidence': knowledge.ontology.classification.confidence
      });

      // Create ontology relationships
      for (const rel of knowledge.ontology.relationships) {
        await this.addEdge(
          knowledge.id,
          rel.targetId,
          rel.type,
          {
            ontologyRelationship: true,
            entityClass: knowledge.ontology.entityClass,
            targetEntityClass: rel.targetEntityClass,
            ...rel.metadata
          }
        );
      }
    }
  }

  // NEW: Query by ontology entity class
  async queryByOntologyClass(
    entityClass: string,
    team?: string
  ): Promise<Knowledge[]> {
    const nodes = this.graph.nodes().filter(nodeId => {
      const attrs = this.graph.getNodeAttributes(nodeId);
      return attrs['ontology.entityClass'] === entityClass &&
             (!team || attrs['ontology.team'] === team || attrs['ontology.team'] === 'mixed');
    });

    return nodes.map(nodeId => this.graph.getNodeAttributes(nodeId) as Knowledge);
  }
}
```

### 4.3 KnowledgeRetriever Integration

**Enhancement** in `src/knowledge-management/KnowledgeRetriever.js`:

```typescript
class KnowledgeRetriever {
  private ontologyQueryEngine?: OntologyQueryEngine;

  constructor(config: KnowledgeConfig) {
    // Existing initialization

    // NEW: Initialize ontology query engine if configured
    if (config.ontology?.enabled) {
      this.ontologyQueryEngine = new OntologyQueryEngine(
        this.graphDb,
        this.vectorDb
      );
    }
  }

  // NEW: Ontology-based retrieval
  async retrieveByOntology(query: OntologyQuery): Promise<Knowledge[]> {
    if (!this.ontologyQueryEngine) {
      throw new Error('Ontology system not enabled');
    }

    return this.ontologyQueryEngine.findByEntityClass(
      query.entityClass,
      query.team
    );
  }

  // ENHANCED: Hybrid retrieval (semantic + ontology)
  async retrieve(query: RetrievalQuery): Promise<Knowledge[]> {
    // Existing semantic search
    let results = await this.semanticSearch(query.text, query.limit);

    // NEW: Filter by ontology if specified
    if (query.ontology && this.ontologyQueryEngine) {
      const ontologyResults = await this.ontologyQueryEngine.findByEntityClass(
        query.ontology.entityClass,
        query.ontology.team
      );

      // Intersect results
      const ontologyIds = new Set(ontologyResults.map(k => k.id));
      results = results.filter(k => ontologyIds.has(k.id));
    }

    return results;
  }
}

interface RetrievalQuery {
  text: string;
  limit?: number;
  ontology?: {
    entityClass: string;
    team?: string;
  };
}
```

---

## 5. API Design

### 5.1 OntologyManager API

```typescript
class OntologyManager {
  /**
   * Load ontology from file path
   * @param path - Absolute or relative path to ontology JSON file
   * @returns Parsed ontology object
   */
  async loadOntology(path: string): Promise<Ontology>;

  /**
   * Resolve entity definition with inheritance
   * @param entityClass - Entity class name
   * @param team - Optional team scope for lower ontology
   * @returns Merged entity definition (lower extends upper)
   */
  async resolveEntity(
    entityClass: string,
    team?: string
  ): Promise<EntityDefinition>;

  /**
   * Get all entity classes for a team
   * @param team - Team scope (includes upper + lower if team specified)
   * @returns Array of entity class names
   */
  async getAllEntityClasses(team?: string): Promise<string[]>;

  /**
   * Get relationship definitions
   * @param team - Optional team scope
   * @returns Map of relationship name to definition
   */
  async getRelationships(
    team?: string
  ): Promise<Record<string, RelationshipDefinition>>;

  /**
   * Reload ontologies from disk (for hot-reloading)
   */
  async reloadOntologies(): Promise<void>;

  /**
   * Validate ontology file structure
   * @param path - Path to ontology file
   * @returns Validation result with errors if any
   */
  async validateOntologyFile(path: string): Promise<ValidationResult>;
}
```

### 5.2 OntologyClassifier API

```typescript
class OntologyClassifier {
  /**
   * Classify single knowledge extraction
   * @param knowledge - Knowledge object to classify
   * @param options - Classification options
   * @returns Classification result with confidence score
   */
  async classify(
    knowledge: Knowledge,
    options: ClassificationOptions
  ): Promise<OntologyClassification>;

  /**
   * Classify batch of knowledge extractions (efficient)
   * @param knowledgeBatch - Array of knowledge objects
   * @param options - Classification options
   * @returns Array of classification results
   */
  async classifyBatch(
    knowledgeBatch: Knowledge[],
    options: ClassificationOptions
  ): Promise<OntologyClassification[]>;

  /**
   * Get classification prompt (for debugging)
   * @param knowledge - Knowledge object
   * @param entityClasses - Available entity classes
   * @returns Generated prompt string
   */
  getClassificationPrompt(
    knowledge: Knowledge,
    entityClasses: string[]
  ): string;
}

interface OntologyClassification {
  entityClass: string;
  team?: string;
  confidence: number; // 0.0 to 1.0
  method: 'llm' | 'heuristic' | 'manual';
  modelUsed?: string;
  properties: Record<string, any>;
  reasoning?: string; // LLM explanation
}
```

### 5.3 OntologyQueryEngine API

```typescript
class OntologyQueryEngine {
  /**
   * Find knowledge by entity class
   * @param entityClass - Entity class name
   * @param team - Optional team filter
   * @param options - Query options
   * @returns Matching knowledge objects
   */
  async findByEntityClass(
    entityClass: string,
    team?: string,
    options?: QueryOptions
  ): Promise<Knowledge[]>;

  /**
   * Find knowledge by property value
   * @param entityClass - Entity class name
   * @param propertyPath - Dot-separated property path
   * @param value - Property value to match
   * @returns Matching knowledge objects
   */
  async findByProperty(
    entityClass: string,
    propertyPath: string,
    value: any
  ): Promise<Knowledge[]>;

  /**
   * Aggregate counts by entity class
   * @param team - Optional team filter
   * @returns Map of entity class to count
   */
  async aggregateByEntityClass(
    team?: string
  ): Promise<Map<string, number>>;

  /**
   * Find related knowledge via ontology relationships
   * @param knowledgeId - Starting knowledge ID
   * @param relationshipType - Optional relationship type filter
   * @returns Related knowledge objects
   */
  async findRelated(
    knowledgeId: string,
    relationshipType?: string
  ): Promise<Knowledge[]>;

  /**
   * Query with complex filters
   * @param query - Complex query object
   * @returns Matching knowledge objects
   */
  async query(query: OntologyQuery): Promise<Knowledge[]>;
}

interface QueryOptions {
  limit?: number;
  offset?: number;
  sortBy?: string;
  includeValidationErrors?: boolean;
}

interface OntologyQuery {
  entityClass?: string;
  team?: string;
  properties?: Record<string, any>;
  relationships?: RelationshipFilter[];
  confidenceThreshold?: number;
}
```

---

## 6. Sequence Diagrams

### 6.1 Knowledge Extraction with Ontology

![Knowledge Extraction with Ontology](../../../docs/presentation/images/knowledge-extraction-ontology.png)

*Figure 2: Sequence diagram showing how ontology classification and validation are integrated into the knowledge extraction workflow*

### 6.2 Ontology-Based Query

![Ontology-Based Query](../../../docs/presentation/images/ontology-query.png)

*Figure 3: Sequence diagram showing how ontology-based queries retrieve knowledge by entity class and properties*

### 6.3 Ontology Resolution (Upper + Lower)

![Ontology Resolution](../../../docs/presentation/images/ontology-resolution.png)

*Figure 4: Sequence diagram showing how entity definitions are resolved by merging upper and lower ontologies with caching*

---

## 7. Implementation Considerations

### 7.1 Performance Optimization

1. **Ontology Caching**:
   - Cache parsed ontology files in memory
   - Invalidate cache on file change (watch for modifications)
   - Use LRU cache for resolved entity definitions

2. **Batch Classification**:
   - Process multiple knowledge extractions in single LLM call
   - Use streaming inference for real-time classification
   - Batch validation checks

3. **Index Optimization**:
   - Create graph indices on `ontology.entityClass` and `ontology.team`
   - Use Qdrant payload indexing for ontology metadata
   - Cache frequent queries

4. **Lazy Loading**:
   - Load lower ontologies only when team scope is specified
   - Defer validation until explicitly requested
   - Load ontology relationships on-demand

### 7.2 Error Handling

1. **Ontology File Errors**:
```typescript
class OntologyError extends Error {
  constructor(
    message: string,
    public code: string,
    public path?: string
  ) {
    super(message);
    this.name = 'OntologyError';
  }
}

// Error codes:
// - ONTOLOGY_NOT_FOUND
// - ONTOLOGY_PARSE_ERROR
// - ONTOLOGY_VALIDATION_ERROR
// - ENTITY_NOT_FOUND
// - PROPERTY_VALIDATION_ERROR
```

2. **Classification Errors**:
   - Fallback to heuristics if LLM fails
   - Log classification failures for analysis
   - Continue processing even if classification fails (ontology is optional)

3. **Validation Errors**:
   - Store validation errors with knowledge object
   - Don't block storage in lenient mode
   - Provide detailed error messages with property paths

### 7.3 Configuration Management

**Default Configuration** (`config/knowledge-management.json`):

```json
{
  "ontology": {
    "enabled": true,
    "upperOntologyPath": ".data/ontologies/upper/cluster-reprocessing-ontology.json",
    "team": "mixed",
    "confidenceThreshold": 0.7,
    "validation": {
      "enabled": true,
      "strict": false
    },
    "caching": {
      "enabled": true,
      "ttl": 3600000,
      "maxSize": 100
    },
    "classification": {
      "batchSize": 10,
      "useHeuristicFallback": true,
      "heuristicThreshold": 0.8
    }
  }
}
```

**Team-Specific Configuration** (`config/teams/`):

```json
// config/teams/raas.json
{
  "team": "RaaS",
  "lowerOntologyPath": ".data/ontologies/lower/raas-ontology.json",
  "validation": {
    "strict": true
  }
}

// config/teams/resi.json
{
  "team": "ReSi",
  "lowerOntologyPath": ".data/ontologies/lower/resi-ontology.json",
  "validation": {
    "strict": false
  }
}

// config/teams/coding.json
{
  "team": "coding",
  "lowerOntologyPath": ".data/ontologies/lower/coding-ontology.json",
  "validation": {
    "strict": true
  }
}

// config/teams/agentic.json
{
  "team": "agentic",
  "lowerOntologyPath": ".data/ontologies/lower/agentic-ontology.json",
  "validation": {
    "strict": false
  }
}

// config/teams/ui.json
{
  "team": "ui",
  "lowerOntologyPath": ".data/ontologies/lower/ui-ontology.json",
  "validation": {
    "strict": true
  }
}
```

### 7.4 Testing Strategy

1. **Unit Tests**:
   - OntologyManager: Loading, parsing, resolution
   - OntologyValidator: Property validation, schema validation
   - OntologyClassifier: Prompt building, heuristics
   - OntologyQueryEngine: Query filtering, aggregations

2. **Integration Tests**:
   - StreamingKnowledgeExtractor with ontology system
   - End-to-end classification and storage
   - Query retrieval with ontology filters
   - Upper + lower ontology inheritance

3. **Performance Tests**:
   - Classification throughput (extractions/second)
   - Query performance with large knowledge base
   - Memory usage with cached ontologies

4. **Test Fixtures**:
```typescript
// tests/fixtures/ontologies/test-upper-ontology.json
{
  "name": "test-upper",
  "version": "1.0.0",
  "type": "upper",
  "entities": {
    "TestEntity": {
      "description": "Test entity",
      "properties": {
        "id": { "type": "string", "required": true },
        "value": { "type": "number" }
      }
    }
  },
  "relationships": {},
  "metadata": {
    "description": "Test ontology",
    "domain": "test"
  }
}
```

### 7.5 Migration Strategy

**Phase 1: Non-Breaking Addition** (Week 1)
- Add ontology system alongside existing system
- No changes to existing knowledge extraction
- Enable via configuration flag

**Phase 2: Gradual Enablement** (Week 2-3)
- Enable ontology classification for new knowledge
- Backfill ontology metadata for recent knowledge (optional)
- Monitor classification accuracy and performance

**Phase 3: Full Integration** (Week 4-5)
- Integrate ontology queries into retrieval workflows
- Update dashboards to show ontology metrics
- Document best practices for ontology usage

**Rollback Plan**:
- Disable ontology system via configuration
- Existing knowledge without ontology metadata remains functional
- No data migration required for rollback

---

## 8. Security and Privacy

### 8.1 Data Sensitivity

- Ontology files may contain proprietary domain knowledge
- Knowledge extractions may include sensitive code patterns
- LLM classification prompts should not include PII or secrets

### 8.2 Access Control

- Ontology files stored in `.data/` (git-ignored)
- Team-specific ontologies require authentication
- Query API should enforce team-based access control (future enhancement)

### 8.3 Audit Trail

```typescript
interface OntologyAuditLog {
  timestamp: string;
  action: 'classify' | 'validate' | 'query';
  entityClass: string;
  team?: string;
  user?: string;
  result: 'success' | 'failure';
  metadata?: Record<string, any>;
}
```

---

## 9. Monitoring and Observability

### 9.1 Metrics

```typescript
interface OntologyMetrics {
  // Classification metrics
  classificationsPerSecond: number;
  classificationLatency: Histogram;
  classificationConfidence: Histogram;
  heuristicFallbackRate: number;

  // Validation metrics
  validationsPerSecond: number;
  validationFailureRate: number;
  strictValidationFailureRate: number;

  // Query metrics
  queriesByEntityClass: Map<string, number>;
  queryLatency: Histogram;

  // Cache metrics
  cacheHitRate: number;
  cacheSize: number;
}
```

### 9.2 Logging

```typescript
logger.info('Ontology classification', {
  knowledgeId: knowledge.id,
  entityClass: classification.entityClass,
  confidence: classification.confidence,
  method: classification.method,
  team: classification.team,
  latency: classificationTime
});

logger.warn('Ontology validation failed', {
  knowledgeId: knowledge.id,
  entityClass: knowledge.ontology.entityClass,
  errors: validationResult.errors,
  strict: options.strict
});
```

---

## 10. Future Enhancements

### 10.1 Short-Term (3-6 months)

1. **Relationship Extraction**: Automatically detect and store ontology relationships between knowledge extractions
2. **Ontology Versioning**: Support multiple ontology versions and migration paths
3. **Visual Ontology Editor**: Web-based UI for creating and editing ontologies
4. **Advanced Heuristics**: Machine learning-based heuristic classification

### 10.2 Long-Term (6-12 months)

1. **Cross-Project Ontologies**: Share ontologies across multiple projects
2. **Ontology Alignment**: Automatically map between different ontologies
3. **Temporal Ontologies**: Track how entity definitions evolve over time
4. **Federated Ontologies**: Integrate with external ontology standards (OWL, SKOS)

---

## 11. Acceptance Criteria

### 11.1 Functional Requirements

- [ ] OntologyManager loads and parses upper and lower ontologies
- [ ] OntologyClassifier classifies knowledge using LLM and heuristics
- [ ] OntologyValidator validates knowledge against entity schemas
- [ ] OntologyQueryEngine retrieves knowledge by entity class
- [ ] StreamingKnowledgeExtractor integrates ontology classification seamlessly
- [ ] System works with mixed team scope
- [ ] Validation supports strict and lenient modes
- [ ] Configuration is flexible and team-specific

### 11.2 Non-Functional Requirements

- [ ] Classification latency < 500ms (p95)
- [ ] Query latency < 100ms (p95)
- [ ] No performance degradation when ontology disabled
- [ ] Memory usage increase < 50MB with cached ontologies
- [ ] Classification accuracy > 85% (LLM) or > 90% (heuristic)
- [ ] System handles 100+ entity classes efficiently

### 11.3 Integration Requirements

- [ ] No breaking changes to existing knowledge management API
- [ ] Backward compatible with knowledge without ontology metadata
- [ ] Works with existing graph and vector databases
- [ ] Integrates with existing LLM inference engine

---

## 12. Open Questions

1. **Ontology Evolution**: How should we handle ontology schema changes over time? Should we version ontologies explicitly?

2. **Multi-Ontology Knowledge**: Can a single knowledge extraction belong to multiple entity classes? (Current design: single entity class)

3. **Relationship Inference**: Should relationships be manually defined or automatically inferred from co-occurrence patterns?

4. **External Ontologies**: Should we support importing standard ontologies (e.g., Dublin Core, FOAF)?

5. **Query Language**: Should we develop a custom query DSL for complex ontology queries, or use existing query languages?

---

## Appendix A: Entity Class Examples

### Upper Ontology Examples

```json
{
  "RecordedData": {
    "description": "Vehicle sensor and ECU data captured during test drives",
    "properties": {
      "sources": {
        "type": "array",
        "items": { "type": "string", "enum": ["camera", "radar", "lidar", "SOME/IP", "MIPI"] },
        "description": "Data source types"
      },
      "containerFormat": {
        "type": "string",
        "enum": ["MF4", "MCAP"],
        "description": "File container format"
      },
      "payloadFormat": {
        "type": "string",
        "enum": ["Protobuf/SPP", "Kaitai-Binary", "raw"],
        "description": "Payload encoding format"
      },
      "metadata": {
        "type": "object",
        "description": "Recording metadata (vehicle, timestamp, location, etc.)"
      }
    },
    "requiredProperties": ["sources", "containerFormat"]
  },

  "RPU": {
    "description": "Reprocessing Unit - containerized virtual target execution environment",
    "properties": {
      "imageId": { "type": "string", "description": "Docker image identifier" },
      "imageTag": { "type": "string", "description": "Image version tag" },
      "artifactoryPath": { "type": "string", "description": "Path in Artifactory" },
      "virtualTarget": {
        "type": "reference",
        "refersTo": "VirtualTarget",
        "description": "Virtual target executed in this RPU"
      },
      "resourceRequirements": {
        "type": "object",
        "properties": {
          "cpu": { "type": "string" },
          "memory": { "type": "string" }
        }
      }
    },
    "requiredProperties": ["imageId", "virtualTarget"]
  }
}
```

### Lower Ontology Examples (RaaS)

```json
{
  "ArgoWorkflowTemplate": {
    "description": "Argo Workflow template for orchestrating compound reprocessing",
    "extendsEntity": "CompoundReprocessing",
    "properties": {
      "templateName": { "type": "string", "required": true },
      "namespace": { "type": "string", "required": true },
      "dagSpec": {
        "type": "object",
        "description": "Argo DAG specification"
      },
      "rpuSteps": {
        "type": "array",
        "items": { "type": "reference", "refersTo": "RPU" },
        "description": "RPU components in workflow"
      },
      "parallelization": {
        "type": "object",
        "properties": {
          "maxConcurrency": { "type": "number" },
          "strategy": { "type": "string", "enum": ["fan-out", "sequential", "adaptive"] }
        }
      }
    }
  },

  "RDQFramework": {
    "description": "RaaS Data Quality framework for validation",
    "properties": {
      "rules": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "ruleId": { "type": "string" },
            "condition": { "type": "string" },
            "severity": { "type": "string", "enum": ["error", "warning", "info"] }
          }
        }
      },
      "reportingEndpoint": { "type": "string" },
      "alertThresholds": { "type": "object" }
    }
  }
}
```

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-03 | Claude | Initial design document |

