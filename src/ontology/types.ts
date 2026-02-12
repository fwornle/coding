/**
 * TypeScript type definitions for the Ontology System
 *
 * This module defines all core types for the ontology-based knowledge management system,
 * including ontology structure, entity definitions, validation, and classification.
 */

// ============================================================================
// Core Ontology Types
// ============================================================================

/**
 * Ontology type: upper (domain-level) or lower (team-specific)
 */
export type OntologyType = 'upper' | 'lower';

/**
 * Property types supported in entity definitions
 */
export type PropertyType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'reference';

/**
 * Validation modes for ontology enforcement
 * - strict: All entities must match ontology classes
 * - lenient: Entities can have unknown types (logged as warnings)
 * - disabled: No validation
 * - auto-extend: Suggest new classes for unmatched patterns
 */
export type ValidationMode = 'strict' | 'lenient' | 'disabled' | 'auto-extend';

/**
 * Property definition for an entity
 */
export interface PropertyDefinition {
  /** Property data type */
  type: PropertyType;

  /** Human-readable description */
  description?: string;

  /** Facet this property is tagged with */
  facet?: string;

  /** Whether this property is required (inline marker) */
  required?: boolean;

  /** Allowed values for enum types */
  enum?: string[];

  /** Regex pattern for string validation */
  pattern?: string;

  /** Minimum value for numbers or minimum length for strings/arrays */
  min?: number;

  /** Maximum value for numbers or maximum length for strings/arrays */
  max?: number;

  /** Default value if not provided */
  default?: any;

  /** For array types: item type definition */
  items?: string | PropertyDefinition;

  /** Example values */
  examples?: string[];

  /** For object types: nested properties */
  properties?: Record<string, PropertyDefinition>;

  /** For reference types: target entity class name */
  targetEntityClass?: string;

  /** Units for numeric values (e.g., "seconds", "bytes", "MB") */
  unit?: string;
}

/**
 * Relationship cardinality between entities
 */
export type Cardinality = 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';

/**
 * Relationship definition between entity classes
 */
export interface RelationshipDefinition {
  /** Relationship description */
  description: string;

  /** Facet this relationship belongs to */
  facet?: string;

  /** Source entity class (single or array for multi-source relationships) */
  sourceEntityClass: string | string[];

  /** Target entity class (single or array for multi-target relationships) */
  targetEntityClass: string | string[];

  /** Relationship cardinality */
  cardinality?: Cardinality;

  /** Additional properties on the relationship */
  properties?: Record<string, string>;
}

/**
 * Entity definition in the ontology
 */
export interface EntityDefinition {
  /** Entity class description */
  description: string;

  /** Facet this entity belongs to */
  facet?: string;

  /** Upper ontology entity this extends (for lower ontologies) */
  extendsEntity?: string;

  /** Entity properties with their definitions */
  properties: Record<string, PropertyDefinition>;

  /** List of required property names */
  requiredProperties?: string[];

  /** Example instances of this entity */
  examples?: string[];
}

/**
 * Ontology metadata
 */
export interface OntologyMetadata {
  /** Ontology name */
  name: string;

  /** Ontology version (semver) */
  version: string;

  /** Ontology type */
  type: OntologyType;

  /** Team identifier (for lower ontologies) */
  team?: string;

  /** Upper ontology this extends (for lower ontologies) */
  extendsOntology?: string;

  /** Ontology description */
  description?: string;

  /** Facet names used to organize entities and relationships */
  facets?: string[];
}

/**
 * Complete ontology definition
 */
export interface Ontology extends OntologyMetadata {
  /** Entity class definitions */
  entities: Record<string, EntityDefinition>;

  /** Relationship definitions */
  relationships?: Record<string, RelationshipDefinition>;
}

// ============================================================================
// Validation Types
// ============================================================================

/**
 * Validation error details
 */
export interface ValidationError {
  /** Property path where error occurred (e.g., "properties.rpuComponents[2].imageTag") */
  path: string;

  /** Error message */
  message: string;

  /** Expected value or type */
  expected?: string;

  /** Actual value received */
  actual?: any;
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;

  /** List of validation errors */
  errors: ValidationError[];

  /** List of validation warnings (in lenient mode) */
  warnings?: ValidationError[];
}

/**
 * Validation options
 */
export interface ValidationOptions {
  /** Validation strictness mode */
  mode: ValidationMode;

  /** Team context for resolving lower ontology */
  team?: string;

  /** Allow properties not defined in ontology */
  allowUnknownProperties?: boolean;

  /** Fail immediately on first error (strict mode) */
  failFast?: boolean;
}

/**
 * Property validation result
 */
export interface PropertyValidationResult {
  /** Whether property is valid */
  valid: boolean;

  /** Validation error if invalid */
  error?: ValidationError;
}

// ============================================================================
// Classification Types
// ============================================================================

/**
 * LLM usage statistics for classification
 */
