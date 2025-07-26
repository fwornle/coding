import { log } from "../logging.js";

export interface SimilarityConfig {
  embeddingModel?: string;
  similarityThreshold: number;
  batchSize: number;
}

export interface MergingStrategy {
  preserveReferences: boolean;
  mergeObservations: boolean;
  keepMostSignificant: boolean;
}

export interface DuplicateGroup {
  id: string;
  entities: Entity[];
  similarity: number;
  suggestedMerge: Entity;
  confidence: number;
}

export interface Entity {
  id: string;
  name: string;
  type: string;
  observations: Observation[];
  significance?: number;
  timestamp: string;
  references?: string[];
}

export interface Observation {
  type: string;
  content: string;
  timestamp: string;
  source?: string;
}

export interface DeduplicationResult {
  totalProcessed: number;
  duplicatesFound: number;
  entitiesMerged: number;
  entitiesRemoved: number;
  conflictsRequiringReview: number;
  processingTime: number;
}

export class DeduplicationAgent {
  private similarityConfig: SimilarityConfig;
  private mergingStrategy: MergingStrategy;

  constructor() {
    this.similarityConfig = {
      embeddingModel: "sentence-transformers/all-MiniLM-L6-v2",
      similarityThreshold: 0.85,
      batchSize: 100,
    };

    this.mergingStrategy = {
      preserveReferences: true,
      mergeObservations: true,
      keepMostSignificant: true,
    };

    log("DeduplicationAgent initialized", "info", {
      threshold: this.similarityConfig.similarityThreshold,
      batchSize: this.similarityConfig.batchSize,
    });
  }

  async deduplicateEntities(entities: Entity[]): Promise<DeduplicationResult> {
    const startTime = Date.now();
    log(`Starting deduplication of ${entities.length} entities`, "info");

    const result: DeduplicationResult = {
      totalProcessed: entities.length,
      duplicatesFound: 0,
      entitiesMerged: 0,
      entitiesRemoved: 0,
      conflictsRequiringReview: 0,
      processingTime: 0,
    };

    try {
      // Process entities in batches
      const batches = this.createBatches(entities, this.similarityConfig.batchSize);
      const duplicateGroups: DuplicateGroup[] = [];

      for (const batch of batches) {
        const batchDuplicates = await this.findDuplicatesInBatch(batch);
        duplicateGroups.push(...batchDuplicates);
      }

      result.duplicatesFound = duplicateGroups.length;

      // Merge duplicate groups
      for (const group of duplicateGroups) {
        try {
          const mergeResult = await this.mergeEntityGroup(group);
          if (mergeResult.success) {
            result.entitiesMerged++;
            result.entitiesRemoved += group.entities.length - 1;
          } else {
            result.conflictsRequiringReview++;
          }
        } catch (error) {
          log(`Failed to merge group ${group.id}`, "error", error);
          result.conflictsRequiringReview++;
        }
      }

      result.processingTime = Date.now() - startTime;
      
      log("Deduplication completed", "info", result);
      
    } catch (error) {
      log("Deduplication failed", "error", error);
      throw error;
    }

    return result;
  }

  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  private async findDuplicatesInBatch(entities: Entity[]): Promise<DuplicateGroup[]> {
    const duplicateGroups: DuplicateGroup[] = [];
    const processed = new Set<string>();

    for (let i = 0; i < entities.length; i++) {
      if (processed.has(entities[i].id)) continue;

      const similarEntities = [entities[i]];
      processed.add(entities[i].id);

      for (let j = i + 1; j < entities.length; j++) {
        if (processed.has(entities[j].id)) continue;

        const similarity = await this.calculateSimilarity(entities[i], entities[j]);
        
        if (similarity >= this.similarityConfig.similarityThreshold) {
          similarEntities.push(entities[j]);
          processed.add(entities[j].id);
        }
      }

      if (similarEntities.length > 1) {
        const group = await this.createDuplicateGroup(similarEntities);
        duplicateGroups.push(group);
      }
    }

    return duplicateGroups;
  }

  private async calculateSimilarity(entity1: Entity, entity2: Entity): Promise<number> {
    // Simplified similarity calculation
    // In a real implementation, this would use embeddings

    let score = 0;
    let factors = 0;

    // Name similarity
    const nameSimilarity = this.calculateStringSimilarity(entity1.name, entity2.name);
    score += nameSimilarity * 0.4;
    factors += 0.4;

    // Type similarity
    if (entity1.type === entity2.type) {
      score += 0.2;
    }
    factors += 0.2;

    // Content similarity (from observations)
    const content1 = entity1.observations.map(obs => obs.content).join(' ');
    const content2 = entity2.observations.map(obs => obs.content).join(' ');
    const contentSimilarity = this.calculateStringSimilarity(content1, content2);
    score += contentSimilarity * 0.4;
    factors += 0.4;

    return factors > 0 ? score / factors : 0;
  }

