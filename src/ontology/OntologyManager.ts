/**
 * OntologyManager - Centralized management for ontology loading, resolution, and caching
 *
 * Responsibilities:
 * - Load upper and lower ontologies from JSON files
 * - Resolve entity definitions with inheritance (merge lower with upper)
 * - Cache loaded ontologies for performance
 * - Provide query API for ontology structure
 * - Validate ontologies against JSON Schema
 * - Support team-specific ontology resolution
 */

import fs from 'fs/promises';
import path from 'path';
import Ajv, { type ValidateFunction, type ErrorObject } from 'ajv';
import {
  Ontology,
  OntologyType,
  EntityDefinition,
  PropertyDefinition,
  RelationshipDefinition,
  OntologyConfig,
  TeamOntologyConfig,
  OntologyLoadError,
  EntityResolutionError,
} from './types.js';
import { ontologyMetrics } from './metrics.js';

/**
 * Resolved entity definition with merged properties from upper + lower ontologies
 */
export interface ResolvedEntityDefinition extends EntityDefinition {
  /** Team that defined this entity (for lower ontology entities) */
  team?: string;

  /** Ontology type where this entity is defined */
  ontologyType: OntologyType;

  /** Full inheritance chain */
  inheritanceChain: string[];
}

/**
 * Cache entry for loaded ontologies
 */
interface OntologyCacheEntry {
  ontology: Ontology;
  loadedAt: number;
  filePath: string;
}

/**
 * OntologyManager - Manages loading and resolution of ontologies
 */
export class OntologyManager {
  private upperOntology: Ontology | null = null;
  private lowerOntologies: Map<string, Ontology> = new Map();
  private ontologyCache: Map<string, OntologyCacheEntry> = new Map();
  private schemaValidator: InstanceType<typeof Ajv>;
  private config: OntologyConfig;

  constructor(config: OntologyConfig) {
    this.config = config;
    this.schemaValidator = new Ajv({ allErrors: true });
  }

  /**
   * Initialize the ontology manager by loading upper ontology and configured lower ontologies
   */
  async initialize(): Promise<void> {
    // Load JSON Schema for ontology validation (only if not already loaded)
    if (!this.schemaValidator.getSchema('ontology')) {
      const schemaPath = path.join(
        path.dirname(this.config.upperOntologyPath),
        '../schemas/ontology-schema.json'
      );
      const schemaContent = await fs.readFile(schemaPath, 'utf-8');
      const schema = JSON.parse(schemaContent);
      this.schemaValidator.addSchema(schema, 'ontology');
    }

    // Load upper ontology
    this.upperOntology = await this.loadOntology(
      this.config.upperOntologyPath,
      'upper'
    );

    // Load team-specific lower ontology if configured
    if (this.config.team && this.config.lowerOntologyPath) {
      const lowerOntology = await this.loadOntology(
        this.config.lowerOntologyPath,
        'lower'
      );
      this.lowerOntologies.set(this.config.team, lowerOntology);
    }
  }

  /**
   * Load additional lower ontology for a specific team
   */
  async loadTeamOntology(teamConfig: TeamOntologyConfig): Promise<void> {
    const lowerOntology = await this.loadOntology(
      teamConfig.lowerOntologyPath,
      'lower'
    );
    this.lowerOntologies.set(teamConfig.team, lowerOntology);
  }

  /**
   * Load ontology from JSON file with validation
   */
  private async loadOntology(
    filePath: string,
    expectedType: OntologyType
  ): Promise<Ontology> {
    try {
      // Check cache first
      const cached = this.ontologyCache.get(filePath);
      if (cached && this.config.caching?.enabled) {
        const age = Date.now() - cached.loadedAt;
        const ttl = this.config.caching.ttl || 3600000; // 1 hour default
        if (age < ttl) {
          ontologyMetrics.incrementCounter('ontology_cache_hits', { type: expectedType });
          return cached.ontology;
        }
      }

      // Cache miss
      ontologyMetrics.incrementCounter('ontology_cache_misses', { type: expectedType });

      // Load from file
      const content = await fs.readFile(filePath, 'utf-8');
      const ontology: Ontology = JSON.parse(content);

      // Validate against JSON Schema
      const valid = this.schemaValidator.validate('ontology', ontology);
      if (!valid) {
        const errors = this.schemaValidator.errors || [];
        throw new OntologyLoadError(
          `Ontology validation failed: ${errors.map((e: ErrorObject) => e.message).join(', ')}`,
          filePath,
          { errors }
        );
      }

      // Verify ontology type matches expected
      if (ontology.type !== expectedType) {
        throw new OntologyLoadError(
          `Expected ${expectedType} ontology, got ${ontology.type}`,
          filePath
        );
      }

      // Cache the loaded ontology
      if (this.config.caching?.enabled) {
        this.ontologyCache.set(filePath, {
          ontology,
          loadedAt: Date.now(),
          filePath,
        });

        // Implement cache size limit
        const maxEntries = this.config.caching.maxEntries || 10;
        if (this.ontologyCache.size > maxEntries) {
          // Remove oldest entry
          const oldestKey = Array.from(this.ontologyCache.entries())
            .sort((a, b) => a[1].loadedAt - b[1].loadedAt)[0][0];
          this.ontologyCache.delete(oldestKey);
        }

        // Update cache size metric
        ontologyMetrics.setGauge('ontology_cache_size', this.ontologyCache.size);
      }

      return ontology;
    } catch (error) {
      if (error instanceof OntologyLoadError) {
        throw error;
      }
      throw new OntologyLoadError(
        `Failed to load ontology from ${filePath}: ${(error as Error).message}`,
        filePath,
        { originalError: error }
      );
    }
  }

