/**
 * Semantic Analysis Client
 * Client for connecting to the semantic analysis agent system
 */

import { EventEmitter } from 'events';
import { Logger } from '../../shared/logger.js';
import { EventTypes } from '../../infrastructure/events/event-types.js';
import mqtt from 'mqtt';
import jayson from 'jayson/promise/index.js';

export class SemanticAnalysisClient extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      mqttUrl: config.mqttUrl || 'mqtt://localhost:1883',
      rpcUrl: config.rpcUrl || 'http://localhost:3001',
      timeout: config.timeout || 30000,
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 5000,
      ...config
    };
    
    this.logger = new Logger('semantic-analysis-client');
    this.mqttClient = null;
    this.rpcClient = null;
    this.connected = false;
    this.pendingRequests = new Map();
  }

  async connect() {
    try {
      // Connect to MQTT broker
      await this.connectMQTT();
      
      // Connect to RPC server
      await this.connectRPC();
      
      this.connected = true;
      this.logger.info('Connected to semantic analysis system');
      
    } catch (error) {
      this.logger.error('Failed to connect to semantic analysis system:', error);
      throw error;
    }
  }

  async connectMQTT() {
    return new Promise((resolve, reject) => {
      try {
        this.mqttClient = mqtt.connect(this.config.mqttUrl, {
          clientId: `mcp-client-${Date.now()}`,
          clean: true,
          reconnectPeriod: 5000,
          connectTimeout: 10000
        });

        this.mqttClient.on('connect', () => {
          this.logger.debug('Connected to MQTT broker');
          
          // Subscribe to response events
          this.mqttClient.subscribe([
            'analysis/+/completed',
            'search/+/completed',
            'knowledge/+/completed',
            'coordinator/+/completed',
            'workflow/+/completed',
            '+/error'
          ]);
          
          resolve();
        });

        this.mqttClient.on('error', (error) => {
          this.logger.error('MQTT connection error:', error);
          reject(error);
        });

        this.mqttClient.on('message', (topic, message) => {
          this.handleMQTTMessage(topic, message);
        });

        // Set connection timeout
        setTimeout(() => {
          if (!this.mqttClient.connected) {
            reject(new Error('MQTT connection timeout'));
          }
        }, 10000);

      } catch (error) {
        reject(error);
      }
    });
  }

  async connectRPC() {
    try {
      this.rpcClient = jayson.Client.http(this.config.rpcUrl);
      
      // Test connection
      await this.rpcClient.request('ping', {});
      this.logger.debug('Connected to RPC server');
      
    } catch (error) {
      this.logger.warn('RPC connection failed, using MQTT only:', error.message);
      // Continue without RPC - we can still use MQTT
    }
  }

  handleMQTTMessage(topic, message) {
    try {
      const data = JSON.parse(message.toString());
      
      // Handle response for pending requests
      if (data.requestId && this.pendingRequests.has(data.requestId)) {
        const request = this.pendingRequests.get(data.requestId);
        
        if (topic.includes('completed')) {
          request.resolve(data.result || data);
        } else if (topic.includes('error') || topic.includes('failed')) {
          request.reject(new Error(data.error || 'Request failed'));
        }
        
        this.pendingRequests.delete(data.requestId);
        
        if (request.timeout) {
          clearTimeout(request.timeout);
        }
      }
      
      // Emit event for other listeners
      this.emit('message', { topic, data });
      
    } catch (error) {
      this.logger.debug('Failed to parse MQTT message:', error.message);
    }
  }

  async sendRequest(topic, data, timeout = this.config.timeout) {
    if (!this.connected) {
      throw new Error('Client not connected');
    }

    const requestId = this.generateRequestId();
    const requestData = { ...data, requestId };

    return new Promise((resolve, reject) => {
      // Store request for response handling
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, timeout);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout: timeoutHandle,
        timestamp: Date.now()
      });

      // Send request via MQTT
      this.mqttClient.publish(topic, JSON.stringify(requestData));
    });
  }

  async sendRPCRequest(method, params) {
    if (!this.rpcClient) {
      throw new Error('RPC client not available');
    }

    try {
      const response = await this.rpcClient.request(method, params);
      
      if (response.error) {
        throw new Error(response.error.message || 'RPC request failed');
      }
      
      return response.result;
      
    } catch (error) {
      this.logger.error(`RPC request failed (${method}):`, error);
      throw error;
    }
  }

  // Agent Communication Methods

  async analyzeRepository(params) {
    return await this.sendRequest(EventTypes.CODE_ANALYSIS_REQUESTED, params);
  }

  async analyzeConversation(params) {
    return await this.sendRequest(EventTypes.CONVERSATION_ANALYSIS_REQUESTED, params);
  }

  async searchWeb(params) {
    return await this.sendRequest(EventTypes.WEB_SEARCH_REQUESTED, params);
  }

  async searchTechnicalDocs(params) {
    return await this.sendRequest('web-search/technical-docs', params);
  }

  async createKnowledgeEntity(params) {
    return await this.sendRequest(EventTypes.ENTITY_CREATE_REQUESTED, params);
  }

  async searchKnowledge(params) {
    return await this.sendRequest('knowledge/entity/search', params);
  }

  async startWorkflow(workflowType, parameters) {
    const workflowParams = {
      workflowType,
      parameters
    };

    switch (workflowType) {
      case 'repository-analysis':
        return await this.sendRequest('coordinator/analyze/repository', workflowParams);
      case 'conversation-analysis':
        return await this.sendRequest('coordinator/analyze/conversation', workflowParams);
      case 'technology-research':
        return await this.sendRequest('coordinator/research/technology', workflowParams);
      default:
        throw new Error(`Unknown workflow type: ${workflowType}`);
    }
  }

  async getWorkflowStatus(workflowId) {
    return await this.sendRequest('coordinator/workflow/status', { workflowId });
  }

  async scheduleTask(taskDefinition) {
    return await this.sendRequest('coordinator/task/schedule', {
      task: {
        name: taskDefinition.taskName,
        type: taskDefinition.taskType,
        config: taskDefinition.config
      },
      schedule: taskDefinition.schedule
    });
  }

  async syncWithUkb(direction = 'bidirectional') {
    return await this.sendRequest('knowledge/ukb/sync', { direction });
  }

  async getSystemStatus() {
    try {
      // Try to get status from multiple agents
      const statusPromises = [
        this.getAgentStatus('semantic-analysis'),
        this.getAgentStatus('web-search'),
        this.getAgentStatus('knowledge-graph'),
        this.getAgentStatus('coordinator')
      ];

      const results = await Promise.allSettled(statusPromises);
      
      const agentStatuses = {};
      let activeAgents = 0;
      
      ['semantic-analysis', 'web-search', 'knowledge-graph', 'coordinator'].forEach((agentId, index) => {
        if (results[index].status === 'fulfilled') {
          agentStatuses[agentId] = {
            status: 'active',
            capabilities: results[index].value?.capabilities || []
          };
          activeAgents++;
        } else {
          agentStatuses[agentId] = {
            status: 'inactive',
            error: results[index].reason?.message
          };
        }
      });

      // Get coordinator-specific info
      let runningWorkflows = 0;
      let scheduledTasks = 0;
      
      try {
        const coordinatorStatus = await this.sendRequest('coordinator/agents/discover', {});
        runningWorkflows = coordinatorStatus.runningWorkflows || 0;
        scheduledTasks = coordinatorStatus.scheduledTasks || 0;
      } catch (error) {
        this.logger.debug('Could not get coordinator status:', error.message);
      }

      return {
        status: activeAgents > 0 ? 'operational' : 'degraded',
        activeAgents,
        runningWorkflows,
        scheduledTasks,
        agents: agentStatuses,
        health: {
          uptime: process.uptime(),
          memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
          connections: this.mqttClient?.connected ? 'mqtt:ok' : 'mqtt:disconnected'
        },
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('Failed to get system status:', error);
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async getAgentStatus(agentId) {
    return await this.sendRequest(`${agentId}/status`, {}, 5000); // Shorter timeout for status
  }

  // Utility Methods

  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  async disconnect() {
    try {
      this.connected = false;
      
      // Clear pending requests
      for (const [, request] of this.pendingRequests) {
        if (request.timeout) {
          clearTimeout(request.timeout);
        }
        request.reject(new Error('Client disconnected'));
      }
      this.pendingRequests.clear();
      
      // Disconnect MQTT
      if (this.mqttClient) {
        await new Promise((resolve) => {
          this.mqttClient.end(true, resolve);
        });
        this.mqttClient = null;
      }
      
      // Disconnect RPC
      this.rpcClient = null;
      
      this.logger.info('Disconnected from semantic analysis system');
      
    } catch (error) {
      this.logger.error('Error during disconnect:', error);
    }
  }

  isConnected() {
    return this.connected && this.mqttClient?.connected;
  }

  getConnectionInfo() {
    return {
      connected: this.connected,
      mqttConnected: this.mqttClient?.connected || false,
      rpcConnected: !!this.rpcClient,
      pendingRequests: this.pendingRequests.size
    };
  }
}