#!/usr/bin/env node

/**
 * Start Agents Script
 * Starts the semantic analysis agent system infrastructure
 */

import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { Logger } from '../shared/logger.js';
import chalk from 'chalk';
import ora from 'ora';

const logger = new Logger('start-agents');

class AgentSystemStarter {
  constructor() {
    this.processes = new Map();
    this.config = null;
  }

  async loadConfig() {
    // Load environment variables
    try {
      const { config } = await import('dotenv');
      
      // Load root .env first (main API keys)
      const rootEnvPath = new URL('../../.env', import.meta.url).pathname;
      if (existsSync(rootEnvPath)) {
        config({ path: rootEnvPath });
      }
      
      // Load local .env second (for overrides and local config)
      const localEnvPath = new URL('../.env', import.meta.url).pathname;
      if (existsSync(localEnvPath)) {
        config({ path: localEnvPath, override: false });
      }
      
    } catch (error) {
      logger.warn('Could not load .env files:', error.message);
    }

    return {
      mqttPort: process.env.MQTT_BROKER_PORT || 1883,
      rpcPort: process.env.JSON_RPC_PORT || 8080,
      mqttHost: process.env.MQTT_BROKER_HOST || 'localhost',
      enabledAgents: {
        semantic: process.env.AGENT_SEMANTIC_ENABLED === 'true',
        websearch: process.env.AGENT_WEBSEARCH_ENABLED === 'true',
        knowledge: process.env.AGENT_KNOWLEDGE_ENABLED === 'true',
        coordinator: process.env.AGENT_COORDINATOR_ENABLED === 'true'
      }
    };
  }

  async start() {
    console.log(chalk.blue.bold('\n🚀 Starting Semantic Analysis Agent System\n'));

    try {
      // Load configuration
      this.config = await this.loadConfig();
      
      // Check API keys
      await this.checkApiKeys();
      
      // Start MQTT broker (embedded)
      await this.startMQTTBroker();
      
      // Start RPC server
      await this.startRPCServer();
      
      // Start individual agents
      await this.startAgents();
      
      console.log(chalk.green.bold('\n✅ Agent system started successfully!'));
      console.log(chalk.yellow('\n📋 System Status:'));
      console.log(`   MQTT Broker: running on port ${this.config.mqttPort}`);
      console.log(`   RPC Server: running on port ${this.config.rpcPort}`);
      console.log(`   Active Agents: ${Object.values(this.config.enabledAgents).filter(Boolean).length}`);
      console.log(chalk.gray('\n💡 Use Ctrl+C to stop all services\n'));
      
      // Keep the process running
      this.setupGracefulShutdown();
      await this.keepRunning();
      
    } catch (error) {
      console.error(chalk.red.bold('\n❌ Failed to start agent system:'));
      console.error(chalk.red(`   ${error.message}\n`));
      process.exit(1);
    }
  }

  async checkApiKeys() {
    const spinner = ora('Checking API keys...').start();
    
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    
    if ((!anthropicKey || anthropicKey === 'your-anthropic-api-key') && 
        (!openaiKey || openaiKey === 'your-openai-api-key')) {
      spinner.fail('No valid API keys found');
      throw new Error('Please configure ANTHROPIC_API_KEY or OPENAI_API_KEY in .env file');
    }
    
    const configuredKeys = [];
    if (anthropicKey && anthropicKey !== 'your-anthropic-api-key') {
      configuredKeys.push('ANTHROPIC_API_KEY');
    }
    if (openaiKey && openaiKey !== 'your-openai-api-key') {
      configuredKeys.push('OPENAI_API_KEY');
    }
    
    spinner.succeed(`API keys configured: ${configuredKeys.join(', ')}`);
  }

  async startMQTTBroker() {
    const spinner = ora('Starting embedded MQTT broker...').start();
    
    try {
      // Use embedded Aedes MQTT broker
      const { default: aedes } = await import('aedes');
      const { createServer } = await import('net');
      
      const broker = aedes();
      const server = createServer(broker.handle);
      
      await new Promise((resolve, reject) => {
        server.listen(this.config.mqttPort, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      
      this.processes.set('mqtt-broker', { server, broker });
      spinner.succeed(`MQTT broker started on port ${this.config.mqttPort}`);
      
    } catch (error) {
      spinner.fail('Failed to start MQTT broker');
      throw error;
    }
  }

  async startRPCServer() {
    const spinner = ora('Starting RPC server...').start();
    
    try {
      // Create a simple RPC server for basic functionality
      const { default: jayson } = await import('jayson');
      
      const server = jayson.server({
        ping: () => 'pong',
        status: () => ({
          status: 'running',
          timestamp: new Date().toISOString(),
          services: ['mqtt-broker', 'rpc-server']
        })
      });
      
      const httpServer = server.http();
      
      await new Promise((resolve, reject) => {
        httpServer.listen(this.config.rpcPort, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      
      this.processes.set('rpc-server', httpServer);
      spinner.succeed(`RPC server started on port ${this.config.rpcPort}`);
      
    } catch (error) {
      spinner.fail('Failed to start RPC server');
      throw error;
    }
  }

  async startAgents() {
    const spinner = ora('Starting semantic analysis agents...').start();
    
    // For now, we'll create placeholder agents
    // In a full implementation, these would be separate agent processes
    const agentCount = Object.values(this.config.enabledAgents).filter(Boolean).length;
    
    spinner.succeed(`${agentCount} agents configured (placeholder implementation)`);
    
    // Note: In a complete implementation, you would start actual agent processes here
    logger.info('Agent system infrastructure ready for semantic analysis tools');
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      console.log(chalk.yellow(`\n\n🛑 Received ${signal}, shutting down gracefully...`));
      
      for (const [name, process] of this.processes) {
        try {
          console.log(chalk.gray(`   Stopping ${name}...`));
          if (process.close) {
            await new Promise(resolve => process.close(resolve));
          } else if (process.kill) {
            process.kill();
          }
        } catch (error) {
          console.log(chalk.red(`   Failed to stop ${name}: ${error.message}`));
        }
      }
      
      console.log(chalk.green('✅ All services stopped. Goodbye!\n'));
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  async keepRunning() {
    // Keep the process alive
    return new Promise(() => {
      // This will run until the process is terminated
    });
  }
}

// Start the system if this script is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const starter = new AgentSystemStarter();
  starter.start().catch(error => {
    console.error(chalk.red.bold('\n💥 Unhandled error:'));
    console.error(chalk.red(error.stack || error.message));
    process.exit(1);
  });
}

export default AgentSystemStarter;