export interface LLMUsageStats {
  /** Model used for inference */
  model?: string;

  /** Provider used (groq, ollama, gemini, etc.) */
  provider?: string;

  /** Input/prompt tokens consumed */
  promptTokens?: number;

  /** Output/completion tokens generated */
  completionTokens?: number;

  /** Total tokens (prompt + completion) */
  totalTokens?: number;
}

/**
 * Ontology classification result
 */
export interface OntologyClassification {
  /** Classified entity class */
  entityClass: string;

  /** Classification confidence score (0-1) */
  confidence: number;

  /** Ontology context used (upper or team-specific lower) */
  ontology: 'upper' | string;

  /** Extracted entity properties */
  properties?: Record<string, any>;

  /** Classification method used */
  method: 'llm' | 'heuristic' | 'hybrid';

  /** Validation result if validation was performed */
  validation?: ValidationResult;

  /** LLM usage statistics (when method is 'llm' or 'hybrid') */
  llmUsage?: LLMUsageStats;
}

/**
 * Classification options
 */
export interface ClassificationOptions {
  /** Team context for classification */
  team?: string;

  /** Enable team scope mixing (try multiple teams) */
  mixedTeamScope?: boolean;

  /** Minimum confidence threshold (0-1) */
  minConfidence?: number;

  /** Enable LLM classification */
  enableLLM?: boolean;

  /** Enable heuristic classification */
  enableHeuristics?: boolean;

  /** LLM budget limit (max tokens) */
  llmBudget?: number;

  /** Validate classified entity */
  validate?: boolean;

  /** Validation options */
  validationOptions?: ValidationOptions;
}

/**
 * Heuristic classification result
 */
export interface HeuristicClassification {
  /** Classified entity class */
  entityClass: string;

  /** Classification confidence (0-1) */
  confidence: number;

  /** Matched patterns/keywords */
  matchedPatterns?: string[];
}

// ============================================================================
// Multi-Layer Classification Types
// ============================================================================

/**
 * Layer result from a single classification layer
 */
export interface LayerResult {
  /** Layer number (0-4) */
  layer: number;

  /** Layer name */
  layerName: string;

  /** Classified entity class (null if no classification) */
  entityClass: string | null;

  /** Team classification */
  team?: string;

  /** Classification confidence (0-1) */
  confidence: number;

  /** Processing time in milliseconds */
  processingTime: number;

  /** Evidence/reasoning for classification */
  evidence?: string;
}

/**
 * Classification history entry for conversation bias tracking
 */
export interface ClassificationHistory {
  /** Knowledge ID */
  knowledgeId: string;

  /** Classified entity class */
  entityClass: string;

  /** Team classification */
  team: string;

  /** Classification timestamp */
  timestamp: Date;

  /** Classification confidence */
  confidence: number;
}

/**
 * Team bias calculation result
 */
export interface TeamBias {
  /** Dominant team */
  team: string;

  /** Bias strength (0-1) */
  strength: number;

  /** Number of occurrences in history */
  occurrences: number;

  /** Suggested entity class based on recent classifications */
  suggestedEntity?: string;
}

/**
 * Artifact match result from pattern analysis
 */
export interface ArtifactMatch {
  /** Team that owns the artifact */
  team: string;

  /** Inferred entity class */
  entityClass: string;

  /** Match confidence (0-1) */
  confidence: number;
}

/**
 * Keyword scoring result
 */
export interface KeywordScore {
  /** Total keyword matches */
  totalMatches: number;

  /** Confidence score (0-1) */
  confidence: number;

  /** Matched keywords */
  matchedKeywords: string[];

  /** Matched required keywords */
  matchedRequired: string[];

  /** Suggested entity class */
  suggestedEntity?: string;
}

/**
 * Embedding similarity match result
 */
export interface EmbeddingMatch {
  /** Team */
  team: string;

  /** Entity class */
  entityClass: string;

  /** Similarity score (0-1) */
  similarity: number;

  /** Matched ontology content */
  matchedContent: string;
}

// ============================================================================
// Query Types
// ============================================================================

/**
 * Ontology query filters
 */
export interface OntologyQueryFilters {
  /** Filter by entity class */
  entityClass?: string;

  /** Filter by entity classes (multiple) */
  entityClasses?: string[];

  /** Filter by team */
  team?: string;

  /** Filter by ontology properties */
  properties?: Record<string, any>;

  /** Filter by relationship type */
  relationshipType?: string;
}

/**
 * Ontology query options
 */
export interface QueryOptions {
  /** Query filters */
  filters?: OntologyQueryFilters;

  /** Maximum number of results */
  limit?: number;

  /** Result offset for pagination */
  offset?: number;

  /** Include entity properties in results */
  includeProperties?: boolean;

  /** Include relationships in results */
  includeRelationships?: boolean;

  /** Sort field */
  sortBy?: string;

  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Ontology query result
 */
export interface OntologyQueryResult<T = any> {
  /** Query results */
  results: T[];

