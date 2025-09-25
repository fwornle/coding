#!/usr/bin/env node

/**
 * Exchange Classifier Stub - Temporary compatibility layer
 * This is a minimal stub to fix missing import errors during transition
 * to ReliableCodingClassifier system
 */

class ExchangeClassifier {
  constructor() {
    console.warn('⚠️ Using ExchangeClassifier stub - please update to ReliableCodingClassifier');
  }

  async classifyExchange(exchange) {
    // Simple fallback classification
    return {
      category: 'GENERAL',
      confidence: 0.1,
      reason: 'Stub classifier - no actual classification performed'
    };
  }

  async classify(content) {
    return this.classifyExchange(content);
  }
}

export default ExchangeClassifier;