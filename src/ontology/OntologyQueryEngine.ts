/**
 * OntologyQueryEngine - Knowledge retrieval using ontology metadata
 *
 * Responsibilities:
 * - Query knowledge by entity class
 * - Filter by properties using dot notation
 * - Aggregate counts by entity class
 * - Follow ontology relationships in graph
 * - Support complex queries with multiple filters
 * - Implement pagination and sorting
 */

import {
  OntologyQueryFilters,
  QueryOptions,
  OntologyQueryResult,
} from './types.js';
import { OntologyManager } from './OntologyManager.js';

/**
 * Knowledge item with ontology metadata (interface for query results)
 */
export interface KnowledgeWithOntology {
  id: string;
  content: string;
  ontology?: {
    entityClass: string;
    team?: string;
    confidence: number;
    properties?: Record<string, any>;
  };
  metadata?: Record<string, any>;
  timestamp: string;
}

/**
 * OntologyQueryEngine - Query knowledge using ontology metadata
 *
 * Note: This is a TypeScript interface for the engine. The actual implementation
 * will integrate with GraphDatabaseService which is in JavaScript.
 */
export class OntologyQueryEngine {
  constructor(
    private ontologyManager: OntologyManager,
    private graphDatabase: any // GraphDatabaseService (JavaScript)
  ) {}

  /**
   * Find knowledge by entity class
   */
  async findByEntityClass(
    entityClass: string,
    team?: string,
    options?: QueryOptions
  ): Promise<OntologyQueryResult<KnowledgeWithOntology>> {
    const filters: OntologyQueryFilters = {
      entityClass,
      team,
    };

    return this.query(filters, options);
  }

  /**
   * Find knowledge by property value using dot notation
   *
   * @param entityClass - Entity class to filter
   * @param propertyPath - Dot-notation path (e.g., "properties.cpu" or "ontology.confidence")
   * @param value - Value to match
   * @param options - Query options (pagination, sorting)
   */
  async findByProperty(
    entityClass: string,
    propertyPath: string,
    value: any,
    options?: QueryOptions
  ): Promise<OntologyQueryResult<KnowledgeWithOntology>> {
    const filters: OntologyQueryFilters = {
      entityClass,
      properties: {
        [propertyPath]: value,
      },
    };

    return this.query(filters, options);
  }

  /**
   * Aggregate counts by entity class
   */
  async aggregateByEntityClass(
    team?: string
  ): Promise<Record<string, number>> {
    // Query all knowledge with ontology metadata
    const allKnowledge = await this.query(
      { team },
      { includeProperties: false }
    );

    // Count by entity class
    const counts: Record<string, number> = {};
    for (const item of allKnowledge.results) {
      const entityClass = item.ontology?.entityClass;
      if (entityClass) {
        counts[entityClass] = (counts[entityClass] || 0) + 1;
      }
    }

    return counts;
  }

  /**
   * Find related knowledge by following ontology relationships
   *
   * @param knowledgeId - Source knowledge ID
   * @param relationshipType - Optional relationship type to filter
   */
  async findRelated(
    knowledgeId: string,
    relationshipType?: string
  ): Promise<KnowledgeWithOntology[]> {
    // Get the source knowledge node
    const sourceNode = await this.graphDatabase.getNode(knowledgeId);
    if (!sourceNode) {
      return [];
    }

    // Get all relationships from this node
    const relationships = await this.graphDatabase.getRelationships(
      knowledgeId,
      relationshipType
    );

    // Get target nodes
    const relatedNodes: KnowledgeWithOntology[] = [];
    for (const rel of relationships) {
      const targetNode = await this.graphDatabase.getNode(rel.target);
      if (targetNode && targetNode.ontology) {
        relatedNodes.push(this.nodeToKnowledge(targetNode));
      }
    }

    return relatedNodes;
  }

  /**
   * Execute complex query with multiple filters
   */
  async query(
    filters?: OntologyQueryFilters,
    options?: QueryOptions
  ): Promise<OntologyQueryResult<KnowledgeWithOntology>> {
    const {
      includeProperties = true,
      includeRelationships = false,
      limit = 100,
      offset = 0,
      sortBy,
      sortOrder = 'desc',
    } = options || {};

    // Build query for graph database
    let allNodes = await this.getAllNodesWithOntology();

    // Apply filters
    if (filters) {
      allNodes = this.applyFilters(allNodes, filters);
    }

    // Apply sorting
    if (sortBy) {
      allNodes = this.applySorting(allNodes, sortBy, sortOrder);
    }

    // Get total count before pagination
    const totalCount = allNodes.length;

    // Apply pagination
    const paginatedNodes = allNodes.slice(offset, offset + limit);

    // Convert to knowledge objects
    const results = paginatedNodes.map((node) =>
      this.nodeToKnowledge(node, includeProperties, includeRelationships)
    );

    return {
      results,
      totalCount,
      hasMore: offset + limit < totalCount,
    };
  }