  private calculateStringSimilarity(str1: string, str2: string): number {
    // Simple Jaccard similarity using word sets
    const words1 = new Set(str1.toLowerCase().split(/\s+/));
    const words2 = new Set(str2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(word => words2.has(word)));
    const union = new Set([...words1, ...words2]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  private async createDuplicateGroup(entities: Entity[]): Promise<DuplicateGroup> {
    // Calculate average similarity within the group
    let totalSimilarity = 0;
    let comparisons = 0;

    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        totalSimilarity += await this.calculateSimilarity(entities[i], entities[j]);
        comparisons++;
      }
    }

    const avgSimilarity = comparisons > 0 ? totalSimilarity / comparisons : 0;

    // Create suggested merge
    const suggestedMerge = await this.createMergedEntity(entities);

    return {
      id: `group-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      entities,
      similarity: avgSimilarity,
      suggestedMerge,
      confidence: this.calculateConfidence(avgSimilarity, entities.length),
    };
  }

  private calculateConfidence(similarity: number, entityCount: number): number {
    // Higher similarity and more entities = higher confidence
    const similarityFactor = similarity;
    const countFactor = Math.min(entityCount / 5, 1); // Cap at 5 entities
    
    return (similarityFactor * 0.7 + countFactor * 0.3);
  }

  private async createMergedEntity(entities: Entity[]): Promise<Entity> {
    // Choose the most significant entity as base
    let baseEntity = entities[0];
    
    if (this.mergingStrategy.keepMostSignificant) {
      baseEntity = entities.reduce((most, current) => 
        (current.significance || 0) > (most.significance || 0) ? current : most
      );
    }

    const mergedEntity: Entity = {
      id: baseEntity.id,
      name: baseEntity.name,
      type: baseEntity.type,
      observations: [],
      significance: baseEntity.significance,
      timestamp: new Date().toISOString(),
      references: [],
    };

    // Merge observations
    if (this.mergingStrategy.mergeObservations) {
      const allObservations: Observation[] = [];
      
      entities.forEach(entity => {
        allObservations.push(...entity.observations);
      });

      // Remove duplicate observations
      const uniqueObservations = this.removeDuplicateObservations(allObservations);
      mergedEntity.observations = uniqueObservations;
    } else {
      mergedEntity.observations = baseEntity.observations;
    }

    // Merge references
    if (this.mergingStrategy.preserveReferences) {
      const allReferences: string[] = [];
      
      entities.forEach(entity => {
        if (entity.references) {
          allReferences.push(...entity.references);
        }
      });

      mergedEntity.references = [...new Set(allReferences)];
    }

    // Update significance to highest value
    const maxSignificance = Math.max(...entities.map(e => e.significance || 0));
    if (maxSignificance > 0) {
      mergedEntity.significance = maxSignificance;
    }

    return mergedEntity;
  }

  private removeDuplicateObservations(observations: Observation[]): Observation[] {
    const seen = new Set<string>();
    const unique: Observation[] = [];

    observations.forEach(obs => {
      const key = `${obs.type}:${obs.content}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(obs);
      }
    });

    // Sort by timestamp (most recent first)
    return unique.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  private async mergeEntityGroup(group: DuplicateGroup): Promise<{ success: boolean; mergedEntity?: Entity }> {
    try {
      // Check if automatic merge is safe
      if (group.confidence < 0.8) {
        log(`Low confidence merge for group ${group.id}: ${group.confidence}`, "warning");
        return { success: false };
      }

      // Perform the merge
      const mergedEntity = group.suggestedMerge;
      
      log(`Merged ${group.entities.length} entities into: ${mergedEntity.name}`, "info", {
        groupId: group.id,
        similarity: group.similarity,
        confidence: group.confidence,
      });

      return { success: true, mergedEntity };
      
    } catch (error) {
      log(`Failed to merge group ${group.id}`, "error", error);
      return { success: false };
    }
  }

  async findSimilarEntities(targetEntity: Entity, candidates: Entity[]): Promise<Entity[]> {
    const similarEntities: Array<{entity: Entity, similarity: number}> = [];

    for (const candidate of candidates) {
      if (candidate.id === targetEntity.id) continue;

      const similarity = await this.calculateSimilarity(targetEntity, candidate);
      
      if (similarity >= this.similarityConfig.similarityThreshold) {
        similarEntities.push({ entity: candidate, similarity });
      }
    }

    // Sort by similarity (highest first)
    similarEntities.sort((a, b) => b.similarity - a.similarity);

    return similarEntities.map(item => item.entity);
  }

  updateSimilarityThreshold(threshold: number): void {
    if (threshold < 0 || threshold > 1) {
      throw new Error("Similarity threshold must be between 0 and 1");
    }
    
    this.similarityConfig.similarityThreshold = threshold;
    log(`Updated similarity threshold to: ${threshold}`, "info");
  }

  updateMergingStrategy(strategy: Partial<MergingStrategy>): void {
    Object.assign(this.mergingStrategy, strategy);
    log("Updated merging strategy", "info", this.mergingStrategy);
  }
}