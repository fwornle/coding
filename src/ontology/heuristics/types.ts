/**
 * Heuristic classification types and interfaces
 */

/**
 * Pattern-based classification rule
 */
export interface HeuristicPattern {
  /** Keywords that trigger this pattern (case-insensitive) */
  keywords: string[];

  /** Required keywords (all must be present) */
  requiredKeywords?: string[];

  /** Exclude keywords (none should be present) */
  excludeKeywords?: string[];

  /** Regex patterns to match */
  patterns?: RegExp[];

  /** Base confidence score (0-1) */
  baseConfidence: number;

  /** Confidence boost per additional keyword match */
  keywordBoost?: number;

  /** Maximum confidence score */
  maxConfidence?: number;
}

/**
 * Entity class heuristics
 */
export interface EntityClassHeuristics {
  /** Entity class name */
  entityClass: string;

  /** Description for logging */
  description: string;

  /** Classification patterns */
  patterns: HeuristicPattern[];

  /** Minimum confidence threshold to return this classification */
  minConfidence?: number;
}

/**
 * Team-specific heuristics configuration
 */
export interface TeamHeuristics {
  /** Team identifier */
  team: string;

  /** Team description */
  description: string;

  /** Entity class heuristics */
  entityHeuristics: EntityClassHeuristics[];
}

/**
 * Heuristic match result
 */
export interface HeuristicMatch {
  /** Matched entity class */
  entityClass: string;

  /** Confidence score (0-1) */
  confidence: number;

  /** Matched keywords */
  matchedKeywords: string[];

  /** Matched patterns */
  matchedPatterns: string[];
}
