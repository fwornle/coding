/**
 * Coordinator Agent
 * Orchestrates workflows between semantic analysis, web search, and knowledge graph agents
 */

import { BaseAgent } from '../../framework/base-agent.js';
import { WorkflowEngine } from './engines/workflow-engine.js';
import { WorkflowBuilder } from './builders/workflow-builder.js';
import { TaskScheduler } from './schedulers/task-scheduler.js';
import { EventTypes } from '../../infrastructure/events/event-types.js';
import { Logger } from '../../shared/logger.js';

export class CoordinatorAgent extends BaseAgent {
  constructor(config) {
    super({
      id: 'coordinator',
      ...config
    });
    
    this.workflowEngine = null;
    this.workflowBuilder = null;
    this.taskScheduler = null;
    this.activeWorkflows = new Map();
    this.agentCapabilities = new Map();
  }

  async onInitialize() {
    this.logger.info('Initializing Coordinator Agent...');
    
    // Initialize workflow components
    this.workflowEngine = new WorkflowEngine(this.config.workflows);
    this.workflowBuilder = new WorkflowBuilder(this.config.workflows);
    this.taskScheduler = new TaskScheduler(this.config.scheduling);
    
    // Register request handlers
    this.registerRequestHandlers();
    
    // Subscribe to events
    await this.subscribeToEvents();
    
    // Discover agent capabilities
    await this.discoverAgentCapabilities();
    
    // Start scheduler
    this.taskScheduler.start();
    
    this.logger.info('Coordinator Agent initialized successfully');
  }

  registerRequestHandlers() {
    // Workflow management
    this.registerRequestHandler('coordinator/workflow/create',
      this.handleWorkflowCreateRequest.bind(this));
    
    this.registerRequestHandler('coordinator/workflow/start',
      this.handleWorkflowStartRequest.bind(this));
    
    this.registerRequestHandler('coordinator/workflow/stop',
      this.handleWorkflowStopRequest.bind(this));
    
    this.registerRequestHandler('coordinator/workflow/status',
      this.handleWorkflowStatusRequest.bind(this));
    
    // Task scheduling
    this.registerRequestHandler('coordinator/task/schedule',
      this.handleTaskScheduleRequest.bind(this));
    
    // Agent coordination
    this.registerRequestHandler('coordinator/agents/discover',
      this.handleAgentDiscoveryRequest.bind(this));
    
    // Predefined workflows
    this.registerRequestHandler('coordinator/analyze/repository',
      this.handleRepositoryAnalysisRequest.bind(this));
    
    this.registerRequestHandler('coordinator/analyze/conversation',
      this.handleConversationAnalysisRequest.bind(this));
    
    this.registerRequestHandler('coordinator/research/technology',
      this.handleTechnologyResearchRequest.bind(this));
  }

  async subscribeToEvents() {
    // Subscribe to all agent completion events for workflow coordination
    await this.subscribe(EventTypes.CODE_ANALYSIS_COMPLETED,
      this.handleAnalysisCompleted.bind(this));
    
    await this.subscribe(EventTypes.CONVERSATION_ANALYSIS_COMPLETED,
      this.handleAnalysisCompleted.bind(this));
    
    await this.subscribe(EventTypes.WEB_SEARCH_COMPLETED,
      this.handleSearchCompleted.bind(this));
    
    await this.subscribe(EventTypes.ENTITY_CREATED,
      this.handleEntityCreated.bind(this));
    
    await this.subscribe(EventTypes.KNOWLEDGE_SYNCED,
      this.handleKnowledgeSynced.bind(this));
    
    // Subscribe to workflow events
    await this.subscribe(EventTypes.WORKFLOW_STARTED,
      this.handleWorkflowStarted.bind(this));
    
    await this.subscribe(EventTypes.WORKFLOW_COMPLETED,
      this.handleWorkflowCompleted.bind(this));
    
    await this.subscribe(EventTypes.WORKFLOW_FAILED,
      this.handleWorkflowFailed.bind(this));
    
    // Subscribe to agent lifecycle events
    await this.subscribe(EventTypes.AGENT_STARTED,
      this.handleAgentStarted.bind(this));
    
    await this.subscribe(EventTypes.AGENT_STOPPED,
      this.handleAgentStopped.bind(this));
  }

