#!/usr/bin/env node

/**
 * Semantic Analysis System - Main Entry Point
 * Starts all agents and services
 */

import { SemanticAnalysisAgent } from './agents/semantic-analysis/index.js';
import { WebSearchAgent } from './agents/web-search/index.js';
import { KnowledgeGraphAgent } from './agents/knowledge-graph/index.js';
import { CoordinatorAgent } from './agents/coordinator/index.js';
import { AgentRegistry } from './framework/agent-registry.js';
import { AgentSupervisor } from './framework/lifecycle/supervisor.js';
import { MQTTBroker } from './infrastructure/mqtt/broker.js';
import { RPCServer } from './infrastructure/rpc/server.js';
import { Logger } from './shared/logger.js';
import { ConfigManager } from './shared/config.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

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
      
      // Load configuration
      const config = await this.configManager.loadConfig();
      
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
    this.mqttBroker = new MQTTBroker(config.mqtt);
    await this.mqttBroker.start();
    
    // Start RPC server
    this.rpcServer = new RPCServer(config.rpc);
    await this.rpcServer.start();
    
    this.logger.info('Infrastructure services started');
  }

  async startAgents(config) {
    const agentConfigs = {
      'semantic-analysis': {
        ...config.agents?.semanticAnalysis,
        llm: config.llm
      },
      'web-search': {
        ...config.agents?.webSearch,
        search: config.search
      },
      'knowledge-graph': {
        ...config.agents?.knowledgeGraph,
        knowledgeApi: config.knowledgeApi,
        ukb: config.ukb
      },
      'coordinator': {
        ...config.agents?.coordinator,
        workflows: config.workflows,
        scheduling: config.scheduling
      }
    };

    // Create agents
    const agentClasses = {
      'semantic-analysis': SemanticAnalysisAgent,
      'web-search': WebSearchAgent,
      'knowledge-graph': KnowledgeGraphAgent,
      'coordinator': CoordinatorAgent
    };

    for (const [agentId, AgentClass] of Object.entries(agentClasses)) {
      try {
        const agent = new AgentClass(agentConfigs[agentId]);
        
        // Register agent
        this.agentRegistry.register(agent);
        this.supervisor.addAgent(agent);
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
    // Keep the process running and monitor system health
    setInterval(() => {
      if (this.running) {
        this.performHealthCheck();
      }
    }, 30000); // Every 30 seconds
  }

  performHealthCheck() {
    try {
      const status = {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        agents: this.supervisor?.getAgentStatus() || {},
        infrastructure: {
          mqtt: this.mqttBroker?.isRunning() || false,
          rpc: this.rpcServer?.isRunning() || false
        }
      };
      
      this.logger.debug('Health check:', JSON.stringify(status, null, 2));
      
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
        await this.supervisor.stopAll();
      }

      // Stop infrastructure
      if (this.rpcServer) {
        await this.rpcServer.stop();
      }

      if (this.mqttBroker) {
        await this.mqttBroker.stop();
      }

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