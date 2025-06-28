/**
 * Workflow Engine
 * Executes and manages workflow instances
 */

import { EventEmitter } from 'events';
import { Logger } from '../../../shared/logger.js';
import { EventTypes } from '../../../infrastructure/events/event-types.js';

export class WorkflowEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      maxConcurrentWorkflows: config.maxConcurrentWorkflows || 10,
      defaultTimeout: config.defaultTimeout || 300000, // 5 minutes
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 5000,
      ...config
    };
    
    this.logger = new Logger('workflow-engine');
    this.workflows = new Map(); // workflowId -> workflow definition
    this.executions = new Map(); // executionId -> execution state
    this.running = false;
    
    this.startEngine();
  }

  startEngine() {
    this.running = true;
    this.logger.info('Workflow engine started');
    
    // Start monitoring loop
    this.monitoringInterval = setInterval(() => {
      this.monitorExecutions();
    }, 10000); // Check every 10 seconds
  }

  stopEngine() {
    this.running = false;
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    
    this.logger.info('Workflow engine stopped');
  }

  registerWorkflow(workflow) {
    this.workflows.set(workflow.id, workflow);
    this.logger.debug(`Registered workflow: ${workflow.id}`);
  }

  async startWorkflow(workflowId, parameters = {}) {
    try {
      const workflow = this.workflows.get(workflowId);
      
      if (!workflow) {
        throw new Error(`Workflow not found: ${workflowId}`);
      }

      // Check concurrent execution limit
      const runningCount = Array.from(this.executions.values())
        .filter(exec => exec.status === 'running').length;
      
      if (runningCount >= this.config.maxConcurrentWorkflows) {
        throw new Error('Maximum concurrent workflows reached');
      }

      // Create execution instance
      const execution = this.createExecution(workflow, parameters);
      this.executions.set(execution.id, execution);
      
      this.logger.info(`Starting workflow execution: ${execution.id} (${workflowId})`);
      
      // Start execution
      await this.executeWorkflow(execution);
      
      return execution;
      
    } catch (error) {
      this.logger.error(`Failed to start workflow ${workflowId}:`, error);
      throw error;
    }
  }

  async stopWorkflow(executionId) {
    try {
      const execution = this.executions.get(executionId);
      
      if (!execution) {
        throw new Error(`Execution not found: ${executionId}`);
      }

      execution.status = 'stopped';
      execution.stoppedAt = new Date().toISOString();
      
      // Cancel any pending timeouts
      if (execution.stepTimeout) {
        clearTimeout(execution.stepTimeout);
      }

      this.logger.info(`Stopped workflow execution: ${executionId}`);
      
      this.emit('workflow-stopped', { executionId, execution });
      
    } catch (error) {
      this.logger.error(`Failed to stop workflow ${executionId}:`, error);
      throw error;
    }
  }

  async continueWorkflow(executionId, eventData) {
    try {
      const execution = this.executions.get(executionId);
      
      if (!execution || execution.status !== 'running') {
        return;
      }

      // Clear step timeout
      if (execution.stepTimeout) {
        clearTimeout(execution.stepTimeout);
        execution.stepTimeout = null;
      }

      // Continue with next step
      await this.executeNextStep(execution, eventData);
      
    } catch (error) {
      this.logger.error(`Failed to continue workflow ${executionId}:`, error);
      await this.failExecution(execution, error);
    }
  }

  async getWorkflowStatus(executionId) {
    const execution = this.executions.get(executionId);
    
    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    return {
      id: execution.id,
      workflowId: execution.workflowId,
      status: execution.status,
      currentStepIndex: execution.currentStepIndex,
      currentStep: execution.currentStep,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      error: execution.error,
      progress: this.calculateProgress(execution),
      context: execution.context
    };
  }

  createExecution(workflow, parameters) {
    const executionId = this.generateExecutionId();
    
    return {
      id: executionId,
      workflowId: workflow.id,
      workflow: workflow,
      status: 'created',
      currentStepIndex: 0,
      currentStep: null,
      context: { ...parameters },
      results: [],
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
      stepTimeout: null,
      retryCount: 0
    };
  }

  async executeWorkflow(execution) {
    try {
      execution.status = 'running';
      
      this.emit('workflow-started', {
        executionId: execution.id,
        workflowId: execution.workflowId
      });

      await this.executeNextStep(execution);
      
    } catch (error) {
      await this.failExecution(execution, error);
    }
  }

  async executeNextStep(execution, eventData = null) {
    try {
      const workflow = execution.workflow;
      
      // Check if workflow is complete
      if (execution.currentStepIndex >= workflow.steps.length) {
        await this.completeExecution(execution);
        return;
      }

      const step = workflow.steps[execution.currentStepIndex];
      execution.currentStep = step;
      
      this.logger.debug(`Executing step ${execution.currentStepIndex + 1}/${workflow.steps.length}: ${step.name} (${execution.id})`);
      
      // Check step conditions
      if (!this.checkStepConditions(step, execution.context, eventData)) {
        this.logger.debug(`Skipping step ${step.name} - conditions not met`);
        execution.currentStepIndex++;
        await this.executeNextStep(execution);
        return;
      }

      // Execute the step
      const stepResult = await this.executeStep(step, execution, eventData);
      
      // Handle step result
      await this.handleStepResult(execution, step, stepResult);
      
    } catch (error) {
      this.logger.error(`Step execution failed for ${execution.id}:`, error);
      
      // Try to retry the step
      if (execution.retryCount < this.config.retryAttempts) {
        execution.retryCount++;
        this.logger.info(`Retrying step (attempt ${execution.retryCount}/${this.config.retryAttempts})`);
        
        setTimeout(() => {
          this.executeNextStep(execution, eventData);
        }, this.config.retryDelay);
        
        return;
      }
      
      await this.failExecution(execution, error);
    }
  }

  async executeStep(step, execution, eventData) {
    const stepStartTime = Date.now();
    
    try {
      let result;
      
      switch (step.type) {
        case 'agent-call':
          result = await this.executeAgentCall(step, execution, eventData);
          break;
        case 'condition':
          result = await this.executeCondition(step, execution, eventData);
          break;
        case 'parallel':
          result = await this.executeParallel(step, execution, eventData);
          break;
        case 'wait':
          result = await this.executeWait(step, execution, eventData);
          break;
        case 'transform':
          result = await this.executeTransform(step, execution, eventData);
          break;
        default:
          throw new Error(`Unknown step type: ${step.type}`);
      }
      
      const duration = Date.now() - stepStartTime;
      this.logger.debug(`Step ${step.name} completed in ${duration}ms`);
      
      return result;
      
    } catch (error) {
      const duration = Date.now() - stepStartTime;
      this.logger.error(`Step ${step.name} failed after ${duration}ms:`, error);
      throw error;
    }
  }

  async executeAgentCall(step, execution, eventData) {
    const { agent, action, parameters = {} } = step.config;
    
    // Build request parameters
    const requestParams = this.buildRequestParameters(parameters, execution.context, eventData);
    
    // Set timeout for step
    const timeout = step.timeout || this.config.defaultTimeout;
    execution.stepTimeout = setTimeout(() => {
      this.logger.error(`Step timeout: ${step.name} in execution ${execution.id}`);
      this.failExecution(execution, new Error(`Step timeout: ${step.name}`));
    }, timeout);

    // Send request to agent
    return new Promise((resolve, reject) => {
      const requestId = this.generateRequestId();
      
      // Store request for tracking
      execution.currentRequest = { requestId, resolve, reject };
      
      // If this is a wait step, we don't send a request, just wait for events
      if (step.config.waitingFor) {
        execution.currentStep.waitingFor = step.config.waitingFor;
        return; // Will be resolved by continueWorkflow when event arrives
      }
      
      // Send the actual request
      this.emit('agent-request', {
        agent,
        action,
        parameters: { ...requestParams, requestId },
        executionId: execution.id,
        stepName: step.name
      });
    });
  }

  async executeCondition(step, execution, eventData) {
    const { condition } = step.config;
    
    // Evaluate condition based on context and event data
    const result = this.evaluateCondition(condition, execution.context, eventData);
    
    return { conditionResult: result };
  }

  async executeParallel(step, execution, eventData) {
    const { steps } = step.config;
    
    // Execute all parallel steps
    const promises = steps.map(parallelStep => 
      this.executeStep(parallelStep, execution, eventData)
    );
    
    const results = await Promise.all(promises);
    
    return { parallelResults: results };
  }

  async executeWait(step, execution, eventData) {
    const { duration, condition, waitingFor } = step.config;
    
    if (duration) {
      // Wait for specific duration
      await new Promise(resolve => setTimeout(resolve, duration));
      return { waitCompleted: true };
    }
    
    if (waitingFor) {
      // Wait for specific event (handled by continueWorkflow)
      execution.currentStep.waitingFor = waitingFor;
      return new Promise((resolve) => {
        execution.currentRequest = { resolve };
      });
    }
    
    if (condition) {
      // Wait until condition is met
      return new Promise((resolve) => {
        const checkCondition = () => {
          if (this.evaluateCondition(condition, execution.context, eventData)) {
            resolve({ conditionMet: true });
          } else {
            setTimeout(checkCondition, 1000); // Check every second
          }
        };
        checkCondition();
      });
    }
    
    throw new Error('Wait step requires duration, condition, or waitingFor');
  }

  async executeTransform(step, execution, eventData) {
    const { transform } = step.config;
    
    // Apply transformation to context
    const result = this.applyTransformation(transform, execution.context, eventData);
    
    return { transformResult: result };
  }

  buildRequestParameters(parameters, context, eventData) {
    const built = {};
    
    for (const [key, value] of Object.entries(parameters)) {
      if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
        // Template substitution
        const path = value.slice(2, -1);
        built[key] = this.getValueFromPath(path, { context, eventData });
      } else {
        built[key] = value;
      }
    }
    
    return built;
  }

  getValueFromPath(path, data) {
    const parts = path.split('.');
    let current = data;
    
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }
    
    return current;
  }

  checkStepConditions(step, context, eventData) {
    if (!step.conditions) return true;
    
    for (const condition of step.conditions) {
      if (!this.evaluateCondition(condition, context, eventData)) {
        return false;
      }
    }
    
    return true;
  }

  evaluateCondition(condition, context, eventData) {
    // Simple condition evaluation
    // In production, use a proper expression evaluator
    try {
      const { field, operator, value } = condition;
      const fieldValue = this.getValueFromPath(field, { context, eventData });
      
      switch (operator) {
        case 'equals': return fieldValue === value;
        case 'not_equals': return fieldValue !== value;
        case 'greater_than': return fieldValue > value;
        case 'less_than': return fieldValue < value;
        case 'contains': return String(fieldValue).includes(value);
        case 'exists': return fieldValue !== undefined && fieldValue !== null;
        default: return true;
      }
    } catch (error) {
      this.logger.warn('Condition evaluation failed:', error);
      return false;
    }
  }

  applyTransformation(transform, context, eventData) {
    // Apply transformation rules
    const result = {};
    
    for (const [targetKey, sourceKey] of Object.entries(transform)) {
      result[targetKey] = this.getValueFromPath(sourceKey, { context, eventData });
    }
    
    return result;
  }

  async handleStepResult(execution, step, result) {
    // Store step result
    execution.results.push({
      step: step.name,
      result: result,
      timestamp: new Date().toISOString()
    });
    
    // Update context with step results
    if (step.outputMapping) {
      for (const [contextKey, resultKey] of Object.entries(step.outputMapping)) {
        execution.context[contextKey] = this.getValueFromPath(resultKey, { result });
      }
    }
    
    // Reset retry count on successful step
    execution.retryCount = 0;
    
    // Move to next step
    execution.currentStepIndex++;
    
    // Continue workflow
    if (step.type !== 'wait' || !step.config.waitingFor) {
      await this.executeNextStep(execution);
    }
  }

  async completeExecution(execution) {
    execution.status = 'completed';
    execution.completedAt = new Date().toISOString();
    
    this.logger.info(`Workflow execution completed: ${execution.id}`);
    
    this.emit('workflow-completed', {
      executionId: execution.id,
      workflowId: execution.workflowId,
      results: execution.results,
      context: execution.context
    });
  }

  async failExecution(execution, error) {
    execution.status = 'failed';
    execution.error = error.message;
    execution.completedAt = new Date().toISOString();
    
    // Clear any timeouts
    if (execution.stepTimeout) {
      clearTimeout(execution.stepTimeout);
    }
    
    this.logger.error(`Workflow execution failed: ${execution.id}`, error);
    
    this.emit('workflow-failed', {
      executionId: execution.id,
      workflowId: execution.workflowId,
      error: error.message,
      context: execution.context
    });
  }

  calculateProgress(execution) {
    if (execution.workflow.steps.length === 0) return 100;
    
    const completedSteps = Math.min(execution.currentStepIndex, execution.workflow.steps.length);
    return Math.round((completedSteps / execution.workflow.steps.length) * 100);
  }

  monitorExecutions() {
    const now = Date.now();
    
    for (const [executionId, execution] of this.executions) {
      // Clean up completed executions older than 1 hour
      if (execution.status !== 'running') {
        const completedTime = new Date(execution.completedAt || execution.startedAt).getTime();
        if (now - completedTime > 3600000) { // 1 hour
          this.executions.delete(executionId);
          this.logger.debug(`Cleaned up execution: ${executionId}`);
        }
      }
    }
  }

  generateExecutionId() {
    return `exec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  getInfo() {
    return {
      running: this.running,
      registeredWorkflows: this.workflows.size,
      activeExecutions: this.executions.size,
      config: this.config
    };
  }
}