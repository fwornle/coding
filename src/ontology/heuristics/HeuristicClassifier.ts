/**
 * HeuristicClassifier - Multi-Layer Pattern-Based Classification System
 *
 * Orchestrates 5 layers of classification with early exit optimization:
 * - Layer 0: Team Context Filter (conversation bias tracking)
 * - Layer 1: Entity Pattern Analyzer (file/artifact detection)
 * - Layer 2: Enhanced Keyword Matcher (multi-match requirement)
 * - Layer 3: Semantic Embedding Classifier (vector similarity)
 * - Layer 4: LLM Semantic Analyzer (handled by OntologyClassifier)
 *
 * Performance: <100ms for 90% of classifications (most exit at Layers 0-2)
 */

import {
  TeamHeuristics,
} from './types.js';
import { HeuristicClassification, LayerResult } from '../types.js';
import { TeamContextFilter } from './TeamContextFilter.js';
import { EntityPatternAnalyzer } from './EntityPatternAnalyzer.js';
import { EnhancedKeywordMatcher } from './EnhancedKeywordMatcher.js';
import { SemanticEmbeddingClassifier } from './SemanticEmbeddingClassifier.js';

/**
 * Multi-Layer Heuristic Classifier
 */
export class HeuristicClassifier {
  private teamContextFilter: TeamContextFilter;
  private entityPatternAnalyzer: EntityPatternAnalyzer;
  private enhancedKeywordMatcher: EnhancedKeywordMatcher;
  private semanticEmbeddingClassifier?: SemanticEmbeddingClassifier;

  private readonly earlyExitThreshold: number;

  constructor(config: {
    earlyExitThreshold?: number;
    windowSize?: number;
    semanticEmbeddingClassifier?: SemanticEmbeddingClassifier;
  } = {}) {
    this.earlyExitThreshold = config.earlyExitThreshold || 0.85;

    // Initialize layers
    this.teamContextFilter = new TeamContextFilter(config.windowSize || 5);
    this.entityPatternAnalyzer = new EntityPatternAnalyzer();
    this.enhancedKeywordMatcher = new EnhancedKeywordMatcher();
    this.semanticEmbeddingClassifier = config.semanticEmbeddingClassifier;
  }

  /**
   * Register heuristics for a team (backward compatibility)
   */
  registerTeamHeuristics(heuristics: TeamHeuristics): void {
    this.enhancedKeywordMatcher.registerTeamHeuristics(heuristics);
  }

  /**
   * Classify text using multi-layer heuristic system
   *
   * @param text - Text to classify
   * @param team - Team context (optional, searches all teams if not provided)
   * @param minConfidence - Minimum confidence threshold (default: 0.5)
   * @returns Array of heuristic classifications sorted by confidence
   */
  classify(
    text: string,
    team?: string,
    minConfidence: number = 0.5
  ): HeuristicClassification[] {
    const knowledge = { id: 'temp', content: text };
    const layerResults: LayerResult[] = [];

    // Layer 0: Team Context Filter
    const contextResult = this.teamContextFilter.checkTeamContext(knowledge);
    if (contextResult) {
      if (contextResult.confidence >= this.earlyExitThreshold) {
        // Early exit - update history and return
        this.updateClassificationHistory(contextResult);
        return [this.toHeuristicClassification(contextResult)];
      }
      layerResults.push(contextResult);
    }

    // Layer 1: Entity Pattern Analyzer
    const patternResult = this.entityPatternAnalyzer.analyzeEntityPatterns(knowledge);
    if (patternResult) {
      if (patternResult.confidence >= this.earlyExitThreshold) {
        // Early exit - update history and return
        this.updateClassificationHistory(patternResult);
        return [this.toHeuristicClassification(patternResult)];
      }
      layerResults.push(patternResult);
    }

    // Layer 2: Enhanced Keyword Matcher
    const keywordResult = this.enhancedKeywordMatcher.matchKeywords(knowledge, team);
    if (keywordResult) {
      if (keywordResult.confidence >= this.earlyExitThreshold) {
        // Early exit - update history and return
        this.updateClassificationHistory(keywordResult);
        return [this.toHeuristicClassification(keywordResult)];
      }
      layerResults.push(keywordResult);
    }

    // Layer 3: Semantic Embedding Classifier (async, handled separately in async classify method)
    // Skip in synchronous classify method

    // Aggregate results from multiple layers
    if (layerResults.length > 0) {
      const aggregated = this.aggregateLayerResults(layerResults, minConfidence);

      // Update classification history with best result
      if (aggregated.length > 0) {
        const best = aggregated[0];
        this.updateClassificationHistory({
          layer: -1,
          layerName: 'Aggregated',
          entityClass: best.entityClass,
          team: undefined,
          confidence: best.confidence,
          processingTime: 0,
        });
      }

      return aggregated;
    }

    return [];
  }

