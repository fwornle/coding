/**
 * TeamContextFilter - Layer 0: Conversation Bias Tracking
 *
 * Tracks recent team classifications to handle follow-up questions
 * by applying conversation momentum when knowledge signals are ambiguous.
 *
 * Performance: <1ms response time
 */

import {
  LayerResult,
  ClassificationHistory,
  TeamBias,
} from '../types.js';

/**
 * Team Context Filter for conversation bias tracking
 */
export class TeamContextFilter {
  private classificationHistory: ClassificationHistory[] = [];
  private readonly windowSize: number;

  constructor(windowSize: number = 5) {
    this.windowSize = windowSize;
  }

  /**
   * Check team context for neutral/ambiguous knowledge
   *
   * @param knowledge - Knowledge content to classify
   * @param neutralityThresholds - Thresholds from other layers indicating neutrality
   * @returns LayerResult if context applies, null otherwise
   */
  checkTeamContext(
    knowledge: { id: string; content: string },
    neutralityThresholds?: {
      pathConfidence?: number;
      keywordScore?: number;
      embeddingDiff?: number;
    }
  ): LayerResult | null {
    const start = performance.now();

    // Cannot apply context if no history
    if (this.classificationHistory.length === 0) {
      return null;
    }

    // Calculate team bias from recent history
    const teamBias = this.calculateTeamBias();

    // Check if knowledge is neutral (weak signals from other layers)
    const isNeutral = this.isNeutralKnowledge(
      knowledge,
      neutralityThresholds
    );

    if (!isNeutral) {
      return null; // Not neutral, skip context filter
    }

    // Apply bias if strong enough
    if (teamBias.strength >= 0.65) {
      return {
        layer: 0,
        layerName: 'TeamContextFilter',
        entityClass: teamBias.suggestedEntity || null,
        team: teamBias.team,
        confidence: teamBias.strength * 0.8, // Discounted for contextual nature
        processingTime: performance.now() - start,
        evidence: `Recent conversation focused on ${teamBias.team} (${teamBias.occurrences.toFixed(1)} of ${this.windowSize} exchanges)`,
      };
    }

    return null; // Bias not strong enough
  }

  /**
   * Update classification history with new classification
   *
   * @param knowledgeId - Knowledge ID
   * @param entityClass - Classified entity class
   * @param team - Team classification
   * @param confidence - Classification confidence
   */
  updateHistory(
    knowledgeId: string,
    entityClass: string,
    team: string,
    confidence: number
  ): void {
    // Add new classification
    this.classificationHistory.push({
      knowledgeId,
      entityClass,
      team,
      timestamp: new Date(),
      confidence,
    });

    // Maintain sliding window size
    if (this.classificationHistory.length > this.windowSize) {
      this.classificationHistory.shift(); // Remove oldest
    }
  }

  /**
   * Calculate team bias from recent history with temporal decay
   *
   * @returns Team bias with strength and dominant team
   */
  private calculateTeamBias(): TeamBias {
    const teamCounts = new Map<string, number>();
    const teamEntities = new Map<string, Map<string, number>>();
    let totalWeight = 0;

    // Apply temporal decay (more recent = higher weight)
    this.classificationHistory.forEach((hist, index) => {
      const age = this.classificationHistory.length - index - 1;
      const weight = Math.exp(-age * 0.2); // Exponential decay

      // Update team count with weight
      teamCounts.set(
        hist.team,
        (teamCounts.get(hist.team) || 0) + weight
      );

      // Track entity classes per team
      if (!teamEntities.has(hist.team)) {
        teamEntities.set(hist.team, new Map());
      }
      const entities = teamEntities.get(hist.team)!;
      entities.set(
        hist.entityClass,
        (entities.get(hist.entityClass) || 0) + weight
      );

      totalWeight += weight;
    });

    // Find dominant team
    let maxTeam = '';
    let maxCount = 0;
    teamCounts.forEach((count, team) => {
      if (count > maxCount) {
        maxTeam = team;
        maxCount = count;
      }
    });

    // Find most common entity class for dominant team
    let suggestedEntity: string | undefined;
    if (maxTeam && teamEntities.has(maxTeam)) {
      const entities = teamEntities.get(maxTeam)!;
      let maxEntityCount = 0;
      entities.forEach((count, entity) => {
        if (count > maxEntityCount) {
          suggestedEntity = entity;
          maxEntityCount = count;
        }
      });
    }

    return {
      team: maxTeam,
      strength: totalWeight > 0 ? maxCount / totalWeight : 0,
      occurrences: maxCount,
      suggestedEntity,
    };
  }

  /**
   * Check if knowledge is neutral (weak signals from other layers)
   *
   * @param knowledge - Knowledge content
   * @param thresholds - Neutrality thresholds from other layers
   * @returns True if knowledge is neutral/ambiguous
   */
  private isNeutralKnowledge(
    knowledge: { content: string },
    thresholds?: {
      pathConfidence?: number;
      keywordScore?: number;
      embeddingDiff?: number;
    }
  ): boolean {
    const { pathConfidence = 1.0, keywordScore = 1.0, embeddingDiff = 1.0 } =
      thresholds || {};

    // Knowledge is neutral if:
    // - Path confidence < 0.5 (no clear artifact match)
    // - Keyword score < 0.3 (weak keyword signals)
    // - Embedding diff < 0.15 (similar scores across teams)
    const isNeutral =
      pathConfidence < 0.5 && keywordScore < 0.3 && embeddingDiff < 0.15;

    // Also check for common neutral patterns (follow-up questions)
    const neutralPatterns = [
      /^(continue|proceed|go ahead|next|more)/i,
      /^(yes|ok|sure|sounds good|looks good)/i,
      /^(what about|how about|can you|could you)/i,
      /^(similar|like that|same as|more details)/i,
    ];

    const hasNeutralPattern = neutralPatterns.some((pattern) =>
      pattern.test(knowledge.content.trim())
    );

    return isNeutral || hasNeutralPattern;
  }

  /**
   * Clear classification history (for testing or reset)
   */
  clearHistory(): void {
    this.classificationHistory = [];
  }

  /**
   * Get current history size
   */
  getHistorySize(): number {
    return this.classificationHistory.length;
  }

  /**
   * Get classification history (for debugging)
   */
  getHistory(): ClassificationHistory[] {
    return [...this.classificationHistory]; // Return copy
  }
}
