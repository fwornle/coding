/**
 * Heuristics module - Multi-Layer Pattern-Based Classification
 *
 * Exports all team heuristics, the multi-layer HeuristicClassifier,
 * and individual layer classifiers.
 */

export * from './types.js';
export * from './HeuristicClassifier.js';

// Layer classifiers
export { TeamContextFilter } from './TeamContextFilter.js';
export { EntityPatternAnalyzer } from './EntityPatternAnalyzer.js';
export { EnhancedKeywordMatcher } from './EnhancedKeywordMatcher.js';
export { SemanticEmbeddingClassifier } from './SemanticEmbeddingClassifier.js';

// Team heuristics
export { raasHeuristics } from './raas-heuristics.js';
export { resiHeuristics } from './resi-heuristics.js';
export { codingHeuristics } from './coding-heuristics.js';
export { agenticHeuristics } from './agentic-heuristics.js';
export { uiHeuristics } from './ui-heuristics.js';

import { HeuristicClassifier } from './HeuristicClassifier.js';
import { raasHeuristics } from './raas-heuristics.js';
import { resiHeuristics } from './resi-heuristics.js';
import { codingHeuristics } from './coding-heuristics.js';
import { agenticHeuristics } from './agentic-heuristics.js';
import { uiHeuristics } from './ui-heuristics.js';

/**
 * Create and initialize a HeuristicClassifier with all team heuristics
 */
export function createHeuristicClassifier(): HeuristicClassifier {
  const classifier = new HeuristicClassifier();

  // Register all team heuristics
  classifier.registerTeamHeuristics(raasHeuristics);
  classifier.registerTeamHeuristics(resiHeuristics);
  classifier.registerTeamHeuristics(codingHeuristics);
  classifier.registerTeamHeuristics(agenticHeuristics);
  classifier.registerTeamHeuristics(uiHeuristics);

  return classifier;
}
