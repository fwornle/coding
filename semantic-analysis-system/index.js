#!/usr/bin/env node

/**
 * Semantic Analysis System - Main Entry Point
 * Starts all agents and services
 */

import { SemanticAnalysisAgent } from './agents/semantic-analysis/index.js';
import { WebSearchAgent } from './agents/web-search/index.js';
import { KnowledgeGraphAgent } from './agents/knowledge-graph/index.js';
import { CoordinatorAgent } from './agents/coordinator/index.js';
import { SynchronizationAgent } from './agents/synchronization/index.js';
import { DeduplicationAgent } from './agents/deduplication/index.js';
import { DocumentationAgent } from './agents/documentation/index.js';
import { AgentRegistry } from './framework/agent-registry.js';
import { AgentSupervisor } from './framework/lifecycle/supervisor.js';
import { MQTTBroker } from './infrastructure/mqtt/broker.js';
import { JSONRPCServer } from './infrastructure/rpc/server.js';
import { Logger } from './shared/logger.js';
import { ConfigManager } from './shared/config.js';
import { portManager } from './shared/port-manager.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Handle different working directories
const originalCwd = process.env.SEMANTIC_ANALYSIS_CWD || process.cwd();
const systemPath = process.env.SEMANTIC_ANALYSIS_SYSTEM_PATH || process.cwd();

class SemanticAnalysisSystem {
  constructor() {
    this.logger = new Logger('system');
    this.configManager = new ConfigManager();
    this.mqttBroker = null;
    this.rpcServer = null;
    this.agentRegistry = null;
    this.supervisor = null;
    this.agents = new Map();
    this.running = false;
  }

  async start() {
    try {
      this.logger.info('Starting Semantic Analysis System...');
      
      // Initialize port manager first to resolve all port conflicts
      await portManager.initialize();
      
      // Load configuration
      const config = this.configManager.config;
      
      // Start infrastructure
      await this.startInfrastructure(config);
      
      // Initialize agent registry and supervisor
      this.agentRegistry = new AgentRegistry();
      this.supervisor = new AgentSupervisor(config.supervisor);
      
      // Start agents
      await this.startAgents(config);
      
      // Setup shutdown handlers
      this.setupShutdownHandlers();
      
      this.running = true;
      this.logger.info('Semantic Analysis System started successfully');
      
      // Keep the process running
      this.keepAlive();
      
    } catch (error) {
      this.logger.error('Failed to start system:', error);
      await this.shutdown();
      process.exit(1);
    }
  }

  async startInfrastructure(config) {
    // Start MQTT broker
    const mqttConfig = this.configManager.getInfrastructureConfig('mqtt.broker') || {};
    this.mqttBroker = new MQTTBroker(mqttConfig);
    await this.mqttBroker.start();
    
    // Start RPC server  
    const rpcConfig = this.configManager.getJSONRPCConfig();
    this.rpcServer = new JSONRPCServer(rpcConfig);
    await this.rpcServer.start();
    
    this.logger.info('Infrastructure services started');
  }

  async startAgents(config) {
    const agentConfigs = {
      'semantic-analysis': {
        ...this.configManager.getAgentConfig('semantic-analysis'),
        llm: this.configManager.getLLMConfig('semantic-analysis')
      },
      'web-search': {
        ...this.configManager.getAgentConfig('web-search'),
        search: {
          provider: 'google',
          apiKey: process.env.GOOGLE_API_KEY,
          searchEngineId: process.env.GOOGLE_CSE_ID
        }
      },
      'knowledge-graph': {
        ...this.configManager.getAgentConfig('knowledge-graph'),
        knowledgeApi: {
          apiUrl: 'http://localhost:3001',
          timeout: 10000
        },
        ukb: {
          ukbPath: process.env.CODING_TOOLS_PATH + '/bin/ukb',
          sharedMemoryPath: process.env.CODING_KB_PATH + '/shared-memory-coding.json',
          autoSync: true
        }
      },
      'coordinator': {
        ...this.configManager.getAgentConfig('coordinator'),
        workflows: {},
        scheduling: {}
      },
      'synchronization': {
        ...this.configManager.getAgentConfig('synchronization')
      },
      'deduplication': {
        ...this.configManager.getAgentConfig('deduplication')
      },
      'documentation': {
        ...this.configManager.getAgentConfig('documentation')
      }
    };

    // Create agents
    const agentClasses = {
      'semantic-analysis': SemanticAnalysisAgent,
      'web-search': WebSearchAgent,
      'knowledge-graph': KnowledgeGraphAgent,
      'coordinator': CoordinatorAgent,
      'synchronization': SynchronizationAgent,
      'deduplication': DeduplicationAgent,
      'documentation': DocumentationAgent
    };

    for (const [agentId, AgentClass] of Object.entries(agentClasses)) {
      try {
        const agent = new AgentClass(agentConfigs[agentId]);
        
        // Register agent
        await this.agentRegistry.registerAgent(agent);
        await this.supervisor.registerAgent(agent);
        this.agents.set(agentId, agent);
        
        // Initialize agent
        await agent.initialize();
        
        this.logger.info(`Agent started: ${agentId}`);
        
      } catch (error) {
        this.logger.error(`Failed to start agent ${agentId}:`, error);
        // Continue with other agents
      }
    }
  }

  keepAlive() {
    // Perform initial health check
    this.performHealthCheck();
    
    // Keep the process running and monitor system health
    setInterval(() => {
      if (this.running) {
        this.performHealthCheck();
      }
    }, 15000); // Every 15 seconds
  }

  performHealthCheck() {
    try {
      const status = {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        agents: this.supervisor?.getStats() || {},
        infrastructure: {
          mqtt: this.mqttBroker?.isRunning() || false,
          rpc: this.rpcServer?.isRunning() || false
        }
      };
      
      this.logger.debug('System health check passed');
      
    } catch (error) {
      this.logger.error('Health check failed:', error);
    }
  }

  setupShutdownHandlers() {
    const shutdown = async (signal) => {
      this.logger.info(`Received ${signal}, shutting down gracefully...`);
      await this.shutdown();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('SIGQUIT', shutdown);

    process.on('uncaughtException', async (error) => {
      this.logger.error('Uncaught exception:', error);
      await this.shutdown();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason, promise) => {
      this.logger.error('Unhandled rejection at:', promise, 'reason:', reason);
      await this.shutdown();
      process.exit(1);
    });
  }

  async shutdown() {
    if (!this.running) return;
    
    this.logger.info('Shutting down Semantic Analysis System...');
    this.running = false;

    try {
      // Stop agents
      if (this.supervisor) {
        await this.supervisor.stop();
      }

      // Stop infrastructure
      if (this.rpcServer) {
        await this.rpcServer.stop();
      }

      if (this.mqttBroker) {
        await this.mqttBroker.stop();
      }

      // Cleanup port manager
      await portManager.cleanup();

      this.logger.info('System shutdown completed');
      
    } catch (error) {
      this.logger.error('Error during shutdown:', error);
    }
  }

  getStatus() {
    return {
      running: this.running,
      agents: Array.from(this.agents.keys()),
      infrastructure: {
        mqtt: this.mqttBroker?.isRunning() || false,
        rpc: this.rpcServer?.isRunning() || false
      },
      uptime: process.uptime(),
      memory: process.memoryUsage()
    };
  }
}

// Start the system
async function main() {
  const system = new SemanticAnalysisSystem();
  await system.start();
}

// Only run if this file is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Failed to start system:', error);
    process.exit(1);
  });
}

export { SemanticAnalysisSystem };