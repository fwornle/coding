/**
 * SemanticEmbeddingClassifier - Layer 3: Semantic Similarity Classification
 *
 * Uses 384-dimensional vector embeddings to compare knowledge against
 * team-specific ontology content for semantic similarity matching.
 *
 * Leverages:
 * - Transformers.js (Xenova/all-MiniLM-L6-v2) for local embedding generation
 * - Qdrant vector database for similarity search
 * - Team-specific collections (ontology-coding, ontology-raas, etc.)
 *
 * Performance: ~50ms response time
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { LayerResult, EmbeddingMatch } from '../types.js';
// @ts-expect-error - EmbeddingGenerator is a JS class without type declarations
import type { EmbeddingGenerator } from '../../knowledge-management/EmbeddingGenerator.js';

/**
 * Configuration for Semantic Embedding Classifier
 */
export interface SemanticEmbeddingConfig {
  /** Qdrant client instance */
  qdrantClient?: QdrantClient;

  /** Qdrant host */
  qdrantHost?: string;

  /** Qdrant port */
  qdrantPort?: number;

  /** Embedding generator instance */
  embeddingGenerator?: any; // EmbeddingGenerator (JavaScript class)

  /** Similarity threshold (0-1) */
  similarityThreshold?: number;

  /** Number of results to retrieve per team */
  topK?: number;

  /** Minimum difference required between best and second-best match */
  disambiguationThreshold?: number;
}

/**
 * Semantic Embedding Classifier for vector-based classification
 */
export class SemanticEmbeddingClassifier {
  private qdrantClient: QdrantClient;
  private embeddingGenerator: any; // EmbeddingGenerator
  private readonly similarityThreshold: number;
  private readonly topK: number;
  private readonly disambiguationThreshold: number;
  private initialized: boolean = false;

  constructor(config: SemanticEmbeddingConfig = {}) {
    // Initialize Qdrant client
    if (config.qdrantClient) {
      this.qdrantClient = config.qdrantClient;
    } else {
      const host = config.qdrantHost || process.env.QDRANT_HOST || 'localhost';
      const port = config.qdrantPort || parseInt(process.env.QDRANT_PORT || '6333');

      this.qdrantClient = new QdrantClient({
        url: `http://${host}:${port}`,
      });
    }

    // Store embedding generator
    this.embeddingGenerator = config.embeddingGenerator;

    // Configuration
    this.similarityThreshold = config.similarityThreshold || 0.65;
    this.topK = config.topK || 5;
    this.disambiguationThreshold = config.disambiguationThreshold || 0.1;
  }

  /**
   * Initialize the classifier
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Initialize embedding generator if provided
    if (this.embeddingGenerator && !this.embeddingGenerator.initialized) {
      await this.embeddingGenerator.initialize();
    }

    this.initialized = true;
  }

  /**
   * Classify knowledge using semantic embeddings
   *
   * @param knowledge - Knowledge content to classify
   * @param team - Optional team filter (searches all teams if not provided)
   * @returns LayerResult if semantic match found, null otherwise
   */
  async classifyByEmbedding(
    knowledge: { id: string; content: string },
    team?: string
  ): Promise<LayerResult | null> {
    const start = performance.now();

    // Ensure initialized
    if (!this.initialized) {
      await this.initialize();
    }

    // Check if embedding generator is available
    if (!this.embeddingGenerator) {
      console.warn(
        '[SemanticEmbeddingClassifier] Embedding generator not configured, skipping Layer 3'
      );
      return null;
    }

    try {
      // Generate embedding for knowledge content (384-dim local)
      const embedding = await this.embeddingGenerator.generate(
        knowledge.content,
        { vectorSize: 384 }
      );

      if (!embedding || embedding.length !== 384) {
        console.warn(
          '[SemanticEmbeddingClassifier] Invalid embedding generated, skipping Layer 3'
        );
        return null;
      }

      // Search team-specific ontology collections
      const teams = team
        ? [team]
        : ['Coding', 'RaaS', 'ReSi', 'Agentic', 'UI'];
      const searchResults: EmbeddingMatch[] = [];

      for (const t of teams) {
        const collectionName = `ontology-${t.toLowerCase()}`;

        try {
          // Check if collection exists
          const collections = await this.qdrantClient.getCollections();
          const collectionExists = collections.collections.some(
            (c) => c.name === collectionName
          );

          if (!collectionExists) {
            console.warn(
              `[SemanticEmbeddingClassifier] Collection ${collectionName} does not exist, skipping`
            );
            continue;
          }

          // Search for similar vectors
          const results = await this.qdrantClient.search(collectionName, {
            vector: embedding,
            limit: this.topK,
            score_threshold: this.similarityThreshold,
          });

          // Process results
          for (const result of results) {
            if (result.score && result.score >= this.similarityThreshold) {
              searchResults.push({
                team: t,
                entityClass:
                  (result.payload?.entityClass as string) || 'Unknown',
                similarity: result.score,
                matchedContent:
                  (result.payload?.content as string) || 'No content',
              });
            }
          }
        } catch (error) {
          // Collection might not exist yet, skip silently
          console.debug(
            `[SemanticEmbeddingClassifier] Failed to search ${collectionName}:`,
            (error as Error).message
          );
        }
      }

      // No semantic matches found
      if (searchResults.length === 0) {
        return null;
      }

      // Sort by similarity (descending)
      searchResults.sort((a, b) => b.similarity - a.similarity);

      const bestMatch = searchResults[0];
      const secondBest = searchResults[1];

      // Check if significantly better than second-best (disambiguation)
      const significantlyBetter =
        !secondBest ||
        bestMatch.similarity - secondBest.similarity >=
          this.disambiguationThreshold;

      // Apply confidence discount if not significantly better
      const confidence = significantlyBetter
        ? bestMatch.similarity
        : bestMatch.similarity * 0.9;

      return {
        layer: 3,
        layerName: 'SemanticEmbeddingClassifier',
        entityClass: bestMatch.entityClass,
        team: bestMatch.team,
        confidence,
        processingTime: performance.now() - start,
        evidence: `Semantic similarity ${bestMatch.similarity.toFixed(2)} to ${bestMatch.team} ontology (${bestMatch.entityClass})${!significantlyBetter ? ' - close match, confidence discounted' : ''}`,
      };
    } catch (error) {
      console.error(
        '[SemanticEmbeddingClassifier] Classification failed:',
        error
      );
      return null;
    }
  }

  /**
   * Check if Qdrant is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.qdrantClient.getCollections();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get available ontology collections
   */
  async getAvailableCollections(): Promise<string[]> {
    try {
      const collections = await this.qdrantClient.getCollections();
      return collections.collections
        .filter((c) => c.name.startsWith('ontology-'))
        .map((c) => c.name);
    } catch (error) {
      console.error(
        '[SemanticEmbeddingClassifier] Failed to get collections:',
        error
      );
      return [];
    }
  }

  /**
   * Set embedding generator (for late initialization)
   */
  setEmbeddingGenerator(generator: any): void {
    this.embeddingGenerator = generator;
  }

  /**
   * Get statistics about the classifier
   */
  getStats() {
    return {
      initialized: this.initialized,
      hasEmbeddingGenerator: !!this.embeddingGenerator,
      similarityThreshold: this.similarityThreshold,
      topK: this.topK,
      disambiguationThreshold: this.disambiguationThreshold,
    };
  }
}
