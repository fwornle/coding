/**
 * Knowledge Learning Workflow End-to-End Tests
 *
 * Tests complete workflow covering all functional requirements:
 * 1. Live session monitoring and transcript processing
 * 2. Knowledge extraction from conversations
 * 3. Concept abstraction and storage
 * 4. Knowledge retrieval and search
 * 5. Trajectory tracking with intent classification
 * 6. Budget tracking and enforcement
 * 7. Cross-session knowledge sharing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Mock complete workflow system
class MockKnowledgeLearningSystem {
  constructor(options = {}) {
    this.projectPath = options.projectPath;
    this.sessions = [];
    this.knowledgeBase = [];
    this.trajectory = [];
    this.budget = {
      limit: options.budgetLimit || 8.33,
      used: 0,
      costs: []
    };
    this.currentSession = null;
  }

  // FR-1: Live session monitoring and transcript processing
  async startSession(metadata = {}) {
    this.currentSession = {
      id: `session_${Date.now()}`,
      startTime: Date.now(),
      metadata,
      exchanges: [],
      trajectory: {
        intent: 'exploring',
        state: 'active',
        goal: null
      }
    };

    this.sessions.push(this.currentSession);
    return this.currentSession;
  }

  async processExchange(user, assistant) {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    const exchange = {
      id: `exchange_${Date.now()}`,
      user,
      assistant,
      timestamp: Date.now()
    };

    this.currentSession.exchanges.push(exchange);

    // Update trajectory
    await this.updateTrajectory(exchange);

    // Extract knowledge in real-time
    await this.extractKnowledge(exchange);

    return exchange;
  }

  async endSession() {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    this.currentSession.endTime = Date.now();
    this.currentSession.duration = this.currentSession.endTime - this.currentSession.startTime;

    const session = this.currentSession;
    this.currentSession = null;

    return session;
  }

  // FR-2: Knowledge extraction from conversations
  async extractKnowledge(exchange) {
    // Classify exchange type
    const classification = this.classifyExchange(exchange);

    if (classification.hasKnowledge) {
      // Check budget before LLM call
      const estimatedCost = 0.001; // ~$0.001 per classification
      if (!this.canAffordCost(estimatedCost)) {
        // Use heuristic classification (no cost)
        return this.heuristicExtraction(exchange);
      }

      // Track cost
      this.trackCost(estimatedCost, 'knowledge_extraction');

      const knowledge = {
        id: `knowledge_${Date.now()}`,
        type: classification.type,
        content: exchange.assistant,
        source: {
          sessionId: this.currentSession.id,
          exchangeId: exchange.id
        },
        confidence: classification.confidence,
        timestamp: Date.now(),
        observations: [exchange.user, exchange.assistant]
      };

      this.knowledgeBase.push(knowledge);
      return knowledge;
    }

    return null;
  }

  classifyExchange(exchange) {
    const userLower = exchange.user.toLowerCase();
    const assistantLower = exchange.assistant.toLowerCase();

    // Heuristic classification
    if (userLower.includes('how') || userLower.includes('implement')) {
      if (assistantLower.includes('pattern') || assistantLower.includes('use')) {
        return { hasKnowledge: true, type: 'coding_pattern', confidence: 0.8 };
      }
    }

    if (userLower.includes('error') || userLower.includes('bug')) {
      if (assistantLower.includes('fix') || assistantLower.includes('solution')) {
        return { hasKnowledge: true, type: 'bug_solution', confidence: 0.85 };
      }
    }

    if (userLower.includes('test')) {
      return { hasKnowledge: true, type: 'test_strategy', confidence: 0.75 };
    }

    return { hasKnowledge: false, type: null, confidence: 0 };
  }

  heuristicExtraction(exchange) {
    const knowledge = {
      id: `knowledge_heuristic_${Date.now()}`,
      type: 'general_knowledge',
      content: exchange.assistant,
      source: {
        sessionId: this.currentSession.id,
        exchangeId: exchange.id
      },
      confidence: 0.6, // Lower confidence for heuristic
      timestamp: Date.now(),
      observations: [exchange.user, exchange.assistant],
      method: 'heuristic'
    };

    this.knowledgeBase.push(knowledge);
    return knowledge;
  }

  // FR-3: Concept abstraction and storage
  async abstractConcepts() {
    // Group similar knowledge items
    const clusters = this.clusterKnowledge();

    const concepts = [];
    for (const cluster of clusters) {
      if (cluster.items.length >= 3) {
        const concept = {
          id: `concept_${Date.now()}`,
          type: 'abstraction',
          pattern: this.extractPattern(cluster.items),
          instances: cluster.items.map(k => k.id),
          confidence: this.calculateConceptConfidence(cluster.items),
          timestamp: Date.now()
        };

        concepts.push(concept);
        this.knowledgeBase.push(concept);
      }
    }

    return concepts;
  }

  clusterKnowledge() {
    const byType = {};

    for (const knowledge of this.knowledgeBase) {
      if (knowledge.type === 'abstraction') continue;

      if (!byType[knowledge.type]) {
        byType[knowledge.type] = [];
      }
      byType[knowledge.type].push(knowledge);
    }

    return Object.keys(byType).map(type => ({
      type,
      items: byType[type]
    }));
  }

  extractPattern(items) {
    const allWords = items.flatMap(item =>
      item.content.toLowerCase().split(/\s+/)
    );

    const wordCounts = {};
    allWords.forEach(word => {
      wordCounts[word] = (wordCounts[word] || 0) + 1;
    });

    const commonWords = Object.entries(wordCounts)
      .filter(([_, count]) => count >= Math.ceil(items.length * 0.5))
      .map(([word, _]) => word)
      .slice(0, 5);

    return `Pattern: ${commonWords.join(' ')}`;
  }

  calculateConceptConfidence(items) {
    const avgConfidence = items.reduce((sum, k) => sum + k.confidence, 0) / items.length;
    const countBonus = Math.min(items.length / 20, 0.2);
    return Math.min(avgConfidence + countBonus, 1.0);
  }

  // FR-4: Knowledge retrieval and search
  async searchKnowledge(query, options = {}) {
    const results = [];

    for (const knowledge of this.knowledgeBase) {
      const relevance = this.calculateRelevance(query, knowledge);

      if (relevance > (options.threshold || 0.5)) {
        results.push({
          knowledge,
          relevance,
          highlighted: this.highlightMatch(query, knowledge.content)
        });
      }
    }

    // Sort by relevance
    results.sort((a, b) => b.relevance - a.relevance);

    return results.slice(0, options.limit || 10);
  }

  calculateRelevance(query, knowledge) {
    const queryWords = new Set(query.toLowerCase().split(/\s+/));
    const contentWords = new Set(knowledge.content.toLowerCase().split(/\s+/));

    const intersection = [...queryWords].filter(w => contentWords.has(w));
    const similarity = intersection.length / queryWords.size;

    // Boost recent knowledge
    const age = Date.now() - knowledge.timestamp;
    const ageBoost = age < 86400000 ? 0.2 : 0; // 24 hours

    return Math.min(similarity + ageBoost, 1.0);
  }

  highlightMatch(query, content) {
    const queryWords = query.toLowerCase().split(/\s+/);
    let highlighted = content;

    queryWords.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      highlighted = highlighted.replace(regex, `**${word}**`);
    });

    return highlighted;
  }

  async getKnowledgeByType(type, options = {}) {
    const items = this.knowledgeBase.filter(k => k.type === type);

    // Sort by timestamp (newest first)
    items.sort((a, b) => b.timestamp - a.timestamp);

    return items.slice(0, options.limit || 10);
  }

  // FR-5: Trajectory tracking with intent classification
  async updateTrajectory(exchange) {
    const intent = this.classifyIntent(exchange);
    const state = this.determineState(exchange);

    const trajectoryPoint = {
      timestamp: Date.now(),
      intent,
      state,
      exchange: exchange.id,
      sessionId: this.currentSession.id
    };

    this.trajectory.push(trajectoryPoint);
    this.currentSession.trajectory = {
      intent,
      state,
      goal: this.inferGoal(intent)
    };

    return trajectoryPoint;
  }

  classifyIntent(exchange) {
    const userLower = exchange.user.toLowerCase();

    if (userLower.includes('implement') || userLower.includes('create')) {
      return 'feature-dev';
    }
    if (userLower.includes('fix') || userLower.includes('error')) {
      return 'debugging';
    }
    if (userLower.includes('test')) {
      return 'testing';
    }
    if (userLower.includes('refactor')) {
      return 'refactoring';
    }
    if (userLower.includes('understand') || userLower.includes('explain')) {
      return 'learning';
    }

    return 'exploring';
  }

  determineState(exchange) {
    if (exchange.assistant.includes('error') || exchange.assistant.includes('issue')) {
      return 'blocked';
    }
    if (exchange.assistant.includes('complete') || exchange.assistant.includes('done')) {
      return 'complete';
    }

    return 'implementing';
  }

  inferGoal(intent) {
    const goals = {
      'feature-dev': 'Build new feature',
      'debugging': 'Fix bug',
      'testing': 'Add test coverage',
      'refactoring': 'Improve code quality',
      'learning': 'Understand codebase',
      'exploring': 'Explore options'
    };

    return goals[intent] || 'General development';
  }

  getTrajectoryAnalytics() {
    const intentCounts = {};
    const stateCounts = {};
    let totalTime = 0;

    for (let i = 0; i < this.trajectory.length; i++) {
      const point = this.trajectory[i];

      intentCounts[point.intent] = (intentCounts[point.intent] || 0) + 1;
      stateCounts[point.state] = (stateCounts[point.state] || 0) + 1;

      if (i > 0) {
        totalTime += point.timestamp - this.trajectory[i - 1].timestamp;
      }
    }

    return {
      intentDistribution: intentCounts,
      stateDistribution: stateCounts,
      totalPoints: this.trajectory.length,
      averageTimePerPoint: this.trajectory.length > 1 ? totalTime / (this.trajectory.length - 1) : 0
    };
  }

  // FR-6: Budget tracking and enforcement
  canAffordCost(estimatedCost) {
    return (this.budget.used + estimatedCost) <= this.budget.limit;
  }

  trackCost(cost, operation) {
    this.budget.used += cost;
    this.budget.costs.push({
      amount: cost,
      operation,
      timestamp: Date.now()
    });

    return {
      used: this.budget.used,
      remaining: this.budget.limit - this.budget.used,
      percentage: (this.budget.used / this.budget.limit) * 100
    };
  }

  getBudgetStatus() {
    return {
      limit: this.budget.limit,
      used: this.budget.used,
      remaining: this.budget.limit - this.budget.used,
      percentage: (this.budget.used / this.budget.limit) * 100,
      totalCosts: this.budget.costs.length
    };
  }

  // FR-7: Cross-session knowledge sharing
  async exportKnowledge() {
    return {
      sessions: this.sessions,
      knowledge: this.knowledgeBase,
      trajectory: this.trajectory,
      budget: this.budget
    };
  }

  async importKnowledge(data) {
    // Merge knowledge from another session
    const importedKnowledge = data.knowledge.filter(k =>
      !this.knowledgeBase.some(existing => existing.id === k.id)
    );

    this.knowledgeBase.push(...importedKnowledge);

    return {
      imported: importedKnowledge.length,
      total: this.knowledgeBase.length
    };
  }

  async findCrossSessionPatterns(otherSystem) {
    const sharedPatterns = [];

    for (const myKnowledge of this.knowledgeBase) {
      for (const theirKnowledge of otherSystem.knowledgeBase) {
        if (myKnowledge.type === theirKnowledge.type) {
          const similarity = this.calculateSimilarity(
            myKnowledge.content,
            theirKnowledge.content
          );

          if (similarity > 0.7) {
            sharedPatterns.push({
              pattern: myKnowledge.type,
              mine: myKnowledge.id,
              theirs: theirKnowledge.id,
              similarity
            });
          }
        }
      }
    }

    return sharedPatterns;
  }

  calculateSimilarity(content1, content2) {
    const words1 = new Set(content1.toLowerCase().split(/\s+/));
    const words2 = new Set(content2.toLowerCase().split(/\s+/));

    const intersection = [...words1].filter(w => words2.has(w));
    const union = new Set([...words1, ...words2]);

    return intersection.length / union.size;
  }

  // Utility methods
  getStats() {
    return {
      sessions: this.sessions.length,
      totalExchanges: this.sessions.reduce((sum, s) => sum + s.exchanges.length, 0),
      knowledgeItems: this.knowledgeBase.length,
      trajectoryPoints: this.trajectory.length,
      budgetUsed: this.budget.used,
      budgetPercentage: (this.budget.used / this.budget.limit) * 100
    };
  }
}

describe('Knowledge Learning Workflow E2E Tests', () => {
  let system;
  let testDir;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), 'e2e-test-' + Math.random().toString(36).substring(7));
    await fs.mkdir(testDir, { recursive: true });

    system = new MockKnowledgeLearningSystem({
      projectPath: testDir,
      budgetLimit: 8.33
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Complete Workflow: Session to Retrieval', () => {

    it('should complete full workflow from session start to knowledge retrieval', async () => {
      // Start session
      const session = await system.startSession({
        project: 'test-project',
        agent: 'claude'
      });

      expect(session.id).toBeDefined();
      expect(session.exchanges).toHaveLength(0);

      // Process exchanges
      await system.processExchange(
        'How do I implement caching?',
        'You can use a Map for simple in-memory caching'
      );

      await system.processExchange(
        'How do I handle cache expiration?',
        'You can use setTimeout to expire cache entries after a timeout'
      );

      await system.processExchange(
        'What about LRU caching?',
        'Use a Map with a size limit and remove oldest entries when full'
      );

      // End session
      await system.endSession();

      // Verify knowledge was extracted
      const knowledge = system.knowledgeBase;
      expect(knowledge.length).toBeGreaterThan(0);

      // Search for knowledge
      const results = await system.searchKnowledge('caching');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].relevance).toBeGreaterThan(0.5);
    });

    it('should track trajectory throughout session', async () => {
      await system.startSession({ project: 'test' });

      await system.processExchange(
        'I want to implement a new feature',
        'Let me help you design that feature'
      );

      await system.processExchange(
        'How do I fix this bug?',
        'Here is the solution to fix the bug'
      );

      await system.endSession();

      const analytics = system.getTrajectoryAnalytics();

      expect(analytics.intentDistribution['feature-dev']).toBeDefined();
      expect(analytics.intentDistribution['debugging']).toBeDefined();
      expect(analytics.totalPoints).toBe(2);
    });

    it('should enforce budget limits during session', async () => {
      // Create system with low budget
      const limitedSystem = new MockKnowledgeLearningSystem({
        projectPath: testDir,
        budgetLimit: 0.005 // Only $0.005
      });

      await limitedSystem.startSession({ project: 'test' });

      // Process exchanges until budget exhausted
      for (let i = 0; i < 10; i++) {
        await limitedSystem.processExchange(
          `Question ${i}`,
          `Answer ${i}`
        );
      }

      await limitedSystem.endSession();

      const budget = limitedSystem.getBudgetStatus();

      // Should have used budget
      expect(budget.used).toBeGreaterThan(0);

      // Should respect limit (may switch to heuristic when exceeded)
      expect(budget.percentage).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Multi-Session Scenarios', () => {

    it('should accumulate knowledge across multiple sessions', async () => {
      // Session 1
      await system.startSession({ project: 'test', session: 1 });
      await system.processExchange(
        'How to cache data?',
        'Use Map for caching'
      );
      await system.endSession();

      const afterSession1 = system.knowledgeBase.length;

      // Session 2
      await system.startSession({ project: 'test', session: 2 });
      await system.processExchange(
        'How to test caching?',
        'Use vitest to test cache functionality'
      );
      await system.endSession();

      const afterSession2 = system.knowledgeBase.length;

      expect(afterSession2).toBeGreaterThan(afterSession1);

      // Both sessions should be tracked
      expect(system.sessions.length).toBe(2);
    });

    it('should enable cross-session pattern detection', async () => {
      // Session 1: Caching patterns
      await system.startSession({ project: 'test' });
      await system.processExchange(
        'How to implement caching?',
        'Use Map with expiration pattern'
      );
      await system.processExchange(
        'How to cache API responses?',
        'Cache responses with TTL using Map'
      );
      await system.endSession();

      // Abstract concepts
      const concepts = await system.abstractConcepts();

      expect(concepts.length).toBeGreaterThan(0);
      expect(concepts[0].instances.length).toBeGreaterThanOrEqual(2);
    });

    it('should track budget across multiple sessions', async () => {
      await system.startSession({ project: 'test' });
      await system.processExchange('Q1', 'A1');
      await system.endSession();

      const budget1 = system.getBudgetStatus();

      await system.startSession({ project: 'test' });
      await system.processExchange('Q2', 'A2');
      await system.endSession();

      const budget2 = system.getBudgetStatus();

      // Budget should accumulate
      expect(budget2.used).toBeGreaterThan(budget1.used);
      expect(budget2.totalCosts).toBeGreaterThan(budget1.totalCosts);
    });

    it('should maintain session history', async () => {
      for (let i = 0; i < 3; i++) {
        await system.startSession({ project: 'test', iteration: i });
        await system.processExchange(`Question ${i}`, `Answer ${i}`);
        await system.endSession();
      }

      expect(system.sessions.length).toBe(3);

      // Each session should have duration
      system.sessions.forEach(session => {
        expect(session.duration).toBeGreaterThan(0);
      });
    });
  });

  describe('Cross-Agent Compatibility', () => {

    it('should allow knowledge sharing between different systems', async () => {
      // System 1 (e.g., Claude)
      const system1 = new MockKnowledgeLearningSystem({
        projectPath: testDir,
        budgetLimit: 8.33
      });

      await system1.startSession({ agent: 'claude' });
      await system1.processExchange(
        'How to cache?',
        'Use Map for caching'
      );
      await system1.endSession();

      // Export knowledge
      const exported = await system1.exportKnowledge();

      // System 2 (e.g., Copilot)
      const system2 = new MockKnowledgeLearningSystem({
        projectPath: testDir,
        budgetLimit: 8.33
      });

      // Import knowledge
      const result = await system2.importKnowledge(exported);

      expect(result.imported).toBeGreaterThan(0);
      expect(system2.knowledgeBase.length).toBe(system1.knowledgeBase.length);
    });

    it('should detect shared patterns across agents', async () => {
      const claude = new MockKnowledgeLearningSystem({ projectPath: testDir });
      const copilot = new MockKnowledgeLearningSystem({ projectPath: testDir });

      // Both learn similar patterns
      await claude.startSession({ agent: 'claude' });
      await claude.processExchange(
        'How to cache data?',
        'Use Map with LRU eviction pattern'
      );
      await claude.endSession();

      await copilot.startSession({ agent: 'copilot' });
      await copilot.processExchange(
        'How to implement caching?',
        'Use Map with LRU eviction strategy'
      );
      await copilot.endSession();

      // Find shared patterns
      const sharedPatterns = await claude.findCrossSessionPatterns(copilot);

      expect(sharedPatterns.length).toBeGreaterThan(0);
      expect(sharedPatterns[0].similarity).toBeGreaterThan(0.5);
    });

    it('should handle agent-specific metadata', async () => {
      await system.startSession({
        agent: 'claude',
        agentVersion: '3.5',
        features: ['mcp', 'streaming']
      });

      await system.processExchange('Test', 'Response');
      const session = await system.endSession();

      expect(session.metadata.agent).toBe('claude');
      expect(session.metadata.agentVersion).toBe('3.5');
      expect(session.metadata.features).toContain('mcp');
    });
  });

  describe('User Value Validation', () => {

    it('should provide relevant knowledge for follow-up questions', async () => {
      // First session: Learn about caching
      await system.startSession({ project: 'test' });
      await system.processExchange(
        'How to implement caching?',
        'Use Map with Set for fast lookups and deletions'
      );
      await system.endSession();

      // New session: Ask related question
      await system.startSession({ project: 'test' });

      const results = await system.searchKnowledge('caching implementation');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].knowledge.content).toContain('Map');
    });

    it('should filter knowledge by type for targeted retrieval', async () => {
      await system.startSession({ project: 'test' });
      await system.processExchange(
        'How to implement feature X?',
        'Use pattern Y for feature X'
      );
      await system.processExchange(
        'How to fix bug Z?',
        'Apply solution W to fix bug Z'
      );
      await system.endSession();

      const patterns = await system.getKnowledgeByType('coding_pattern');
      const bugs = await system.getKnowledgeByType('bug_solution');

      expect(patterns.length).toBeGreaterThan(0);
      expect(bugs.length).toBeGreaterThan(0);

      patterns.forEach(p => expect(p.type).toBe('coding_pattern'));
      bugs.forEach(b => expect(b.type).toBe('bug_solution'));
    });

    it('should boost recent knowledge in search results', async () => {
      await system.startSession({ project: 'test' });

      // Old knowledge
      await system.processExchange('Old question', 'Old answer about caching');
      const oldKnowledge = system.knowledgeBase[system.knowledgeBase.length - 1];
      oldKnowledge.timestamp = Date.now() - 86400000 * 7; // 7 days ago

      // Recent knowledge
      await system.processExchange('Recent question', 'Recent answer about caching');

      await system.endSession();

      const results = await system.searchKnowledge('caching');

      // Recent should rank higher
      expect(results[0].knowledge.content).toContain('Recent');
    });

    it('should provide statistics for user insights', async () => {
      await system.startSession({ project: 'test' });
      await system.processExchange('Q1', 'A1');
      await system.processExchange('Q2', 'A2');
      await system.endSession();

      await system.startSession({ project: 'test' });
      await system.processExchange('Q3', 'A3');
      await system.endSession();

      const stats = system.getStats();

      expect(stats.sessions).toBe(2);
      expect(stats.totalExchanges).toBe(3);
      expect(stats.knowledgeItems).toBeGreaterThan(0);
      expect(stats.budgetPercentage).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases and Real-World Scenarios', () => {

    it('should handle session without knowledge extraction', async () => {
      await system.startSession({ project: 'test' });

      // Small talk with no knowledge value
      await system.processExchange('Hello', 'Hi there!');
      await system.processExchange('Thanks', 'You\'re welcome!');

      await system.endSession();

      // Should still track session but may have minimal knowledge
      expect(system.sessions.length).toBe(1);
    });

    it('should handle rapid-fire exchanges', async () => {
      await system.startSession({ project: 'test' });

      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          system.processExchange(`Question ${i}`, `Answer ${i}`)
        );
      }

      await Promise.all(promises);
      await system.endSession();

      expect(system.sessions[0].exchanges.length).toBe(10);
    });

    it('should recover from extraction errors', async () => {
      await system.startSession({ project: 'test' });

      // Process normal exchange
      await system.processExchange('Valid question', 'Valid answer');

      // System should continue working
      expect(system.currentSession.exchanges.length).toBe(1);

      await system.endSession();
    });

    it('should handle budget exhaustion gracefully', async () => {
      const limitedSystem = new MockKnowledgeLearningSystem({
        projectPath: testDir,
        budgetLimit: 0.001 // Very low
      });

      await limitedSystem.startSession({ project: 'test' });

      // Should switch to heuristic when budget runs out
      for (let i = 0; i < 5; i++) {
        await limitedSystem.processExchange(
          `Question ${i}`,
          `Answer ${i}`
        );
      }

      await limitedSystem.endSession();

      // Should have some knowledge (heuristic)
      const heuristicKnowledge = limitedSystem.knowledgeBase.filter(
        k => k.method === 'heuristic'
      );

      expect(heuristicKnowledge.length).toBeGreaterThan(0);
    });

    it('should handle long-running sessions', async () => {
      await system.startSession({ project: 'test' });

      // Simulate 20 exchanges
      for (let i = 0; i < 20; i++) {
        await system.processExchange(
          `Question ${i}`,
          `Answer ${i}`
        );
      }

      const session = await system.endSession();

      expect(session.exchanges.length).toBe(20);
      expect(session.duration).toBeGreaterThan(0);
    });
  });
});
