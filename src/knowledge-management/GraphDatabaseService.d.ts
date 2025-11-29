export class GraphDatabaseService extends EventEmitter<[never]> {
    /**
     * Create a GraphDatabaseService instance
     *
     * @param {Object} options - Configuration options
     * @param {string} [options.dbPath] - Path to Level database (defaults to central coding/.data/knowledge-graph)
     * @param {Object} [options.config={}] - Graph database configuration
     * @param {boolean} [options.config.autoPersist=true] - Auto-persist graph changes
     * @param {number} [options.config.persistIntervalMs=1000] - Persistence interval
     * @param {number} [options.config.maxTraversalDepth=5] - Maximum traversal depth
     * @param {number} [options.config.maxResultsPerQuery=1000] - Max query results
     */
    constructor(options?: {
        dbPath?: string | undefined;
        config?: {
            autoPersist?: boolean | undefined;
            persistIntervalMs?: number | undefined;
            maxTraversalDepth?: number | undefined;
            maxResultsPerQuery?: number | undefined;
        } | undefined;
    });
    dbPath: string;
    config: {
        autoPersist?: boolean | undefined;
        persistIntervalMs?: number | undefined;
        maxTraversalDepth?: number | undefined;
        maxResultsPerQuery?: number | undefined;
    };
    graph: Graph<import("graphology-types").Attributes, import("graphology-types").Attributes, import("graphology-types").Attributes> | null;
    levelDB: Level<string, string> | null;
    inMemoryOnly: boolean;
    autoPersist: boolean;
    persistIntervalMs: number;
    persistTimer: NodeJS.Timeout | null;
    isDirty: boolean;
    /**
     * Initialize the graph database
     *
     * Creates Graphology graph instance and opens Level database.
     * Loads existing graph from Level if present.
     *
     * @returns {Promise<void>}
     * @throws {Error} If initialization fails critically
     * @emits ready When initialization complete
     */
    initialize(): Promise<void>;
    /**
     * Store an entity in the graph database
     *
     * @param {Object} entity - Entity to store
     * @param {string} entity.name - Entity name
     * @param {string} entity.entityType - Entity type (Pattern, Problem, etc.)
     * @param {Array<string>} [entity.observations=[]] - Observations about entity
     * @param {number} [entity.confidence=1.0] - Confidence score (0-1)
     * @param {string} [entity.source='manual'] - Source (manual, auto)
     * @param {Object} options - Storage options
     * @param {string} options.team - Team scope for entity
     * @returns {Promise<string>} Node ID (team:name)
     * @throws {Error} If entity validation fails
     * @emits entity:stored When entity stored successfully
     */
    storeEntity(entity: {
        name: string;
        entityType: string;
        observations?: string[] | undefined;
        confidence?: number | undefined;
        source?: string | undefined;
    }, options?: {
        team: string;
    }): Promise<string>;
    /**
     * Retrieve an entity from the graph database
     *
     * @param {string} name - Entity name
     * @param {string} team - Team scope
     * @returns {Promise<Object|null>} Entity attributes or null if not found
     */
    getEntity(name: string, team: string): Promise<Object | null>;
    /**
     * Store a relationship between two entities
     *
     * @param {string} fromEntity - Source entity name
     * @param {string} toEntity - Target entity name
     * @param {string} type - Relationship type (implements, solves, uses, etc.)
     * @param {Object} [metadata={}] - Relationship metadata
     * @param {string} metadata.team - Team scope
     * @param {number} [metadata.confidence=1.0] - Confidence score
     * @returns {Promise<void>}
     * @throws {Error} If either entity doesn't exist
     * @emits relationship:stored When relationship stored successfully
     */
    storeRelationship(fromEntity: string, toEntity: string, type: string, metadata?: {
        team: string;
        confidence?: number | undefined;
    }): Promise<void>;
    /**
     * Find related entities using graph traversal
     *
     * Uses breadth-first search to find entities related within specified depth.
     *
     * @param {string} entityName - Starting entity name
     * @param {number} [depth=2] - Maximum traversal depth (hops)
     * @param {Object} [filter={}] - Filter options
     * @param {string} [filter.team] - Filter by team
     * @param {string} [filter.relationshipType] - Filter by relationship type
     * @param {string} [filter.entityType] - Filter by entity type
     * @returns {Promise<Array<Object>>} Array of {entity, depth, relationshipType}
     */
    findRelated(entityName: string, depth?: number, filter?: {
        team?: string | undefined;
        relationshipType?: string | undefined;
        entityType?: string | undefined;
    }): Promise<Array<Object>>;
    /**
     * Query entities with SQL-compatible filtering
     *
     * Provides same interface as SQLite queries for VKB/UKB compatibility.
     *
     * @param {Object} [options={}] - Query options
     * @param {string} [options.team] - Filter by team
     * @param {string} [options.source] - Filter by source (manual, auto)
     * @param {Array<string>} [options.types] - Filter by entity types
     * @param {string} [options.startDate] - Filter by created after (ISO string)
     * @param {string} [options.endDate] - Filter by created before (ISO string)
     * @param {number} [options.minConfidence=0] - Minimum confidence score
     * @param {number} [options.limit=1000] - Result limit
     * @param {number} [options.offset=0] - Result offset for pagination
     * @param {string} [options.searchTerm] - Text search term
     * @param {string} [options.sortBy='last_modified'] - Sort field
     * @param {string} [options.sortOrder='DESC'] - Sort order (ASC, DESC)
     * @returns {Promise<Array<Object>>} Array of entities matching filters
     */
    queryEntities(options?: {
        team?: string | undefined;
        source?: string | undefined;
        types?: string[] | undefined;
        startDate?: string | undefined;
        endDate?: string | undefined;
        minConfidence?: number | undefined;
        limit?: number | undefined;
        offset?: number | undefined;
        searchTerm?: string | undefined;
        sortBy?: string | undefined;
        sortOrder?: string | undefined;
    }): Promise<Array<Object>>;
    /**
     * Query relationships with filtering
     *
     * @param {Object} [options={}] - Query options
     * @param {string} [options.entityId] - Filter by source or target entity
     * @param {string} [options.team] - Filter by team
     * @param {string} [options.relationType] - Filter by relationship type
     * @param {number} [options.limit=1000] - Result limit
     * @returns {Promise<Array<Object>>} Array of relationships
     */
    queryRelations(options?: {
        entityId?: string | undefined;
        team?: string | undefined;
        relationType?: string | undefined;
        limit?: number | undefined;
    }): Promise<Array<Object>>;
    /**
     * Get list of all teams
     *
     * @returns {Promise<Array<string>>} Sorted array of unique team names
     */
    getTeams(): Promise<Array<string>>;
    /**
     * Get statistics about stored knowledge
     *
     * @param {Object} [options={}] - Statistics options
     * @param {string} [options.team] - Filter statistics by team
     * @returns {Promise<Object>} Statistics object with entity/relation counts
     */
    getStatistics(options?: {
        team?: string | undefined;
    }): Promise<Object>;
    /**
     * Export knowledge to JSON file
     *
     * Used for manual backups via `ukb export` command.
     *
     * @param {string} team - Team to export
     * @param {string} filePath - Output file path
     * @returns {Promise<Object>} Export result with counts
     * @throws {Error} If file write fails
     */
    exportToJSON(team: string, filePath: string): Promise<Object>;
    /**
     * Import knowledge from JSON file
     *
     * Used for manual imports via `ukb import` command.
     * Idempotent - safe to run multiple times.
     *
     * @param {string} filePath - Input file path
     * @returns {Promise<Object>} Import result with counts
     * @throws {Error} If file read fails or JSON invalid
     */
    importFromJSON(filePath: string): Promise<Object>;
    /**
     * Get database health status
     *
     * @returns {Promise<Object>} Health status object
     */
    getHealth(): Promise<Object>;
    /**
     * Delete an entity from the graph database
     *
     * @param {string} name - Entity name
     * @param {string} team - Team scope
     * @param {Object} [options={}] - Deletion options
     * @param {boolean} [options.force=false] - Force deletion of critical nodes
     * @returns {Promise<Object>} Deletion result
     * @throws {Error} If entity not found or protected
     * @emits entity:deleted When entity deleted successfully
     */
    deleteEntity(name: string, team: string, options?: {
        force?: boolean | undefined;
    }): Promise<Object>;
    /**
     * Delete relationships by type
     *
     * @param {string} relationType - The relationship type to delete
     * @param {Object} [options={}] - Options
     * @param {string} [options.team] - Filter by team (optional)
     * @returns {Promise<{deleted: number, edges: Array}>} Deletion result
     */
    deleteRelationsByType(relationType: string, options?: {
        team?: string | undefined;
    }): Promise<{ deleted: number; edges: any[] }>;
    /**
     * Close database and cleanup resources
     *
     * @returns {Promise<void>}
     */
    close(): Promise<void>;
    /**
     * Persist graph to Level database (internal method)
     *
     * @private
     * @returns {Promise<void>}
     */
    private _persistGraphToLevel;
    /**
     * Load graph from Level database (internal method)
     *
     * @private
     * @returns {Promise<void>}
     */
    private _loadGraphFromLevel;
    /**
     * Start auto-persist timer (internal method)
     *
     * @private
     */
    private _startAutoPersist;
    /**
     * Stop auto-persist timer (internal method)
     *
     * @private
     */
    private _stopAutoPersist;
}
import { EventEmitter } from 'events';
import Graph from 'graphology';
import { Level } from 'level';