  async handleWorkflowCreateRequest(data) {
    try {
      const { workflowDefinition, requestId } = data;
      
      const workflow = await this.workflowBuilder.createWorkflow(workflowDefinition);
      
      await this.publish('coordinator/workflow/created', {
        requestId,
        workflowId: workflow.id,
        workflow,
        status: 'created'
      });

      return workflow;
      
    } catch (error) {
      this.logger.error('Workflow creation failed:', error);
      throw error;
    }
  }

  async handleWorkflowStartRequest(data) {
    try {
      const { workflowId, parameters, requestId } = data;
      
      const workflow = await this.workflowEngine.startWorkflow(workflowId, parameters);
      this.activeWorkflows.set(workflowId, workflow);
      
      await this.publish(EventTypes.WORKFLOW_STARTED, {
        requestId,
        workflowId,
        workflow,
        status: 'started'
      });

      return workflow;
      
    } catch (error) {
      this.logger.error('Workflow start failed:', error);
      throw error;
    }
  }

  async handleWorkflowStopRequest(data) {
    try {
      const { workflowId, requestId } = data;
      
      await this.workflowEngine.stopWorkflow(workflowId);
      this.activeWorkflows.delete(workflowId);
      
      await this.publish('coordinator/workflow/stopped', {
        requestId,
        workflowId,
        status: 'stopped'
      });

      return { workflowId, status: 'stopped' };
      
    } catch (error) {
      this.logger.error('Workflow stop failed:', error);
      throw error;
    }
  }

  async handleWorkflowStatusRequest(data) {
    try {
      const { workflowId, requestId } = data;
      
      const status = await this.workflowEngine.getWorkflowStatus(workflowId);
      
      await this.publish('coordinator/workflow/status/retrieved', {
        requestId,
        workflowId,
        status
      });

      return status;
      
    } catch (error) {
      this.logger.error('Workflow status retrieval failed:', error);
      throw error;
    }
  }

  async handleTaskScheduleRequest(data) {
    try {
      const { task, schedule, requestId } = data;
      
      const scheduledTask = await this.taskScheduler.scheduleTask(task, schedule);
      
      await this.publish('coordinator/task/scheduled', {
        requestId,
        taskId: scheduledTask.id,
        task: scheduledTask,
        status: 'scheduled'
      });

      return scheduledTask;
      
    } catch (error) {
      this.logger.error('Task scheduling failed:', error);
      throw error;
    }
  }

  async handleAgentDiscoveryRequest(data) {
    try {
      const { requestId } = data;
      
      await this.discoverAgentCapabilities();
      
      const agentInfo = Array.from(this.agentCapabilities.entries()).map(([agentId, capabilities]) => ({
        agentId,
        capabilities
      }));
      
      await this.publish('coordinator/agents/discovered', {
        requestId,
        agents: agentInfo,
        status: 'completed'
      });

      return agentInfo;
      
    } catch (error) {
      this.logger.error('Agent discovery failed:', error);
      throw error;
    }
  }

  async handleRepositoryAnalysisRequest(data) {
    try {
      const { repository, depth = 10, includeSearch = true, requestId } = data;
      
      this.logger.info(`Starting repository analysis workflow for: ${repository}`);
      
      // Create repository analysis workflow
      const workflow = await this.workflowBuilder.createRepositoryAnalysisWorkflow({
        repository,
        depth,
        includeSearch
      });
      
      // Start the workflow
      const execution = await this.workflowEngine.startWorkflow(workflow.id, data);
      this.activeWorkflows.set(workflow.id, execution);
      
      await this.publish('coordinator/repository-analysis/started', {
        requestId,
        workflowId: workflow.id,
        repository,
        status: 'started'
      });

      return { workflowId: workflow.id, status: 'started' };
      
    } catch (error) {
      this.logger.error('Repository analysis workflow failed:', error);
      throw error;
    }
  }

