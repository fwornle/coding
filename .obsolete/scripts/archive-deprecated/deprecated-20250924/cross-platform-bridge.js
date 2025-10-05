#!/usr/bin/env node
/**
 * Cross-Platform Integration Bridge
 * 
 * Provides unified insight extraction interface for:
 * - Claude Code (via MCP integration)
 * - GitHub Copilot (via VS Code extension)
 * - Manual triggering (via CLI)
 * - Scheduled analysis (via cron/systemd)
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AutoInsightTrigger } from './auto-insight-trigger.js';
import { InsightOrchestrator } from './insight-orchestrator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CODING_ROOT = path.join(__dirname, '..');
const BRIDGE_CONFIG_FILE = path.join(CODING_ROOT, 'tmp', 'bridge-config.json');

class CrossPlatformBridge {
  constructor(options = {}) {
    this.config = {
      claudeCodeEnabled: true,
      copilotEnabled: true,
      mcpIntegration: true,
      autoTrigger: true,
      ...options
    };
    
    this.logger = this.createLogger();
  }
  
  createLogger() {
    return {
      info: (msg) => console.log(`[${new Date().toISOString()}] BRIDGE INFO: ${msg}`),
      warn: (msg) => console.log(`[${new Date().toISOString()}] BRIDGE WARN: ${msg}`),
      error: (msg) => console.error(`[${new Date().toISOString()}] BRIDGE ERROR: ${msg}`),
      debug: (msg) => {
        if (process.env.DEBUG) {
          console.log(`[${new Date().toISOString()}] BRIDGE DEBUG: ${msg}`);
        }
      }
    };
  }
  
  /**
   * Universal insight extraction interface
   */
  async extractInsights(request) {
    this.logger.info(`Processing insight extraction request from: ${request.source}`);
    
    try {
      // Validate request
      const validatedRequest = await this.validateRequest(request);
      
      // Route to appropriate handler based on source
      let result;
      switch (validatedRequest.source) {
        case 'claude-code':
          result = await this.handleClaudeCodeRequest(validatedRequest);
          break;
        case 'copilot':
          result = await this.handleCopilotRequest(validatedRequest);
          break;
        case 'manual':
          result = await this.handleManualRequest(validatedRequest);
          break;
        case 'scheduled':
          result = await this.handleScheduledRequest(validatedRequest);
          break;
        default:
          throw new Error(`Unknown source: ${validatedRequest.source}`);
      }
      
      // Log successful completion
      this.logger.info(`Insight extraction completed for: ${request.source}`);
      return result;
      
    } catch (error) {
      this.logger.error(`Insight extraction failed: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Validate incoming request
   */
  async validateRequest(request) {
    const requiredFields = ['source'];
    const validSources = ['claude-code', 'copilot', 'manual', 'scheduled'];
    
    // Check required fields
    for (const field of requiredFields) {
      if (!request[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    // Validate source
    if (!validSources.includes(request.source)) {
      throw new Error(`Invalid source: ${request.source}. Must be one of: ${validSources.join(', ')}`);
    }
    
    // Set defaults
    return {
      source: request.source,
      sessionId: request.sessionId || `${request.source}-${Date.now()}`,
      projectPath: request.projectPath || process.cwd(),
      significance: request.significance || 7,
      autoTrigger: request.autoTrigger !== false,
      webSearch: request.webSearch !== false,
      generateDiagrams: request.generateDiagrams !== false,
      ...request
    };
  }
  
  /**
   * Handle Claude Code requests
   */
  async handleClaudeCodeRequest(request) {
    this.logger.debug('Processing Claude Code request');
    
    if (!this.config.claudeCodeEnabled) {
      throw new Error('Claude Code integration is disabled');
    }
    
    // Claude Code requests typically come through MCP tools
    if (request.mcpTool) {
      return await this.handleMCPToolRequest(request);
    }
    
    // Standard Claude Code session completion
    const trigger = new AutoInsightTrigger({
      significanceThreshold: request.significance
    });
    
    return await trigger.checkAndTrigger();
  }
  
  /**
   * Handle MCP tool requests
   */
  async handleMCPToolRequest(request) {
    this.logger.debug(`Processing MCP tool request: ${request.mcpTool}`);
    
    switch (request.mcpTool) {
      case 'extract_session_insights':
        return await this.extractSessionInsights(request);
      case 'analyze_repository':
        return await this.analyzeRepository(request);
      case 'trigger_analysis':
        return await this.triggerAnalysis(request);
      default:
        throw new Error(`Unknown MCP tool: ${request.mcpTool}`);
    }
  }
  
  /**
   * Extract insights from session data
   */
  async extractSessionInsights(request) {
    const orchestrator = new InsightOrchestrator({
      significanceThreshold: request.significance,
      webSearchEnabled: request.webSearch,
      maxSessionsToAnalyze: 1
    });
    
    // If session content is provided directly
    if (request.sessionContent) {
      // Process the provided session content
      return await this.processSessionContent(request.sessionContent, request);
    }
    
    // Otherwise, use standard session monitoring
    await orchestrator.start();
    return { message: 'Session insights extracted successfully' };
  }
  
  /**
   * Process session content directly
   */
  async processSessionContent(content, request) {
    // Create a temporary session file for processing
    const tempDir = path.join(CODING_ROOT, 'tmp');
    await fs.mkdir(tempDir, { recursive: true });
    
    const tempFile = path.join(tempDir, `temp-session-${request.sessionId}.md`);
    await fs.writeFile(tempFile, content);
    
    try {
      const orchestrator = new InsightOrchestrator({
        significanceThreshold: request.significance,
        webSearchEnabled: request.webSearch
      });
      
      // Analyze the temporary session file
      await orchestrator.analyzeSession({
        path: tempFile,
        name: `temp-session-${request.sessionId}.md`,
        timestamp: Date.now()
      });
      
      return { message: 'Session content processed successfully' };
    } finally {
      // Clean up temporary file
      try {
        await fs.unlink(tempFile);
      } catch (cleanupError) {
        this.logger.debug(`Cleanup warning: ${cleanupError.message}`);
      }
    }
  }
  
  /**
   * Analyze repository changes
   */
  async analyzeRepository(request) {
    const orchestrator = new InsightOrchestrator({
      significanceThreshold: request.significance
    });
    
    // Get repository analysis
    const repoAnalysis = await orchestrator.analyzeRepositoryChanges(Date.now());
    
    if (repoAnalysis.commits.length > 0 || repoAnalysis.insights.length > 0) {
      // Create insight from repository analysis
      const insight = {
        title: 'Repository Analysis Insight',
        significance: Math.max(request.significance, 6),
        problem: 'Repository changes detected',
        solution: 'Analyzed code changes and extracted patterns',
        implementation: `Commits: ${repoAnalysis.commits.length}, Files: ${repoAnalysis.filesChanged.length}`,
        benefits: 'Understanding of code evolution and patterns',
        technologies: this.extractTechnologiesFromFiles(repoAnalysis.filesChanged),
        patterns: repoAnalysis.patterns || [],
        applicability: 'Similar codebase changes',
        references: repoAnalysis.commits.map(c => `Commit: ${c.hash}`),
        relatedFiles: repoAnalysis.filesChanged
      };
      
      await orchestrator.createKnowledgeEntry(insight);
    }
    
    return { message: 'Repository analysis completed', analysis: repoAnalysis };
  }
  
  /**
   * Extract technologies from file extensions
   */
  extractTechnologiesFromFiles(files) {
    const technologies = new Set();
    
    files.forEach(file => {
      const ext = path.extname(file).toLowerCase();
      switch (ext) {
        case '.js':
        case '.jsx':
          technologies.add('JavaScript');
          break;
        case '.ts':
        case '.tsx':
          technologies.add('TypeScript');
          break;
        case '.py':
          technologies.add('Python');
          break;
        case '.json':
          if (file.includes('package.json')) technologies.add('Node.js');
          break;
        case '.md':
          technologies.add('Documentation');
          break;
      }
    });
    
    return Array.from(technologies);
  }
  
  /**
   * Trigger manual analysis
   */
  async triggerAnalysis(request) {
    const trigger = new AutoInsightTrigger({
      significanceThreshold: request.significance
    });
    
    return await trigger.forceTrigger(request);
  }
  
  /**
   * Handle GitHub Copilot requests
   */
  async handleCopilotRequest(request) {
    this.logger.debug('Processing GitHub Copilot request');
    
    if (!this.config.copilotEnabled) {
      throw new Error('GitHub Copilot integration is disabled');
    }
    
    // Copilot requests might come through VS Code extension bridge
    if (request.vscodeExtension) {
      return await this.handleVSCodeExtensionRequest(request);
    }
    
    // Standard Copilot session analysis
    return await this.extractSessionInsights(request);
  }
  
  /**
   * Handle VS Code extension requests
   */
  async handleVSCodeExtensionRequest(request) {
    this.logger.debug('Processing VS Code extension request');
    
    // VS Code extension provides structured data
    const sessionData = {
      workspace: request.workspace,
      files: request.changedFiles || [],
      chatHistory: request.chatHistory || '',
      activeFile: request.activeFile,
      selection: request.selection
    };
    
    // Create session content from VS Code data
    const sessionContent = this.formatVSCodeSessionContent(sessionData);
    
    return await this.processSessionContent(sessionContent, request);
  }
  
  /**
   * Format VS Code session data into markdown
   */
  formatVSCodeSessionContent(sessionData) {
    const content = [`# VS Code Session Analysis
    
**Workspace:** ${sessionData.workspace}
**Active File:** ${sessionData.activeFile || 'None'}
**Files Changed:** ${sessionData.files.length}

## Chat History

${sessionData.chatHistory || 'No chat history available'}

## Files Modified

${sessionData.files.length > 0 
  ? sessionData.files.map(file => `- ${file}`).join('\\n')
  : 'No files modified'
}

${sessionData.selection ? `
## Code Selection

\`\`\`
${sessionData.selection}
\`\`\`
` : ''}
`];
    
    return content.join('\\n');
  }
  
  /**
   * Handle manual requests
   */
  async handleManualRequest(request) {
    this.logger.debug('Processing manual request');
    
    if (request.action === 'analyze') {
      const trigger = new AutoInsightTrigger();
      return await trigger.forceTrigger(request);
    }
    
    if (request.action === 'status') {
      const trigger = new AutoInsightTrigger();
      return await trigger.getStatus();
    }
    
    throw new Error(`Unknown manual action: ${request.action}`);
  }
  
  /**
   * Handle scheduled requests
   */
  async handleScheduledRequest(request) {
    this.logger.debug('Processing scheduled request');
    
    const trigger = new AutoInsightTrigger({
      significanceThreshold: request.significance || 6, // Lower threshold for scheduled runs
      cooldownMinutes: 0 // No cooldown for scheduled runs
    });
    
    return await trigger.checkAndTrigger();
  }
  
  /**
   * Get bridge status
   */
  async getStatus() {
    const trigger = new AutoInsightTrigger();
    const triggerStatus = await trigger.getStatus();
    
    return {
      bridge: {
        claudeCodeEnabled: this.config.claudeCodeEnabled,
        copilotEnabled: this.config.copilotEnabled,
        mcpIntegration: this.config.mcpIntegration,
        autoTrigger: this.config.autoTrigger
      },
      trigger: triggerStatus,
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * Save bridge configuration
   */
  async saveConfig() {
    try {
      await fs.mkdir(path.dirname(BRIDGE_CONFIG_FILE), { recursive: true });
      await fs.writeFile(BRIDGE_CONFIG_FILE, JSON.stringify(this.config, null, 2));
    } catch (error) {
      this.logger.warn(`Failed to save bridge config: ${error.message}`);
    }
  }
  
  /**
   * Load bridge configuration
   */
  async loadConfig() {
    try {
      const configData = await fs.readFile(BRIDGE_CONFIG_FILE, 'utf8');
      this.config = { ...this.config, ...JSON.parse(configData) };
    } catch (error) {
      this.logger.debug('No existing bridge config found, using defaults');
    }
  }
}

// MCP Tool Integration Functions
const MCPTools = {
  /**
   * Extract insights from current session
   */
  async extractSessionInsights(params) {
    const bridge = new CrossPlatformBridge();
    
    return await bridge.extractInsights({
      source: 'claude-code',
      mcpTool: 'extract_session_insights',
      sessionContent: params.content,
      significance: params.significanceThreshold || 7,
      webSearch: params.webSearchEnabled !== false
    });
  },
  
  /**
   * Analyze repository changes
   */
  async analyzeRepository(params) {
    const bridge = new CrossPlatformBridge();
    
    return await bridge.extractInsights({
      source: 'claude-code',
      mcpTool: 'analyze_repository',
      significance: params.significanceThreshold || 7,
      projectPath: params.repository
    });
  },
  
  /**
   * Trigger analysis manually
   */
  async triggerAnalysis(params) {
    const bridge = new CrossPlatformBridge();
    
    return await bridge.extractInsights({
      source: 'claude-code',
      mcpTool: 'trigger_analysis',
      significance: params.significanceThreshold || 7,
      webSearch: params.webSearchEnabled !== false
    });
  }
};

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  const bridge = new CrossPlatformBridge();
  
  switch (command) {
    case 'extract':
      const content = process.argv[3];
      if (!content) {
        console.error('Usage: cross-platform-bridge.js extract <content>');
        process.exit(1);
      }
      
      bridge.extractInsights({
        source: 'manual',
        action: 'analyze',
        sessionContent: content
      }).then(result => {
        console.log('Extraction result:', result);
      }).catch(error => {
        console.error('Extraction failed:', error);
        process.exit(1);
      });
      break;
      
    case 'status':
      bridge.getStatus().then(status => {
        console.log('Bridge status:', JSON.stringify(status, null, 2));
      }).catch(error => {
        console.error('Status check failed:', error);
        process.exit(1);
      });
      break;
      
    case 'test':
      // Test all integration points
      const testRequests = [
        { source: 'claude-code', mcpTool: 'trigger_analysis' },
        { source: 'manual', action: 'status' },
        { source: 'scheduled' }
      ];
      
      Promise.all(testRequests.map(req => 
        bridge.extractInsights(req).catch(err => ({ error: err.message }))
      )).then(results => {
        console.log('Test results:', results);
      });
      break;
      
    default:
      console.log(`
Cross-Platform Integration Bridge

Usage: cross-platform-bridge.js [command] [args]

Commands:
  extract <content>  - Extract insights from content
  status            - Show bridge status  
  test              - Test all integration points

Environment Variables:
  DEBUG=true        - Enable debug logging
`);
      process.exit(0);
  }
}

export { CrossPlatformBridge, MCPTools };