/**
 * Workflow Builder
 * Creates and manages workflow definitions
 */

import { Logger } from '../../../shared/logger.js';

export class WorkflowBuilder {
  constructor(config = {}) {
    this.config = {
      defaultTimeout: config.defaultTimeout || 300000, // 5 minutes
      ...config
    };
    
    this.logger = new Logger('workflow-builder');
    this.templates = new Map();
    
    this.initializeTemplates();
  }

  initializeTemplates() {
    // Register predefined workflow templates
    this.registerTemplate('repository-analysis', this.createRepositoryAnalysisTemplate());
    this.registerTemplate('conversation-analysis', this.createConversationAnalysisTemplate());
    this.registerTemplate('technology-research', this.createTechnologyResearchTemplate());
    this.registerTemplate('knowledge-extraction', this.createKnowledgeExtractionTemplate());
  }

  registerTemplate(name, template) {
    this.templates.set(name, template);
    this.logger.debug(`Registered workflow template: ${name}`);
  }

  async createWorkflow(definition) {
    try {
      let workflow;
      
      if (typeof definition === 'string') {
        // Use predefined template
        const template = this.templates.get(definition);
        if (!template) {
          throw new Error(`Template not found: ${definition}`);
        }
        workflow = this.cloneTemplate(template);
      } else if (definition.template) {
        // Use template with parameters
        const template = this.templates.get(definition.template);
        if (!template) {
          throw new Error(`Template not found: ${definition.template}`);
        }
        workflow = this.cloneTemplate(template);
        
        // Apply parameters to template
        if (definition.parameters) {
          this.applyParameters(workflow, definition.parameters);
        }
      } else {
        // Custom workflow definition
        workflow = this.validateWorkflow(definition);
      }
      
      // Generate unique ID
      workflow.id = workflow.id || this.generateWorkflowId();
      workflow.createdAt = new Date().toISOString();
      
      this.logger.debug(`Created workflow: ${workflow.id} (${workflow.name})`);
      
      return workflow;
      
    } catch (error) {
      this.logger.error('Workflow creation failed:', error);
      throw error;
    }
  }

  async createRepositoryAnalysisWorkflow(parameters = {}) {
    const workflow = this.cloneTemplate(this.templates.get('repository-analysis'));
    this.applyParameters(workflow, parameters);
    workflow.id = this.generateWorkflowId();
    return workflow;
  }

  async createConversationAnalysisWorkflow(parameters = {}) {
    const workflow = this.cloneTemplate(this.templates.get('conversation-analysis'));
    this.applyParameters(workflow, parameters);
    workflow.id = this.generateWorkflowId();
    return workflow;
  }

  async createTechnologyResearchWorkflow(parameters = {}) {
    const workflow = this.cloneTemplate(this.templates.get('technology-research'));
    this.applyParameters(workflow, parameters);
    workflow.id = this.generateWorkflowId();
    return workflow;
  }

