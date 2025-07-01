/**
 * Auto-Robust MCP Tools for Semantic Analysis
 * Automatically ensures system health before executing any semantic analysis tools
 */

import { SystemHealthManager } from '../../system-health-manager.js';
import { SemanticAnalysisClient } from '../clients/semantic-analysis-client.js';
import { Logger } from '../../shared/logger.js';

class AutoRobustTools {
  constructor() {
    this.logger = new Logger('auto-robust-tools');
    this.healthManager = new SystemHealthManager();
    this.client = null;
    this.lastHealthCheck = 0;
    this.healthCheckCooldown = 30000; // 30 seconds
    this.systemReady = false;
  }

  async ensureSystemReady() {
    const now = Date.now();
    
    // Use cached health status if recent
    if (this.systemReady && (now - this.lastHealthCheck) < this.healthCheckCooldown) {
      return true;
    }

    this.logger.info('🔧 Ensuring system is ready for MCP operations...');
    
    try {
      // Ensure system health
      const healthStatus = await this.healthManager.ensureSystemReady();
      
      // Create/recreate client connection
      if (!this.client || !this.client.isConnected()) {
        await this.initializeClient();
      }
      
      this.systemReady = true;
      this.lastHealthCheck = now;
      
      this.logger.info(`✅ System ready: ${healthStatus.agents} agents running`);
      return true;
      
    } catch (error) {
      this.logger.error('❌ Failed to ensure system ready:', error.message);
      this.systemReady = false;
      throw new Error(`System not ready: ${error.message}`);
    }
  }

  async initializeClient() {
    this.logger.debug('🔌 Initializing semantic analysis client...');
    
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (error) {
        // Ignore disconnect errors
      }
    }

    this.client = new SemanticAnalysisClient({
      mqttUrl: `mqtt://localhost:${process.env.MQTT_BROKER_PORT || 1883}`,
      rpcUrl: `http://localhost:${process.env.JSON_RPC_PORT || 8082}`,
      timeout: 60000 // Longer timeout for complex operations
    });

    await this.client.connect();
    this.logger.debug('✅ Client connected successfully');
  }

  // Auto-robust wrapper for all semantic analysis tools
  async withSystemReady(toolName, operation) {
    try {
      await this.ensureSystemReady();
      this.logger.debug(`🛠️  Executing ${toolName}...`);
      
      const result = await operation();
      
      this.logger.debug(`✅ ${toolName} completed successfully`);
      return result;
      
    } catch (error) {
      this.logger.error(`❌ ${toolName} failed:`, error.message);
      
      // Mark system as potentially unhealthy for next check
      this.systemReady = false;
      
      throw error;
    }
  }

  // Tool implementations with auto-robust wrappers

  async determine_insights(params) {
    return this.withSystemReady('determine_insights', async () => {
      const { path, depth = 2, include_files = false } = params;
      
      return await this.client.analyzeRepository({
        repositoryPath: path,
        analysisDepth: depth,
        includeFiles: include_files,
        extractInsights: true
      });
    });
  }

  async analyze_repository(params) {
    return this.withSystemReady('analyze_repository', async () => {
      const { path, depth = 2, focus } = params;
      
      return await this.client.analyzeRepository({
        repositoryPath: path,
        analysisDepth: depth,
        focusAreas: focus ? [focus] : undefined
      });
    });
  }

  async analyze_conversation(params) {
    return this.withSystemReady('analyze_conversation', async () => {
      const { conversationData, extractPatterns = true } = params;
      
      return await this.client.analyzeConversation({
        conversation: conversationData,
        extractPatterns,
        generateInsights: true
      });
    });
  }

  async search_technical_docs(params) {
    return this.withSystemReady('search_technical_docs', async () => {
      const { query, sources, maxResults = 10 } = params;
      
      return await this.client.searchTechnicalDocs({
        query,
        sources,
        maxResults
      });
    });
  }

  async update_knowledge_base(params) {
    return this.withSystemReady('update_knowledge_base', async () => {
      const { insights, entities, merge_strategy = 'smart' } = params;
      
      // Create knowledge entities from insights
      const results = [];
      
      if (insights && insights.length > 0) {
        for (const insight of insights) {
          const result = await this.client.createKnowledgeEntity({
            name: insight.name || insight.title,
            type: insight.type || 'insight',
            content: insight.content || insight.description,
            metadata: insight.metadata || {},
            significance: insight.significance || 5
          });
          results.push(result);
        }
      }
      
      if (entities && entities.length > 0) {
        for (const entity of entities) {
          const result = await this.client.createKnowledgeEntity(entity);
          results.push(result);
        }
      }
      
      // Trigger synchronization
      await this.client.sendRequest('synchronization/sync/all', {
        strategy: merge_strategy
      });
      
      return {
        created: results.length,
        entities: results,
        synchronized: true
      };
    });
  }

  async extract_lessons_learned(params) {
    return this.withSystemReady('extract_lessons_learned', async () => {
      const { context, time_period, categories } = params;
      
      return await this.client.searchKnowledge({
        query: context,
        timePeriod: time_period,
        categories: categories || ['lesson', 'pattern', 'insight'],
        extractLessons: true
      });
    });
  }

  async schedule_analysis_task(params) {
    return this.withSystemReady('schedule_analysis_task', async () => {
      const { taskType, schedule, config } = params;
      
      return await this.client.scheduleTask({
        taskName: `analysis_${Date.now()}`,
        taskType,
        schedule,
        config
      });
    });
  }

  async get_system_status() {
    // Note: This tool doesn't require system ready check - it checks system status
    try {
      const healthStatus = await this.healthManager.getSystemStatus();
      
      let agentStatus = {};
      
      if (this.client && this.client.isConnected()) {
        try {
          agentStatus = await this.client.getSystemStatus();
        } catch (error) {
          this.logger.debug('Could not get detailed agent status:', error.message);
        }
      }
      
      return {
        ...healthStatus,
        agents: agentStatus.agents || {},
        details: {
          systemHealth: healthStatus,
          agentDetails: agentStatus
        }
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async get_mcp_server_status() {
    // This tool also doesn't require system ready - it's for diagnostic purposes
    return {
      status: 'running',
      serverType: 'semantic-analysis-mcp',
      features: [
        'auto-robust-operations',
        'system-health-management', 
        'port-conflict-resolution',
        '7-agent-coordination'
      ],
      lastHealthCheck: new Date(this.lastHealthCheck).toISOString(),
      systemReady: this.systemReady,
      clientConnected: this.client?.isConnected() || false,
      timestamp: new Date().toISOString()
    };
  }

  // Cleanup
  async cleanup() {
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  }
}

export { AutoRobustTools };