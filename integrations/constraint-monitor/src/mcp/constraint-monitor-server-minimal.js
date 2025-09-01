import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * Minimal MCP Server for Constraint Monitor
 * 
 * Provides basic constraint monitoring without heavy dependencies
 */
export class ConstraintMonitorServerMinimal {
  constructor() {
    this.server = new Server(
      {
        name: 'constraint-monitor',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Simple in-memory storage
    this.constraints = new Map();
    this.violations = [];
    this.initialized = false;

    this.setupToolHandlers();
    this.setupErrorHandlers();
  }

  async initialize() {
    if (this.initialized) return;

    try {
      // Initialize with some default constraints
      this.constraints.set('console-log-pattern', {
        id: 'console-log-pattern',
        type: 'anti-pattern',
        severity: 'warning',
        matcher: 'console\\.log',
        message: 'Avoid using console.log in production code. Use structured logging instead.',
        correctionAction: 'suggest'
      });

      this.initialized = true;
      console.log('Constraint Monitor MCP Server (minimal) initialized');
    } catch (error) {
      console.error('Failed to initialize MCP server:', error);
      throw error;
    }
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'get_constraint_status',
          description: 'Get current constraint monitoring status and metrics',
          inputSchema: {
            type: 'object',
            properties: {
              sessionId: {
                type: 'string',
                description: 'Optional session ID to get specific session metrics'
              }
            }
          }
        },
        {
          name: 'add_constraint_rule',
          description: 'Add a new constraint rule to the monitoring system',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Unique identifier for the constraint'
              },
              type: {
                type: 'string',
                enum: ['pattern', 'anti-pattern', 'semantic', 'workflow'],
                description: 'Type of constraint rule'
              },
              severity: {
                type: 'string',
                enum: ['info', 'warning', 'error', 'critical'],
                description: 'Severity level of the constraint'
              },
              matcher: {
                type: 'string',
                description: 'Pattern or rule for matching violations'
              },
              message: {
                type: 'string',
                description: 'Message to display when constraint is violated'
              },
              correctionAction: {
                type: 'string',
                enum: ['warn', 'suggest', 'block', 'auto-correct'],
                description: 'Action to take when constraint is violated'
              }
            },
            required: ['id', 'type', 'message']
          }
        },
        {
          name: 'check_action_constraints',
          description: 'Check if a proposed action would violate any constraints',
          inputSchema: {
            type: 'object',
            properties: {
              action: {
                type: 'object',
                description: 'Action to check for constraint violations'
              },
              context: {
                type: 'object',
                description: 'Current session context'
              }
            },
            required: ['action']
          }
        },
        {
          name: 'get_violation_history',
          description: 'Get history of constraint violations and their resolutions',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maximum number of violations to return'
              }
            }
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        await this.ensureInitialized();

        switch (name) {
          case 'get_constraint_status':
            return await this.getConstraintStatus(args);
            
          case 'add_constraint_rule':
            return await this.addConstraintRule(args);
            
          case 'check_action_constraints':
            return await this.checkActionConstraints(args);
            
          case 'get_violation_history':
            return await this.getViolationHistory(args);
            
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        console.error(`Tool ${name} failed:`, error);
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error.message}`
        );
      }
    });
  }

  async ensureInitialized() {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  async getConstraintStatus(args) {
    const status = {
      monitoring: {
        active: true,
        constraintsLoaded: this.constraints.size,
        violationsLogged: this.violations.length
      },
      constraints: Array.from(this.constraints.values()),
      recentViolations: this.violations.slice(-5)
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(status, null, 2)
      }]
    };
  }

  async addConstraintRule(args) {
    const constraint = {
      id: args.id,
      type: args.type,
      severity: args.severity || 'warning',
      matcher: args.matcher,
      message: args.message,
      correctionAction: args.correctionAction || 'warn',
      createdAt: new Date().toISOString()
    };

    this.constraints.set(args.id, constraint);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          constraint: constraint,
          message: 'Constraint rule added successfully'
        }, null, 2)
      }]
    };
  }

  async checkActionConstraints(args) {
    const { action, context = {} } = args;
    const violations = [];
    
    // Simple pattern matching against constraints
    const actionContent = JSON.stringify(action);
    
    for (const [id, constraint] of this.constraints) {
      if (constraint.matcher && actionContent.includes(constraint.matcher)) {
        const violation = {
          constraintId: id,
          constraint: constraint,
          severity: constraint.severity,
          message: constraint.message,
          detectedAt: new Date().toISOString()
        };
        violations.push(violation);
        this.violations.push(violation);
      }
    }

    // Keep violations history limited
    if (this.violations.length > 100) {
      this.violations = this.violations.slice(-100);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          action,
          violations,
          recommendation: violations.length > 0 ? 'Review violations before proceeding' : 'Action appears compliant'
        }, null, 2)
      }]
    };
  }

  async getViolationHistory(args) {
    const { limit = 10 } = args;
    
    const recentViolations = this.violations.slice(-limit);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          violations: recentViolations,
          count: recentViolations.length,
          totalRecorded: this.violations.length
        }, null, 2)
      }]
    };
  }

  setupErrorHandlers() {
    this.server.onerror = (error) => {
      console.error('MCP Server error:', error);
    };

    process.on('SIGINT', async () => {
      await this.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await this.shutdown();
      process.exit(0);
    });
  }

  async shutdown() {
    try {
      console.log('Shutting down Constraint Monitor MCP Server (minimal)');
      console.log('Constraint Monitor MCP Server shutdown complete');
    } catch (error) {
      console.error('Error during shutdown:', error);
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.log('Constraint Monitor MCP Server (minimal) running on stdio');
  }
}

// Run the server if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new ConstraintMonitorServerMinimal();
  server.run().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}