  /**
   * Get upper ontology
   */
  getUpperOntology(): Ontology {
    if (!this.upperOntology) {
      throw new OntologyLoadError(
        'Upper ontology not loaded. Call initialize() first.',
        this.config.upperOntologyPath
      );
    }
    return this.upperOntology;
  }

  /**
   * Get lower ontology for a specific team
   */
  getLowerOntology(team: string): Ontology | undefined {
    return this.lowerOntologies.get(team);
  }

  /**
   * Get all loaded lower ontologies
   */
  getAllLowerOntologies(): Map<string, Ontology> {
    return new Map(this.lowerOntologies);
  }

  /**
   * Check if entity class exists in upper or lower ontology
   */
  hasEntityClass(entityClass: string, team?: string): boolean {
    // Check upper ontology
    if (this.upperOntology?.entities[entityClass]) {
      return true;
    }

    // Check team-specific lower ontology
    if (team) {
      const lowerOntology = this.lowerOntologies.get(team);
      if (lowerOntology?.entities[entityClass]) {
        return true;
      }
    }

    // Check all lower ontologies if no team specified
    if (!team) {
      for (const lowerOntology of this.lowerOntologies.values()) {
        if (lowerOntology.entities[entityClass]) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Resolve entity definition with full inheritance from upper ontology
   *
   * For lower ontology entities that extend upper entities:
   * 1. Find the lower entity definition
   * 2. Find the upper entity it extends
   * 3. Merge properties (lower overrides upper)
   * 4. Return resolved definition with inheritance chain
   */
  resolveEntityDefinition(
    entityClass: string,
    team?: string
  ): ResolvedEntityDefinition {
    // First, try to find in team-specific lower ontology
    if (team) {
      const lowerOntology = this.lowerOntologies.get(team);
      if (lowerOntology?.entities[entityClass]) {
        return this.resolveFromLower(
          entityClass,
          lowerOntology.entities[entityClass],
          team
        );
      }
    }

    // Try all lower ontologies if no team specified
    if (!team) {
      for (const [teamName, lowerOntology] of this.lowerOntologies.entries()) {
        if (lowerOntology.entities[entityClass]) {
          return this.resolveFromLower(
            entityClass,
            lowerOntology.entities[entityClass],
            teamName
          );
        }
      }
    }

    // Finally, check upper ontology
    if (this.upperOntology?.entities[entityClass]) {
      return {
        ...this.upperOntology.entities[entityClass],
        ontologyType: 'upper',
        inheritanceChain: [entityClass],
      };
    }

    // Entity not found
    throw new EntityResolutionError(
      `Entity class '${entityClass}' not found in ${team ? `team '${team}'` : 'any ontology'}`,
      entityClass,
      { team }
    );
  }

  /**
   * Resolve entity definition from lower ontology with upper ontology inheritance
   */
  private resolveFromLower(
    entityClass: string,
    lowerEntity: EntityDefinition,
    team: string
  ): ResolvedEntityDefinition {
    const inheritanceChain: string[] = [entityClass];
    let currentEntity = lowerEntity;
    let mergedProperties = { ...lowerEntity.properties };
    let mergedRequiredProperties = [...(lowerEntity.requiredProperties || [])];
    let description = lowerEntity.description;

    // Follow inheritance chain
    while (currentEntity.extendsEntity) {
      const parentEntityClass = currentEntity.extendsEntity;
      inheritanceChain.push(parentEntityClass);

      // Find parent in upper ontology
      if (!this.upperOntology?.entities[parentEntityClass]) {
        throw new EntityResolutionError(
          `Parent entity '${parentEntityClass}' not found in upper ontology`,
          entityClass,
          { team, parentEntityClass }
        );
      }

      const parentEntity = this.upperOntology.entities[parentEntityClass];

      // Merge properties (child properties override parent)
      mergedProperties = {
        ...parentEntity.properties,
        ...mergedProperties,
      };

      // Merge required properties
      mergedRequiredProperties = [
        ...(parentEntity.requiredProperties || []),
        ...mergedRequiredProperties,
      ];

      // Stop at upper ontology entity (no further inheritance)
      currentEntity = parentEntity;
    }

    return {
      description,
      properties: mergedProperties,
      requiredProperties: Array.from(new Set(mergedRequiredProperties)), // Deduplicate
      examples: lowerEntity.examples,
      team,
      ontologyType: 'lower',
      inheritanceChain: inheritanceChain.reverse(), // Root first
    };
  }

  /**
   * Get all entity classes from upper and lower ontologies
   */
  getAllEntityClasses(team?: string): string[] {
    const entityClasses = new Set<string>();

    // Add upper ontology entities
    if (this.upperOntology) {
      Object.keys(this.upperOntology.entities).forEach((cls) =>
        entityClasses.add(cls)
      );
    }

    // Add team-specific lower ontology entities
    if (team) {
      const lowerOntology = this.lowerOntologies.get(team);
      if (lowerOntology) {
        Object.keys(lowerOntology.entities).forEach((cls) =>
          entityClasses.add(cls)
        );
      }
    } else {
      // Add all lower ontology entities
      for (const lowerOntology of this.lowerOntologies.values()) {
        Object.keys(lowerOntology.entities).forEach((cls) =>
          entityClasses.add(cls)
        );
      }
    }

    return Array.from(entityClasses).sort();
  }

  /**
   * Get all relationships from upper and lower ontologies
   */
  getAllRelationships(team?: string): Record<string, RelationshipDefinition> {
    const relationships: Record<string, RelationshipDefinition> = {};

    // Add upper ontology relationships
    if (this.upperOntology?.relationships) {
      Object.assign(relationships, this.upperOntology.relationships);
    }

    // Add team-specific lower ontology relationships
    if (team) {
      const lowerOntology = this.lowerOntologies.get(team);
      if (lowerOntology?.relationships) {
        Object.assign(relationships, lowerOntology.relationships);
      }
    } else {
      // Add all lower ontology relationships
      for (const lowerOntology of this.lowerOntologies.values()) {
        if (lowerOntology.relationships) {
          Object.assign(relationships, lowerOntology.relationships);
        }
      }
    }

    return relationships;
  }

  /**
   * Find relationships for a specific entity class
   */
  getEntityRelationships(
    entityClass: string,
    team?: string
  ): Array<{ name: string; definition: RelationshipDefinition; direction: 'source' | 'target' }> {
    const allRelationships = this.getAllRelationships(team);
    const entityRelationships: Array<{
      name: string;
      definition: RelationshipDefinition;
      direction: 'source' | 'target';
    }> = [];

    for (const [name, rel] of Object.entries(allRelationships)) {
      if (rel.sourceEntityClass === entityClass) {
        entityRelationships.push({ name, definition: rel, direction: 'source' });
      }
      if (rel.targetEntityClass === entityClass) {
        entityRelationships.push({ name, definition: rel, direction: 'target' });
      }
    }

    return entityRelationships;
  }

  /**
   * Get ontology statistics
   */
  getStatistics(team?: string): {
    upperEntities: number;
    lowerEntities: number;
    totalEntities: number;
    relationships: number;
    teams: string[];
  } {
    const upperEntities = this.upperOntology
      ? Object.keys(this.upperOntology.entities).length
      : 0;

    let lowerEntities = 0;
    if (team) {
      const lowerOntology = this.lowerOntologies.get(team);
      lowerEntities = lowerOntology
        ? Object.keys(lowerOntology.entities).length
        : 0;
    } else {
      for (const lowerOntology of this.lowerOntologies.values()) {
        lowerEntities += Object.keys(lowerOntology.entities).length;
      }
    }

    const allRelationships = this.getAllRelationships(team);
    const relationships = Object.keys(allRelationships).length;

    return {
      upperEntities,
      lowerEntities,
      totalEntities: upperEntities + lowerEntities,
      relationships,
      teams: Array.from(this.lowerOntologies.keys()),
    };
  }

  /**
   * Clear ontology cache
   */
  clearCache(): void {
    this.ontologyCache.clear();
  }

  /**
   * Reload all ontologies from disk
   */
  async reload(): Promise<void> {
    this.clearCache();
    this.upperOntology = null;
    this.lowerOntologies.clear();
    await this.initialize();
  }
}
