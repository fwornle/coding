/**
 * Agent Supervisor
 * Manages agent lifecycle, health monitoring, and automatic recovery
 */

import { EventEmitter } from 'events';
import { Logger } from '../../shared/logger.js';
import { AgentRegistry } from '../agent-registry.js';

export class AgentSupervisor extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      healthCheckInterval: config.healthCheckInterval || 30000,
      restartThreshold: config.restartThreshold || 3,
      restartDelay: config.restartDelay || 5000,
      maxRestartAttempts: config.maxRestartAttempts || 5,
      ...config
    };
    
    this.logger = new Logger('agent-supervisor');
    this.registry = new AgentRegistry(this.config);
    this.healthCheckInterval = null;
    this.restartAttempts = new Map();
    this.quarantinedAgents = new Set();
  }

  /**
   * Start supervising agents
   */
  async start() {
    this.logger.info('Starting agent supervisor...');
    
    // Set up registry event handlers
    this.setupRegistryEventHandlers();
    
    // Start monitoring
    this.registry.startMonitoring();
    this.startHealthChecks();
    
    this.logger.info('Agent supervisor started');
    this.emit('started');
  }

  /**
   * Stop supervising agents
   */
  async stop() {
    this.logger.info('Stopping agent supervisor...');
    
    // Stop health checks
    this.stopHealthChecks();
    
    // Stop registry monitoring
    this.registry.stopMonitoring();
    
    // Shutdown all agents
    await this.registry.shutdownAll();
    
    this.logger.info('Agent supervisor stopped');
    this.emit('stopped');
  }

  /**
   * Register an agent for supervision
   */
  async registerAgent(agent) {
    await this.registry.registerAgent(agent);
    
    // Set up agent-specific monitoring
    this.setupAgentMonitoring(agent);
    
    this.logger.info(`Now supervising agent: ${agent.config.id}`);
    return agent;
  }

  /**
   * Unregister an agent from supervision
   */
  unregisterAgent(agentId) {
    this.registry.unregisterAgent(agentId);
    this.restartAttempts.delete(agentId);
    this.quarantinedAgents.delete(agentId);
    
    this.logger.info(`No longer supervising agent: ${agentId}`);
  }

  /**
   * Set up registry event handlers
   */
  setupRegistryEventHandlers() {
    this.registry.on('agentUnhealthy', (data) => {
      this.handleUnhealthyAgent(data);
    });
    
    this.registry.on('agentRegistered', (agentInfo) => {
      this.emit('agentRegistered', agentInfo);
    });
    
    this.registry.on('agentUnregistered', (agentInfo) => {
      this.emit('agentUnregistered', agentInfo);
    });
  }

  /**
   * Set up monitoring for a specific agent
   */
  setupAgentMonitoring(agent) {
    // Monitor agent errors
    agent.on('error', (error) => {
      this.handleAgentError(agent.config.id, error);
    });
    
    // Monitor agent stops
    agent.on('stopped', () => {
      this.handleAgentStopped(agent.config.id);
    });
    
    // Monitor memory usage
    agent.on('memoryWarning', (data) => {
      this.handleMemoryWarning(agent.config.id, data);
    });
  }

  /**
   * Handle unhealthy agent
   */
  async handleUnhealthyAgent(data) {
    const { agentId } = data;
    
    if (this.quarantinedAgents.has(agentId)) {
      this.logger.debug(`Agent ${agentId} already quarantined`);
      return;
    }
    
    this.logger.warn(`Agent ${agentId} is unhealthy, attempting recovery...`);
    
    try {
      await this.attemptAgentRecovery(agentId);
    } catch (error) {
      this.logger.error(`Failed to recover agent ${agentId}:`, error);
      this.quarantineAgent(agentId);
    }
  }

  /**
   * Handle agent error
   */
  async handleAgentError(agentId, error) {
    this.logger.error(`Agent ${agentId} reported error:`, error);
    
    const attempts = this.restartAttempts.get(agentId) || 0;
    
    if (attempts < this.config.maxRestartAttempts) {
      await this.scheduleRestart(agentId, this.config.restartDelay);
    } else {
      this.logger.error(`Agent ${agentId} exceeded restart attempts, quarantining`);
      this.quarantineAgent(agentId);
    }
  }

  /**
   * Handle agent stopped
   */
  async handleAgentStopped(agentId) {
    const agentInfo = this.registry.getAgent(agentId);
    
    if (agentInfo && agentInfo.status !== 'stopping') {
      this.logger.warn(`Agent ${agentId} stopped unexpectedly`);
      await this.scheduleRestart(agentId, this.config.restartDelay);
    }
  }

  /**
   * Handle memory warning
   */
  handleMemoryWarning(agentId, data) {
    this.logger.warn(`Agent ${agentId} memory warning:`, data);
    
    // If memory usage is critical, restart the agent
    if (data.usage > 0.9) { // 90% memory usage
      this.logger.warn(`Agent ${agentId} critical memory usage, restarting...`);
      this.scheduleRestart(agentId, 1000); // Immediate restart
    }
  }

  /**
   * Attempt to recover an agent
   */
  async attemptAgentRecovery(agentId) {
    const agentInfo = this.registry.getAgent(agentId);
    
    if (!agentInfo || !agentInfo.instance) {
      throw new Error(`Agent ${agentId} not found or no instance available`);
    }
    
    this.logger.info(`Attempting to recover agent: ${agentId}`);
    
    try {
      // Try health check first
      const health = await agentInfo.instance.getHealth();
      
      if (health.status === 'running') {
        this.logger.info(`Agent ${agentId} recovered on its own`);
        return;
      }
      
      // Try restart
      await this.restartAgent(agentId);
      
    } catch (error) {
      this.logger.error(`Recovery attempt failed for agent ${agentId}:`, error);
      throw error;
    }
  }

  /**
   * Schedule agent restart
   */
  async scheduleRestart(agentId, delay = 0) {
    const attempts = this.restartAttempts.get(agentId) || 0;
    this.restartAttempts.set(agentId, attempts + 1);
    
    this.logger.info(`Scheduling restart for agent ${agentId} (attempt ${attempts + 1}) in ${delay}ms`);
    
    setTimeout(async () => {
      try {
        await this.restartAgent(agentId);
        this.logger.info(`Agent ${agentId} restarted successfully`);
        
        // Reset restart attempts on successful restart
        this.restartAttempts.set(agentId, 0);
        
      } catch (error) {
        this.logger.error(`Failed to restart agent ${agentId}:`, error);
        
        const newAttempts = this.restartAttempts.get(agentId) || 0;
        if (newAttempts >= this.config.maxRestartAttempts) {
          this.quarantineAgent(agentId);
        }
      }
    }, delay);
  }

  /**
   * Restart an agent
   */
  async restartAgent(agentId) {
    await this.registry.restartAgent(agentId);
    this.emit('agentRestarted', { agentId, timestamp: new Date() });
  }

  /**
   * Quarantine an agent
   */
  quarantineAgent(agentId) {
    this.quarantinedAgents.add(agentId);
    
    this.logger.error(`Agent ${agentId} quarantined due to repeated failures`);
    
    this.emit('agentQuarantined', {
      agentId,
      timestamp: new Date(),
      attempts: this.restartAttempts.get(agentId) || 0
    });
  }

  /**
   * Remove agent from quarantine
   */
  removeFromQuarantine(agentId) {
    if (this.quarantinedAgents.has(agentId)) {
      this.quarantinedAgents.delete(agentId);
      this.restartAttempts.set(agentId, 0);
      
      this.logger.info(`Agent ${agentId} removed from quarantine`);
      this.emit('agentUnquarantined', { agentId, timestamp: new Date() });
    }
  }

  /**
   * Start health checks
   */
  startHealthChecks() {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, this.config.healthCheckInterval);
  }

  /**
   * Stop health checks
   */
  stopHealthChecks() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Perform health checks on all agents
   */
  async performHealthChecks() {
    const agents = this.registry.getAgents();
    
    for (const agentInfo of agents) {
      if (this.quarantinedAgents.has(agentInfo.id)) {
        continue; // Skip quarantined agents
      }
      
      try {
        await this.checkAgentHealth(agentInfo);
      } catch (error) {
        this.logger.error(`Health check failed for agent ${agentInfo.id}:`, error);
      }
    }
  }

  /**
   * Check health of a specific agent
   */
  async checkAgentHealth(agentInfo) {
    if (!agentInfo.instance || !agentInfo.instance.getHealth) {
      return;
    }
    
    try {
      const health = await agentInfo.instance.getHealth();
      
      // Check memory usage
      if (health.memory) {
        const memoryUsage = health.memory.heapUsed / health.memory.heapTotal;
        if (memoryUsage > 0.8) {
          this.emit('memoryWarning', {
            agentId: agentInfo.id,
            usage: memoryUsage,
            memory: health.memory
          });
        }
      }
      
      // Check uptime
      if (health.uptime && health.uptime < 60000) { // Less than 1 minute uptime
        this.logger.debug(`Agent ${agentInfo.id} recently restarted`);
      }
      
    } catch (error) {
      this.logger.warn(`Failed to get health from agent ${agentInfo.id}:`, error);
    }
  }

  /**
   * Get supervisor statistics
   */
  getStats() {
    const registryStats = this.registry.getStats();
    
    return {
      ...registryStats,
      quarantinedAgents: this.quarantinedAgents.size,
      restartAttempts: Array.from(this.restartAttempts.entries()).reduce((acc, [agentId, attempts]) => {
        acc[agentId] = attempts;
        return acc;
      }, {}),
      supervisionStarted: this.healthCheckInterval !== null
    };
  }

  /**
   * Get agent registry
   */
  getRegistry() {
    return this.registry;
  }
}