  /**
   * Classify text using multi-layer heuristic system (async version with Layer 3)
   *
   * @param text - Text to classify
   * @param team - Team context (optional, searches all teams if not provided)
   * @param minConfidence - Minimum confidence threshold (default: 0.5)
   * @returns Array of heuristic classifications sorted by confidence
   */
  async classifyAsync(
    text: string,
    team?: string,
    minConfidence: number = 0.5
  ): Promise<HeuristicClassification[]> {
    const knowledge = { id: 'temp', content: text };
    const layerResults: LayerResult[] = [];

    // Layer 0: Team Context Filter
    const contextResult = this.teamContextFilter.checkTeamContext(knowledge);
    if (contextResult) {
      if (contextResult.confidence >= this.earlyExitThreshold) {
        this.updateClassificationHistory(contextResult);
        return [this.toHeuristicClassification(contextResult)];
      }
      layerResults.push(contextResult);
    }

    // Layer 1: Entity Pattern Analyzer
    const patternResult = this.entityPatternAnalyzer.analyzeEntityPatterns(knowledge);
    if (patternResult) {
      if (patternResult.confidence >= this.earlyExitThreshold) {
        this.updateClassificationHistory(patternResult);
        return [this.toHeuristicClassification(patternResult)];
      }
      layerResults.push(patternResult);
    }

    // Layer 2: Enhanced Keyword Matcher
    const keywordResult = this.enhancedKeywordMatcher.matchKeywords(knowledge, team);
    if (keywordResult) {
      if (keywordResult.confidence >= this.earlyExitThreshold) {
        this.updateClassificationHistory(keywordResult);
        return [this.toHeuristicClassification(keywordResult)];
      }
      layerResults.push(keywordResult);
    }

    // Layer 3: Semantic Embedding Classifier (async)
    if (this.semanticEmbeddingClassifier) {
      try {
        const embeddingResult = await this.semanticEmbeddingClassifier.classifyByEmbedding(
          knowledge,
          team
        );

        if (embeddingResult) {
          if (embeddingResult.confidence >= this.earlyExitThreshold) {
            this.updateClassificationHistory(embeddingResult);
            return [this.toHeuristicClassification(embeddingResult)];
          }
          layerResults.push(embeddingResult);
        }
      } catch (error) {
        console.warn('[HeuristicClassifier] Layer 3 (Semantic Embedding) failed:', error);
      }
    }

    // Aggregate results from multiple layers
    if (layerResults.length > 0) {
      const aggregated = this.aggregateLayerResults(layerResults, minConfidence);

      if (aggregated.length > 0) {
        const best = aggregated[0];
        this.updateClassificationHistory({
          layer: -1,
          layerName: 'Aggregated',
          entityClass: best.entityClass,
          team: undefined,
          confidence: best.confidence,
          processingTime: 0,
        });
      }

      return aggregated;
    }

    return [];
  }

  /**
   * Update classification history for conversation bias tracking
   */
  private updateClassificationHistory(result: LayerResult): void {
    if (result.entityClass && result.team) {
      this.teamContextFilter.updateHistory(
        'temp',
        result.entityClass,
        result.team,
        result.confidence
      );
    }
  }

  /**
   * Convert LayerResult to HeuristicClassification format
   */
  private toHeuristicClassification(result: LayerResult): HeuristicClassification {
    return {
      entityClass: result.entityClass || 'Unknown',
      confidence: result.confidence,
      matchedPatterns: result.evidence ? [result.evidence] : [],
    };
  }

  /**
   * Aggregate results from multiple layers
   *
   * Uses weighted averaging based on layer confidence and processing time.
   * Layers with higher confidence and faster processing time get more weight.
   */
  private aggregateLayerResults(
    layerResults: LayerResult[],
    minConfidence: number
  ): HeuristicClassification[] {
    if (layerResults.length === 0) {
      return [];
    }

    // Group by entity class and team
    const groupedResults = new Map<string, LayerResult[]>();
    layerResults.forEach((result) => {
      if (!result.entityClass) return;

      const key = `${result.team || 'unknown'}:${result.entityClass}`;
      if (!groupedResults.has(key)) {
        groupedResults.set(key, []);
      }
      groupedResults.get(key)!.push(result);
    });

    // Calculate aggregated confidence for each group
    const aggregated: HeuristicClassification[] = [];
    groupedResults.forEach((results, key) => {
      const [_team, entityClass] = key.split(':');

      // Weighted average based on confidence
      let totalWeight = 0;
      let weightedSum = 0;

      results.forEach((result) => {
        // Weight = confidence (higher confidence = more weight)
        const weight = result.confidence;
        weightedSum += result.confidence * weight;
        totalWeight += weight;
      });

      const aggregatedConfidence =
        totalWeight > 0 ? weightedSum / totalWeight : 0;

      if (aggregatedConfidence >= minConfidence) {
        aggregated.push({
          entityClass,
          confidence: aggregatedConfidence,
          matchedPatterns: results
            .map((r) => r.evidence || '')
            .filter((e) => e.length > 0),
        });
      }
    });

    // Sort by confidence (descending)
    aggregated.sort((a, b) => b.confidence - a.confidence);

    return aggregated;
  }

  /**
   * Get all registered teams
   */
  getRegisteredTeams(): string[] {
    return this.enhancedKeywordMatcher.getRegisteredTeams();
  }

  /**
   * Get heuristics for a team
   */
  getTeamHeuristics(team: string): TeamHeuristics | undefined {
    return this.enhancedKeywordMatcher.getTeamHeuristics(team);
  }

  /**
   * Clear all registered heuristics
   */
  clear(): void {
    this.enhancedKeywordMatcher.clear();
    this.teamContextFilter.clearHistory();
  }

  /**
   * Set semantic embedding classifier (for late initialization)
   */
  setSemanticEmbeddingClassifier(classifier: SemanticEmbeddingClassifier): void {
    this.semanticEmbeddingClassifier = classifier;
  }

  /**
   * Get team context filter (for direct access)
   */
  getTeamContextFilter(): TeamContextFilter {
    return this.teamContextFilter;
  }

  /**
   * Get classification statistics
   */
  getStats() {
    return {
      earlyExitThreshold: this.earlyExitThreshold,
      contextHistorySize: this.teamContextFilter.getHistorySize(),
      registeredTeams: this.getRegisteredTeams(),
      hasSemanticEmbedding: !!this.semanticEmbeddingClassifier,
    };
  }
}
