/**
 * JSON-RPC Client
 * Provides client for making RPC calls to other agents
 */

import jayson from 'jayson';
import { Logger } from '../../shared/logger.js';

export class JSONRPCClient {
  constructor(config = {}) {
    this.config = {
      endpoint: config.endpoint || 'http://localhost:8080',
      timeout: config.timeout || 30000,
      retries: config.retries || 3,
      retryDelay: config.retryDelay || 1000,
      ...config
    };
    
    this.logger = new Logger('jsonrpc-client');
    this.client = null;
    this.initialize();
  }

  initialize() {
    const [protocol, host] = this.config.endpoint.split('://');
    const [hostname, port] = host.split(':');
    
    this.client = jayson.client.http({
      host: hostname,
      port: parseInt(port) || 80,
      timeout: this.config.timeout
    });
  }

  /**
   * Make an RPC call
   */
  async call(method, params = {}, options = {}) {
    const maxRetries = options.retries || this.config.retries;
    const retryDelay = options.retryDelay || this.config.retryDelay;
    let lastError = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await this.makeRequest(method, params);
        return result;
      } catch (error) {
        lastError = error;
        this.logger.warn(`RPC call failed (attempt ${attempt + 1}/${maxRetries}):`, error.message);
        
        if (attempt < maxRetries - 1) {
          await this.delay(retryDelay * Math.pow(2, attempt)); // Exponential backoff
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Make a single RPC request
   */
  makeRequest(method, params) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      this.client.request(method, params, (error, response) => {
        const duration = Date.now() - startTime;
        
        if (error) {
          this.logger.error(`RPC call to ${method} failed after ${duration}ms:`, error);
          reject(new Error(`RPC call failed: ${error.message}`));
          return;
        }
        
        if (response.error) {
          this.logger.error(`RPC call to ${method} returned error after ${duration}ms:`, response.error);
          const rpcError = new Error(response.error.message);
          rpcError.code = response.error.code;
          rpcError.data = response.error.data;
          reject(rpcError);
          return;
        }
        
        this.logger.debug(`RPC call to ${method} completed in ${duration}ms`);
        resolve(response.result);
      });
    });
  }

  /**
   * Batch multiple RPC calls
   */
  async batch(calls) {
    const requests = calls.map(({ method, params }) => ({
      method,
      params: params || {}
    }));
    
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      this.client.request(requests, (error, responses) => {
        const duration = Date.now() - startTime;
        
        if (error) {
          this.logger.error(`Batch RPC call failed after ${duration}ms:`, error);
          reject(new Error(`Batch RPC call failed: ${error.message}`));
          return;
        }
        
        const results = responses.map((response, index) => {
          if (response.error) {
            const error = new Error(response.error.message);
            error.code = response.error.code;
            error.data = response.error.data;
            error.method = calls[index].method;
            return { error };
          }
          
          return { result: response.result };
        });
        
        this.logger.debug(`Batch RPC call completed in ${duration}ms`);
        resolve(results);
      });
    });
  }

  /**
   * Discover available methods from server
   */
  async discover() {
    try {
      const discovery = await this.call('rpc.discover');
      return discovery;
    } catch (error) {
      this.logger.error('Failed to discover RPC methods:', error);
      throw error;
    }
  }

  /**
   * Describe a specific method
   */
  async describe(method) {
    try {
      const description = await this.call('rpc.describe', { method });
      return description;
    } catch (error) {
      this.logger.error(`Failed to describe method ${method}:`, error);
      throw error;
    }
  }

  /**
   * Create a proxy object for easier method calling
   */
  createProxy() {
    return new Proxy({}, {
      get: (target, prop) => {
        return (...args) => this.call(prop, ...args);
      }
    });
  }

  /**
   * Utility delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update client endpoint
   */
  setEndpoint(endpoint) {
    this.config.endpoint = endpoint;
    this.initialize();
  }
}