/**
 * JSON-RPC Server
 * Provides synchronous request-response communication for agents
 */

import jayson from 'jayson';
import { createServer } from 'http';
import { Logger } from '../../shared/logger.js';

export class JSONRPCServer {
  constructor(config = {}) {
    this.config = {
      port: config.port || 8080,
      host: config.host || '0.0.0.0',
      ...config
    };
    
    this.logger = new Logger('jsonrpc-server');
    this.methods = {};
    this.server = null;
    this.httpServer = null;
    this.middleware = [];
  }

  /**
   * Register a method that can be called via RPC
   */
  registerMethod(name, handler, metadata = {}) {
    this.methods[name] = {
      handler: this.wrapHandler(handler),
      metadata: {
        description: metadata.description || '',
        params: metadata.params || [],
        returns: metadata.returns || 'unknown',
        ...metadata
      }
    };
    
    this.logger.debug(`Registered RPC method: ${name}`);
  }

  /**
   * Register multiple methods from an object
   */
  registerMethods(methodMap) {
    Object.entries(methodMap).forEach(([name, handler]) => {
      this.registerMethod(name, handler);
    });
  }

  /**
   * Add middleware for request processing
   */
  use(middleware) {
    this.middleware.push(middleware);
  }

  /**
   * Wrap handler to add logging and error handling
   */
  wrapHandler(handler) {
    return async (params, callback) => {
      const startTime = Date.now();
      const context = {
        params,
        startTime,
        metadata: {}
      };
      
      try {
        // Run middleware
        for (const mw of this.middleware) {
          await mw(context);
        }
        
        // Execute handler
        const result = await handler(params, context);
        
        const duration = Date.now() - startTime;
        this.logger.debug(`RPC method completed in ${duration}ms`);
        
        callback(null, result);
      } catch (error) {
        this.logger.error('RPC method error:', error);
        
        callback({
          code: error.code || -32603,
          message: error.message || 'Internal error',
          data: error.data
        });
      }
    };
  }

  /**
   * Start the JSON-RPC server
   */
  async start() {
    return new Promise((resolve, reject) => {
      // Create Jayson server with our methods
      const rpcMethods = {};
      Object.entries(this.methods).forEach(([name, { handler }]) => {
        rpcMethods[name] = handler;
      });
      
      // Add introspection methods
      rpcMethods['discover'] = this.createDiscoverMethod();
      rpcMethods['describe'] = this.createDescribeMethod();
      
      this.server = jayson.server(rpcMethods);
      
      // Create HTTP server
      this.httpServer = createServer((req, res) => {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }
        
        if (req.method === 'POST') {
          this.server.middleware()(req, res);
        } else {
          res.writeHead(405, { 'Content-Type': 'text/plain' });
          res.end('Method not allowed');
        }
      });
      
      this.httpServer.listen(this.config.port, this.config.host, () => {
        this.logger.info(`JSON-RPC server listening on ${this.config.host}:${this.config.port}`);
        resolve();
      });
      
      this.httpServer.on('error', (error) => {
        this.logger.error('HTTP server error:', error);
        reject(error);
      });
    });
  }

  /**
   * Stop the JSON-RPC server
   */
  async stop() {
    return new Promise((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => {
          this.logger.info('JSON-RPC server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Create method for service discovery
   */
  createDiscoverMethod() {
    return (params, callback) => {
      const methods = Object.entries(this.methods).map(([name, { metadata }]) => ({
        name,
        description: metadata.description,
        params: metadata.params,
        returns: metadata.returns
      }));
      
      callback(null, {
        service: 'semantic-analysis-rpc',
        version: '1.0.0',
        methods
      });
    };
  }

  /**
   * Create method for describing a specific method
   */
  createDescribeMethod() {
    return (params, callback) => {
      const methodName = params.method;
      
      if (!methodName) {
        callback({ code: -32602, message: 'Invalid params: method name required' });
        return;
      }
      
      const method = this.methods[methodName];
      
      if (!method) {
        callback({ code: -32601, message: 'Method not found' });
        return;
      }
      
      callback(null, {
        name: methodName,
        ...method.metadata
      });
    };
  }

  /**
   * Get server statistics
   */
  getStats() {
    return {
      methods: Object.keys(this.methods).length,
      address: `${this.config.host}:${this.config.port}`,
      uptime: process.uptime()
    };
  }
}

/**
 * RPC Error class for structured errors
 */
export class RPCError extends Error {
  constructor(message, code = -32603, data = null) {
    super(message);
    this.code = code;
    this.data = data;
  }
}