  createRepositoryAnalysisTemplate() {
    return {
      name: 'Repository Analysis',
      description: 'Analyzes a code repository and extracts knowledge',
      version: '1.0',
      parameters: {
        repository: { type: 'string', required: true },
        depth: { type: 'number', default: 10 },
        includeSearch: { type: 'boolean', default: true }
      },
      steps: [
        {
          name: 'analyze-repository',
          type: 'agent-call',
          config: {
            agent: 'semantic-analysis',
            action: 'analyze-code',
            parameters: {
              repository: '${context.repository}',
              depth: '${context.depth}',
              significanceThreshold: 7
            }
          },
          outputMapping: {
            analysisResult: 'result'
          },
          timeout: 180000 // 3 minutes
        },
        {
          name: 'extract-technologies',
          type: 'transform',
          config: {
            transform: {
              technologies: 'analysisResult.technologies',
              patterns: 'analysisResult.patterns'
            }
          },
          conditions: [
            { field: 'analysisResult', operator: 'exists' }
          ]
        },
        {
          name: 'search-best-practices',
          type: 'agent-call',
          config: {
            agent: 'web-search',
            action: 'best-practices',
            parameters: {
              technologies: '${context.technologies}',
              patterns: '${context.patterns}'
            }
          },
          conditions: [
            { field: 'context.includeSearch', operator: 'equals', value: true },
            { field: 'context.technologies', operator: 'exists' }
          ],
          outputMapping: {
            searchResults: 'result'
          },
          timeout: 120000 // 2 minutes
        },
        {
          name: 'create-knowledge-entities',
          type: 'agent-call',
          config: {
            agent: 'knowledge-graph',
            action: 'extract-insights',
            parameters: {
              analysisData: '${context.analysisResult}',
              context: {
                source: 'repository-analysis',
                repository: '${context.repository}'
              }
            }
          },
          outputMapping: {
            insights: 'result'
          }
        },
        {
          name: 'sync-with-ukb',
          type: 'agent-call',
          config: {
            agent: 'knowledge-graph',
            action: 'ukb-sync',
            parameters: {
              direction: 'to-ukb'
            }
          },
          outputMapping: {
            syncResult: 'result'
          }
        }
      ]
    };
  }

  createConversationAnalysisTemplate() {
    return {
      name: 'Conversation Analysis',
      description: 'Analyzes conversation logs and extracts insights',
      version: '1.0',
      parameters: {
        conversationPath: { type: 'string', required: true },
        extractInsights: { type: 'boolean', default: true },
        updateKnowledge: { type: 'boolean', default: true }
      },
      steps: [
        {
          name: 'analyze-conversation',
          type: 'agent-call',
          config: {
            agent: 'semantic-analysis',
            action: 'analyze-conversation',
            parameters: {
              conversationPath: '${context.conversationPath}',
              extractInsights: '${context.extractInsights}'
            }
          },
          outputMapping: {
            conversationAnalysis: 'result'
          }
        },
        {
          name: 'search-related-topics',
          type: 'agent-call',
          config: {
            agent: 'web-search',
            action: 'technical-docs',
            parameters: {
              topics: '${context.conversationAnalysis.mainTopics}',
              maxResults: 5
            }
          },
          conditions: [
            { field: 'context.conversationAnalysis.mainTopics', operator: 'exists' }
          ],
          outputMapping: {
            relatedDocs: 'result'
          }
        },
        {
          name: 'create-insights',
          type: 'agent-call',
          config: {
            agent: 'knowledge-graph',
            action: 'extract-insights',
            parameters: {
              analysisData: '${context.conversationAnalysis}',
              context: {
                source: 'conversation-analysis',
                conversationPath: '${context.conversationPath}'
              }
            }
          },
          conditions: [
            { field: 'context.updateKnowledge', operator: 'equals', value: true }
          ],
          outputMapping: {
            insights: 'result'
          }
        }
      ]
    };
  }