  /** Total count (before pagination) */
  totalCount: number;

  /** Whether there are more results */
  hasMore: boolean;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Ontology system configuration
 */
export interface OntologyConfig {
  /** Whether ontology system is enabled */
  enabled: boolean;

  /** Path to upper ontology file */
  upperOntologyPath: string;

  /** Team-specific configuration */
  team?: string;

  /** Path to lower ontology file (for team-specific config) */
  lowerOntologyPath?: string;

  /** Validation configuration */
  validation?: {
    /** Validation mode */
    mode: ValidationMode;

    /** Fail on validation errors */
    failOnError?: boolean;

    /** Allow unknown properties */
    allowUnknownProperties?: boolean;
  };

  /** Classification configuration */
  classification?: {
    /** Use upper ontology for classification */
    useUpper?: boolean;

    /** Use lower ontology for classification */
    useLower?: boolean;

    /** Minimum confidence threshold */
    minConfidence?: number;

    /** Enable LLM classification */
    enableLLM?: boolean;

    /** Enable heuristic classification */
    enableHeuristics?: boolean;

    /** LLM budget per classification (tokens) */
    llmBudgetPerClassification?: number;
  };

  /** Caching configuration */
  caching?: {
    /** Enable caching */
    enabled: boolean;

    /** Cache size (number of entries) */
    maxEntries?: number;

    /** Cache TTL in milliseconds */
    ttl?: number;
  };
}

/**
 * Team-specific ontology configuration
 */
export interface TeamOntologyConfig {
  /** Team identifier */
  team: string;

  /** Path to lower ontology file */
  lowerOntologyPath: string;

  /** Validation configuration */
  validation?: {
    mode: ValidationMode;
    failOnError?: boolean;
  };

  /** Classification configuration */
  classification?: {
    minConfidence?: number;
    enableLLM?: boolean;
    enableHeuristics?: boolean;
  };
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Ontology-specific error
 */
export class OntologyError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'OntologyError';
  }
}

/**
 * Ontology loading error
 */
export class OntologyLoadError extends OntologyError {
  constructor(message: string, public path: string, details?: any) {
    super(message, 'ONTOLOGY_LOAD_ERROR', details);
    this.name = 'OntologyLoadError';
  }
}

/**
 * Ontology validation error
 */
export class OntologyValidationError extends OntologyError {
  constructor(message: string, public errors: ValidationError[]) {
    super(message, 'ONTOLOGY_VALIDATION_ERROR', { errors });
    this.name = 'OntologyValidationError';
  }
}

/**
 * Entity resolution error
 */
export class EntityResolutionError extends OntologyError {
  constructor(message: string, public entityClass: string, details?: any) {
    super(message, 'ENTITY_RESOLUTION_ERROR', details);
    this.name = 'EntityResolutionError';
  }
}

// ============================================================================
// Knowledge Integration Types
// ============================================================================

/**
 * Knowledge entity with ontology classification
 */
export interface OntologyKnowledge {
  /** Knowledge ID */
  id: string;

  /** Knowledge content */
  content: string;

  /** Ontology classification */
  ontology?: OntologyClassification;

  /** Entity metadata */
  metadata?: Record<string, any>;

  /** Timestamp */
  timestamp: string;

  /** Source information */
  source?: string;
}

/**
 * Relationship between knowledge entities
 */
export interface KnowledgeRelationship {
  /** Source knowledge ID */
  from: string;

  /** Target knowledge ID */
  to: string;

  /** Relationship type (from ontology) */
  type: string;

  /** Relationship properties */
  properties?: Record<string, any>;
}

// ============================================================================
// LLM Integration Types
// ============================================================================

/**
 * LLM message for chat-based inference
 */
export interface LLMMessage {
  /** Message role */
  role: 'system' | 'user' | 'assistant';

  /** Message content */
  content: string;
}

/**
 * LLM completion request options
 */
export interface LLMCompletionOptions {
  /** Chat messages */
  messages: LLMMessage[];

  /** Maximum tokens to generate */
  maxTokens?: number;

  /** Temperature for sampling (0-2) */
  temperature?: number;

  /** Model identifier */
  model?: string;
}

/**
 * LLM completion response
 */
export interface LLMCompletionResponse {
  /** Generated content */
  content: string;

  /** Token usage statistics */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };

  /** Model used */
  model?: string;
}

/**
 * Unified Inference Engine interface for LLM operations
 */
export interface UnifiedInferenceEngine {
  /**
   * Generate completion from messages
   */
  generateCompletion(options: LLMCompletionOptions): Promise<LLMCompletionResponse>;

  /**
   * Get cost estimate for a completion
   */
  getCostEstimate?(options: LLMCompletionOptions): { totalCost: number };
}

// ============================================================================
// Export all types
// ============================================================================

export type {
  // Core types already exported via interface
};
