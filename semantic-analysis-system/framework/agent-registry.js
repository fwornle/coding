/**
 * Agent Registry
 * Manages agent discovery, registration, and lifecycle
 */

import { EventEmitter } from 'events';
import { Logger } from '../shared/logger.js';
import { EventTypes } from '../infrastructure/events/event-types.js';

export class AgentRegistry extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      healthCheckInterval: config.healthCheckInterval || 60000,
      agentTimeout: config.agentTimeout || 120000,
      ...config
    };
    
    this.logger = new Logger('agent-registry');
    this.agents = new Map();
    this.healthCheckInterval = null;
  }

  /**
   * Register an agent
   */
  async registerAgent(agent) {
    const agentInfo = {
      id: agent.config.id,
      instance: agent,
      status: agent.status,
      registeredAt: new Date(),
      lastHeartbeat: new Date(),
      capabilities: agent.getCapabilities ? await agent.getCapabilities() : [],
      metadata: agent.getMetadata ? await agent.getMetadata() : {}
    };
    
    this.agents.set(agent.config.id, agentInfo);
    
    // Set up event listeners
    this.setupAgentEventListeners(agent);
    
    this.logger.info(`Agent registered: ${agent.config.id}`);
    this.emit('agentRegistered', agentInfo);
    
    return agentInfo;
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(agentId) {
    const agentInfo = this.agents.get(agentId);
    
    if (agentInfo) {
      this.agents.delete(agentId);
      this.logger.info(`Agent unregistered: ${agentId}`);
      this.emit('agentUnregistered', agentInfo);
    }
  }

  /**
   * Get all registered agents
   */
  getAgents() {
    return Array.from(this.agents.values());
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId) {
    return this.agents.get(agentId);
  }

  /**
   * Get agents by capability
   */
  getAgentsByCapability(capability) {
    return this.getAgents().filter(agent => 
      agent.capabilities.includes(capability)
    );
  }

  /**
   * Get healthy agents
   */
  getHealthyAgents() {
    return this.getAgents().filter(agent => 
      agent.status === 'running' && this.isAgentHealthy(agent)
    );
  }

  /**
   * Check if agent is healthy
   */
  isAgentHealthy(agent) {
    const timeSinceHeartbeat = Date.now() - agent.lastHeartbeat.getTime();
    return timeSinceHeartbeat < this.config.agentTimeout;
  }

  /**
   * Find best agent for a capability
   */
  findBestAgent(capability, criteria = {}) {
    const candidates = this.getAgentsByCapability(capability)
      .filter(agent => this.isAgentHealthy(agent));
    
    if (candidates.length === 0) {
      return null;
    }
    
    // Simple load balancing - return least recently used
    return candidates.reduce((best, current) => {
      if (!best || current.lastHeartbeat < best.lastHeartbeat) {
        return current;
      }
      return best;
    });
  }

  /**
   * Set up event listeners for an agent
   */
  setupAgentEventListeners(agent) {
    // Update status on agent events
    agent.on('started', () => {
      this.updateAgentStatus(agent.config.id, 'running');
    });
    
    agent.on('stopped', () => {
      this.updateAgentStatus(agent.config.id, 'stopped');
    });
    
    agent.on('error', (error) => {
      this.updateAgentStatus(agent.config.id, 'error');
      this.logger.error(`Agent ${agent.config.id} error:`, error);
    });
    
    // Listen for health updates
    agent.on(EventTypes.AGENT_HEALTH_CHECK, (data) => {
      this.updateAgentHeartbeat(agent.config.id);
    });
  }

  /**
   * Update agent status
   */
  updateAgentStatus(agentId, status) {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status;
      agent.lastHeartbeat = new Date();
      this.emit('agentStatusUpdated', agent);
    }
  }

  /**
   * Update agent heartbeat
   */
  updateAgentHeartbeat(agentId) {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.lastHeartbeat = new Date();
    }
  }

  /**
   * Start monitoring agents
   */
  startMonitoring() {
    this.healthCheckInterval = setInterval(() => {
      this.checkAgentHealth();
    }, this.config.healthCheckInterval);
    
    this.logger.info('Agent monitoring started');
  }

  /**
   * Stop monitoring agents
   */
  stopMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    this.logger.info('Agent monitoring stopped');
  }

  /**
   * Check health of all agents
   */
  checkAgentHealth() {
    for (const [agentId, agent] of this.agents) {
      if (!this.isAgentHealthy(agent) && agent.status === 'running') {
        this.logger.warn(`Agent ${agentId} appears unhealthy`);
        
        this.updateAgentStatus(agentId, 'unhealthy');
        
        this.emit('agentUnhealthy', {
          agentId,
          lastHeartbeat: agent.lastHeartbeat,
          timeSinceHeartbeat: Date.now() - agent.lastHeartbeat.getTime()
        });
      }
    }
  }

  /**
   * Get registry statistics
   */
  getStats() {
    const agents = this.getAgents();
    const statusCounts = {};
    
    for (const agent of agents) {
      statusCounts[agent.status] = (statusCounts[agent.status] || 0) + 1;
    }
    
    return {
      totalAgents: agents.length,
      healthyAgents: this.getHealthyAgents().length,
      statusCounts,
      capabilities: this.getAllCapabilities()
    };
  }

  /**
   * Get all available capabilities
   */
  getAllCapabilities() {
    const capabilities = new Set();
    
    for (const agent of this.getAgents()) {
      for (const capability of agent.capabilities) {
        capabilities.add(capability);
      }
    }
    
    return Array.from(capabilities);
  }

  /**
   * Shutdown all agents
   */
  async shutdownAll() {
    this.logger.info('Shutting down all agents...');
    
    const shutdownPromises = [];
    
    for (const [agentId, agentInfo] of this.agents) {
      if (agentInfo.instance && typeof agentInfo.instance.stop === 'function') {
        shutdownPromises.push(
          agentInfo.instance.stop().catch(error => {
            this.logger.error(`Failed to stop agent ${agentId}:`, error);
          })
        );
      }
    }
    
    await Promise.all(shutdownPromises);
    this.agents.clear();
    
    this.logger.info('All agents shut down');
  }

  /**
   * Restart an agent
   */
  async restartAgent(agentId) {
    const agentInfo = this.agents.get(agentId);
    
    if (!agentInfo || !agentInfo.instance) {
      throw new Error(`Agent ${agentId} not found or no instance available`);
    }
    
    this.logger.info(`Restarting agent: ${agentId}`);
    
    try {
      await agentInfo.instance.stop();
      await agentInfo.instance.start();
      
      this.logger.info(`Agent ${agentId} restarted successfully`);
      this.emit('agentRestarted', agentInfo);
      
    } catch (error) {
      this.logger.error(`Failed to restart agent ${agentId}:`, error);
      throw error;
    }
  }
}