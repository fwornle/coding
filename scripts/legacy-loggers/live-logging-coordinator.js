#!/usr/bin/env node

/**
 * Live Logging Coordinator
 * Integrates with constraint monitor statusLine hooks to capture real-time tool interactions
 * Bridges the constraint monitor system with the enhanced session logging
 */

import HybridSessionLogger from './hybrid-session-logger.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

class LiveLoggingCoordinator {
  constructor() {
    this.logger = null;
    this.isActive = false;
    this.sessionId = this.generateSessionId();
    this.toolCallBuffer = [];
    this.maxBufferSize = 100;
    
    // Integration with constraint monitor
    this.constraintMonitorIntegrated = false;
    this.statusFilePath = join(process.cwd(), '.services-running.json');
    
    this.initialize();
  }

  async initialize() {
    try {
      // Create hybrid session logger
      this.logger = await HybridSessionLogger.createFromCurrentContext();
      
      // Check for constraint monitor integration
      this.checkConstraintMonitorIntegration();
      
      // Set up monitoring hooks
      await this.setupMonitoringHooks();
      
      this.isActive = true;
      console.log(`🚀 Live logging coordinator initialized (Session: ${this.sessionId})`);
    } catch (error) {
      console.error('Failed to initialize live logging coordinator:', error);
    }
  }

  generateSessionId() {
    return `live-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  }

  checkConstraintMonitorIntegration() {
    if (existsSync(this.statusFilePath)) {
      try {
        const services = JSON.parse(readFileSync(this.statusFilePath, 'utf8'));
        this.constraintMonitorIntegrated = services.constraint_monitor && 
          services.constraint_monitor.status === '✅ FULLY OPERATIONAL';
      } catch (error) {
        console.debug('Could not read services status:', error.message);
      }
    }
  }

  async setupMonitoringHooks() {
    // Create monitoring hook that can be called by statusLine or other systems
    await this.createHookInterface();
    
    // Set up periodic buffer processing
    setInterval(() => {
      this.processBufferedInteractions();
    }, 5000); // Process every 5 seconds
  }

  async createHookInterface() {
    // Create a simple file-based interface for tool interaction capture
    const hookPath = join(process.cwd(), '.mcp-sync/tool-interaction-hook.js');
    
    const hookContent = `
// Tool Interaction Hook for Live Logging
// This file is called by the constraint monitor or statusLine to capture tool interactions

const { existsSync, appendFileSync } = require('fs');
const path = require('path');

function captureToolInteraction(toolCall, result, context = {}) {
  const interaction = {
    timestamp: new Date().toISOString(),
    sessionId: '${this.sessionId}',
    toolCall: toolCall,
    result: result,
    context: context
  };
  
  const bufferPath = path.join(process.cwd(), '.mcp-sync/tool-interaction-buffer.jsonl');
  
  try {
    appendFileSync(bufferPath, JSON.stringify(interaction) + '\\n');
  } catch (error) {
    console.error('Hook capture error:', error);
  }
}

module.exports = { captureToolInteraction };
`;
    
    const hookDir = join(process.cwd(), '.mcp-sync');
    if (!existsSync(hookDir)) {
      require('fs').mkdirSync(hookDir, { recursive: true });
    }
    
    writeFileSync(hookPath, hookContent);
  }

  async processBufferedInteractions() {
    const bufferPath = join(process.cwd(), '.mcp-sync/tool-interaction-buffer.jsonl');
    
    if (!existsSync(bufferPath)) {
      return;
    }
    
    try {
      const bufferContent = readFileSync(bufferPath, 'utf8').trim();
      if (!bufferContent) {
        return;
      }
      
      const interactions = bufferContent.split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
      
      // Process each interaction
      for (const interaction of interactions) {
        await this.processToolInteraction(interaction);
      }
      
      // Clear the buffer
      writeFileSync(bufferPath, '');
      
    } catch (error) {
      console.error('Buffer processing error:', error);
    }
  }

  async processToolInteraction(interaction) {
    try {
      if (!this.logger || !this.isActive) {
        return;
      }
      
      // Add to our buffer for analysis
      this.toolCallBuffer.push(interaction);
      
      // Keep buffer size manageable
      if (this.toolCallBuffer.length > this.maxBufferSize) {
        this.toolCallBuffer.shift();
      }
      
      // Process with hybrid session logger
      const exchange = await this.logger.onToolInteraction(
        interaction.toolCall,
        interaction.result,
        {
          ...interaction.context,
          sessionId: this.sessionId,
          workingDirectory: process.cwd()
        }
      );
      
      // Notify if high-value exchange detected
      if (exchange && exchange.classification && exchange.classification.confidence > 0.8) {
        console.log(`📝 High-value exchange logged: ${exchange.summary.summary}`);
      }
      
    } catch (error) {
      console.error('Tool interaction processing error:', error);
    }
  }

  // Manual tool interaction capture (for testing)
  async captureManualInteraction(toolName, params, result, context = {}) {
    const toolCall = { name: toolName, params };
    
    return await this.processToolInteraction({
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      toolCall: toolCall,
      result: result,
      context: {
        ...context,
        manual: true,
        workingDirectory: process.cwd()
      }
    });
  }

  // Session finalization
  async finalizeSession() {
    if (!this.logger) {
      return null;
    }
    
    console.log(`📋 Finalizing live logging session: ${this.sessionId}`);
    
    // Process any remaining buffered interactions
    await this.processBufferedInteractions();
    
    // Finalize the hybrid session logger
    const summary = await this.logger.finalizeSession();
    
    console.log(`✅ Session finalized: ${summary.exchangeCount} exchanges logged`);
    console.log(`   - Coding-related: ${summary.classification.coding}`);
    console.log(`   - Project-specific: ${summary.classification.project}`);
    console.log(`   - Hybrid: ${summary.classification.hybrid}`);
    
    this.isActive = false;
    
    return summary;
  }

  // Statistics and monitoring
  getSessionStats() {
    return {
      sessionId: this.sessionId,
      isActive: this.isActive,
      bufferSize: this.toolCallBuffer.length,
      constraintMonitorIntegrated: this.constraintMonitorIntegrated,
      recentInteractions: this.toolCallBuffer.slice(-5).map(i => ({
        tool: i.toolCall.name,
        timestamp: i.timestamp
      }))
    };
  }

  // Cleanup
  async cleanup() {
    await this.finalizeSession();
    
    // Clean up hook files
    const hookFiles = [
      '.mcp-sync/tool-interaction-hook.js',
      '.mcp-sync/tool-interaction-buffer.jsonl'
    ].map(f => join(process.cwd(), f));
    
    hookFiles.forEach(file => {
      if (existsSync(file)) {
        try {
          require('fs').unlinkSync(file);
        } catch (error) {
          console.warn(`Could not clean up ${file}:`, error.message);
        }
      }
    });
  }
}

// Create and initialize if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const coordinator = new LiveLoggingCoordinator();
  
  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    await coordinator.cleanup();
    process.exit(0);
  });
  
  process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down gracefully...');
    await coordinator.cleanup();
    process.exit(0);
  });
  
  // Keep alive
  setInterval(() => {
    const stats = coordinator.getSessionStats();
    if (stats.bufferSize > 0) {
      console.log(`📊 Session stats: ${stats.bufferSize} buffered interactions`);
    }
  }, 30000); // Every 30 seconds
}

// Global coordinator instance
let globalCoordinator = null;

export function getGlobalCoordinator() {
  if (!globalCoordinator) {
    globalCoordinator = new LiveLoggingCoordinator();
  }
  return globalCoordinator;
}

export default LiveLoggingCoordinator;