  async handleConversationAnalysisRequest(data) {
    try {
      const { conversationPath, extractInsights = true, updateKnowledge = true, requestId } = data;
      
      this.logger.info(`Starting conversation analysis workflow for: ${conversationPath}`);
      
      // Create conversation analysis workflow
      const workflow = await this.workflowBuilder.createConversationAnalysisWorkflow({
        conversationPath,
        extractInsights,
        updateKnowledge
      });
      
      // Start the workflow
      const execution = await this.workflowEngine.startWorkflow(workflow.id, data);
      this.activeWorkflows.set(workflow.id, execution);
      
      await this.publish('coordinator/conversation-analysis/started', {
        requestId,
        workflowId: workflow.id,
        conversationPath,
        status: 'started'
      });

      return { workflowId: workflow.id, status: 'started' };
      
    } catch (error) {
      this.logger.error('Conversation analysis workflow failed:', error);
      throw error;
    }
  }

  async handleTechnologyResearchRequest(data) {
    try {
      const { technology, aspects = ['documentation', 'best-practices', 'comparison'], requestId } = data;
      
      this.logger.info(`Starting technology research workflow for: ${technology}`);
      
      // Create technology research workflow
      const workflow = await this.workflowBuilder.createTechnologyResearchWorkflow({
        technology,
        aspects
      });
      
      // Start the workflow
      const execution = await this.workflowEngine.startWorkflow(workflow.id, data);
      this.activeWorkflows.set(workflow.id, execution);
      
      await this.publish('coordinator/technology-research/started', {
        requestId,
        workflowId: workflow.id,
        technology,
        status: 'started'
      });

      return { workflowId: workflow.id, status: 'started' };
      
    } catch (error) {
      this.logger.error('Technology research workflow failed:', error);
      throw error;
    }
  }

