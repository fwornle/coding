#!/usr/bin/env node

/**
 * MCP Server for Semantic Analysis System
 * Exposes agent capabilities as MCP tools for Claude Code integration
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { SemanticAnalysisClient } from './clients/semantic-analysis-client.js';
import { Logger } from '../shared/logger.js';

class SemanticAnalysisMCPServer {
  constructor() {
    this.logger = new Logger('mcp-server');
    this.server = new Server(
      {
        name: 'semantic-analysis-system',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
    
    this.client = null;
    this.connectionStatus = {
      server: 'starting',
      client: 'disconnected',
      mqttBroker: 'unknown',
      rpcServer: 'unknown',
      agentSystem: 'unknown',
      lastError: null,
      startTime: new Date().toISOString()
    };
    this.setupServer();
  }

  async setupServer() {
    try {
      this.connectionStatus.server = 'initializing';
      
      // Check environment and provide detailed error messages
      await this.checkEnvironment();
      
      // Initialize semantic analysis client
      this.connectionStatus.client = 'connecting';
      this.client = new SemanticAnalysisClient();
      
      try {
        await this.client.connect();
        this.connectionStatus.client = 'connected';
        this.connectionStatus.mqttBroker = 'connected';
        this.connectionStatus.rpcServer = 'connected';
        this.connectionStatus.agentSystem = 'running';
      } catch (clientError) {
        this.connectionStatus.client = 'failed';
        this.connectionStatus.lastError = clientError.message;
        
        // Check specific connection failures
        if (clientError.message?.includes('MQTT')) {
          this.connectionStatus.mqttBroker = 'failed';
        }
        if (clientError.message?.includes('RPC')) {
          this.connectionStatus.rpcServer = 'failed';
        }
        if (clientError.code === 'ECONNREFUSED') {
          this.connectionStatus.agentSystem = 'not_running';
        }
        
        throw clientError;
      }
      
      // Register tools
      this.registerTools();
      
      // Register error handlers
      this.server.onerror = (error) => {
        this.logger.error('MCP Server error:', error);
        this.connectionStatus.lastError = error.message;
      };
      
      this.connectionStatus.server = 'ready';
      this.logger.info('MCP Server setup completed');
      
    } catch (error) {
      this.connectionStatus.server = 'failed';
      this.connectionStatus.lastError = error.message;
      this.logger.error('Failed to setup MCP server:', error);
      
      // Provide detailed, actionable error information
      this.displayDetailedError(error);
      
      throw error;
    }
  }
  
  displayDetailedError(error) {
    console.error('\n' + '='.repeat(80));
    console.error('🚨 SEMANTIC ANALYSIS MCP SERVER - CONNECTION FAILED');
    console.error('='.repeat(80));
    
    if (error.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED')) {
      console.error('\n❌ ISSUE: Agent system infrastructure not running');
      console.error('\n📋 REQUIRED SERVICES:');
      console.error('   • MQTT Broker (port 1883)');
      console.error('   • RPC Server (port 3001 or 8080)');
      console.error('   • Semantic Analysis Agents');
      
      console.error('\n🔧 TO FIX THIS:');
      console.error('   1. Check if you have the required infrastructure setup');
      console.error('   2. The start-agents.js script is missing - you may need to:');
      console.error('      - Install and start an MQTT broker (like Mosquitto)');
      console.error('      - Create the agent system infrastructure');
      console.error('      - Or run this MCP server in standalone mode');
      
      console.error('\n💡 QUICK START OPTIONS:');
      console.error('   Option A: Install MQTT broker');
      console.error('   → brew install mosquitto && brew services start mosquitto');
      console.error('   \n   Option B: Use embedded MQTT (recommended)');
      console.error('   → We can modify the server to use embedded Aedes MQTT broker');
      
    } else if (error.message?.includes('API')) {
      console.error('\n❌ ISSUE: API key configuration problem');
      console.error(`\n📝 ERROR: ${error.message}`);
      console.error('\n🔧 TO FIX THIS:');
      console.error('   1. Create or update ./.env file with:');
      console.error('      ANTHROPIC_API_KEY=your-actual-anthropic-key');
      console.error('      OPENAI_API_KEY=your-actual-openai-key');
      console.error('   2. Or set environment variables directly');
      
    } else {
      console.error(`\n❌ ISSUE: ${error.message}`);
      console.error('\n🔍 DEBUG INFO:');
      console.error(`   Error Type: ${error.constructor.name}`);
      console.error(`   Error Code: ${error.code || 'N/A'}`);
      if (error.stack) {
        console.error(`   Stack: ${error.stack.split('\n')[1]?.trim() || 'N/A'}`);
      }
    }
    
    console.error('\n📊 CONNECTION STATUS:');
    Object.entries(this.connectionStatus).forEach(([key, value]) => {
      const status = typeof value === 'string' ? value : JSON.stringify(value);
      const icon = this.getStatusIcon(status);
      console.error(`   ${icon} ${key}: ${status}`);
    });
    
    console.error('\n' + '='.repeat(80) + '\n');
  }
  
  getStatusIcon(status) {
    switch (status) {
      case 'connected':
      case 'ready':
      case 'running':
        return '✅';
      case 'connecting':
      case 'initializing':
      case 'starting':
        return '🔄';
      case 'failed':
      case 'not_running':
      case 'disconnected':
        return '❌';
      default:
        return '❓';
    }
  }
  
  async checkEnvironment() {
    // Load environment variables - load root .env first, then local .env for overrides
    try {
      const { config } = await import('dotenv');
      
      // Load root .env first (main API keys)
      const rootEnvPath = new URL('../../.env', import.meta.url).pathname;
      config({ path: rootEnvPath });
      
      // Load local .env second (for overrides and local config)
      const localEnvPath = new URL('../.env', import.meta.url).pathname;
      config({ path: localEnvPath, override: false }); // Don't override root values
      
    } catch (error) {
      // dotenv might not be available, continue
      this.logger.warn('Could not load .env files:', error.message);
    }
    
    // Check API keys
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    
    if ((!anthropicKey || anthropicKey === 'your-anthropic-api-key') && 
        (!openaiKey || openaiKey === 'your-openai-api-key')) {
      throw new Error('No valid API keys found. Please configure ANTHROPIC_API_KEY or OPENAI_API_KEY in .env file');
    }
    
    // Log which keys are configured
    const configuredKeys = [];
    if (anthropicKey && anthropicKey !== 'your-anthropic-api-key') {
      configuredKeys.push('ANTHROPIC_API_KEY');
    }
    if (openaiKey && openaiKey !== 'your-openai-api-key') {
      configuredKeys.push('OPENAI_API_KEY');
    }
    
    this.logger.info(`API keys configured: ${configuredKeys.join(', ')}`);
  }

  registerTools() {
    // Semantic Analysis Tools - MCP Tool Call Handler
    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        const { name, arguments: args } = request.params;
        
        try {
          switch (name) {
          case 'analyze_repository':
            return await this.analyzeRepository(args);
          case 'analyze_conversation':
            return await this.analyzeConversation(args);
          case 'search_web':
            return await this.searchWeb(args);
          case 'search_technical_docs':
            return await this.searchTechnicalDocs(args);
          case 'create_knowledge_entity':
            return await this.createKnowledgeEntity(args);
          case 'search_knowledge':
            return await this.searchKnowledge(args);
          case 'start_workflow':
            return await this.startWorkflow(args);
          case 'get_workflow_status':
            return await this.getWorkflowStatus(args);
          case 'schedule_task':
            return await this.scheduleTask(args);
          case 'sync_with_ukb':
            return await this.syncWithUkb(args);
          case 'get_system_status':
            return await this.getSystemStatus(args);
          case 'get_mcp_server_status':
            return await this.getMCPServerStatus(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        this.logger.error(`Tool execution failed for ${name}:`, error);
        return {
          content: [
            {
              type: 'text',
              text: `Error executing ${name}: ${error.message}`
            }
          ],
          isError: true
        };
      }
    });

    // MCP Tool List Handler
    this.server.setRequestHandler(
      ListToolsRequestSchema,
      async () => {
      return {
        tools: [
          {
            name: 'analyze_repository',
            description: 'Analyze a code repository for semantic patterns and insights',
            inputSchema: {
              type: 'object',
              properties: {
                repository: {
                  type: 'string',
                  description: 'Path to the repository to analyze'
                },
                depth: {
                  type: 'number',
                  description: 'Number of recent commits to analyze',
                  default: 10
                },
                significanceThreshold: {
                  type: 'number',
                  description: 'Minimum significance level (1-10)',
                  default: 7
                }
              },
              required: ['repository']
            }
          },
          {
            name: 'analyze_conversation',
            description: 'Analyze conversation logs to extract insights and patterns',
            inputSchema: {
              type: 'object',
              properties: {
                conversationPath: {
                  type: 'string',
                  description: 'Path to the conversation file to analyze'
                },
                extractInsights: {
                  type: 'boolean',
                  description: 'Whether to extract structured insights',
                  default: true
                },
                updateKnowledge: {
                  type: 'boolean',
                  description: 'Whether to update the knowledge base',
                  default: true
                }
              },
              required: ['conversationPath']
            }
          },
          {
            name: 'search_web',
            description: 'Search the web for information related to technical topics',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query'
                },
                maxResults: {
                  type: 'number',
                  description: 'Maximum number of results to return',
                  default: 10
                },
                domains: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Specific domains to search (e.g., ["docs.", "github.com"])'
                }
              },
              required: ['query']
            }
          },
          {
            name: 'search_technical_docs',
            description: 'Search for technical documentation for specific technologies',
            inputSchema: {
              type: 'object',
              properties: {
                technology: {
                  type: 'string',
                  description: 'Technology to search documentation for'
                },
                topic: {
                  type: 'string',
                  description: 'Specific topic or feature to find documentation for'
                }
              },
              required: ['technology', 'topic']
            }
          },
          {
            name: 'create_knowledge_entity',
            description: 'Create a new entity in the knowledge graph',
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Name of the entity'
                },
                entityType: {
                  type: 'string',
                  description: 'Type of entity (e.g., Pattern, Insight, Technology)'
                },
                significance: {
                  type: 'number',
                  description: 'Significance level (1-10)',
                  minimum: 1,
                  maximum: 10
                },
                observations: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Observations or notes about the entity'
                },
                metadata: {
                  type: 'object',
                  description: 'Additional metadata for the entity'
                }
              },
              required: ['name', 'entityType']
            }
          },
          {
            name: 'search_knowledge',
            description: 'Search the knowledge graph for entities and relationships',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query'
                },
                entityType: {
                  type: 'string',
                  description: 'Filter by entity type'
                },
                minSignificance: {
                  type: 'number',
                  description: 'Minimum significance level to include'
                },
                maxResults: {
                  type: 'number',
                  description: 'Maximum number of results',
                  default: 20
                }
              },
              required: ['query']
            }
          },
          {
            name: 'start_workflow',
            description: 'Start a predefined workflow for complex analysis tasks',
            inputSchema: {
              type: 'object',
              properties: {
                workflowType: {
                  type: 'string',
                  enum: ['repository-analysis', 'conversation-analysis', 'technology-research'],
                  description: 'Type of workflow to start'
                },
                parameters: {
                  type: 'object',
                  description: 'Parameters specific to the workflow type'
                }
              },
              required: ['workflowType', 'parameters']
            }
          },
          {
            name: 'get_workflow_status',
            description: 'Get the status of a running workflow',
            inputSchema: {
              type: 'object',
              properties: {
                workflowId: {
                  type: 'string',
                  description: 'ID of the workflow to check'
                }
              },
              required: ['workflowId']
            }
          },
          {
            name: 'schedule_task',
            description: 'Schedule a recurring task or workflow',
            inputSchema: {
              type: 'object',
              properties: {
                taskName: {
                  type: 'string',
                  description: 'Name of the task'
                },
                taskType: {
                  type: 'string',
                  enum: ['workflow', 'agent-call', 'function'],
                  description: 'Type of task to schedule'
                },
                schedule: {
                  type: 'object',
                  description: 'Schedule definition (interval, cron, etc.)'
                },
                config: {
                  type: 'object',
                  description: 'Task configuration'
                }
              },
              required: ['taskName', 'taskType', 'schedule', 'config']
            }
          },
          {
            name: 'sync_with_ukb',
            description: 'Synchronize knowledge with the existing UKB system',
            inputSchema: {
              type: 'object',
              properties: {
                direction: {
                  type: 'string',
                  enum: ['to-ukb', 'from-ukb', 'bidirectional'],
                  description: 'Sync direction',
                  default: 'bidirectional'
                }
              }
            }
          },
          {
            name: 'get_system_status',
            description: 'Get the status of all agents and system components',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'get_mcp_server_status',
            description: 'Get detailed MCP server connection and health status',
            inputSchema: {
              type: 'object',
              properties: {
                includeDebugInfo: {
                  type: 'boolean',
                  description: 'Include detailed debug information',
                  default: false
                }
              }
            }
          }
        ]
      };
    });
  }

  // Tool Implementation Methods

  async analyzeRepository(args) {
    try {
      const result = await this.client.analyzeRepository(args);
      
      return {
        content: [
          {
            type: 'text',
            text: `# Repository Analysis Results\n\n` +
                  `**Repository:** ${args.repository}\n` +
                  `**Commits Analyzed:** ${result.totalCommits}\n` +
                  `**Significant Findings:** ${result.analyzedCommits}\n\n` +
                  `## Key Patterns\n` +
                  `${this.formatPatterns(result.patterns)}\n\n` +
                  `## Analysis Summary\n` +
                  `${this.formatAnalyses(result.analyses)}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Repository analysis failed: ${error.message}`);
    }
  }

  async analyzeConversation(args) {
    try {
      const result = await this.client.analyzeConversation(args);
      
      return {
        content: [
          {
            type: 'text',
            text: `# Conversation Analysis Results\n\n` +
                  `**File:** ${args.conversationPath}\n` +
                  `**Significance:** ${result.significance}/10\n\n` +
                  `## Analysis\n` +
                  `${result.analysis}\n\n` +
                  `## Extracted Insights\n` +
                  `${this.formatInsights(result.insights)}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Conversation analysis failed: ${error.message}`);
    }
  }

  async searchWeb(args) {
    try {
      const result = await this.client.searchWeb(args);
      
      return {
        content: [
          {
            type: 'text',
            text: `# Web Search Results\n\n` +
                  `**Query:** ${args.query}\n` +
                  `**Results Found:** ${result.results.length}\n\n` +
                  `${this.formatSearchResults(result.results)}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Web search failed: ${error.message}`);
    }
  }

  async searchTechnicalDocs(args) {
    try {
      const result = await this.client.searchTechnicalDocs(args);
      
      return {
        content: [
          {
            type: 'text',
            text: `# Technical Documentation Search\n\n` +
                  `**Technology:** ${args.technology}\n` +
                  `**Topic:** ${args.topic}\n\n` +
                  `${this.formatSearchResults(result.results)}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Technical docs search failed: ${error.message}`);
    }
  }

  async createKnowledgeEntity(args) {
    try {
      const result = await this.client.createKnowledgeEntity(args);
      
      return {
        content: [
          {
            type: 'text',
            text: `# Knowledge Entity Created\n\n` +
                  `**Name:** ${result.name}\n` +
                  `**Type:** ${result.entityType}\n` +
                  `**Significance:** ${result.significance}/10\n` +
                  `**ID:** ${result.id}\n\n` +
                  `## Observations\n` +
                  `${result.observations.map(obs => `- ${obs}`).join('\n')}\n\n` +
                  `Entity successfully added to knowledge graph.`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Knowledge entity creation failed: ${error.message}`);
    }
  }

  async searchKnowledge(args) {
    try {
      const result = await this.client.searchKnowledge(args);
      
      return {
        content: [
          {
            type: 'text',
            text: `# Knowledge Search Results\n\n` +
                  `**Query:** ${args.query}\n` +
                  `**Results Found:** ${result.length}\n\n` +
                  `${this.formatKnowledgeResults(result)}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Knowledge search failed: ${error.message}`);
    }
  }

  async startWorkflow(args) {
    try {
      const result = await this.client.startWorkflow(args.workflowType, args.parameters);
      
      return {
        content: [
          {
            type: 'text',
            text: `# Workflow Started\n\n` +
                  `**Type:** ${args.workflowType}\n` +
                  `**Workflow ID:** ${result.workflowId}\n` +
                  `**Status:** ${result.status}\n\n` +
                  `Workflow is now running. Use \`get_workflow_status\` to check progress.`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Workflow start failed: ${error.message}`);
    }
  }

  async getWorkflowStatus(args) {
    try {
      const result = await this.client.getWorkflowStatus(args.workflowId);
      
      return {
        content: [
          {
            type: 'text',
            text: `# Workflow Status\n\n` +
                  `**ID:** ${result.id}\n` +
                  `**Status:** ${result.status}\n` +
                  `**Progress:** ${result.progress}%\n` +
                  `**Current Step:** ${result.currentStep?.name || 'N/A'}\n` +
                  `**Started:** ${result.startedAt}\n` +
                  `${result.completedAt ? `**Completed:** ${result.completedAt}\n` : ''}` +
                  `${result.error ? `**Error:** ${result.error}\n` : ''}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Workflow status retrieval failed: ${error.message}`);
    }
  }

  async scheduleTask(args) {
    try {
      const result = await this.client.scheduleTask(args);
      
      return {
        content: [
          {
            type: 'text',
            text: `# Task Scheduled\n\n` +
                  `**Name:** ${args.taskName}\n` +
                  `**Type:** ${args.taskType}\n` +
                  `**Task ID:** ${result.id}\n` +
                  `**Next Run:** ${result.nextRun}\n\n` +
                  `Task has been successfully scheduled.`
          }
        ]
      };
    } catch (error) {
      throw new Error(`Task scheduling failed: ${error.message}`);
    }
  }

  async syncWithUkb(args) {
    try {
      const result = await this.client.syncWithUkb(args.direction || 'bidirectional');
      
      return {
        content: [
          {
            type: 'text',
            text: `# UKB Sync Results\n\n` +
                  `**Direction:** ${args.direction || 'bidirectional'}\n` +
                  `**Status:** ${result.status}\n\n` +
                  `${this.formatSyncResults(result)}`
          }
        ]
      };
    } catch (error) {
      throw new Error(`UKB sync failed: ${error.message}`);
    }
  }

  async getSystemStatus(args) {
    try {
      // If client is not connected, return connection status instead
      if (!this.client || !this.client.isConnected()) {
        return {
          content: [
            {
              type: 'text',
              text: `# System Status - DISCONNECTED\n\n` +
                    `**Overall Status:** disconnected\n` +
                    `**Connection Issue:** Agent system not available\n\n` +
                    `## MCP Server Status\n` +
                    `${this.formatConnectionStatus()}\n\n` +
                    `## Troubleshooting\n` +
                    `- Ensure MQTT broker is running on port 1883\n` +
                    `- Ensure RPC server is running on port 3001\n` +
                    `- Check API keys in .env file\n` +
                    `- Run: npm run start:agents (if available)`
            }
          ]
        };
      }
      
      const result = await this.client.getSystemStatus();
      
      return {
        content: [
          {
            type: 'text',
            text: `# System Status\n\n` +
                  `**Overall Status:** ${result.status}\n` +
                  `**Active Agents:** ${result.activeAgents}\n` +
                  `**Running Workflows:** ${result.runningWorkflows}\n` +
                  `**Scheduled Tasks:** ${result.scheduledTasks}\n\n` +
                  `## Agent Status\n` +
                  `${this.formatAgentStatus(result.agents)}\n\n` +
                  `## System Health\n` +
                  `${this.formatHealthStatus(result.health)}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `# System Status - ERROR\n\n` +
                  `**Status:** error\n` +
                  `**Error:** ${error.message}\n\n` +
                  `## MCP Server Status\n` +
                  `${this.formatConnectionStatus()}\n\n` +
                  `## Last Known Issue\n` +
                  `${this.connectionStatus.lastError || 'No specific error recorded'}`
          }
        ]
      };
    }
  }
  
  async getMCPServerStatus(args) {
    const includeDebug = args?.includeDebugInfo || false;
    
    // Get client connection info if available
    let clientInfo = { connected: false };
    if (this.client) {
      try {
        clientInfo = this.client.getConnectionInfo();
      } catch (error) {
        clientInfo.error = error.message;
      }
    }
    
    const status = {
      server: this.connectionStatus,
      client: clientInfo,
      tools: {
        total: 12, // Number of tools we register
        available: this.client && this.client.isConnected()
      },
      uptime: Math.floor(process.uptime()),
      memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      timestamp: new Date().toISOString()
    };
    
    let debugSection = '';
    if (includeDebug) {
      debugSection = `\n\n## Debug Information\n` +
                    `**Process ID:** ${process.pid}\n` +
                    `**Node Version:** ${process.version}\n` +
                    `**Platform:** ${process.platform}\n` +
                    `**Working Directory:** ${process.cwd()}\n` +
                    `**Environment:** ${process.env.NODE_ENV || 'development'}\n` +
                    `**Memory Usage:** ${JSON.stringify(process.memoryUsage(), null, 2)}`;
    }
    
    return {
      content: [
        {
          type: 'text',
          text: `# MCP Server Status Report\n\n` +
                `**Server Status:** ${this.getStatusIcon(status.server.server)} ${status.server.server}\n` +
                `**Client Status:** ${this.getStatusIcon(status.server.client)} ${status.server.client}\n` +
                `**Started:** ${status.server.startTime}\n` +
                `**Uptime:** ${status.uptime} seconds\n` +
                `**Memory:** ${status.memory} MB\n\n` +
                `## Connection Details\n` +
                `${this.formatConnectionStatus()}\n\n` +
                `## Tool Availability\n` +
                `**Total Tools:** ${status.tools.total}\n` +
                `**Tools Available:** ${status.tools.available ? '✅ Yes' : '❌ No (client disconnected)'}\n` +
                `${status.server.lastError ? `\n## Last Error\n${status.server.lastError}` : ''}` +
                debugSection
        }
      ]
    };
  }

  // Formatting Helper Methods

  formatPatterns(patterns) {
    if (!patterns || !patterns.details) return 'No significant patterns detected.';
    
    return patterns.details.map(pattern => 
      `- **${pattern.type || 'Pattern'}**: ${pattern.explanation || pattern.context || 'No description'}`
    ).join('\n');
  }

  formatAnalyses(analyses) {
    if (!analyses || analyses.length === 0) return 'No analyses available.';
    
    return analyses.slice(0, 3).map(analysis => 
      `### ${analysis.commit.subject}\n` +
      `- **Significance:** ${analysis.significance}/10\n` +
      `- **Files:** ${analysis.changedFiles?.length || 0}\n` +
      `- **Author:** ${analysis.commit.author}\n`
    ).join('\n');
  }

  formatInsights(insights) {
    if (!insights || insights.length === 0) return 'No insights extracted.';
    
    return insights.map(insight => 
      `### ${insight.title}\n` +
      `${insight.description}\n` +
      `- **Type:** ${insight.type}\n` +
      `- **Significance:** ${insight.significance}/10\n` +
      `- **Applicability:** ${insight.applicability}\n`
    ).join('\n');
  }

  formatSearchResults(results) {
    if (!results || results.length === 0) return 'No results found.';
    
    return results.slice(0, 5).map(result => 
      `### ${result.title}\n` +
      `${result.snippet}\n` +
      `**URL:** ${result.url}\n` +
      `**Relevance:** ${Math.round((result.relevanceScore || 0) * 100)}%\n`
    ).join('\n');
  }

  formatKnowledgeResults(results) {
    if (!results || results.length === 0) return 'No entities found.';
    
    return results.map(entity => 
      `### ${entity.name}\n` +
      `- **Type:** ${entity.entityType}\n` +
      `- **Significance:** ${entity.significance}/10\n` +
      `- **Observations:** ${entity.observations?.length || 0}\n`
    ).join('\n');
  }

  formatSyncResults(result) {
    let text = '';
    
    if (result.export) {
      text += `**Export to UKB:** ${result.export.syncedEntities}/${result.export.totalEntities} entities synced\n`;
    }
    
    if (result.import) {
      text += `**Import from UKB:** ${result.import.importedEntities} entities imported\n`;
    }
    
    return text || 'Sync completed successfully.';
  }

  formatAgentStatus(agents) {
    if (!agents) return 'No agent information available.';
    
    return Object.entries(agents).map(([agentId, status]) => 
      `- **${agentId}:** ${status.status || 'unknown'} (${status.capabilities?.length || 0} capabilities)`
    ).join('\n');
  }

  formatHealthStatus(health) {
    if (!health) return 'Health information not available.';
    
    const metrics = [];
    if (health.memory) metrics.push(`Memory: ${health.memory}`);
    if (health.uptime) metrics.push(`Uptime: ${health.uptime}`);
    if (health.connections) metrics.push(`Connections: ${health.connections}`);
    
    return metrics.join(' | ') || 'System operational.';
  }
  
  formatConnectionStatus() {
    return Object.entries(this.connectionStatus)
      .filter(([key]) => key !== 'startTime' && key !== 'lastError')
      .map(([key, value]) => {
        const displayName = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
        const icon = this.getStatusIcon(value);
        return `**${displayName}:** ${icon} ${value}`;
      })
      .join('\n');
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logger.info('MCP Server started on stdio transport');
  }
}

// Start the server
async function main() {
  try {
    const server = new SemanticAnalysisMCPServer();
    await server.start();
  } catch (error) {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}