  createTechnologyResearchTemplate() {
    return {
      name: 'Technology Research',
      description: 'Researches a technology and compiles comprehensive information',
      version: '1.0',
      parameters: {
        technology: { type: 'string', required: true },
        aspects: { type: 'array', default: ['documentation', 'best-practices', 'comparison'] }
      },
      steps: [
        {
          name: 'search-documentation',
          type: 'agent-call',
          config: {
            agent: 'web-search',
            action: 'technical-docs',
            parameters: {
              technology: '${context.technology}',
              topic: 'documentation guide tutorial'
            }
          },
          conditions: [
            { field: 'context.aspects', operator: 'contains', value: 'documentation' }
          ],
          outputMapping: {
            documentation: 'result'
          }
        },
        {
          name: 'search-best-practices',
          type: 'agent-call',
          config: {
            agent: 'web-search',
            action: 'best-practices',
            parameters: {
              technology: '${context.technology}',
              category: 'development patterns architecture'
            }
          },
          conditions: [
            { field: 'context.aspects', operator: 'contains', value: 'best-practices' }
          ],
          outputMapping: {
            bestPractices: 'result'
          }
        },
        {
          name: 'search-comparisons',
          type: 'agent-call',
          config: {
            agent: 'web-search',
            action: 'tech-comparison',
            parameters: {
              technologies: '${context.technology}',
              criteria: 'performance scalability ecosystem'
            }
          },
          conditions: [
            { field: 'context.aspects', operator: 'contains', value: 'comparison' }
          ],
          outputMapping: {
            comparisons: 'result'
          }
        },
        {
          name: 'compile-research',
          type: 'transform',
          config: {
            transform: {
              research: {
                technology: 'context.technology',
                documentation: 'context.documentation',
                bestPractices: 'context.bestPractices',
                comparisons: 'context.comparisons',
                compiledAt: new Date().toISOString()
              }
            }
          },
          outputMapping: {
            compiledResearch: 'research'
          }
        },
        {
          name: 'create-technology-entity',
          type: 'agent-call',
          config: {
            agent: 'knowledge-graph',
            action: 'create-entity',
            parameters: {
              name: 'Technology Research: ${context.technology}',
              entityType: 'TechnologyResearch',
              significance: 7,
              observations: [
                'Research compiled from multiple sources',
                'Documentation: ${context.documentation.results.length} sources',
                'Best practices: ${context.bestPractices.results.length} sources',
                'Comparisons: ${context.comparisons.results.length} sources'
              ],
              metadata: {
                technology: '${context.technology}',
                researchDate: new Date().toISOString(),
                sources: {
                  documentation: '${context.documentation.metadata.totalResults}',
                  bestPractices: '${context.bestPractices.metadata.totalResults}',
                  comparisons: '${context.comparisons.metadata.totalResults}'
                }
              }
            }
          },
          outputMapping: {
            technologyEntity: 'result'
          }
        }
      ]
    };
  }

  createKnowledgeExtractionTemplate() {
    return {
      name: 'Knowledge Extraction',
      description: 'Extracts and organizes knowledge from various sources',
      version: '1.0',
      parameters: {
        source: { type: 'string', required: true },
        sourceType: { type: 'string', required: true }
      },
      steps: [
        {
          name: 'analyze-source',
          type: 'condition',
          config: {
            condition: { field: 'context.sourceType', operator: 'equals', value: 'code' }
          }
        },
        {
          name: 'analyze-code-source',
          type: 'agent-call',
          config: {
            agent: 'semantic-analysis',
            action: 'analyze-code',
            parameters: {
              repository: '${context.source}'
            }
          },
          conditions: [
            { field: 'context.sourceType', operator: 'equals', value: 'code' }
          ],
          outputMapping: {
            analysis: 'result'
          }
        },
        {
          name: 'analyze-conversation-source',
          type: 'agent-call',
          config: {
            agent: 'semantic-analysis',
            action: 'analyze-conversation',
            parameters: {
              conversationPath: '${context.source}'
            }
          },
          conditions: [
            { field: 'context.sourceType', operator: 'equals', value: 'conversation' }
          ],
          outputMapping: {
            analysis: 'result'
          }
        },
        {
          name: 'extract-knowledge',
          type: 'agent-call',
          config: {
            agent: 'knowledge-graph',
            action: 'extract-insights',
            parameters: {
              analysisData: '${context.analysis}',
              context: {
                source: '${context.source}',
                sourceType: '${context.sourceType}'
              }
            }
          },
          outputMapping: {
            extractedKnowledge: 'result'
          }
        }
      ]
    };
  }

  cloneTemplate(template) {
    return JSON.parse(JSON.stringify(template));
  }