  async handleAnalysisCompleted(data) {
    try {
      // Find workflows waiting for this analysis
      for (const [workflowId, workflow] of this.activeWorkflows) {
        if (workflow.status === 'running' && workflow.currentStep?.waitingFor === 'analysis') {
          await this.workflowEngine.continueWorkflow(workflowId, {
            analysisResult: data.result,
            eventType: data.type || 'analysis-completed'
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to handle analysis completion:', error);
    }
  }

  async handleSearchCompleted(data) {
    try {
      // Find workflows waiting for search results
      for (const [workflowId, workflow] of this.activeWorkflows) {
        if (workflow.status === 'running' && workflow.currentStep?.waitingFor === 'search') {
          await this.workflowEngine.continueWorkflow(workflowId, {
            searchResult: data.result,
            eventType: 'search-completed'
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to handle search completion:', error);
    }
  }

  async handleEntityCreated(data) {
    try {
      // Find workflows waiting for entity creation
      for (const [workflowId, workflow] of this.activeWorkflows) {
        if (workflow.status === 'running' && workflow.currentStep?.waitingFor === 'entity-creation') {
          await this.workflowEngine.continueWorkflow(workflowId, {
            entity: data.entity,
            eventType: 'entity-created'
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to handle entity creation:', error);
    }
  }

  async handleKnowledgeSynced(data) {
    try {
      // Find workflows waiting for knowledge sync
      for (const [workflowId, workflow] of this.activeWorkflows) {
        if (workflow.status === 'running' && workflow.currentStep?.waitingFor === 'knowledge-sync') {
          await this.workflowEngine.continueWorkflow(workflowId, {
            syncResult: data.result,
            eventType: 'knowledge-synced'
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to handle knowledge sync:', error);
    }
  }

  async handleWorkflowStarted(data) {
    this.logger.info(`Workflow started: ${data.workflowId}`);
  }

  async handleWorkflowCompleted(data) {
    try {
      const { workflowId } = data;
      this.activeWorkflows.delete(workflowId);
      this.logger.info(`Workflow completed: ${workflowId}`);
      
      // Trigger any dependent workflows
      await this.triggerDependentWorkflows(workflowId, data);
      
    } catch (error) {
      this.logger.error('Failed to handle workflow completion:', error);
    }
  }

  async handleWorkflowFailed(data) {
    try {
      const { workflowId } = data;
      this.activeWorkflows.delete(workflowId);
      this.logger.error(`Workflow failed: ${workflowId}`, data.error);
      
      // Handle failure recovery if configured
      await this.handleWorkflowFailure(workflowId, data);
      
    } catch (error) {
      this.logger.error('Failed to handle workflow failure:', error);
    }
  }

  async handleAgentStarted(data) {
    try {
      const { agentId } = data;
      this.logger.info(`Agent started: ${agentId}`);
      
      // Rediscover capabilities when new agents start
      await this.discoverAgentCapabilities();
      
    } catch (error) {
      this.logger.error('Failed to handle agent start:', error);
    }
  }

  async handleAgentStopped(data) {
    try {
      const { agentId } = data;
      this.logger.info(`Agent stopped: ${agentId}`);
      
      // Remove capabilities and handle active workflows
      this.agentCapabilities.delete(agentId);
      await this.handleAgentStoppedWorkflows(agentId);
      
    } catch (error) {
      this.logger.error('Failed to handle agent stop:', error);
    }
  }

  async discoverAgentCapabilities() {
    try {
      // Send discovery requests to all known agents
      const agentIds = ['semantic-analysis', 'web-search', 'knowledge-graph'];
      
      for (const agentId of agentIds) {
        try {
          const response = await this.sendRequest(`${agentId}/capabilities`, {});
          if (response && response.capabilities) {
            this.agentCapabilities.set(agentId, response.capabilities);
            this.logger.debug(`Discovered capabilities for ${agentId}:`, response.capabilities);
          }
        } catch (error) {
          this.logger.debug(`Failed to discover capabilities for ${agentId}:`, error.message);
        }
      }
      
    } catch (error) {
      this.logger.error('Agent capability discovery failed:', error);
    }
  }

  async triggerDependentWorkflows(completedWorkflowId, completionData) {
    // Check for workflows that depend on the completed workflow
    // This would be configured in the workflow definitions
    this.logger.debug(`Checking for dependent workflows of ${completedWorkflowId}`);
  }

  async handleWorkflowFailure(workflowId, failureData) {
    // Implement failure recovery strategies:
    // - Retry with exponential backoff
    // - Partial workflow restart
    // - Alternative workflow paths
    this.logger.debug(`Handling failure for workflow ${workflowId}`);
  }

  async handleAgentStoppedWorkflows(stoppedAgentId) {
    // Handle workflows that depend on the stopped agent
    for (const [workflowId, workflow] of this.activeWorkflows) {
      if (workflow.currentStep?.targetAgent === stoppedAgentId) {
        this.logger.warn(`Workflow ${workflowId} affected by agent ${stoppedAgentId} stopping`);
        // Could pause, reroute, or fail the workflow
      }
    }
  }

  getCapabilities() {
    return [
      'workflow-orchestration',
      'multi-agent-coordination',
      'task-scheduling',
      'agent-discovery',
      'predefined-workflows',
      'failure-recovery',
      'dependency-management'
    ];
  }

  getMetadata() {
    return {
      activeWorkflows: this.activeWorkflows.size,
      knownAgents: this.agentCapabilities.size,
      agentCapabilities: Object.fromEntries(this.agentCapabilities),
      workflowEngine: this.workflowEngine?.getInfo(),
      taskScheduler: this.taskScheduler?.getInfo(),
      config: this.config
    };
  }

  async onStop() {
    // Stop all active workflows gracefully
    for (const [workflowId, workflow] of this.activeWorkflows) {
      try {
        await this.workflowEngine.stopWorkflow(workflowId);
      } catch (error) {
        this.logger.error(`Failed to stop workflow ${workflowId}:`, error);
      }
    }
    
    // Stop task scheduler
    if (this.taskScheduler) {
      this.taskScheduler.stop();
    }
    
    this.logger.info('Coordinator Agent stopped');
  }
}