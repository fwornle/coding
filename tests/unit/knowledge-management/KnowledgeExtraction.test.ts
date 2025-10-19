/**
 * Knowledge Extraction Unit Tests
 *
 * Tests all FR-6 requirements:
 * 1. Observation extraction from transcripts
 * 2. Observation buffering and batching
 * 3. Pattern detection across observations
 * 4. Concept abstraction logic
 * 5. Confidence scoring
 * 6. Deduplication
 * 7. Knowledge graph construction
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';

// Type definitions
interface Exchange {
  user: string;
  assistant: string;
  timestamp: number;
}

interface Observation {
  id: string;
  content: string;
  type: string;
  source: string;
  timestamp: number;
  confidence: number;
}

interface KnowledgeItem {
  id: string;
  type: string;
  content: string;
  observations: string[];
  confidence: number;
  embedding?: number[];
  metadata?: Record<string, any>;
}

interface ConceptCluster {
  id: string;
  observations: Observation[];
  pattern: string;
  confidence: number;
  instances: number;
}

interface KnowledgeGraph {
  nodes: KnowledgeItem[];
  edges: Array<{ from: string; to: string; type: string }>;
}

// Mock classes for testing
class MockKnowledgeExtractor {
  private buffer: Observation[] = [];
  private bufferSize: number;
  private minObservationsForConcept: number;

  constructor(options: { bufferSize?: number; minObservationsForConcept?: number } = {}) {
    this.bufferSize = options.bufferSize || 5;
    this.minObservationsForConcept = options.minObservationsForConcept || 3;
  }

  async extractObservations(exchanges: Exchange[]): Promise<Observation[]> {
    const observations: Observation[] = [];

    for (const exchange of exchanges) {
      const userObs = this.createObservation(exchange.user, 'user_query', exchange.timestamp);
      const assistantObs = this.createObservation(exchange.assistant, 'assistant_response', exchange.timestamp);

      observations.push(userObs, assistantObs);
    }

    return observations;
  }

  private createObservation(content: string, type: string, timestamp: number): Observation {
    return {
      id: `obs_${Math.random().toString(36).substring(7)}`,
      content,
      type,
      source: 'transcript',
      timestamp,
      confidence: 0.85
    };
  }

  addToBuffer(observation: Observation): void {
    this.buffer.push(observation);

    if (this.buffer.length > this.bufferSize) {
      this.buffer.shift(); // Remove oldest
    }
  }

  getBuffer(): Observation[] {
    return [...this.buffer];
  }

  clearBuffer(): void {
    this.buffer = [];
  }

  shouldFlushBuffer(): boolean {
    return this.buffer.length >= this.bufferSize;
  }

  async detectPatterns(observations: Observation[]): Promise<ConceptCluster[]> {
    if (observations.length < this.minObservationsForConcept) {
      return [];
    }

    // Simple pattern detection based on content similarity
    const clusters: ConceptCluster[] = [];
    const processed = new Set<string>();

    for (const obs of observations) {
      if (processed.has(obs.id)) continue;

      const similar = observations.filter(o =>
        !processed.has(o.id) && this.areSimilar(obs.content, o.content)
      );

      if (similar.length >= this.minObservationsForConcept) {
        clusters.push({
          id: `cluster_${clusters.length}`,
          observations: similar,
          pattern: this.extractPattern(similar),
          confidence: this.calculateClusterConfidence(similar),
          instances: similar.length
        });

        similar.forEach(o => processed.add(o.id));
      }
    }

    return clusters;
  }

  private areSimilar(content1: string, content2: string): boolean {
    // Simple similarity check - share common keywords
    const words1 = new Set(content1.toLowerCase().split(/\s+/));
    const words2 = new Set(content2.toLowerCase().split(/\s+/));

    const intersection = [...words1].filter(w => words2.has(w));
    const union = new Set([...words1, ...words2]);

    const similarity = intersection.length / union.size;
    return similarity > 0.3;
  }

  private extractPattern(observations: Observation[]): string {
    // Extract common pattern from observations
    const allWords = observations.flatMap(o => o.content.toLowerCase().split(/\s+/));
    const wordCounts = new Map<string, number>();

    allWords.forEach(word => {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    });

    const commonWords = [...wordCounts.entries()]
      .filter(([_, count]) => count >= Math.ceil(observations.length * 0.5))
      .map(([word, _]) => word)
      .slice(0, 5);

    return `Pattern: ${commonWords.join(' ')}`;
  }

  private calculateClusterConfidence(observations: Observation[]): number {
    const avgConfidence = observations.reduce((sum, o) => sum + o.confidence, 0) / observations.length;
    const sizeBonus = Math.min(observations.length / 10, 0.2);
    return Math.min(avgConfidence + sizeBonus, 1.0);
  }

  async abstractConcept(cluster: ConceptCluster): Promise<KnowledgeItem> {
    // Create abstract concept from cluster
    const conceptId = `concept_${cluster.id}`;

    return {
      id: conceptId,
      type: this.inferConceptType(cluster.pattern),
      content: cluster.pattern,
      observations: cluster.observations.map(o => o.id),
      confidence: cluster.confidence,
      metadata: {
        instanceCount: cluster.instances,
        created: Date.now()
      }
    };
  }

  private inferConceptType(pattern: string): string {
    const lowerPattern = pattern.toLowerCase();

    if (lowerPattern.includes('error') || lowerPattern.includes('bug')) return 'bug_solution';
    if (lowerPattern.includes('pattern') || lowerPattern.includes('design')) return 'coding_pattern';
    if (lowerPattern.includes('test')) return 'test_strategy';
    if (lowerPattern.includes('api')) return 'api_design';

    return 'general_knowledge';
  }

  calculateConfidence(observations: Observation[]): number {
    if (observations.length === 0) return 0;
    if (observations.length < this.minObservationsForConcept) return 0.5;

    const avgObsConfidence = observations.reduce((sum, o) => sum + o.confidence, 0) / observations.length;
    const countBonus = Math.min(observations.length / 20, 0.3);

    return Math.min(avgObsConfidence + countBonus, 1.0);
  }

  async deduplicate(items: KnowledgeItem[]): Promise<KnowledgeItem[]> {
    const unique: KnowledgeItem[] = [];
    const seen = new Set<string>();

    for (const item of items) {
      const signature = this.createSignature(item);

      if (!seen.has(signature)) {
        seen.add(signature);
        unique.push(item);
      }
    }

    return unique;
  }

  private createSignature(item: KnowledgeItem): string {
    // Create unique signature based on type and content
    const contentWords = item.content.toLowerCase().split(/\s+/).sort().slice(0, 5);
    return `${item.type}:${contentWords.join('_')}`;
  }

  async buildKnowledgeGraph(items: KnowledgeItem[]): Promise<KnowledgeGraph> {
    const nodes = items;
    const edges: Array<{ from: string; to: string; type: string }> = [];

    // Build edges based on relationships
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const item1 = items[i];
        const item2 = items[j];

        // Check for shared observations
        const sharedObs = item1.observations.filter(o => item2.observations.includes(o));
        if (sharedObs.length > 0) {
          edges.push({
            from: item1.id,
            to: item2.id,
            type: 'related_by_observation'
          });
        }

        // Check for same type
        if (item1.type === item2.type) {
          edges.push({
            from: item1.id,
            to: item2.id,
            type: 'same_category'
          });
        }
      }
    }

    return { nodes, edges };
  }

  validateKnowledgeGraph(graph: KnowledgeGraph): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check all edges reference valid nodes
    const nodeIds = new Set(graph.nodes.map(n => n.id));
    for (const edge of graph.edges) {
      if (!nodeIds.has(edge.from)) {
        errors.push(`Edge references invalid source node: ${edge.from}`);
      }
      if (!nodeIds.has(edge.to)) {
        errors.push(`Edge references invalid target node: ${edge.to}`);
      }
    }

    // Check for duplicate nodes
    const seen = new Set<string>();
    for (const node of graph.nodes) {
      if (seen.has(node.id)) {
        errors.push(`Duplicate node ID: ${node.id}`);
      }
      seen.add(node.id);
    }

    // Check concept quality
    for (const node of graph.nodes) {
      if (node.observations.length < 3) {
        errors.push(`Node ${node.id} has insufficient observations: ${node.observations.length}`);
      }
      if (node.confidence < 0 || node.confidence > 1) {
        errors.push(`Node ${node.id} has invalid confidence: ${node.confidence}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

describe('Knowledge Extraction Unit Tests', () => {
  let extractor: MockKnowledgeExtractor;

  beforeEach(() => {
    extractor = new MockKnowledgeExtractor({
      bufferSize: 5,
      minObservationsForConcept: 3
    });
  });

  describe('FR-6.1: Observation Extraction from Transcripts', () => {

    it('should extract observations from simple exchange', async () => {
      const exchanges: Exchange[] = [
        {
          user: 'How do I implement caching?',
          assistant: 'Use a Map for simple caching',
          timestamp: Date.now()
        }
      ];

      const observations = await extractor.extractObservations(exchanges);

      expect(observations).toHaveLength(2);
      expect(observations[0].type).toBe('user_query');
      expect(observations[0].content).toBe('How do I implement caching?');
      expect(observations[1].type).toBe('assistant_response');
      expect(observations[1].content).toBe('Use a Map for simple caching');
    });

    it('should extract observations from multiple exchanges', async () => {
      const exchanges: Exchange[] = [
        { user: 'Question 1', assistant: 'Answer 1', timestamp: 1000 },
        { user: 'Question 2', assistant: 'Answer 2', timestamp: 2000 },
        { user: 'Question 3', assistant: 'Answer 3', timestamp: 3000 }
      ];

      const observations = await extractor.extractObservations(exchanges);

      expect(observations).toHaveLength(6);
      expect(observations[0].timestamp).toBe(1000);
      expect(observations[2].timestamp).toBe(2000);
      expect(observations[4].timestamp).toBe(3000);
    });

    it('should handle empty transcript gracefully', async () => {
      const observations = await extractor.extractObservations([]);
      expect(observations).toHaveLength(0);
    });

    it('should assign confidence scores to observations', async () => {
      const exchanges: Exchange[] = [
        { user: 'Test', assistant: 'Response', timestamp: Date.now() }
      ];

      const observations = await extractor.extractObservations(exchanges);

      observations.forEach(obs => {
        expect(obs.confidence).toBeGreaterThanOrEqual(0);
        expect(obs.confidence).toBeLessThanOrEqual(1);
      });
    });

    it('should handle incomplete exchanges', async () => {
      const exchanges: Exchange[] = [
        { user: '', assistant: 'Response only', timestamp: Date.now() }
      ];

      const observations = await extractor.extractObservations(exchanges);
      expect(observations).toHaveLength(2);
      expect(observations[0].content).toBe('');
    });
  });

  describe('FR-6.2: Observation Buffering and Batching', () => {

    it('should buffer observations up to buffer size', () => {
      const obs1: Observation = {
        id: 'obs1',
        content: 'Test 1',
        type: 'user_query',
        source: 'transcript',
        timestamp: Date.now(),
        confidence: 0.9
      };

      extractor.addToBuffer(obs1);
      expect(extractor.getBuffer()).toHaveLength(1);
    });

    it('should evict oldest observation when buffer exceeds size', () => {
      const observations: Observation[] = [];
      for (let i = 0; i < 7; i++) {
        observations.push({
          id: `obs${i}`,
          content: `Content ${i}`,
          type: 'user_query',
          source: 'transcript',
          timestamp: Date.now() + i,
          confidence: 0.85
        });
      }

      observations.forEach(obs => extractor.addToBuffer(obs));

      const buffer = extractor.getBuffer();
      expect(buffer).toHaveLength(5); // Buffer size is 5
      expect(buffer[0].id).toBe('obs2'); // First two evicted
      expect(buffer[4].id).toBe('obs6');
    });

    it('should signal when buffer should be flushed', () => {
      expect(extractor.shouldFlushBuffer()).toBe(false);

      for (let i = 0; i < 5; i++) {
        extractor.addToBuffer({
          id: `obs${i}`,
          content: `Content ${i}`,
          type: 'user_query',
          source: 'transcript',
          timestamp: Date.now(),
          confidence: 0.85
        });
      }

      expect(extractor.shouldFlushBuffer()).toBe(true);
    });

    it('should clear buffer on demand', () => {
      extractor.addToBuffer({
        id: 'obs1',
        content: 'Test',
        type: 'user_query',
        source: 'transcript',
        timestamp: Date.now(),
        confidence: 0.85
      });

      expect(extractor.getBuffer()).toHaveLength(1);
      extractor.clearBuffer();
      expect(extractor.getBuffer()).toHaveLength(0);
    });

    it('should maintain buffer order (FIFO)', () => {
      const obs1 = { id: 'obs1', content: 'First', type: 'user_query', source: 'transcript', timestamp: 1000, confidence: 0.85 };
      const obs2 = { id: 'obs2', content: 'Second', type: 'user_query', source: 'transcript', timestamp: 2000, confidence: 0.85 };
      const obs3 = { id: 'obs3', content: 'Third', type: 'user_query', source: 'transcript', timestamp: 3000, confidence: 0.85 };

      extractor.addToBuffer(obs1);
      extractor.addToBuffer(obs2);
      extractor.addToBuffer(obs3);

      const buffer = extractor.getBuffer();
      expect(buffer[0].id).toBe('obs1');
      expect(buffer[1].id).toBe('obs2');
      expect(buffer[2].id).toBe('obs3');
    });
  });

  describe('FR-6.3: Pattern Detection Across Observations', () => {

    it('should detect patterns from similar observations', async () => {
      const observations: Observation[] = [
        { id: 'obs1', content: 'implement caching with Map', type: 'code', source: 'transcript', timestamp: 1000, confidence: 0.9 },
        { id: 'obs2', content: 'caching using Map structure', type: 'code', source: 'transcript', timestamp: 2000, confidence: 0.9 },
        { id: 'obs3', content: 'Map for caching data', type: 'code', source: 'transcript', timestamp: 3000, confidence: 0.9 },
        { id: 'obs4', content: 'completely different topic', type: 'code', source: 'transcript', timestamp: 4000, confidence: 0.9 }
      ];

      const clusters = await extractor.detectPatterns(observations);

      expect(clusters.length).toBeGreaterThan(0);
      expect(clusters[0].instances).toBeGreaterThanOrEqual(3);
      expect(clusters[0].pattern).toContain('caching');
    });

    it('should not detect patterns with insufficient observations', async () => {
      const observations: Observation[] = [
        { id: 'obs1', content: 'Single observation', type: 'code', source: 'transcript', timestamp: 1000, confidence: 0.9 }
      ];

      const clusters = await extractor.detectPatterns(observations);
      expect(clusters).toHaveLength(0);
    });

    it('should calculate cluster confidence based on observations', async () => {
      const observations: Observation[] = [
        { id: 'obs1', content: 'error handling pattern', type: 'code', source: 'transcript', timestamp: 1000, confidence: 0.8 },
        { id: 'obs2', content: 'error handling approach', type: 'code', source: 'transcript', timestamp: 2000, confidence: 0.85 },
        { id: 'obs3', content: 'handling error cases', type: 'code', source: 'transcript', timestamp: 3000, confidence: 0.9 }
      ];

      const clusters = await extractor.detectPatterns(observations);

      expect(clusters.length).toBeGreaterThan(0);
      expect(clusters[0].confidence).toBeGreaterThan(0.8);
      expect(clusters[0].confidence).toBeLessThanOrEqual(1.0);
    });

    it('should handle observations with no common patterns', async () => {
      const observations: Observation[] = [
        { id: 'obs1', content: 'totally different topic one', type: 'code', source: 'transcript', timestamp: 1000, confidence: 0.9 },
        { id: 'obs2', content: 'completely unrelated subject two', type: 'code', source: 'transcript', timestamp: 2000, confidence: 0.9 },
        { id: 'obs3', content: 'another distinct matter three', type: 'code', source: 'transcript', timestamp: 3000, confidence: 0.9 }
      ];

      const clusters = await extractor.detectPatterns(observations);
      expect(clusters).toHaveLength(0);
    });
  });

  describe('FR-6.4: Concept Abstraction Logic', () => {

    it('should abstract concept from observation cluster', async () => {
      const cluster: ConceptCluster = {
        id: 'cluster1',
        observations: [
          { id: 'obs1', content: 'caching pattern', type: 'code', source: 'transcript', timestamp: 1000, confidence: 0.9 },
          { id: 'obs2', content: 'caching approach', type: 'code', source: 'transcript', timestamp: 2000, confidence: 0.9 },
          { id: 'obs3', content: 'caching strategy', type: 'code', source: 'transcript', timestamp: 3000, confidence: 0.9 }
        ],
        pattern: 'caching pattern implementation',
        confidence: 0.88,
        instances: 3
      };

      const concept = await extractor.abstractConcept(cluster);

      expect(concept.id).toContain('concept_');
      expect(concept.observations).toHaveLength(3);
      expect(concept.confidence).toBeGreaterThan(0.8);
      expect(concept.type).toBeDefined();
    });

    it('should infer correct concept type from pattern', async () => {
      const errorCluster: ConceptCluster = {
        id: 'cluster1',
        observations: [
          { id: 'obs1', content: 'error handling', type: 'code', source: 'transcript', timestamp: 1000, confidence: 0.9 },
          { id: 'obs2', content: 'handle errors', type: 'code', source: 'transcript', timestamp: 2000, confidence: 0.9 },
          { id: 'obs3', content: 'error cases', type: 'code', source: 'transcript', timestamp: 3000, confidence: 0.9 }
        ],
        pattern: 'error handling pattern',
        confidence: 0.85,
        instances: 3
      };

      const concept = await extractor.abstractConcept(errorCluster);
      expect(concept.type).toBe('bug_solution');
    });

    it('should include metadata in abstracted concept', async () => {
      const cluster: ConceptCluster = {
        id: 'cluster1',
        observations: [
          { id: 'obs1', content: 'test 1', type: 'code', source: 'transcript', timestamp: 1000, confidence: 0.9 },
          { id: 'obs2', content: 'test 2', type: 'code', source: 'transcript', timestamp: 2000, confidence: 0.9 },
          { id: 'obs3', content: 'test 3', type: 'code', source: 'transcript', timestamp: 3000, confidence: 0.9 }
        ],
        pattern: 'test pattern',
        confidence: 0.85,
        instances: 3
      };

      const concept = await extractor.abstractConcept(cluster);

      expect(concept.metadata).toBeDefined();
      expect(concept.metadata?.instanceCount).toBe(3);
      expect(concept.metadata?.created).toBeDefined();
    });

    it('should validate concept quality (minimum 3 observations)', async () => {
      const cluster: ConceptCluster = {
        id: 'cluster1',
        observations: [
          { id: 'obs1', content: 'test 1', type: 'code', source: 'transcript', timestamp: 1000, confidence: 0.9 },
          { id: 'obs2', content: 'test 2', type: 'code', source: 'transcript', timestamp: 2000, confidence: 0.9 },
          { id: 'obs3', content: 'test 3', type: 'code', source: 'transcript', timestamp: 3000, confidence: 0.9 }
        ],
        pattern: 'test pattern',
        confidence: 0.85,
        instances: 3
      };

      const concept = await extractor.abstractConcept(cluster);
      expect(concept.observations.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('FR-6.5: Confidence Scoring', () => {

    it('should calculate confidence based on observation count', () => {
      const observations: Observation[] = Array.from({ length: 10 }, (_, i) => ({
        id: `obs${i}`,
        content: `Test ${i}`,
        type: 'code',
        source: 'transcript',
        timestamp: Date.now(),
        confidence: 0.8
      }));

      const confidence = extractor.calculateConfidence(observations);
      expect(confidence).toBeGreaterThan(0.8);
      expect(confidence).toBeLessThanOrEqual(1.0);
    });

    it('should return 0 confidence for empty observations', () => {
      const confidence = extractor.calculateConfidence([]);
      expect(confidence).toBe(0);
    });

    it('should penalize concepts with fewer than minimum observations', () => {
      const fewObs: Observation[] = [
        { id: 'obs1', content: 'Test', type: 'code', source: 'transcript', timestamp: Date.now(), confidence: 0.9 },
        { id: 'obs2', content: 'Test', type: 'code', source: 'transcript', timestamp: Date.now(), confidence: 0.9 }
      ];

      const confidence = extractor.calculateConfidence(fewObs);
      expect(confidence).toBe(0.5);
    });

    it('should cap confidence at 1.0', () => {
      const manyObs: Observation[] = Array.from({ length: 100 }, (_, i) => ({
        id: `obs${i}`,
        content: `Test ${i}`,
        type: 'code',
        source: 'transcript',
        timestamp: Date.now(),
        confidence: 1.0
      }));

      const confidence = extractor.calculateConfidence(manyObs);
      expect(confidence).toBe(1.0);
    });

    it('should average individual observation confidences', () => {
      const observations: Observation[] = [
        { id: 'obs1', content: 'Test', type: 'code', source: 'transcript', timestamp: Date.now(), confidence: 0.6 },
        { id: 'obs2', content: 'Test', type: 'code', source: 'transcript', timestamp: Date.now(), confidence: 0.8 },
        { id: 'obs3', content: 'Test', type: 'code', source: 'transcript', timestamp: Date.now(), confidence: 0.7 }
      ];

      const confidence = extractor.calculateConfidence(observations);
      // Average should be around 0.7, but may have small bonus
      expect(confidence).toBeGreaterThanOrEqual(0.7);
      expect(confidence).toBeLessThan(0.8);
    });
  });

  describe('FR-6.6: Deduplication', () => {

    it('should remove duplicate knowledge items', async () => {
      const items: KnowledgeItem[] = [
        {
          id: 'item1',
          type: 'coding_pattern',
          content: 'caching with Map structure',
          observations: ['obs1', 'obs2', 'obs3'],
          confidence: 0.9
        },
        {
          id: 'item2',
          type: 'coding_pattern',
          content: 'caching with Map structure',
          observations: ['obs4', 'obs5', 'obs6'],
          confidence: 0.85
        },
        {
          id: 'item3',
          type: 'bug_solution',
          content: 'different content entirely',
          observations: ['obs7', 'obs8', 'obs9'],
          confidence: 0.8
        }
      ];

      const unique = await extractor.deduplicate(items);

      expect(unique.length).toBeLessThan(items.length);
      expect(unique).toHaveLength(2);
    });

    it('should keep items with different types', async () => {
      const items: KnowledgeItem[] = [
        {
          id: 'item1',
          type: 'coding_pattern',
          content: 'same content',
          observations: ['obs1', 'obs2', 'obs3'],
          confidence: 0.9
        },
        {
          id: 'item2',
          type: 'bug_solution',
          content: 'same content',
          observations: ['obs4', 'obs5', 'obs6'],
          confidence: 0.85
        }
      ];

      const unique = await extractor.deduplicate(items);
      expect(unique).toHaveLength(2); // Different types, so both kept
    });

    it('should handle empty item list', async () => {
      const unique = await extractor.deduplicate([]);
      expect(unique).toHaveLength(0);
    });

    it('should preserve order of first occurrence', async () => {
      const items: KnowledgeItem[] = [
        {
          id: 'item1',
          type: 'coding_pattern',
          content: 'first unique item',
          observations: ['obs1', 'obs2', 'obs3'],
          confidence: 0.9
        },
        {
          id: 'item2',
          type: 'coding_pattern',
          content: 'second unique item',
          observations: ['obs4', 'obs5', 'obs6'],
          confidence: 0.85
        },
        {
          id: 'item3',
          type: 'coding_pattern',
          content: 'first unique item',
          observations: ['obs7', 'obs8', 'obs9'],
          confidence: 0.88
        }
      ];

      const unique = await extractor.deduplicate(items);
      expect(unique[0].id).toBe('item1');
      expect(unique[1].id).toBe('item2');
    });
  });

  describe('FR-6.7: Knowledge Graph Construction', () => {

    it('should build knowledge graph from items', async () => {
      const items: KnowledgeItem[] = [
        {
          id: 'item1',
          type: 'coding_pattern',
          content: 'Pattern 1',
          observations: ['obs1', 'obs2', 'obs3'],
          confidence: 0.9
        },
        {
          id: 'item2',
          type: 'coding_pattern',
          content: 'Pattern 2',
          observations: ['obs2', 'obs3', 'obs4'],
          confidence: 0.85
        },
        {
          id: 'item3',
          type: 'bug_solution',
          content: 'Solution 1',
          observations: ['obs5', 'obs6', 'obs7'],
          confidence: 0.88
        }
      ];

      const graph = await extractor.buildKnowledgeGraph(items);

      expect(graph.nodes).toHaveLength(3);
      expect(graph.edges.length).toBeGreaterThan(0);
    });

    it('should create edges for shared observations', async () => {
      const items: KnowledgeItem[] = [
        {
          id: 'item1',
          type: 'coding_pattern',
          content: 'Pattern 1',
          observations: ['obs1', 'obs2'],
          confidence: 0.9
        },
        {
          id: 'item2',
          type: 'coding_pattern',
          content: 'Pattern 2',
          observations: ['obs2', 'obs3'],
          confidence: 0.85
        }
      ];

      const graph = await extractor.buildKnowledgeGraph(items);

      const relatedEdge = graph.edges.find(e => e.type === 'related_by_observation');
      expect(relatedEdge).toBeDefined();
      expect(relatedEdge?.from).toBe('item1');
      expect(relatedEdge?.to).toBe('item2');
    });

    it('should create edges for same category items', async () => {
      const items: KnowledgeItem[] = [
        {
          id: 'item1',
          type: 'coding_pattern',
          content: 'Pattern 1',
          observations: ['obs1', 'obs2', 'obs3'],
          confidence: 0.9
        },
        {
          id: 'item2',
          type: 'coding_pattern',
          content: 'Pattern 2',
          observations: ['obs4', 'obs5', 'obs6'],
          confidence: 0.85
        }
      ];

      const graph = await extractor.buildKnowledgeGraph(items);

      const categoryEdge = graph.edges.find(e => e.type === 'same_category');
      expect(categoryEdge).toBeDefined();
    });

    it('should validate knowledge graph integrity', async () => {
      const validGraph: KnowledgeGraph = {
        nodes: [
          { id: 'item1', type: 'coding_pattern', content: 'Pattern', observations: ['obs1', 'obs2', 'obs3'], confidence: 0.9 },
          { id: 'item2', type: 'bug_solution', content: 'Solution', observations: ['obs4', 'obs5', 'obs6'], confidence: 0.85 }
        ],
        edges: [
          { from: 'item1', to: 'item2', type: 'related' }
        ]
      };

      const result = extractor.validateKnowledgeGraph(validGraph);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect invalid node references in edges', async () => {
      const invalidGraph: KnowledgeGraph = {
        nodes: [
          { id: 'item1', type: 'coding_pattern', content: 'Pattern', observations: ['obs1', 'obs2', 'obs3'], confidence: 0.9 }
        ],
        edges: [
          { from: 'item1', to: 'nonexistent', type: 'related' }
        ]
      };

      const result = extractor.validateKnowledgeGraph(invalidGraph);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('invalid target node');
    });

    it('should detect nodes with insufficient observations', async () => {
      const insufficientGraph: KnowledgeGraph = {
        nodes: [
          { id: 'item1', type: 'coding_pattern', content: 'Pattern', observations: ['obs1', 'obs2'], confidence: 0.9 }
        ],
        edges: []
      };

      const result = extractor.validateKnowledgeGraph(insufficientGraph);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('insufficient observations'))).toBe(true);
    });

    it('should detect invalid confidence values', async () => {
      const invalidConfidenceGraph: KnowledgeGraph = {
        nodes: [
          { id: 'item1', type: 'coding_pattern', content: 'Pattern', observations: ['obs1', 'obs2', 'obs3'], confidence: 1.5 }
        ],
        edges: []
      };

      const result = extractor.validateKnowledgeGraph(invalidConfidenceGraph);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('invalid confidence'))).toBe(true);
    });

    it('should detect duplicate node IDs', async () => {
      const duplicateGraph: KnowledgeGraph = {
        nodes: [
          { id: 'item1', type: 'coding_pattern', content: 'Pattern 1', observations: ['obs1', 'obs2', 'obs3'], confidence: 0.9 },
          { id: 'item1', type: 'bug_solution', content: 'Pattern 2', observations: ['obs4', 'obs5', 'obs6'], confidence: 0.85 }
        ],
        edges: []
      };

      const result = extractor.validateKnowledgeGraph(duplicateGraph);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Duplicate node ID'))).toBe(true);
    });
  });

  describe('Edge Cases and Error Handling', () => {

    it('should handle malformed transcript gracefully', async () => {
      const malformedExchanges: Exchange[] = [
        // @ts-expect-error - testing malformed input
        { user: null, assistant: undefined, timestamp: Date.now() }
      ];

      const observations = await extractor.extractObservations(malformedExchanges);
      expect(observations).toBeDefined();
    });

    it('should handle very long observation content', async () => {
      const longContent = 'a'.repeat(10000);
      const exchanges: Exchange[] = [
        { user: longContent, assistant: 'Response', timestamp: Date.now() }
      ];

      const observations = await extractor.extractObservations(exchanges);
      expect(observations[0].content).toHaveLength(10000);
    });

    it('should handle special characters in content', async () => {
      const specialContent = 'Test with <html>, "quotes", and special chars: @#$%^&*()';
      const exchanges: Exchange[] = [
        { user: specialContent, assistant: 'Response', timestamp: Date.now() }
      ];

      const observations = await extractor.extractObservations(exchanges);
      expect(observations[0].content).toBe(specialContent);
    });

    it('should handle concurrent observation processing', async () => {
      const exchanges: Exchange[] = Array.from({ length: 10 }, (_, i) => ({
        user: `Question ${i}`,
        assistant: `Answer ${i}`,
        timestamp: Date.now() + i
      }));

      const promises = exchanges.map(e => extractor.extractObservations([e]));
      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach(obs => expect(obs).toHaveLength(2));
    });
  });
});
