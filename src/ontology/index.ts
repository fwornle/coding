/**
 * Ontology Integration System
 *
 * Provides ontology-based knowledge management with:
 * - Upper (domain-level) and lower (team-specific) ontologies
 * - Entity resolution with inheritance
 * - Validation with strict/lenient modes
 * - Hybrid LLM + heuristic classification
 * - Team-specific and cross-team support
 *
 * @example
 * ```typescript
 * import { createOntologySystem } from './ontology';
 *
 * const system = await createOntologySystem({
 *   enabled: true,
 *   upperOntologyPath: '.data/ontologies/upper/development-knowledge-ontology.json',
 *   team: 'RaaS',
 *   lowerOntologyPath: '.data/ontologies/lower/raas-ontology.json',
 *   validation: { mode: 'strict' },
 *   classification: { enableLLM: true, enableHeuristics: true },
 *   caching: { enabled: true, maxEntries: 10 },
 * });
 *
 * // Classify text
 * const result = await system.classifier.classify('Kubernetes cluster configuration', {
 *   team: 'RaaS',
 *   minConfidence: 0.7,
 * });
 * // => { entityClass: 'KubernetesCluster', confidence: 0.85, ontology: 'RaaS', method: 'hybrid' }
 *
 * // Validate entity
 * const validation = system.validator.validate('KubernetesCluster', {
 *   clusterName: 'prod-cluster',
 *   region: 'us-west-2',
 *   nodeCount: 50,
 * }, { mode: 'strict', team: 'RaaS' });
 * ```
 */

export * from './types.js';
export * from './LegacyOntologyAdapter.js';
export * from './OntologyValidator.js';
export * from './OntologyClassifier.js';
export * from './OntologyConfigManager.js';
export * from './ontologyPathResolver.js';
export * from './heuristics/index.js';
export * from './metrics.js';

import { OntologyConfig } from './types.js';
import { LegacyOntologyAdapter } from './LegacyOntologyAdapter.js';
import { OntologyValidator } from './OntologyValidator.js';
import { OntologyClassifier } from './OntologyClassifier.js';
import { createHeuristicClassifier } from './heuristics/index.js';
import type { UnifiedInferenceEngine } from './types.js';

/**
 * Complete ontology system instance
 */
export interface OntologySystem {
  /**
   * Legacy adapter exposing hasEntityClass / getAllEntityClasses /
   * resolveEntityDefinition on top of km-core's OntologyRegistry
   * (Phase 42-03 D-53 — B's specific intelligence stays; the deleted
   * legacy manager is replaced by this shim around km-core).
   */
  ontology: LegacyOntologyAdapter;
  validator: OntologyValidator;
  classifier: OntologyClassifier;
  config: OntologyConfig;
}

/**
 * Create and initialize a complete ontology system
 *
 * IMPORTANT: inferenceEngine is REQUIRED. No mock fallback is provided.
 * Pass a real LLM inference engine from SemanticAnalyzer.
 *
 * IMPORTANT: caller constructs the km-core OntologyRegistry and supplies the
 * LegacyOntologyAdapter wrapper. This factory keeps the OntologyValidator
 * + OntologyClassifier wiring identical to the pre-Phase-42-03 shape so
 * existing call paths in persistence-agent.ts don't change.
 *
 * @param config - Ontology system configuration
 * @param inferenceEngine - LLM inference engine (REQUIRED for classification)
 * @param adapter - LegacyOntologyAdapter wrapping a km-core OntologyRegistry
 * @returns Initialized ontology system
 * @throws Error if inferenceEngine or adapter is not provided
 */
export async function createOntologySystem(
  config: OntologyConfig,
  inferenceEngine: UnifiedInferenceEngine,
  adapter: LegacyOntologyAdapter,
): Promise<OntologySystem> {
  // Validate inference engine is provided - NO MOCK FALLBACK
  if (!inferenceEngine) {
    throw new Error(
      'createOntologySystem requires an inferenceEngine. ' +
      'No mock fallback is provided. Pass a real LLM inference engine from SemanticAnalyzer.'
    );
  }

  if (!adapter) {
    throw new Error(
      'createOntologySystem requires a LegacyOntologyAdapter (Phase 42-03). ' +
      'Caller must construct one around a km-core OntologyRegistry first.'
    );
  }

  // Create validator
  const validator = new OntologyValidator(adapter);

  // Create heuristic classifier
  const heuristicClassifier = createHeuristicClassifier();

  // Create main classifier with provided inference engine
  const classifier = new OntologyClassifier(
    adapter,
    validator,
    heuristicClassifier,
    inferenceEngine
  );

  return {
    ontology: adapter,
    validator,
    classifier,
    config,
  };
}

/**
 * Validate ontology configuration
 */
export function validateOntologyConfig(config: Partial<OntologyConfig>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config.enabled) {
    return { valid: true, errors: [] }; // Disabled is valid
  }

  if (!config.upperOntologyPath) {
    errors.push('upperOntologyPath is required when ontology is enabled');
  }

  if (config.team && !config.lowerOntologyPath) {
    errors.push('lowerOntologyPath is required when team is specified');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
