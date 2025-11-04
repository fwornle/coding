/**
 * EnhancedKeywordMatcher - Layer 2: Keyword-Based Classification
 *
 * Fast keyword-based classification with MULTI-MATCH requirement to prevent
 * false positives from single keyword overlap between teams.
 *
 * CRITICAL ENHANCEMENT: Requires ≥2 keyword matches from same team before
 * returning classification (prevents single-keyword misclassification).
 *
 * Performance: <10ms response time
 */

import { LayerResult, KeywordScore } from '../types.js';
import {
  TeamHeuristics,
  EntityClassHeuristics,
  HeuristicPattern,
} from './types.js';

/**
 * Enhanced Keyword Matcher with multi-match requirement
 */
export class EnhancedKeywordMatcher {
  private teamHeuristics: Map<string, TeamHeuristics> = new Map();

  /**
   * Register team-specific heuristics
   *
   * @param heuristics - Team heuristics configuration
   */
  registerTeamHeuristics(heuristics: TeamHeuristics): void {
    this.teamHeuristics.set(heuristics.team, heuristics);
  }

  /**
   * Match keywords with multi-match requirement
   *
   * @param knowledge - Knowledge content to classify
   * @param team - Optional team filter (searches all teams if not provided)
   * @returns LayerResult if sufficient keyword evidence, null otherwise
   */
  matchKeywords(
    knowledge: { id: string; content: string },
    team?: string
  ): LayerResult | null {
    const start = performance.now();
    const content = knowledge.content.toLowerCase();

    // Get teams to search
    const teams = team
      ? [team]
      : ['Coding', 'RaaS', 'ReSi', 'Agentic', 'UI'];
    const teamScores = new Map<string, KeywordScore>();

    // Score each team
    teams.forEach((t) => {
      const teamHeur = this.teamHeuristics.get(t);
      if (!teamHeur) return;

      const score = this.scoreTeamKeywords(content, teamHeur);
      if (score.totalMatches > 0) {
        teamScores.set(t, score);
      }
    });

    // Find team with highest score
    let bestTeam = '';
    let bestScore: KeywordScore | null = null;
    teamScores.forEach((score, t) => {
      if (!bestScore || score.confidence > bestScore.confidence) {
        bestTeam = t;
        bestScore = score;
      }
    });

    // CRITICAL: Only return if ≥2 matches AND confidence ≥0.5
    if (bestScore === null) {
      return null; // No keyword matches found
    }

    // Type assertion to help TypeScript understand bestScore is not null
    const score = bestScore as KeywordScore;

    if (
      score.totalMatches >= 2 &&
      score.confidence >= 0.5
    ) {
      return {
        layer: 2,
        layerName: 'EnhancedKeywordMatcher',
        entityClass: score.suggestedEntity || null,
        team: bestTeam,
        confidence: score.confidence,
        processingTime: performance.now() - start,
        evidence: `Matched ${score.totalMatches} keywords for ${bestTeam}: ${score.matchedKeywords.slice(0, 5).join(', ')}${score.matchedKeywords.length > 5 ? '...' : ''}`,
      };
    }

    return null; // Insufficient keyword evidence
  }

  /**
   * Score all keywords for a team
   *
   * @param content - Normalized content (lowercase)
   * @param teamHeur - Team heuristics
   * @returns Keyword score with confidence
   */
  private scoreTeamKeywords(
    content: string,
    teamHeur: TeamHeuristics
  ): KeywordScore {
    let totalMatches = 0;
    const matchedKeywords: string[] = [];
    const matchedRequired: string[] = [];
    let bestEntityClass: string | undefined;
    let highestEntityScore = 0;

    // Try each entity class pattern
    teamHeur.entityHeuristics.forEach((entityHeur) => {
      const entityScore = this.scoreEntityClass(
        content,
        entityHeur,
        matchedKeywords,
        matchedRequired
      );

      totalMatches += entityScore.matches;

      // Track best entity class
      if (entityScore.matches > highestEntityScore) {
        highestEntityScore = entityScore.matches;
        bestEntityClass = entityHeur.entityClass;
      }
    });

    // Calculate confidence based on match count and required keywords
    const confidence = this.calculateConfidence(
      totalMatches,
      matchedRequired.length
    );

    return {
      totalMatches,
      confidence,
      matchedKeywords: [...new Set(matchedKeywords)],
      matchedRequired: [...new Set(matchedRequired)],
      suggestedEntity: bestEntityClass,
    };
  }

