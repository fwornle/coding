/**
 * VKB API Client
 *
 * HTTP client for accessing VKB server API when it's running.
 * Provides automatic detection of VKB server availability.
 */
export class VkbApiClient {
    constructor(options?: {});
    baseUrl: any;
    timeout: any;
    debug: any;
    /**
     * Check if VKB server is running
     */
    isServerAvailable(): Promise<boolean>;
    /**
     * GET /api/entities
     */
    getEntities(params?: {}): Promise<any>;
    /**
     * GET /api/entities (with search)
     */
    searchEntities(query: any, params?: {}): Promise<any>;
    /**
     * DELETE /api/entities/:name
     */
    deleteEntity(name: any, params?: {}): Promise<any>;
    /**
     * POST /api/entities
     */
    createEntity(entityData: any): Promise<any>;
    /**
     * PUT /api/entities/:name
     */
    updateEntity(name: any, updates: any): Promise<any>;
    /**
     * GET /api/relations
     */
    getRelations(params?: {}): Promise<any>;
    /**
     * DELETE /api/relations
     */
    deleteRelation(from: any, to: any, params?: {}): Promise<any>;
    /**
     * POST /api/relations
     */
    createRelation(relationData: any): Promise<any>;
    /**
     * POST /api/export
     * Export team data to JSON file
     */
    exportTeam(team: string, filePath: string): Promise<any>;
}
