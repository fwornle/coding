/**
 * Agent Communication Logger
 * Logs all inter-agent messages for visualization and analysis
 */

import { promises as fs } from 'fs';
import path from 'path';
import { Logger } from '../../shared/logger.js';

export class AgentCommunicationLogger {
  constructor(config = {}) {
    this.config = {
      logPath: config.logPath || './logs/agent-communication.jsonl',
      enableConsoleLog: config.enableConsoleLog || false,
      ...config
    };
    
    this.logger = new Logger('agent-comm-logger');
    this.messageCount = 0;
  }

  async initialize() {
    // Ensure log directory exists
    const logDir = path.dirname(this.config.logPath);
    await fs.mkdir(logDir, { recursive: true });
    
    // Write header
    const header = {
      type: 'session_start',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    };
    
    await this.writeLog(header);
    this.logger.info(`Agent communication logger initialized at ${this.config.logPath}`);
  }

  async logMessage(fromAgent, toAgent, topic, message, metadata = {}) {
    const logEntry = {
      type: 'message',
      id: ++this.messageCount,
      timestamp: new Date().toISOString(),
      from: fromAgent,
      to: toAgent,
      topic: topic,
      message: message,
      metadata: {
        messageType: this.detectMessageType(topic, message),
        ...metadata
      }
    };

    await this.writeLog(logEntry);
    
    if (this.config.enableConsoleLog) {
      this.logger.debug(`[${fromAgent} → ${toAgent}] ${topic}:`, message);
    }
    
    return logEntry;
  }

  async logEvent(agent, event, details = {}) {
    const logEntry = {
      type: 'event',
      id: ++this.messageCount,
      timestamp: new Date().toISOString(),
      agent: agent,
      event: event,
      details: details
    };

    await this.writeLog(logEntry);
    return logEntry;
  }

  async logWorkflow(workflowId, stage, agents, details = {}) {
    const logEntry = {
      type: 'workflow',
      id: ++this.messageCount,
      timestamp: new Date().toISOString(),
      workflowId: workflowId,
      stage: stage,
      agents: agents,
      details: details
    };

    await this.writeLog(logEntry);
    return logEntry;
  }

  detectMessageType(topic, message) {
    // Detect common message patterns
    if (topic.includes('analyze')) return 'analysis_request';
    if (topic.includes('result')) return 'analysis_result';
    if (topic.includes('error')) return 'error';
    if (topic.includes('status')) return 'status_update';
    if (topic.includes('sync')) return 'synchronization';
    if (topic.includes('dedupe')) return 'deduplication';
    if (topic.includes('doc')) return 'documentation';
    if (topic.includes('search')) return 'search';
    if (topic.includes('knowledge')) return 'knowledge_update';
    return 'general';
  }

  async writeLog(entry) {
    try {
      const line = JSON.stringify(entry) + '\n';
      await fs.appendFile(this.config.logPath, line, 'utf8');
    } catch (error) {
      this.logger.error('Failed to write communication log:', error);
    }
  }

  async generateFlowVisualization() {
    // Read all logs
    const content = await fs.readFile(this.config.logPath, 'utf8');
    const entries = content.split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
    
    // Generate PlantUML sequence diagram
    let puml = '@startuml agent_communication_flow\n';
    puml += '!theme plain\n';
    puml += 'skinparam backgroundColor #FEFEFE\n\n';
    
    // Add participants
    const agents = new Set();
    entries.forEach(entry => {
      if (entry.type === 'message') {
        agents.add(entry.from);
        agents.add(entry.to);
      }
    });
    
    agents.forEach(agent => {
      puml += `participant "${agent}" as ${agent.replace('-', '_')}\n`;
    });
    
    puml += '\n';
    
    // Add messages
    entries.forEach(entry => {
      if (entry.type === 'message') {
        const from = entry.from.replace('-', '_');
        const to = entry.to.replace('-', '_');
        const label = `${entry.topic}\\n[${entry.metadata.messageType}]`;
        puml += `${from} -> ${to}: ${label}\n`;
      }
    });
    
    puml += '\n@enduml';
    
    // Save PlantUML file
    const pumlPath = this.config.logPath.replace('.jsonl', '.puml');
    await fs.writeFile(pumlPath, puml, 'utf8');
    
    this.logger.info(`Generated flow visualization at ${pumlPath}`);
    return pumlPath;
  }
}

// Singleton instance
export const agentCommLogger = new AgentCommunicationLogger({
  enableConsoleLog: process.env.LOG_AGENT_COMMUNICATION === 'true'
});