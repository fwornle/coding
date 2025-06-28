/**
 * Task Scheduler
 * Schedules and manages recurring tasks and workflows
 */

import { EventEmitter } from 'events';
import { Logger } from '../../../shared/logger.js';

export class TaskScheduler extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      maxConcurrentTasks: config.maxConcurrentTasks || 5,
      checkInterval: config.checkInterval || 60000, // 1 minute
      ...config
    };
    
    this.logger = new Logger('task-scheduler');
    this.scheduledTasks = new Map();
    this.runningTasks = new Map();
    this.running = false;
    this.scheduleInterval = null;
  }

  start() {
    if (this.running) return;
    
    this.running = true;
    this.logger.info('Task scheduler started');
    
    // Start scheduling loop
    this.scheduleInterval = setInterval(() => {
      this.checkScheduledTasks();
    }, this.config.checkInterval);
    
    // Initial check
    this.checkScheduledTasks();
  }

  stop() {
    if (!this.running) return;
    
    this.running = false;
    
    if (this.scheduleInterval) {
      clearInterval(this.scheduleInterval);
      this.scheduleInterval = null;
    }
    
    // Stop all running tasks
    for (const [taskId, task] of this.runningTasks) {
      this.stopTask(taskId);
    }
    
    this.logger.info('Task scheduler stopped');
  }

  async scheduleTask(taskDefinition, schedule) {
    try {
      const task = this.createScheduledTask(taskDefinition, schedule);
      
      this.scheduledTasks.set(task.id, task);
      
      this.logger.info(`Task scheduled: ${task.id} (${task.name})`);
      
      // Check if task should run immediately
      if (this.shouldRunTask(task)) {
        await this.executeTask(task);
      }
      
      return task;
      
    } catch (error) {
      this.logger.error('Task scheduling failed:', error);
      throw error;
    }
  }

  async unscheduleTask(taskId) {
    try {
      const task = this.scheduledTasks.get(taskId);
      
      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }
      
      // Stop if running
      if (this.runningTasks.has(taskId)) {
        await this.stopTask(taskId);
      }
      
      // Remove from schedule
      this.scheduledTasks.delete(taskId);
      
      this.logger.info(`Task unscheduled: ${taskId}`);
      
    } catch (error) {
      this.logger.error(`Failed to unschedule task ${taskId}:`, error);
      throw error;
    }
  }

  async executeTask(task) {
    try {
      // Check concurrent task limit
      if (this.runningTasks.size >= this.config.maxConcurrentTasks) {
        this.logger.warn(`Max concurrent tasks reached, skipping: ${task.id}`);
        return;
      }
      
      // Mark as running
      const execution = {
        id: this.generateExecutionId(),
        taskId: task.id,
        startedAt: new Date().toISOString(),
        status: 'running'
      };
      
      this.runningTasks.set(task.id, execution);
      
      this.logger.info(`Executing scheduled task: ${task.id} (${task.name})`);
      
      // Update task last run
      task.lastRun = new Date().toISOString();
      task.runCount = (task.runCount || 0) + 1;
      
      // Execute the task
      await this.performTaskExecution(task, execution);
      
      // Update next run time
      this.updateNextRunTime(task);
      
      // Mark as completed
      execution.status = 'completed';
      execution.completedAt = new Date().toISOString();
      
      this.runningTasks.delete(task.id);
      
      this.logger.info(`Task completed: ${task.id}`);
      
      this.emit('task-completed', { task, execution });
      
    } catch (error) {
      this.logger.error(`Task execution failed: ${task.id}`, error);
      
      // Mark as failed
      if (this.runningTasks.has(task.id)) {
        const execution = this.runningTasks.get(task.id);
        execution.status = 'failed';
        execution.error = error.message;
        execution.completedAt = new Date().toISOString();
        
        this.runningTasks.delete(task.id);
      }
      
      // Update failure count
      task.failureCount = (task.failureCount || 0) + 1;
      
      // Check if task should be disabled due to repeated failures
      if (task.failureCount >= (task.maxFailures || 5)) {
        task.enabled = false;
        this.logger.warn(`Task disabled due to repeated failures: ${task.id}`);
      }
      
      this.emit('task-failed', { task, error });
    }
  }

  async performTaskExecution(task, execution) {
    switch (task.type) {
      case 'workflow':
        await this.executeWorkflowTask(task, execution);
        break;
      case 'agent-call':
        await this.executeAgentCallTask(task, execution);
        break;
      case 'function':
        await this.executeFunctionTask(task, execution);
        break;
      case 'webhook':
        await this.executeWebhookTask(task, execution);
        break;
      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
  }

  async executeWorkflowTask(task, execution) {
    // Trigger workflow execution
    this.emit('workflow-trigger', {
      workflowId: task.config.workflowId,
      parameters: task.config.parameters || {},
      scheduledTask: task,
      execution
    });
  }

  async executeAgentCallTask(task, execution) {
    // Trigger agent call
    this.emit('agent-call', {
      agent: task.config.agent,
      action: task.config.action,
      parameters: task.config.parameters || {},
      scheduledTask: task,
      execution
    });
  }

  async executeFunctionTask(task, execution) {
    // Execute custom function
    const { functionName, parameters } = task.config;
    
    if (typeof this[functionName] === 'function') {
      await this[functionName](parameters, task, execution);
    } else {
      throw new Error(`Function not found: ${functionName}`);
    }
  }

  async executeWebhookTask(task, execution) {
    // Send webhook
    const { url, method = 'POST', headers = {}, body } = task.config;
    
    const fetch = (await import('node-fetch')).default;
    
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(body || { task, execution })
    });
    
    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
    }
  }

  async stopTask(taskId) {
    try {
      const execution = this.runningTasks.get(taskId);
      
      if (!execution) {
        return;
      }
      
      execution.status = 'stopped';
      execution.completedAt = new Date().toISOString();
      
      this.runningTasks.delete(taskId);
      
      this.logger.info(`Task stopped: ${taskId}`);
      
      this.emit('task-stopped', { taskId, execution });
      
    } catch (error) {
      this.logger.error(`Failed to stop task ${taskId}:`, error);
    }
  }

  checkScheduledTasks() {
    if (!this.running) return;
    
    for (const [taskId, task] of this.scheduledTasks) {
      try {
        if (this.shouldRunTask(task)) {
          this.executeTask(task);
        }
      } catch (error) {
        this.logger.error(`Error checking task ${taskId}:`, error);
      }
    }
  }

  shouldRunTask(task) {
    // Check if task is enabled
    if (!task.enabled) return false;
    
    // Check if already running
    if (this.runningTasks.has(task.id)) return false;
    
    // Check if it's time to run
    const now = new Date();
    const nextRun = new Date(task.nextRun);
    
    return now >= nextRun;
  }

  createScheduledTask(taskDefinition, schedule) {
    const task = {
      id: this.generateTaskId(),
      name: taskDefinition.name || 'Unnamed Task',
      type: taskDefinition.type || 'workflow',
      config: taskDefinition.config || {},
      schedule: this.parseSchedule(schedule),
      enabled: taskDefinition.enabled !== false,
      createdAt: new Date().toISOString(),
      runCount: 0,
      failureCount: 0,
      maxFailures: taskDefinition.maxFailures || 5
    };
    
    // Calculate initial next run time
    task.nextRun = this.calculateNextRunTime(task.schedule);
    
    return task;
  }

  parseSchedule(schedule) {
    if (typeof schedule === 'string') {
      return this.parseCronExpression(schedule);
    } else if (typeof schedule === 'object') {
      return this.parseScheduleObject(schedule);
    } else {
      throw new Error('Invalid schedule format');
    }
  }

  parseCronExpression(cronExpr) {
    // Basic cron expression parsing
    // Format: minute hour day month weekday
    const parts = cronExpr.trim().split(/\s+/);
    
    if (parts.length !== 5) {
      throw new Error('Invalid cron expression format');
    }
    
    return {
      type: 'cron',
      expression: cronExpr,
      minute: parts[0],
      hour: parts[1],
      day: parts[2],
      month: parts[3],
      weekday: parts[4]
    };
  }

  parseScheduleObject(scheduleObj) {
    const validTypes = ['interval', 'daily', 'weekly', 'monthly', 'cron'];
    
    if (!scheduleObj.type || !validTypes.includes(scheduleObj.type)) {
      throw new Error('Invalid schedule type');
    }
    
    return scheduleObj;
  }

  calculateNextRunTime(schedule) {
    const now = new Date();
    
    switch (schedule.type) {
      case 'interval':
        return new Date(now.getTime() + schedule.interval);
      
      case 'daily':
        const daily = new Date(now);
        daily.setHours(schedule.hour || 0, schedule.minute || 0, 0, 0);
        if (daily <= now) {
          daily.setDate(daily.getDate() + 1);
        }
        return daily;
      
      case 'weekly':
        const weekly = new Date(now);
        const dayDiff = (schedule.weekday || 0) - weekly.getDay();
        weekly.setDate(weekly.getDate() + (dayDiff <= 0 ? dayDiff + 7 : dayDiff));
        weekly.setHours(schedule.hour || 0, schedule.minute || 0, 0, 0);
        return weekly;
      
      case 'monthly':
        const monthly = new Date(now);
        monthly.setDate(schedule.day || 1);
        monthly.setHours(schedule.hour || 0, schedule.minute || 0, 0, 0);
        if (monthly <= now) {
          monthly.setMonth(monthly.getMonth() + 1);
        }
        return monthly;
      
      case 'cron':
        return this.calculateCronNextRun(schedule, now);
      
      default:
        throw new Error(`Unknown schedule type: ${schedule.type}`);
    }
  }

  calculateCronNextRun(cronSchedule, from) {
    // Simplified cron calculation
    // In production, use a proper cron library
    const next = new Date(from);
    next.setSeconds(0, 0);
    
    // This is a basic implementation - for production use a library like 'node-cron'
    if (cronSchedule.minute !== '*') {
      next.setMinutes(parseInt(cronSchedule.minute));
    }
    
    if (cronSchedule.hour !== '*') {
      next.setHours(parseInt(cronSchedule.hour));
    }
    
    // If calculated time is in the past, move to next occurrence
    if (next <= from) {
      if (cronSchedule.hour === '*') {
        next.setHours(next.getHours() + 1);
      } else {
        next.setDate(next.getDate() + 1);
      }
    }
    
    return next;
  }

  updateNextRunTime(task) {
    if (task.schedule.type === 'interval') {
      // For interval tasks, calculate from last run
      const lastRun = new Date(task.lastRun);
      task.nextRun = new Date(lastRun.getTime() + task.schedule.interval).toISOString();
    } else {
      // For other schedule types, calculate from now
      const nextRun = this.calculateNextRunTime(task.schedule);
      task.nextRun = nextRun.toISOString();
    }
  }

  getScheduledTasks() {
    return Array.from(this.scheduledTasks.values());
  }

  getRunningTasks() {
    return Array.from(this.runningTasks.values());
  }

  getTaskStatus(taskId) {
    const scheduled = this.scheduledTasks.get(taskId);
    const running = this.runningTasks.get(taskId);
    
    if (!scheduled) {
      throw new Error(`Task not found: ${taskId}`);
    }
    
    return {
      ...scheduled,
      isRunning: !!running,
      currentExecution: running
    };
  }

  generateTaskId() {
    return `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  generateExecutionId() {
    return `exec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  getInfo() {
    return {
      running: this.running,
      scheduledTasks: this.scheduledTasks.size,
      runningTasks: this.runningTasks.size,
      config: this.config
    };
  }

  // Predefined task functions

  async performHealthCheck(parameters, task, execution) {
    this.logger.info('Performing system health check');
    
    // Emit health check event
    this.emit('health-check', {
      task,
      execution,
      timestamp: new Date().toISOString()
    });
  }

  async performMaintenance(parameters, task, execution) {
    this.logger.info('Performing system maintenance');
    
    // Emit maintenance event
    this.emit('maintenance', {
      task,
      execution,
      operations: parameters.operations || ['cleanup', 'backup'],
      timestamp: new Date().toISOString()
    });
  }

  async performBackup(parameters, task, execution) {
    this.logger.info('Performing backup operation');
    
    // Emit backup event
    this.emit('backup', {
      task,
      execution,
      targets: parameters.targets || ['knowledge-base'],
      timestamp: new Date().toISOString()
    });
  }
}