#!/usr/bin/env node

/**
 * MCP Server for Semantic Analysis System
 * Exposes agent capabilities as MCP tools for Claude Code integration
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
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
    this.setupServer();
  }

  async setupServer() {
    try {
      // Initialize semantic analysis client
      this.client = new SemanticAnalysisClient();
      await this.client.connect();
      
      // Register tools
      this.registerTools();
      
      // Register error handlers
      this.server.onerror = (error) => {
        this.logger.error('MCP Server error:', error);
      };
      
      this.logger.info('MCP Server setup completed');
      
    } catch (error) {
      this.logger.error('Failed to setup MCP server:', error);
      throw error;
    }
  }

  registerTools() {
    // Semantic Analysis Tools
    this.server.setRequestHandler('tools/call', async (request) => {
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

    this.server.setRequestHandler('tools/list', async () => {
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
      throw new Error(`System status retrieval failed: ${error.message}`);
    }
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