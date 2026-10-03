/**
 * ConversationBiasTracker - Layer 0: Session Filter
 *
 * Tracks conversation context using a sliding window of recent classifications
 * to establish bias that helps classify neutral prompt sets.
 *
 * Key Features:
 * - Maintains sliding window of last N classifications
 * - Calculates conversation bias (CODING vs LOCAL)
 * - Considers current working directory as weak signal
 * - Provides bias strength/confidence scores
 */

import { isWithinPath, samePath } from '../../lib/scope/index.mjs';

class ConversationBiasTracker {
  constructor(config = {}) {
    // Configuration
    this.windowSize = config.window_size || 5;
    this.biasStrengthThreshold = config.bias_strength_threshold || 0.65;
    this.workingDirWeight = config.working_dir_weight || 0.1;
    this.temporalDecay = config.temporal_decay || 0.9;
    this.biasConfidenceDiscount = config.bias_confidence_discount || 0.8;

    // Sliding window of recent classifications
    this.recentClassifications = [];

    // Current state
    this.currentBias = null;          // 'CODING_INFRASTRUCTURE' or 'LOCAL'
    this.biasStrength = 0;            // 0.0-1.0
    this.currentWorkingDir = process.cwd();
    this.codingRepo = config.codingRepo || process.env.CODING_REPO;

    // Stats
    this.stats = {
      totalUpdates: 0,
      biasChanges: 0,
      codingBiasCount: 0,
      localBiasCount: 0
    };
  }

  /**
   * Add a new classification to the sliding window
   * @param {Object} classification - { target, confidence, timestamp }
   */
  addClassification(classification) {
    // Add to window
    this.recentClassifications.push({
      target: classification.target,
      confidence: classification.confidence,
      timestamp: classification.timestamp || Date.now()
    });

    // Maintain window size
    if (this.recentClassifications.length > this.windowSize) {
      this.recentClassifications.shift();
    }

    // Recalculate bias
    this._calculateBias();

    this.stats.totalUpdates++;
  }

  /**
   * Calculate current conversation bias from recent window
   * @private
   */
  _calculateBias() {
    const prevBias = this.currentBias;

    // Need at least 2 entries to establish bias
    if (this.recentClassifications.length < 2) {
      this.currentBias = null;
      this.biasStrength = 0;
      return;
    }

    // Count and weight each classification
    const weights = {
      CODING_INFRASTRUCTURE: 0,
      LOCAL: 0
    };

    const confidenceSum = {
      CODING_INFRASTRUCTURE: 0,
      LOCAL: 0
    };

    const counts = {
      CODING_INFRASTRUCTURE: 0,
      LOCAL: 0
    };

    // Apply temporal decay (more recent = higher weight)
    const totalEntries = this.recentClassifications.length;
    this.recentClassifications.forEach((entry, index) => {
      // Temporal weight: older entries have lower weight
      const position = index / totalEntries; // 0 to 1
      const temporalWeight = Math.pow(this.temporalDecay, (totalEntries - 1 - index));

      // Combine temporal weight with confidence
      const weight = temporalWeight * entry.confidence;

      weights[entry.target] += weight;
      confidenceSum[entry.target] += entry.confidence;
      counts[entry.target] += 1;
    });

    // Add working directory signal (weak)
    // Containment, not `includes`: a substring test called ~/Agentic/coding-history
    // (and any path merely mentioning the repo path) a cwd inside the tools repo.
    if (this.codingRepo && isWithinPath(this.currentWorkingDir, this.codingRepo)) {
      weights.CODING_INFRASTRUCTURE += this.workingDirWeight;
    } else if (!samePath(this.currentWorkingDir, this.codingRepo)) {
      weights.LOCAL += this.workingDirWeight;
    }

    // Determine bias
    const totalWeight = weights.CODING_INFRASTRUCTURE + weights.LOCAL;
    if (totalWeight === 0) {
      this.currentBias = null;
      this.biasStrength = 0;
      return;
    }

    // Winner
    if (weights.CODING_INFRASTRUCTURE > weights.LOCAL) {
      this.currentBias = 'CODING_INFRASTRUCTURE';
      const avgConfidence = counts.CODING_INFRASTRUCTURE > 0
        ? confidenceSum.CODING_INFRASTRUCTURE / counts.CODING_INFRASTRUCTURE
        : 0.5;
      this.biasStrength = (weights.CODING_INFRASTRUCTURE / totalWeight) * avgConfidence;
      this.stats.codingBiasCount++;
    } else {
      this.currentBias = 'LOCAL';
      const avgConfidence = counts.LOCAL > 0
        ? confidenceSum.LOCAL / counts.LOCAL
        : 0.5;
      this.biasStrength = (weights.LOCAL / totalWeight) * avgConfidence;
      this.stats.localBiasCount++;
    }

    // Track bias changes
    if (prevBias && prevBias !== this.currentBias) {
      this.stats.biasChanges++;
    }
  }

  /**
   * Check if we have sufficient bias to make a decision
   * @returns {boolean}
   */
  hasSufficientBias() {
    return this.currentBias !== null &&
           this.biasStrength >= this.biasStrengthThreshold;
  }

  /**
   * Get bias decision for a neutral prompt set
   * @returns {Object|null} - { target, confidence, reason } or null
   */
  getBiasDecision() {
    if (!this.hasSufficientBias()) {
      return null;
    }

    // Apply confidence discount for bias-based decisions
    const confidence = this.biasStrength * this.biasConfidenceDiscount;

    const reason = this._generateReason();

    return {
      target: this.currentBias,
      confidence: confidence,
      reason: reason,
      layer: 'session-filter'
    };
  }

  /**
   * Generate human-readable reason for bias decision
   * @private
   */
  _generateReason() {
    const windowDesc = this.recentClassifications
      .map(c => c.target === 'CODING_INFRASTRUCTURE' ? 'CODING' : 'LOCAL')
      .join(', ');

    const biasType = this.currentBias === 'CODING_INFRASTRUCTURE' ? 'CODING' : 'LOCAL';

    return `Conversation bias: ${biasType} (strength: ${this.biasStrength.toFixed(2)}, window: [${windowDesc}])`;
  }

  /**
   * Get current bias state for logging/debugging
   * @returns {Object}
   */
  getState() {
    return {
      currentBias: this.currentBias,
      biasStrength: this.biasStrength,
      hasSufficientBias: this.hasSufficientBias(),
      windowSize: this.windowSize,
      currentWindowLength: this.recentClassifications.length,
      recentClassifications: this.recentClassifications.map(c => ({
        target: c.target === 'CODING_INFRASTRUCTURE' ? 'CODING' : 'LOCAL',
        confidence: c.confidence.toFixed(2)
      })),
      stats: this.stats
    };
  }

  /**
   * Reset the tracker (for testing or new session)
   */
  reset() {
    this.recentClassifications = [];
    this.currentBias = null;
    this.biasStrength = 0;
  }

  /**
   * Update current working directory
   * @param {string} dir
   */
  updateWorkingDirectory(dir) {
    if (dir !== this.currentWorkingDir) {
      this.currentWorkingDir = dir;
      // Recalculate bias with new working dir
      if (this.recentClassifications.length >= 2) {
        this._calculateBias();
      }
    }
  }
}

export default ConversationBiasTracker;
