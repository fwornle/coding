#!/usr/bin/env node

/**
 * Robust Semantic Analysis System Manager
 * Ensures the system is always ready when MCP tools are called
 * Handles: port conflicts, failed agents, process recovery, health monitoring
 */

import { spawn, exec } from 'child_process';
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { promisify } from 'util';
import { Logger } from './shared/logger.js';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class SystemManager {
  constructor() {
    this.logger = new Logger('system-manager');
    this.config = {
      mqttPort: 1884,  // Avoid conflict with default MQTT 1883
      rpcPort: 8082,   // Avoid conflict with browser-access 8081
      maxRetries: 3,
      healthCheckInterval: 30000,
      startupTimeout: 60000
    };
    this.processes = new Map();
    this.systemState = {
      mqttBroker: 'stopped',
      rpcServer: 'stopped',
      agents: new Map(),
      lastHealthCheck: null,
      errors: []
    };
  }

  /**
   * Main entry point - ensures system is ready for MCP tools
   */
  async ensureSystemReady() {
    try {
      this.logger.info('🔍 Checking system status...');
      
      // Quick health check first
      const isHealthy = await this.performHealthCheck();
      if (isHealthy) {
        this.logger.info('✅ System already running and healthy');
        return { status: 'ready', message: 'System is operational' };
      }

      this.logger.info('🚀 System needs startup/recovery...');
      return await this.startOrRecoverSystem();
      
    } catch (error) {
      this.logger.error('❌ Failed to ensure system ready:', error);
      throw new Error(`System startup failed: ${error.message}`);
    }
  }

  /**
   * Comprehensive health check
   */
  async performHealthCheck() {
    try {
      // Check if processes are running
      const mqttRunning = await this.isPortInUse(this.config.mqttPort);
      const rpcRunning = await this.isPortInUse(this.config.rpcPort);
      
      // Check if agent processes exist
      const agentProcesses = await this.findAgentProcesses();
      
      // Test actual connectivity
      let mqttConnectable = false;
      let rpcConnectable = false;
      
      if (mqttRunning) {
        mqttConnectable = await this.testMQTTConnection();
      }
      
      if (rpcRunning) {
        rpcConnectable = await this.testRPCConnection();
      }

      const isHealthy = mqttConnectable && rpcConnectable && agentProcesses.length > 0;
      
      this.systemState = {
        mqttBroker: mqttConnectable ? 'running' : 'failed',
        rpcServer: rpcConnectable ? 'running' : 'failed',
        agents: this.mapAgentProcesses(agentProcesses),
        lastHealthCheck: new Date().toISOString(),
        errors: []
      };

      this.logger.info(`Health check: MQTT=${mqttConnectable}, RPC=${rpcConnectable}, Agents=${agentProcesses.length}`);
      return isHealthy;
      
    } catch (error) {
      this.logger.error('Health check failed:', error);
      return false;
    }
  }

  /**
   * Start or recover the system with intelligent conflict resolution
   */
  async startOrRecoverSystem() {
    try {
      // Step 1: Clean up any zombie processes
      await this.cleanupZombieProcesses();
      
      // Step 2: Find available ports if conflicts exist
      await this.resolvePortConflicts();
      
      // Step 3: Start the agent system
      await this.startAgentSystem();
      
      // Step 4: Wait for system to be ready
      await this.waitForSystemReady();
      
      // Step 5: Update MCP server configuration if needed
      await this.updateMCPConfiguration();
      
      return { 
        status: 'ready', 
        message: 'System started successfully',
        config: {
          mqttPort: this.config.mqttPort,
          rpcPort: this.config.rpcPort
        }
      };
      
    } catch (error) {
      this.logger.error('Failed to start/recover system:', error);
      throw error;
    }
  }

  /**
   * Check if a port is in use
   */
  async isPortInUse(port) {
    try {
      const { stdout } = await execAsync(`lsof -i :${port}`);
      return stdout.trim().length > 0;
    } catch (error) {
      return false; // Port is free
    }
  }

  /**
   * Test MQTT connection
   */
  async testMQTTConnection() {
    try {
      const mqtt = await import('mqtt');
      return new Promise((resolve) => {
        const client = mqtt.connect(`mqtt://localhost:${this.config.mqttPort}`, {
          connectTimeout: 5000
        });
        
        client.on('connect', () => {
          client.end();
          resolve(true);
        });
        
        client.on('error', () => {
          resolve(false);
        });
        
        setTimeout(() => {
          client.end();
          resolve(false);
        }, 5000);
      });
    } catch (error) {
      return false;
    }
  }

  /**
   * Test RPC connection
   */
  async testRPCConnection() {
    try {
      const response = await fetch(`http://localhost:${this.config.rpcPort}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Find running agent processes
   */
  async findAgentProcesses() {
    try {
      const { stdout } = await execAsync(`ps aux | grep "start-agents.js" | grep -v grep`);
      const lines = stdout.trim().split('\n').filter(line => line.length > 0);
      return lines.map(line => {
        const parts = line.trim().split(/\s+/);
        return {
          pid: parseInt(parts[1]),
          command: parts.slice(10).join(' ')
        };
      });
    } catch (error) {
      return [];
    }
  }

  /**
   * Map agent processes to readable format
   */
  mapAgentProcesses(processes) {
    const agentMap = new Map();
    processes.forEach(proc => {
      agentMap.set(`agent-${proc.pid}`, {
        pid: proc.pid,
        status: 'running',
        command: proc.command
      });
    });
    return agentMap;
  }

  /**
   * Clean up zombie/stale processes
   */
  async cleanupZombieProcesses() {
    try {
      this.logger.info('🧹 Cleaning up zombie processes...');
      
      // Find and kill stale agent processes
      const agentProcesses = await this.findAgentProcesses();
      for (const proc of agentProcesses) {
        try {
          // Test if process is responsive
          const isResponsive = await this.testProcessResponsiveness(proc.pid);
          if (!isResponsive) {
            this.logger.warn(`Killing unresponsive process ${proc.pid}`);
            process.kill(proc.pid, 'SIGTERM');
            await this.sleep(2000);
            
            // Force kill if still running
            try {
              process.kill(proc.pid, 'SIGKILL');
            } catch (e) {
              // Process already dead
            }
          }
        } catch (error) {
          this.logger.warn(`Failed to clean up process ${proc.pid}:`, error.message);
        }
      }
      
      await this.sleep(3000); // Give processes time to die
      
    } catch (error) {
      this.logger.warn('Cleanup had issues:', error.message);
    }
  }

  /**
   * Test if a process is responsive
   */
  async testProcessResponsiveness(pid) {
    try {
      // Send a zero signal to test if process exists and is responsive
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Resolve port conflicts by finding available ports
   */
  async resolvePortConflicts() {
    this.logger.info('🔍 Checking for port conflicts...');
    
    // Check MQTT port
    if (await this.isPortInUse(this.config.mqttPort)) {
      const newMqttPort = await this.findAvailablePort(this.config.mqttPort + 1);
      this.logger.warn(`MQTT port ${this.config.mqttPort} in use, switching to ${newMqttPort}`);
      this.config.mqttPort = newMqttPort;
    }
    
    // Check RPC port
    if (await this.isPortInUse(this.config.rpcPort)) {
      const newRpcPort = await this.findAvailablePort(this.config.rpcPort + 1);
      this.logger.warn(`RPC port ${this.config.rpcPort} in use, switching to ${newRpcPort}`);
      this.config.rpcPort = newRpcPort;
    }
    
    this.logger.info(`Using ports: MQTT=${this.config.mqttPort}, RPC=${this.config.rpcPort}`);
  }

  /**
   * Find an available port starting from a given port
   */
  async findAvailablePort(startPort) {
    for (let port = startPort; port < startPort + 100; port++) {
      if (!(await this.isPortInUse(port))) {
        return port;
      }
    }
    throw new Error(`No available ports found starting from ${startPort}`);
  }

  /**
   * Start the agent system with proper environment variables
   */
  async startAgentSystem() {
    this.logger.info('🚀 Starting agent system...');
    
    const env = {
      ...process.env,
      MQTT_BROKER_PORT: this.config.mqttPort.toString(),
      JSON_RPC_PORT: this.config.rpcPort.toString(),
      AGENT_SEMANTIC_ENABLED: 'true',
      AGENT_WEBSEARCH_ENABLED: 'true',
      AGENT_KNOWLEDGE_ENABLED: 'true',
      AGENT_COORDINATOR_ENABLED: 'true',
      AGENT_SYNCHRONIZATION_ENABLED: 'true',
      AGENT_DEDUPLICATION_ENABLED: 'true',
      AGENT_DOCUMENTATION_ENABLED: 'true'
    };

    return new Promise((resolve, reject) => {
      const agentProcess = spawn('node', ['index.js'], {
        cwd: __dirname,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
      });

      let output = '';
      let errorOutput = '';
      
      agentProcess.stdout.on('data', (data) => {
        output += data.toString();
        this.logger.debug('Agent output:', data.toString().trim());
      });
      
      agentProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
        this.logger.debug('Agent error:', data.toString().trim());
      });

      // Set a timeout for startup
      const timeout = setTimeout(() => {
        agentProcess.kill('SIGTERM');
        reject(new Error('Agent system startup timeout'));
      }, this.config.startupTimeout);

      // Check for successful startup message
      const checkSuccess = setInterval(() => {
        if (output.includes('Semantic Analysis System started successfully') || 
            output.includes('started successfully')) {
          clearTimeout(timeout);
          clearInterval(checkSuccess);
          this.processes.set('agents', agentProcess);
          resolve();
        }
        if (errorOutput.includes('Error:') || errorOutput.includes('EADDRINUSE')) {
          clearTimeout(timeout);
          clearInterval(checkSuccess);
          reject(new Error(`Agent startup failed: ${errorOutput}`));
        }
      }, 1000);

      agentProcess.on('exit', (code) => {
        clearTimeout(timeout);
        clearInterval(checkSuccess);
        if (code !== 0) {
          reject(new Error(`Agent process exited with code ${code}: ${errorOutput}`));
        }
      });
    });
  }

  /**
   * Wait for the system to be fully ready
   */
  async waitForSystemReady() {
    this.logger.info('⏳ Waiting for system to be ready...');
    
    const maxWait = 30000; // 30 seconds
    const checkInterval = 2000; // 2 seconds
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      const isReady = await this.performHealthCheck();
      if (isReady) {
        this.logger.info('✅ System is ready!');
        return;
      }
      await this.sleep(checkInterval);
    }
    
    throw new Error('System did not become ready within timeout period');
  }

  /**
   * Update MCP server configuration with correct ports
   */
  async updateMCPConfiguration() {
    try {
      const mcpClientPath = path.join(__dirname, 'mcp-server/clients/semantic-analysis-client.js');
      let content = await fs.readFile(mcpClientPath, 'utf8');
      
      // Update the RPC URL with the correct port
      const oldPattern = /rpcUrl: config\.rpcUrl \|\| `http:\/\/localhost:\$\{process\.env\.JSON_RPC_PORT \|\| '\d+'\}`,/;
      const newRpcUrl = `rpcUrl: config.rpcUrl || \`http://localhost:\${process.env.JSON_RPC_PORT || '${this.config.rpcPort}'}\`,`;
      
      if (oldPattern.test(content)) {
        content = content.replace(oldPattern, newRpcUrl);
        await fs.writeFile(mcpClientPath, content, 'utf8');
        this.logger.info(`Updated MCP client configuration for port ${this.config.rpcPort}`);
      }
      
    } catch (error) {
      this.logger.warn('Failed to update MCP configuration:', error.message);
    }
  }

  /**
   * Get current system status
   */
  getSystemStatus() {
    return {
      ...this.systemState,
      config: this.config,
      uptime: process.uptime()
    };
  }

  /**
   * Utility: Sleep for specified milliseconds
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    this.logger.info('🛑 Shutting down system...');
    
    for (const [name, process] of this.processes) {
      try {
        if (process && process.kill) {
          process.kill('SIGTERM');
          await this.sleep(2000);
          process.kill('SIGKILL');
        }
      } catch (error) {
        this.logger.warn(`Failed to stop ${name}:`, error.message);
      }
    }
  }
}

// CLI interface when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const manager = new SystemManager();
  
  const command = process.argv[2] || 'ensure-ready';
  
  switch (command) {
    case 'ensure-ready':
      manager.ensureSystemReady()
        .then(result => {
          console.log('✅ System ready:', JSON.stringify(result, null, 2));
          process.exit(0);
        })
        .catch(error => {
          console.error('❌ System failed:', error.message);
          process.exit(1);
        });
      break;
      
    case 'health-check':
      manager.performHealthCheck()
        .then(isHealthy => {
          console.log(`Health: ${isHealthy ? 'HEALTHY' : 'UNHEALTHY'}`);
          console.log('Status:', JSON.stringify(manager.getSystemStatus(), null, 2));
          process.exit(isHealthy ? 0 : 1);
        })
        .catch(error => {
          console.error('❌ Health check failed:', error.message);
          process.exit(1);
        });
      break;
      
    case 'shutdown':
      manager.shutdown()
        .then(() => {
          console.log('✅ System shutdown complete');
          process.exit(0);
        })
        .catch(error => {
          console.error('❌ Shutdown failed:', error.message);
          process.exit(1);
        });
      break;
      
    default:
      console.log('Usage: node system-manager.js [ensure-ready|health-check|shutdown]');
      process.exit(1);
  }
}

export default SystemManager;