  /**
   * Score keywords for an entity class
   *
   * @param content - Normalized content
   * @param entityHeur - Entity class heuristics
   * @param matchedKeywords - Array to accumulate matched keywords
   * @param matchedRequired - Array to accumulate matched required keywords
   * @returns Number of matches for this entity class
   */
  private scoreEntityClass(
    content: string,
    entityHeur: EntityClassHeuristics,
    matchedKeywords: string[],
    matchedRequired: string[]
  ): { matches: number; hasRequired: boolean } {
    let entityMatches = 0;
    let hasAllRequired = false;

    for (const pattern of entityHeur.patterns) {
      const patternResult = this.scorePattern(
        content,
        pattern,
        matchedKeywords,
        matchedRequired
      );

      if (patternResult.matches > 0) {
        entityMatches += patternResult.matches;
        if (patternResult.hasAllRequired) {
          hasAllRequired = true;
        }
      }
    }

    return { matches: entityMatches, hasRequired: hasAllRequired };
  }

  /**
   * Score a single pattern
   *
   * @param content - Normalized content
   * @param pattern - Heuristic pattern
   * @param matchedKeywords - Array to accumulate matched keywords
   * @param matchedRequired - Array to accumulate matched required keywords
   * @returns Number of matches and whether all required keywords present
   */
  private scorePattern(
    content: string,
    pattern: HeuristicPattern,
    matchedKeywords: string[],
    matchedRequired: string[]
  ): { matches: number; hasAllRequired: boolean } {
    // Check exclude keywords (none should be present)
    if (pattern.excludeKeywords) {
      for (const keyword of pattern.excludeKeywords) {
        if (content.includes(keyword.toLowerCase())) {
          return { matches: 0, hasAllRequired: false }; // Skip pattern
        }
      }
    }

    // Check required keywords (all must be present)
    let hasAllRequired = false;
    if (pattern.requiredKeywords && pattern.requiredKeywords.length > 0) {
      hasAllRequired = pattern.requiredKeywords.every((keyword) =>
        content.includes(keyword.toLowerCase())
      );

      if (hasAllRequired) {
        // Add required keywords to matched list
        matchedRequired.push(
          ...pattern.requiredKeywords.map((kw) => kw.toLowerCase())
        );
      } else {
        return { matches: 0, hasAllRequired: false }; // Required keyword missing
      }
    }

    // Count keyword matches
    let matches = 0;
    for (const keyword of pattern.keywords) {
      if (content.includes(keyword.toLowerCase())) {
        matchedKeywords.push(keyword.toLowerCase());
        matches++;
      }
    }

    return { matches, hasAllRequired };
  }

  /**
   * Calculate confidence based on match count and required keywords
   *
   * Confidence Scoring:
   * - 0 matches: 0.0
   * - 1 match: 0.5 (low confidence - insufficient)
   * - 2+ matches without required: 0.65 (medium)
   * - 2+ matches with required: 0.85 (high)
   * - Additional boost: +0.03 per extra match (max 0.95)
   *
   * @param totalMatches - Total keyword matches
   * @param requiredCount - Number of required keywords matched
   * @returns Confidence score (0-1)
   */
  private calculateConfidence(
    totalMatches: number,
    requiredCount: number
  ): number {
    if (totalMatches === 0) {
      return 0.0;
    } else if (totalMatches === 1) {
      return 0.5; // Single match = low confidence (below threshold)
    } else if (totalMatches >= 2 && requiredCount === 0) {
      // Multiple matches but no required keywords = medium confidence
      let confidence = 0.65;
      // Boost for additional matches
      confidence += (totalMatches - 2) * 0.03;
      return Math.min(confidence, 0.8); // Cap at 0.8 without required keywords
    } else {
      // Multiple matches + required keywords = high confidence
      let confidence = 0.85;
      // Boost for additional matches
      confidence += (totalMatches - 2) * 0.03;
      return Math.min(confidence, 0.95); // Cap at 0.95
    }
  }

  /**
   * Get all registered teams
   */
  getRegisteredTeams(): string[] {
    return Array.from(this.teamHeuristics.keys());
  }

  /**
   * Get team heuristics
   */
  getTeamHeuristics(team: string): TeamHeuristics | undefined {
    return this.teamHeuristics.get(team);
  }

  /**
   * Clear all registered heuristics
   */
  clear(): void {
    this.teamHeuristics.clear();
  }
}
