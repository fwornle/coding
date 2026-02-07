import AgentAdapter from '../agent-adapter.js';
import AgentDetector from '../agent-detector.js';
import MemoryFallbackService from '../fallbacks/memory-fallback.js';
import BrowserFallbackService from '../fallbacks/browser-fallback.js';
import LoggerFallbackService from '../fallbacks/logger-fallback.js';
import { executeCommand } from '../utils/system.js';
import path from 'path';
import { createLogger } from '../logging/Logger.js';

const logger = createLogger('copilot');

class CoPilotAdapter extends AgentAdapter {
  constructor(config = {}) {
    super(config);
    this.capabilities = ['code-completion', 'chat', 'memory', 'browser', 'logging'];
    this.hasSpecstory = false;
    
    // Fallback services
    this.memoryService = null;
    this.browserService = null;
    this.loggingService = null;
  }

  async initialize() {
    try {
      // Detect available integrations
      const detector = new AgentDetector();
      this.hasSpecstory = await detector.detectSpecstoryExtension();
      
      logger.info('Initializing CoPilot adapter...');
      if (this.hasSpecstory) {
        logger.info('Specstory extension detected');
      }
      
      // Initialize fallback services
      await this.startMemoryService();
      await this.startBrowserService();
      
      // Only start logging service if Specstory extension not available
      if (!this.hasSpecstory) {
        await this.startLoggingService();
      }
      
      this.initialized = true;
      logger.info('CoPilot adapter initialized successfully');
    } catch (error) {
      throw new Error(`Failed to initialize CoPilot adapter: ${error.message}`);
    }
  }

  async cleanup() {
    // Cleanup all services
    if (this.memoryService) await this.memoryService.cleanup();
    if (this.browserService) await this.browserService.cleanup();
    if (this.loggingService) await this.loggingService.cleanup();
  }

  async startMemoryService() {
    const codingPath = process.env.CODING_TOOLS_PATH || 
                      this.config.codingPath ||
                      path.join(process.env.HOME, 'Agentic', 'coding');
    
    this.memoryService = new MemoryFallbackService({
      dbPath: process.env.CODING_TOOLS_GRAPH_DB ||
              this.config.memoryDbPath ||
              path.join(codingPath, '.coding-tools', 'memory.graph'),
      knowledgeExportPath: path.join(codingPath, '.data', 'knowledge-export'),
      team: process.env.CODING_TEAM || 'coding' // Use coding team by default for consistency
    });
    
    await this.memoryService.initialize();
    logger.info('Memory service (Graphology) started');
    
    // DISABLED: Auto-import causes garbage entity feedback loops
    // Knowledge should be explicitly imported when needed via API calls
    // await this.importExistingKnowledge();
  }

  async startBrowserService() {
    this.browserService = new BrowserFallbackService({
      browser: this.config.browser || 'chromium',
      headless: this.config.headless !== false
    });
    
    await this.browserService.initialize();
    logger.info('Browser service (Playwright) started');
  }

  async startLoggingService() {
    this.loggingService = new LoggerFallbackService({
      logDir: this.config.logDir || './.specstory/history'
    });
    
    await this.loggingService.initialize();
    logger.info('Logging service started');
  }

  async importExistingKnowledge() {
    try {
      // Check for knowledge export file
      const fs = await import('fs/promises');
      const path = await import('path');
      const knowledgeExportPath = path.join(process.cwd(), '.data', 'knowledge-export', 'coding.json');

      if (await fs.access(knowledgeExportPath).then(() => true).catch(() => false)) {
        const content = await fs.readFile(knowledgeExportPath, 'utf8');
        const knowledgeExport = JSON.parse(content);

        if (knowledgeExport.entities && knowledgeExport.entities.length > 0) {
          logger.info(`Importing ${knowledgeExport.entities.length} entities from knowledge export`);

          // Convert to memory service format
          const entities = knowledgeExport.entities.map(e => ({
            name: e.name,
            entityType: e.entityType,
            observations: e.observations || []
          }));

          await this.memoryService.createEntities(entities);

          if (knowledgeExport.relations && knowledgeExport.relations.length > 0) {
            await this.memoryService.createRelations(knowledgeExport.relations);
          }

          logger.info('Knowledge base imported successfully');
        }
      }
    } catch (error) {
      logger.warn('Failed to import existing knowledge', { error: error.message });
    }
  }

  async executeCommand(command = '', args = []) {
    const fullCommand = `copilot ${command} ${args.join(' ')}`.trim();
    return await executeCommand(fullCommand);
  }

  // Memory operations using graph database fallback
  
  async memoryCreate(entities) {
    if (!this.memoryService) throw new Error('Memory service not initialized');
    return await this.memoryService.createEntities(entities);
  }

  async memoryCreateRelations(relations) {
    if (!this.memoryService) throw new Error('Memory service not initialized');
    return await this.memoryService.createRelations(relations);
  }

  async memorySearch(query) {
    if (!this.memoryService) throw new Error('Memory service not initialized');
    return await this.memoryService.searchNodes(query);
  }

  async memoryRead() {
    if (!this.memoryService) throw new Error('Memory service not initialized');
    return await this.memoryService.readGraph();
  }

  async memoryDelete(entityNames) {
    if (!this.memoryService) throw new Error('Memory service not initialized');
    return await this.memoryService.deleteEntities(entityNames);
  }

  // Browser operations using Playwright
  
  async browserNavigate(url) {
    if (!this.browserService) throw new Error('Browser service not initialized');
    return await this.browserService.navigate(url);
  }

  async browserAct(action, variables = {}) {
    if (!this.browserService) throw new Error('Browser service not initialized');
    return await this.browserService.act(action, variables);
  }

  async browserExtract() {
    if (!this.browserService) throw new Error('Browser service not initialized');
    return await this.browserService.extract();
  }

  async browserScreenshot(options = {}) {
    if (!this.browserService) throw new Error('Browser service not initialized');
    return await this.browserService.screenshot(options);
  }

  // Logging operations
  
  async logConversation(data) {
    if (this.hasSpecstory || this.loggingService) {
      // If we have Specstory, the logging service will use it
      // Otherwise, it will use file-based logging
      if (!this.loggingService) {
        // Initialize logging service on demand
        await this.startLoggingService();
      }
      return await this.loggingService.logConversation(data);
    }
    
    // No logging available
    return { success: false, error: 'No logging service available' };
  }

  async readConversationHistory(options = {}) {
    if (this.loggingService) {
      return await this.loggingService.readConversationHistory(options);
    }
    
    // Try to initialize logging service if not already done
    if (!this.hasSpecstory) {
      await this.startLoggingService();
      return await this.loggingService.readConversationHistory(options);
    }
    
    return [];
  }

}

export default CoPilotAdapter;