/**
 * Knowledge Management Type Definitions
 *
 * TypeScript type definitions for the knowledge management system,
 * including ontology configuration and streaming extraction settings.
 */

import type { ValidationMode } from '../ontology/types.js';

/**
 * Knowledge extraction configuration
 */
export interface KnowledgeConfig {
  /** Database manager configuration */
  database?: {
    /** Graph database type */
    type?: 'graphology-level' | 'leveldb';

    /** Database path */
    path?: string;

    /** Database options */
    options?: Record<string, any>;
  };

  /** Embedding generator configuration */
  embeddings?: {
    /** Enable local embeddings */
    local?: {
      enabled?: boolean;
      model?: string;
      vectorSize?: number;
    };

    /** Enable remote embeddings */
    remote?: {
      enabled?: boolean;
      model?: string;
      vectorSize?: number;
      apiKey?: string;
    };

    /** Caching configuration */
    cache?: {
      enabled?: boolean;
      ttl?: number;
      maxEntries?: number;
    };
  };

  /** Streaming extraction configuration */
  streaming?: {
    /** Exchange buffer size for context */
    bufferSize?: number;

    /** Debounce delay in milliseconds */
    debounceMs?: number;

    /** Minimum exchange length to process */
    minExchangeLength?: number;

    /** Batch processing size */
    batchSize?: number;
  };

  /** Ontology system configuration */
  ontology?: {
    /** Enable ontology classification and validation */
    enabled: boolean;

    /** Path to upper ontology file (domain-level) */
    upperOntologyPath: string;

    /** Path to lower ontology file (team-specific), optional */
    lowerOntologyPath?: string;

    /** Team scope for classification */
    team?: 'Coding' | 'RaaS' | 'ReSi' | 'Agentic' | 'UI' | 'mixed';

    /** Classification confidence threshold (0-1) */
    confidenceThreshold?: number;

    /** Validation configuration */
    validation?: {
      /** Enable validation */
      enabled: boolean;

      /** Validation mode */
      mode?: ValidationMode;

      /** Fail on validation errors */
      failOnError?: boolean;

      /** Allow unknown properties */
      allowUnknownProperties?: boolean;
    };

    /** Classification configuration */
    classification?: {
      /** Batch size for LLM classification */
      batchSize?: number;

      /** Use heuristic classification before LLM */
      useHeuristicFallback?: boolean;

      /** Confidence threshold for heuristic acceptance */
      heuristicThreshold?: number;

      /** Enable Layer 0: Team Context Filter */
      enableLayer0?: boolean;

      /** Enable Layer 1: Entity Pattern Analyzer */
      enableLayer1?: boolean;

      /** Enable Layer 2: Enhanced Keyword Matcher */
      enableLayer2?: boolean;

      /** Enable Layer 3: Semantic Embedding Classifier */
      enableLayer3?: boolean;

      /** Enable Layer 4: LLM Semantic Analyzer */
      enableLayer4?: boolean;

      /** Early exit threshold for multi-layer classification */
      earlyExitThreshold?: number;
    };

    /** Caching configuration */
    caching?: {
      /** Enable classification caching */
      enabled?: boolean;

      /** Cache TTL in milliseconds */
      ttl?: number;

      /** Maximum cache entries */
      maxSize?: number;
    };
  };

  /** Inference engine configuration */
  inference?: {
    /** Default provider */
    provider?: 'openai' | 'anthropic' | 'groq' | 'google';

    /** Default model */
    model?: string;

    /** Budget configuration */
    budget?: {
      /** Daily budget in USD */
      dailyBudget?: number;

      /** Monthly budget in USD */
      monthlyBudget?: number;

      /** Enable budget tracking */
      trackBudget?: boolean;
    };
  };
}

/**
 * Team-specific ontology configuration
 */
export interface TeamOntologyConfig {
  /** Team identifier */
  team: 'Coding' | 'RaaS' | 'ReSi' | 'Agentic' | 'UI';

  /** Description of team focus */
  description: string;

  /** Path to lower ontology file */
  lowerOntologyPath: string;

  /** Override confidence threshold for this team */
  confidenceThreshold?: number;

  /** Override validation mode for this team */
  validationMode?: ValidationMode;

  /** Enable strict validation */
  strictValidation?: boolean;

  /** Team-specific classification settings */
  classification?: {
    /** Prefer heuristics over LLM for this team */
    preferHeuristics?: boolean;

    /** Custom heuristic threshold */
    heuristicThreshold?: number;
  };
}

/**
 * Runtime knowledge extraction session
 */
export interface KnowledgeSession {
  /** Session ID */
  sessionId: string;

  /** Project path */
  projectPath: string;

  /** Session intent (from trajectory analysis) */
  intent?: string;

  /** Session start time */
  startTime: Date;

  /** Session end time */
  endTime?: Date;

  /** Configuration for this session */
  config: KnowledgeConfig;
}

/**
 * Streaming extraction statistics
 */
export interface StreamingStats {
  /** Total sessions streamed */
  sessionsStreamed: number;

  /** Total exchanges processed */
  exchangesStreamed: number;

  /** Immediate extractions (no debounce) */
  immediateExtractions: number;

  /** Debounced skips */
  debouncedSkips: number;

  /** Queue overflows */
  queueOverflows: number;

  /** Ontology classification stats */
  ontology?: {
    /** Classifications attempted */
    classificationsAttempted: number;

    /** Classifications successful */
    classificationsSuccessful: number;

    /** Layer 0 exits */
    layer0Exits: number;

    /** Layer 1 exits */
    layer1Exits: number;

    /** Layer 2 exits */
    layer2Exits: number;

    /** Layer 3 exits */
    layer3Exits: number;

    /** Layer 4 (LLM) calls */
    layer4Calls: number;

    /** Average classification time (ms) */
    avgClassificationTime: number;
  };
}