  /**
   * Get all nodes with ontology metadata from graph database
   */
  private async getAllNodesWithOntology(): Promise<any[]> {
    // This would call the actual GraphDatabaseService method
    // For now, return a mock structure
    if (typeof this.graphDatabase.queryByOntologyClass === 'function') {
      return await this.graphDatabase.queryByOntologyClass();
    }

    // Fallback: get all nodes and filter
    const allNodes = await this.graphDatabase.getAllNodes();
    return allNodes.filter((node: any) => node.ontology);
  }

  /**
   * Apply filters to nodes
   */
  private applyFilters(
    nodes: any[],
    filters: OntologyQueryFilters
  ): any[] {
    return nodes.filter((node) => {
      // Filter by entity class
      if (filters.entityClass) {
        if (node.ontology?.entityClass !== filters.entityClass) {
          return false;
        }
      }

      // Filter by entity classes (multiple)
      if (filters.entityClasses && filters.entityClasses.length > 0) {
        if (!filters.entityClasses.includes(node.ontology?.entityClass)) {
          return false;
        }
      }

      // Filter by team (include "mixed" team items)
      if (filters.team) {
        const nodeTeam = node.ontology?.team;
        if (nodeTeam && nodeTeam !== filters.team && nodeTeam !== 'mixed') {
          return false;
        }
      }

      // Filter by properties using dot notation
      if (filters.properties) {
        for (const [path, value] of Object.entries(filters.properties)) {
          const nodeValue = this.getNestedProperty(node, path);
          if (nodeValue !== value) {
            return false;
          }
        }
      }

      // Filter by relationship type
      if (filters.relationshipType) {
        // This would require checking node's relationships
        // Simplified for now
      }

      return true;
    });
  }

  /**
   * Apply sorting to nodes
   */
  private applySorting(
    nodes: any[],
    sortBy: string,
    sortOrder: 'asc' | 'desc'
  ): any[] {
    return nodes.sort((a, b) => {
      const aValue = this.getNestedProperty(a, sortBy);
      const bValue = this.getNestedProperty(b, sortBy);

      let comparison = 0;
      if (aValue < bValue) {
        comparison = -1;
      } else if (aValue > bValue) {
        comparison = 1;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }

  /**
   * Get nested property value using dot notation
   */
  private getNestedProperty(obj: any, path: string): any {
    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }

      // Handle array indices
      const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
      if (arrayMatch) {
        const [, propName, index] = arrayMatch;
        current = current[propName];
        if (Array.isArray(current)) {
          current = current[parseInt(index, 10)];
        } else {
          return undefined;
        }
      } else {
        current = current[part];
      }
    }

    return current;
  }

  /**
   * Convert graph node to KnowledgeWithOntology
   */
  private nodeToKnowledge(
    node: any,
    includeProperties: boolean = true,
    includeRelationships: boolean = false
  ): KnowledgeWithOntology {
    const knowledge: KnowledgeWithOntology = {
      id: node.id,
      content: node.content || '',
      timestamp: node.timestamp || new Date().toISOString(),
    };

    if (node.ontology) {
      knowledge.ontology = {
        entityClass: node.ontology.entityClass,
        team: node.ontology.team,
        confidence: node.ontology.confidence || 0,
      };

      if (includeProperties && node.ontology.properties) {
        knowledge.ontology.properties = node.ontology.properties;
      }
    }

    if (node.metadata) {
      knowledge.metadata = node.metadata;
    }

    return knowledge;
  }

  /**
   * Get query statistics
   */
  async getStatistics(): Promise<{
    totalKnowledge: number;
    knowledgeWithOntology: number;
    entityClasses: string[];
    teams: string[];
  }> {
    const allNodes = await this.graphDatabase.getAllNodes();
    const nodesWithOntology = allNodes.filter((node: any) => node.ontology);

    const entityClasses = new Set<string>();
    const teams = new Set<string>();

    for (const node of nodesWithOntology) {
      if (node.ontology.entityClass) {
        entityClasses.add(node.ontology.entityClass);
      }
      if (node.ontology.team) {
        teams.add(node.ontology.team);
      }
    }

    return {
      totalKnowledge: allNodes.length,
      knowledgeWithOntology: nodesWithOntology.length,
      entityClasses: Array.from(entityClasses).sort(),
      teams: Array.from(teams).sort(),
    };
  }
}
