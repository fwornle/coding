/**
 * Abstract base class for agent adapters
 * All agent-specific adapters must extend this class
 */
class AgentAdapter {
  constructor(config = {}) {
    this.config = config;
    this.initialized = false;
    this.capabilities = [];
  }

  /**
   * Initialize the adapter and any required services
   * @returns {Promise<void>}
   */
  async initialize() {
    throw new Error('initialize() must be implemented by subclass');
  }

  /**
   * Cleanup resources when shutting down
   * @returns {Promise<void>}
   */
  async cleanup() {
    // Override in subclass if needed
  }

  /**
   * Execute a command with the agent
   * @param {string} command - Command to execute
   * @param {string[]} args - Command arguments
   * @returns {Promise<any>}
   */
  async executeCommand(command, _args = []) {
    throw new Error('executeCommand() must be implemented by subclass');
  }

  // Memory operations
  
  /**
   * Create entities in the knowledge graph
   * @param {Array} _entities - Array of entity objects
   * @returns {Promise<any>}
   */
  async memoryCreate(_entities) {
    throw new Error('memoryCreate() not implemented');
  }

  /**
   * Create relations between entities
   * @param {Array} _relations - Array of relation objects
   * @returns {Promise<any>}
   */
  async memoryCreateRelations(_relations) {
    throw new Error('memoryCreateRelations() not implemented');
  }

  /**
   * Search for nodes in the knowledge graph
   * @param {string} _query - Search query
   * @returns {Promise<Array>}
   */
  async memorySearch(_query) {
    throw new Error('memorySearch() not implemented');
  }

  /**
   * Read the entire knowledge graph
   * @returns {Promise<Object>}
   */
  async memoryRead() {
    throw new Error('memoryRead() not implemented');
  }

  /**
   * Delete entities from the knowledge graph
   * @param {string[]} _entityNames - Names of entities to delete
   * @returns {Promise<any>}
   */
  async memoryDelete(_entityNames) {
    throw new Error('memoryDelete() not implemented');
  }

  // Browser operations
  
  /**
   * Navigate to a URL in the browser
   * @param {string} _url - URL to navigate to
   * @returns {Promise<any>}
   */
  async browserNavigate(_url) {
    throw new Error('browserNavigate() not implemented');
  }

  /**
   * Perform an action on a web page
   * @param {string} action - Action description
   * @param {Object} variables - Variables for the action
   * @returns {Promise<any>}
   */
  async browserAct(action, _variables = {}) {
    throw new Error('browserAct() not implemented');
  }

  /**
   * Extract content from the current page
   * @returns {Promise<string>}
   */
  async browserExtract() {
    throw new Error('browserExtract() not implemented');
  }

  /**
   * Take a screenshot of the current page
   * @returns {Promise<Buffer>}
   */
  async browserScreenshot() {
    throw new Error('browserScreenshot() not implemented');
  }

  // Logging operations
  
  /**
   * Log a conversation entry
   * @param {Object} _data - Conversation data to log
   * @returns {Promise<any>}
   */
  async logConversation(_data) {
    throw new Error('logConversation() not implemented');
  }

  /**
   * Read conversation history
   * @param {Object} options - Query options
   * @returns {Promise<Array>}
   */
  async readConversationHistory(_options = {}) {
    throw new Error('readConversationHistory() not implemented');
  }

  // Utility methods
  
  /**
   * Check if the adapter has a specific capability
   * @param {string} capability - Capability to check
   * @returns {boolean}
   */
  hasCapability(capability) {
    return this.capabilities.includes(capability);
  }

  /**
   * Get all capabilities of this adapter
   * @returns {string[]}
   */
  getCapabilities() {
    return [...this.capabilities];
  }

  /**
   * Check if the adapter is initialized
   * @returns {boolean}
   */
  isInitialized() {
    return this.initialized;
  }
}

export default AgentAdapter;