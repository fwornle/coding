import AgentAdapter from '../agent-adapter.js';
import AgentDetector from '../agent-detector.js';
import MemoryFallbackService from '../fallbacks/memory-fallback.js';
import BrowserFallbackService from '../fallbacks/browser-fallback.js';
import LoggerFallbackService from '../fallbacks/logger-fallback.js';
import { executeCommand } from '../utils/system.js';

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
      
      console.log('Initializing CoPilot adapter...');
      if (this.hasSpecstory) {
        console.log('✓ Specstory extension detected');
      }
      
      // Initialize fallback services
      await this.startMemoryService();
      await this.startBrowserService();
      
      // Only start logging service if Specstory extension not available
      if (!this.hasSpecstory) {
        await this.startLoggingService();
      }
      
      this.initialized = true;
      console.log('✓ CoPilot adapter initialized successfully');
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
    this.memoryService = new MemoryFallbackService({
      dbPath: process.env.CODING_TOOLS_GRAPH_DB || 
              this.config.memoryDbPath ||
              './.coding-tools/memory.graph'
    });
    
    await this.memoryService.initialize();
    console.log('✓ Memory service (Graphology) started');
    
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
    console.log('✓ Browser service (Playwright) started');
  }

  async startLoggingService() {
    this.loggingService = new LoggerFallbackService({
      logDir: this.config.logDir || './.specstory/history'
    });
    
    await this.loggingService.initialize();
    console.log('✓ Logging service started');
  }

  async importExistingKnowledge() {
    try {
      // Check for shared-memory.json
      const fs = await import('fs/promises');
      const path = await import('path');
      const sharedMemoryPath = path.join(process.cwd(), 'shared-memory.json');
      
      if (await fs.access(sharedMemoryPath).then(() => true).catch(() => false)) {
        const content = await fs.readFile(sharedMemoryPath, 'utf8');
        const sharedMemory = JSON.parse(content);
        
        if (sharedMemory.entities && sharedMemory.entities.length > 0) {
          console.log(`Importing ${sharedMemory.entities.length} entities from shared-memory.json...`);
          
          // Convert to memory service format
          const entities = sharedMemory.entities.map(e => ({
            name: e.name,
            entityType: e.entityType,
            observations: e.observations || []
          }));
          
          await this.memoryService.createEntities(entities);
          
          if (sharedMemory.relations && sharedMemory.relations.length > 0) {
            await this.memoryService.createRelations(sharedMemory.relations);
          }
          
          console.log('✓ Knowledge base imported successfully');
        }
      }
    } catch (error) {
      console.warn('Failed to import existing knowledge:', error.message);
    }
  }

  async executeCommand(command = '', args = []) {
    // Execute GitHub CoPilot commands
    const fullCommand = `gh copilot ${command} ${args.join(' ')}`.trim();
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

  // Additional CoPilot-specific methods
  
  async suggest(prompt) {
    // Use GitHub CoPilot suggest command
    try {
      const result = await executeCommand(`gh copilot suggest "${prompt}"`);
      return {
        success: true,
        suggestion: result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async explain(code) {
    // Use GitHub CoPilot explain command
    try {
      const result = await executeCommand(`gh copilot explain "${code}"`);
      return {
        success: true,
        explanation: result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default CoPilotAdapter;