/**
 * ConceptAbstractionAgent
 *
 * Generalizes specific knowledge instances into abstract, reusable concepts.
 * Analyzes multiple knowledge items to identify common patterns and principles.
 *
 * Key Features:
 * - Pattern synthesis: Combine similar knowledge into abstract patterns
 * - Concept hierarchy: Build hierarchical concept relationships
 * - Abstraction levels: Generate concepts at multiple abstraction levels
 * - Cross-project generalization: Identify patterns across projects
 * - Confidence scoring: Track abstraction reliability
 * - Bidirectional linking: Link abstract concepts to concrete instances
 *
 * Abstraction Process:
 * 1. Cluster similar knowledge items (semantic similarity)
 * 2. Identify common themes and patterns
 * 3. Generate abstract concept description
 * 4. Create hierarchical relationships (is-a, part-of)
 * 5. Store abstract concept with references to instances
 *
 * Abstraction Levels:
 * - Level 0: Concrete instances (specific implementations)
 * - Level 1: Tactical patterns (reusable within similar contexts)
 * - Level 2: Strategic patterns (applicable across multiple contexts)
 * - Level 3: Principles (universal design principles)
 *
 * Usage:
 * ```javascript
 * const agent = new ConceptAbstractionAgent({
 *   databaseManager,
 *   embeddingGenerator,
 *   inferenceEngine,
 *   knowledgeRetriever
 * });
 *
 * await agent.initialize();
 *
 * // Generate abstractions from knowledge base
 * const abstractions = await agent.generateAbstractions({
 *   minClusterSize: 3,
 *   maxAbstractionLevel: 2
 * });
 *
 * // Get abstract concept for specific knowledge
 * const concept = await agent.getAbstractConcept(knowledgeId);
 * ```
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';

// Abstraction levels
const ABSTRACTION_LEVELS = {
  CONCRETE: 0,      // Specific implementations
  TACTICAL: 1,      // Reusable within similar contexts
  STRATEGIC: 2,     // Applicable across multiple contexts
  PRINCIPLE: 3      // Universal design principles
};

// Clustering configuration
const CLUSTERING_CONFIG = {
  MIN_SIMILARITY: 0.7,        // Minimum similarity for clustering
  MIN_CLUSTER_SIZE: 3,        // Minimum instances to form concept
  MAX_CLUSTER_SIZE: 20,       // Maximum instances per concept
  MERGE_THRESHOLD: 0.85       // Similarity to merge clusters
};

export class ConceptAbstractionAgent extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = config;
    this.initialized = false;

    // Required dependencies
    this.databaseManager = config.databaseManager;
    this.embeddingGenerator = config.embeddingGenerator;
    this.inferenceEngine = config.inferenceEngine;
    this.knowledgeRetriever = config.knowledgeRetriever;

    if (!this.databaseManager || !this.embeddingGenerator || !this.inferenceEngine) {
      throw new Error('ConceptAbstractionAgent requires databaseManager, embeddingGenerator, and inferenceEngine');
    }

    // Abstraction configuration
    this.minSimilarity = config.minSimilarity || CLUSTERING_CONFIG.MIN_SIMILARITY;
    this.minClusterSize = config.minClusterSize || CLUSTERING_CONFIG.MIN_CLUSTER_SIZE;
    this.maxClusterSize = config.maxClusterSize || CLUSTERING_CONFIG.MAX_CLUSTER_SIZE;
    this.mergeThreshold = config.mergeThreshold || CLUSTERING_CONFIG.MERGE_THRESHOLD;

    // Statistics
    this.stats = {
      abstractionsGenerated: 0,
      conceptsClustered: 0,
      instancesAbstracted: 0,
      byLevel: {
        [ABSTRACTION_LEVELS.CONCRETE]: 0,
        [ABSTRACTION_LEVELS.TACTICAL]: 0,
        [ABSTRACTION_LEVELS.STRATEGIC]: 0,
        [ABSTRACTION_LEVELS.PRINCIPLE]: 0
      }
    };
  }

  /**
   * Initialize agent
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    console.log('[ConceptAbstractionAgent] Initializing...');

    // Verify dependencies
    if (!this.databaseManager.initialized) {
      await this.databaseManager.initialize();
    }

    if (!this.embeddingGenerator.initialized) {
      await this.embeddingGenerator.initialize();
    }

    this.initialized = true;
    this.emit('initialized');
    console.log('[ConceptAbstractionAgent] Initialized');
  }

  /**
   * Generate abstractions from knowledge base
   *
   * @param {object} options - Generation options
   * @returns {Promise<Array>} Abstract concepts
   */
  async generateAbstractions(options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    const {
      minClusterSize = this.minClusterSize,
      maxAbstractionLevel = ABSTRACTION_LEVELS.STRATEGIC,
      knowledgeTypes = null, // Filter by type
      projectPath = null      // Filter by project
    } = options;

    console.log('[ConceptAbstractionAgent] Generating abstractions...');

    try {
      // 1. Fetch all knowledge items
      const knowledge = await this.fetchKnowledge({
        types: knowledgeTypes,
        project: projectPath
      });

      console.log(`[ConceptAbstractionAgent] Fetched ${knowledge.length} knowledge items`);

      if (knowledge.length < minClusterSize) {
        console.log('[ConceptAbstractionAgent] Insufficient knowledge for clustering');
        return [];
      }

      // 2. Cluster similar knowledge
      const clusters = await this.clusterKnowledge(knowledge, {
        minClusterSize
      });

      console.log(`[ConceptAbstractionAgent] Found ${clusters.length} clusters`);

      // 3. Generate abstract concepts for each cluster
      const abstractions = [];
      for (const cluster of clusters) {
        const abstraction = await this.generateAbstraction(cluster, {
          maxLevel: maxAbstractionLevel
        });

        if (abstraction) {
          abstractions.push(abstraction);
        }
      }

      console.log(`[ConceptAbstractionAgent] Generated ${abstractions.length} abstractions`);

      // 4. Build hierarchical relationships
      const hierarchy = await this.buildHierarchy(abstractions);

      // 5. Store abstractions
      for (const abstraction of abstractions) {
        await this.storeAbstraction(abstraction);
      }

      this.stats.abstractionsGenerated += abstractions.length;
      this.emit('abstractions-generated', { count: abstractions.length });

      return abstractions;
    } catch (error) {
      console.error('[ConceptAbstractionAgent] Abstraction generation failed:', error);
      return [];
    }
  }

  /**
   * Fetch knowledge from database
   */
  async fetchKnowledge(filters = {}) {
    const { types = null, project = null } = filters;

    // Build filter
    const filter = { must: [] };

    if (types && types.length > 0) {
      filter.must.push({
        key: 'type',
        match: { any: types }
      });
    }

    if (project) {
      filter.must.push({
        key: 'project',
        match: { value: project }
      });
    }

    // Fetch from Qdrant
    const results = await this.databaseManager.searchVectors(
      'knowledge_patterns',
      null, // No query vector, just filter
      {
        limit: 1000, // Fetch up to 1000 items
        filter: filter.must.length > 0 ? filter : undefined,
        includePayload: true
      }
    );

    return results.map(result => ({
      id: result.id,
      ...result.payload
    }));
  }

  /**
   * Cluster knowledge by semantic similarity
   */
  async clusterKnowledge(knowledge, options = {}) {
    const { minClusterSize = this.minClusterSize } = options;

    console.log('[ConceptAbstractionAgent] Clustering knowledge...');

    // Simple agglomerative clustering
    const clusters = [];
    const assigned = new Set();

    for (let i = 0; i < knowledge.length; i++) {
      if (assigned.has(knowledge[i].id)) continue;

      const cluster = [knowledge[i]];
      assigned.add(knowledge[i].id);

      // Find similar items
      for (let j = i + 1; j < knowledge.length; j++) {
        if (assigned.has(knowledge[j].id)) continue;
        if (cluster.length >= this.maxClusterSize) break;

        const similarity = await this.calculateSimilarity(
          knowledge[i].text,
          knowledge[j].text
        );

        if (similarity >= this.minSimilarity) {
          cluster.push(knowledge[j]);
          assigned.add(knowledge[j].id);
        }
      }

      // Only keep clusters above minimum size
      if (cluster.length >= minClusterSize) {
        clusters.push(cluster);
        this.stats.conceptsClustered++;
      }
    }

    return clusters;
  }

  /**
   * Calculate semantic similarity between two texts
   */
  async calculateSimilarity(text1, text2) {
    try {
      // Generate embeddings
      const [emb1, emb2] = await Promise.all([
        this.embeddingGenerator.generate(text1, { vectorSize: 384 }),
        this.embeddingGenerator.generate(text2, { vectorSize: 384 })
      ]);

      // Cosine similarity
      let dotProduct = 0;
      let norm1 = 0;
      let norm2 = 0;

      for (let i = 0; i < emb1.length; i++) {
        dotProduct += emb1[i] * emb2[i];
        norm1 += emb1[i] * emb1[i];
        norm2 += emb2[i] * emb2[i];
      }

      const similarity = dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
      return similarity;
    } catch (error) {
      console.error('[ConceptAbstractionAgent] Similarity calculation failed:', error);
      return 0;
    }
  }

  /**
   * Generate abstract concept from cluster
   */
  async generateAbstraction(cluster, options = {}) {
    const { maxLevel = ABSTRACTION_LEVELS.STRATEGIC } = options;

    console.log(`[ConceptAbstractionAgent] Generating abstraction for cluster of ${cluster.length} items`);

    try {
      // Build prompt with cluster examples
      const examples = cluster.slice(0, 5).map((item, i) =>
        `${i + 1}. [${item.type}] ${item.text.substring(0, 300)}...`
      ).join('\n\n');

      const prompt = `Analyze these ${cluster.length} related knowledge items and generate an abstract concept that captures their common pattern.

Examples:
${examples}

Task:
1. Identify the common pattern or principle
2. Generate an abstract concept name (3-8 words)
3. Write a concise description of the pattern (2-3 sentences)
4. Determine abstraction level:
   - TACTICAL (1): Reusable within similar contexts
   - STRATEGIC (2): Applicable across multiple contexts
   - PRINCIPLE (3): Universal design principle
5. List key characteristics (3-5 bullet points)
6. Provide confidence score (0.0-1.0)

Respond in JSON format:
{
  "name": "Abstract Pattern Name",
  "description": "Clear, concise description of the pattern...",
  "level": 1-3,
  "characteristics": ["key point 1", "key point 2", ...],
  "confidence": 0.0-1.0,
  "reasoning": "Why this abstraction captures the pattern"
}`;

      const response = await this.inferenceEngine.infer(prompt, {
        operationType: 'concept-abstraction',
        temperature: 0.5,
        maxTokens: 500
      });

      // Parse response
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const abstraction = JSON.parse(jsonMatch[0]);

      // Validate level
      if (abstraction.level > maxLevel) {
        abstraction.level = maxLevel;
      }

      // Add metadata
      abstraction.id = this.generateAbstractionId(abstraction.name);
      abstraction.instanceIds = cluster.map(item => item.id);
      abstraction.instanceCount = cluster.length;
      abstraction.createdAt = new Date().toISOString();

      // Aggregate instance metadata
      abstraction.instanceTypes = [...new Set(cluster.map(item => item.type))];
      abstraction.instanceProjects = [...new Set(cluster.map(item => item.project).filter(Boolean))];

      // Update stats
      this.stats.instancesAbstracted += cluster.length;
      this.stats.byLevel[abstraction.level]++;

      return abstraction;
    } catch (error) {
      console.error('[ConceptAbstractionAgent] Abstraction generation failed:', error);
      return null;
    }
  }

  /**
   * Build hierarchical relationships between abstractions
   */
  async buildHierarchy(abstractions) {
    console.log('[ConceptAbstractionAgent] Building concept hierarchy...');

    const hierarchy = {
      nodes: abstractions.map(abs => ({
        id: abs.id,
        level: abs.level,
        name: abs.name
      })),
      edges: []
    };

    // Find parent-child relationships
    for (let i = 0; i < abstractions.length; i++) {
      for (let j = 0; j < abstractions.length; j++) {
        if (i === j) continue;

        const parent = abstractions[i];
        const child = abstractions[j];

        // Parent must be higher level
        if (parent.level <= child.level) continue;

        // Check if parent generalizes child
        const isParent = await this.isGeneralization(parent, child);

        if (isParent) {
          hierarchy.edges.push({
            from: parent.id,
            to: child.id,
            relationship: 'generalizes'
          });

          // Add to abstraction metadata
          if (!child.parentId) {
            child.parentId = parent.id;
          }
        }
      }
    }

    console.log(`[ConceptAbstractionAgent] Built hierarchy with ${hierarchy.edges.length} relationships`);

    return hierarchy;
  }

  /**
   * Check if parent generalizes child
   */
  async isGeneralization(parent, child) {
    try {
      const prompt = `Determine if the first concept is a generalization of the second concept.

Parent Concept: ${parent.name}
Description: ${parent.description}

Child Concept: ${child.name}
Description: ${child.description}

Is the parent a generalization of the child? Respond with JSON:
{
  "isGeneralization": true/false,
  "confidence": 0.0-1.0
}`;

      const response = await this.inferenceEngine.infer(prompt, {
        operationType: 'hierarchy-classification',
        temperature: 0.3,
        maxTokens: 100
      });

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return false;
      }

      const result = JSON.parse(jsonMatch[0]);
      return result.isGeneralization && result.confidence >= 0.7;
    } catch (error) {
      console.error('[ConceptAbstractionAgent] Generalization check failed:', error);
      return false;
    }
  }

  /**
   * Store abstraction in database
   */
  async storeAbstraction(abstraction) {
    try {
      // Generate embedding for abstraction
      const embedding384 = await this.embeddingGenerator.generate(
        `${abstraction.name} ${abstraction.description}`,
        { vectorSize: 384 }
      );

      const embedding1536 = await this.embeddingGenerator.generate(
        `${abstraction.name} ${abstraction.description}`,
        { vectorSize: 1536 }
      );

      // Store in Qdrant (separate collections for abstractions)
      await this.databaseManager.storeVector(
        'knowledge_patterns_small',
        abstraction.id,
        embedding384,
        {
          type: 'abstract_concept',
          level: abstraction.level,
          name: abstraction.name,
          description: abstraction.description,
          characteristics: abstraction.characteristics,
          confidence: abstraction.confidence,
          instanceCount: abstraction.instanceCount,
          instanceTypes: abstraction.instanceTypes,
          instanceProjects: abstraction.instanceProjects,
          createdAt: abstraction.createdAt,
          isAbstraction: true
        }
      );

      await this.databaseManager.storeVector(
        'knowledge_patterns',
        abstraction.id,
        embedding1536,
        {
          type: 'abstract_concept',
          level: abstraction.level,
          name: abstraction.name,
          description: abstraction.description,
          characteristics: abstraction.characteristics,
          confidence: abstraction.confidence,
          instanceCount: abstraction.instanceCount,
          instanceTypes: abstraction.instanceTypes,
          instanceProjects: abstraction.instanceProjects,
          createdAt: abstraction.createdAt,
          isAbstraction: true
        }
      );

      // Store metadata in SQLite
      await this.databaseManager.storeKnowledgeExtraction({
        id: abstraction.id,
        type: 'abstract_concept',
        sessionId: null,
        project: abstraction.instanceProjects.join(','),
        confidence: abstraction.confidence,
        extractedAt: abstraction.createdAt,
        metadata: JSON.stringify({
          level: abstraction.level,
          name: abstraction.name,
          instanceIds: abstraction.instanceIds,
          parentId: abstraction.parentId || null
        })
      });

      console.log(`[ConceptAbstractionAgent] Stored abstraction: ${abstraction.name} (level ${abstraction.level})`);
    } catch (error) {
      console.error('[ConceptAbstractionAgent] Storage failed:', error);
      throw error;
    }
  }

  /**
   * Get abstract concept for specific knowledge
   */
  async getAbstractConcept(knowledgeId) {
    try {
      // Search for abstractions that include this knowledge
      const results = await this.databaseManager.searchVectors(
        'knowledge_patterns',
        null,
        {
          limit: 10,
          filter: {
            must: [{
              key: 'isAbstraction',
              match: { value: true }
            }]
          },
          includePayload: true
        }
      );

      // Find abstractions containing this instance
      const concepts = results
        .filter(result => {
          const metadata = JSON.parse(result.payload.metadata || '{}');
          return metadata.instanceIds && metadata.instanceIds.includes(knowledgeId);
        })
        .map(result => ({
          id: result.id,
          name: result.payload.name,
          description: result.payload.description,
          level: result.payload.level,
          confidence: result.payload.confidence
        }));

      return concepts.length > 0 ? concepts[0] : null;
    } catch (error) {
      console.error('[ConceptAbstractionAgent] Concept retrieval failed:', error);
      return null;
    }
  }

  /**
   * Generate unique abstraction ID
   */
  generateAbstractionId(name) {
    const hash = crypto.createHash('sha256')
      .update(name)
      .digest('hex');
    return `abstract_${hash.substring(0, 16)}`;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      averageInstancesPerAbstraction: this.stats.abstractionsGenerated > 0
        ? (this.stats.instancesAbstracted / this.stats.abstractionsGenerated).toFixed(2)
        : 0
    };
  }

  /**
   * Clear statistics
   */
  clearStats() {
    this.stats = {
      abstractionsGenerated: 0,
      conceptsClustered: 0,
      instancesAbstracted: 0,
      byLevel: {
        [ABSTRACTION_LEVELS.CONCRETE]: 0,
        [ABSTRACTION_LEVELS.TACTICAL]: 0,
        [ABSTRACTION_LEVELS.STRATEGIC]: 0,
        [ABSTRACTION_LEVELS.PRINCIPLE]: 0
      }
    };
  }
}

export default ConceptAbstractionAgent;
export { ABSTRACTION_LEVELS, CLUSTERING_CONFIG };