  applyParameters(workflow, parameters) {
    // Apply parameters to workflow context
    for (const [key, value] of Object.entries(parameters)) {
      // Validate parameter if defined in template
      if (workflow.parameters && workflow.parameters[key]) {
        const paramDef = workflow.parameters[key];
        
        if (paramDef.required && (value === undefined || value === null)) {
          throw new Error(`Required parameter missing: ${key}`);
        }
        
        if (paramDef.type && !this.validateParameterType(value, paramDef.type)) {
          throw new Error(`Invalid parameter type for ${key}: expected ${paramDef.type}`);
        }
      }
    }
    
    // Set default values for missing parameters
    if (workflow.parameters) {
      for (const [key, paramDef] of Object.entries(workflow.parameters)) {
        if (!(key in parameters) && paramDef.default !== undefined) {
          parameters[key] = paramDef.default;
        }
      }
    }
    
    workflow.parameters = parameters;
  }

  validateParameterType(value, expectedType) {
    switch (expectedType) {
      case 'string': return typeof value === 'string';
      case 'number': return typeof value === 'number';
      case 'boolean': return typeof value === 'boolean';
      case 'array': return Array.isArray(value);
      case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
      default: return true;
    }
  }

  validateWorkflow(definition) {
    // Validate workflow structure
    if (!definition.name) {
      throw new Error('Workflow name is required');
    }
    
    if (!definition.steps || !Array.isArray(definition.steps)) {
      throw new Error('Workflow must have steps array');
    }
    
    if (definition.steps.length === 0) {
      throw new Error('Workflow must have at least one step');
    }
    
    // Validate each step
    for (let i = 0; i < definition.steps.length; i++) {
      const step = definition.steps[i];
      this.validateStep(step, i);
    }
    
    return definition;
  }

  validateStep(step, index) {
    if (!step.name) {
      throw new Error(`Step ${index + 1} is missing name`);
    }
    
    if (!step.type) {
      throw new Error(`Step ${index + 1} (${step.name}) is missing type`);
    }
    
    const validTypes = ['agent-call', 'condition', 'parallel', 'wait', 'transform'];
    if (!validTypes.includes(step.type)) {
      throw new Error(`Step ${index + 1} (${step.name}) has invalid type: ${step.type}`);
    }
    
    if (!step.config) {
      throw new Error(`Step ${index + 1} (${step.name}) is missing config`);
    }
    
    // Type-specific validation
    switch (step.type) {
      case 'agent-call':
        this.validateAgentCallStep(step);
        break;
      case 'condition':
        this.validateConditionStep(step);
        break;
      case 'parallel':
        this.validateParallelStep(step);
        break;
      case 'wait':
        this.validateWaitStep(step);
        break;
      case 'transform':
        this.validateTransformStep(step);
        break;
    }
  }

  validateAgentCallStep(step) {
    const { agent, action } = step.config;
    
    if (!agent) {
      throw new Error(`Agent call step ${step.name} is missing agent`);
    }
    
    if (!action) {
      throw new Error(`Agent call step ${step.name} is missing action`);
    }
  }

  validateConditionStep(step) {
    const { condition } = step.config;
    
    if (!condition) {
      throw new Error(`Condition step ${step.name} is missing condition`);
    }
  }

  validateParallelStep(step) {
    const { steps } = step.config;
    
    if (!steps || !Array.isArray(steps)) {
      throw new Error(`Parallel step ${step.name} is missing steps array`);
    }
  }

  validateWaitStep(step) {
    const { duration, condition, waitingFor } = step.config;
    
    if (!duration && !condition && !waitingFor) {
      throw new Error(`Wait step ${step.name} must have duration, condition, or waitingFor`);
    }
  }

  validateTransformStep(step) {
    const { transform } = step.config;
    
    if (!transform) {
      throw new Error(`Transform step ${step.name} is missing transform config`);
    }
  }

  generateWorkflowId() {
    return `workflow_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  getTemplates() {
    return Array.from(this.templates.keys());
  }

  getTemplate(name) {
    return this.templates.get(name);
  }
}