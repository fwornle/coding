/**
 * RPC Communication Handler
 * Handles JSON-RPC communication patterns and method routing
 */

import { EventEmitter } from 'events';
import { Logger } from '../../shared/logger.js';
import { RPCError } from '../../infrastructure/rpc/server.js';

export class RPCHandler extends EventEmitter {
  constructor(rpcClient, agentId) {
    super();
    
    this.rpcClient = rpcClient;
    this.agentId = agentId;
    this.logger = new Logger(`rpc-handler:${agentId}`);
    
    this.methodCache = new Map();
    this.callStats = new Map();
    this.middleware = [];
    
    this.initialize();
  }

  /**
   * Initialize RPC handler
   */
  async initialize() {
    if (this.rpcClient) {
      try {
        // Discover available methods
        await this.discoverMethods();
      } catch (error) {
        this.logger.warn('Failed to discover RPC methods:', error.message);
      }
    }
  }

  /**
   * Discover available RPC methods
   */
  async discoverMethods() {
    try {
      const discovery = await this.rpcClient.discover();
      this.logger.info(`Discovered ${discovery.methods.length} RPC methods`);
      
      // Cache method information
      for (const method of discovery.methods) {
        this.methodCache.set(method.name, method);
      }
      
      this.emit('methodsDiscovered', discovery.methods);
      
    } catch (error) {
      this.logger.error('Method discovery failed:', error);
      throw error;
    }
  }

  /**
   * Call a remote method
   */
  async call(agent, method, params = {}, options = {}) {
    const fullMethod = `${agent}.${method}`;
    const startTime = Date.now();
    
    try {
      // Apply middleware
      const processedParams = await this.applyMiddleware('beforeCall', {
        agent,
        method,
        params,
        options
      });
      
      this.logger.debug(`Calling RPC method: ${fullMethod}`);
      
      const result = await this.rpcClient.call(fullMethod, processedParams.params, options);
      
      const duration = Date.now() - startTime;
      this.updateCallStats(fullMethod, 'success', duration);
      
      // Apply middleware
      const processedResult = await this.applyMiddleware('afterCall', {
        agent,
        method,
        params,
        result,
        duration
      });
      
      this.logger.debug(`RPC call completed: ${fullMethod} (${duration}ms)`);
      
      return processedResult.result;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      this.updateCallStats(fullMethod, 'error', duration);
      
      this.logger.error(`RPC call failed: ${fullMethod} (${duration}ms):`, error.message);
      
      // Apply error middleware
      await this.applyMiddleware('onError', {
        agent,
        method,
        params,
        error,
        duration
      });
      
      throw error;
    }
  }

  /**
   * Make multiple RPC calls in batch
   */
  async batch(calls) {
    const startTime = Date.now();
    
    try {
      this.logger.debug(`Executing batch RPC call with ${calls.length} methods`);
      
      const results = await this.rpcClient.batch(calls);
      
      const duration = Date.now() - startTime;
      this.logger.debug(`Batch RPC call completed (${duration}ms)`);
      
      // Update stats for each call
      for (let i = 0; i < calls.length; i++) {
        const call = calls[i];
        const result = results[i];
        const fullMethod = `${call.agent || 'unknown'}.${call.method}`;
        
        if (result.error) {
          this.updateCallStats(fullMethod, 'error', duration / calls.length);
        } else {
          this.updateCallStats(fullMethod, 'success', duration / calls.length);
        }
      }
      
      return results;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Batch RPC call failed (${duration}ms):`, error.message);
      throw error;
    }
  }

  /**
   * Call with retry logic
   */
  async callWithRetry(agent, method, params, options = {}) {
    const maxRetries = options.retries || 3;
    const retryDelay = options.retryDelay || 1000;
    let lastError;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.call(agent, method, params, options);
      } catch (error) {
        lastError = error;
        
        if (attempt < maxRetries - 1) {
          this.logger.warn(`RPC call failed (attempt ${attempt + 1}/${maxRetries}), retrying...`);
          await this.delay(retryDelay * Math.pow(2, attempt)); // Exponential backoff
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Call with timeout
   */
  async callWithTimeout(agent, method, params, timeout = 30000) {
    return Promise.race([
      this.call(agent, method, params),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`RPC call timeout: ${agent}.${method}`));
        }, timeout);
      })
    ]);
  }

  /**
   * Check if method is available
   */
  hasMethod(agent, method) {
    const fullMethod = `${agent}.${method}`;
    return this.methodCache.has(fullMethod);
  }

  /**
   * Get method information
   */
  getMethodInfo(agent, method) {
    const fullMethod = `${agent}.${method}`;
    return this.methodCache.get(fullMethod);
  }

  /**
   * Get all available methods for an agent
   */
  getAgentMethods(agent) {
    const methods = [];
    
    for (const [methodName, methodInfo] of this.methodCache) {
      if (methodName.startsWith(`${agent}.`)) {
        methods.push({
          ...methodInfo,
          method: methodName.substring(agent.length + 1)
        });
      }
    }
    
    return methods;
  }

  /**
   * Add middleware
   */
  use(middleware) {
    this.middleware.push(middleware);
  }

  /**
   * Apply middleware
   */
  async applyMiddleware(phase, context) {
    let result = context;
    
    for (const mw of this.middleware) {
      if (mw[phase]) {
        result = await mw[phase](result);
      }
    }
    
    return result;
  }

  /**
   * Update call statistics
   */
  updateCallStats(method, status, duration) {
    if (!this.callStats.has(method)) {
      this.callStats.set(method, {
        success: 0,
        error: 0,
        totalDuration: 0,
        averageDuration: 0,
        lastCall: null
      });
    }
    
    const stats = this.callStats.get(method);
    stats[status]++;
    stats.totalDuration += duration;
    stats.averageDuration = stats.totalDuration / (stats.success + stats.error);
    stats.lastCall = new Date();
  }

  /**
   * Get call statistics
   */
  getCallStats(method = null) {
    if (method) {
      return this.callStats.get(method) || null;
    }
    
    const allStats = {};
    for (const [methodName, stats] of this.callStats) {
      allStats[methodName] = { ...stats };
    }
    
    return allStats;
  }

  /**
   * Create a proxy for easier method calling
   */
  createAgentProxy(agentName) {
    return new Proxy({}, {
      get: (target, methodName) => {
        return (...args) => {
          const params = args.length === 1 ? args[0] : args;
          return this.call(agentName, methodName, params);
        };
      }
    });
  }

  /**
   * Health check for RPC connection
   */
  async healthCheck() {
    try {
      await this.rpcClient.call('rpc.discover');
      return { status: 'healthy', timestamp: new Date() };
    } catch (error) {
      return { 
        status: 'unhealthy', 
        error: error.message, 
        timestamp: new Date() 
      };
    }
  }

  /**
   * Utility delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get handler statistics
   */
  getStats() {
    const totalCalls = Array.from(this.callStats.values())
      .reduce((total, stats) => total + stats.success + stats.error, 0);
    
    const totalErrors = Array.from(this.callStats.values())
      .reduce((total, stats) => total + stats.error, 0);
    
    return {
      methodsDiscovered: this.methodCache.size,
      totalCalls,
      totalErrors,
      errorRate: totalCalls > 0 ? (totalErrors / totalCalls * 100).toFixed(2) + '%' : '0%',
      middlewareCount: this.middleware.length
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.callStats.clear();
  }
}