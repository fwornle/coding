/**
 * Claude Adapter - Implementation for Claude Code
 *
 * Provides Claude Code-specific implementations of:
 * - BaseAdapter: Core adapter functionality
 * - StatuslineProvider: Status line generation
 * - HooksManager: Hook management via ~/.claude/settings.json
 * - TranscriptAdapter: Transcript parsing from ~/.claude/projects/
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';

import { BaseAdapter } from '../base-adapter.js';
import { StatuslineProvider } from '../statusline-api.js';
import { HooksManager, HookEvent } from '../hooks-api.js';
import { TranscriptAdapter, LSLEntryType } from '../transcript-api.js';
import { createLogger } from '../../logging/Logger.js';

const logger = createLogger('claude-adapter');

// ============================================
// Claude Adapter - Core Implementation
// ============================================

/**
 * Claude Code adapter implementing the BaseAdapter interface
 */
class ClaudeAdapter extends BaseAdapter {
  constructor(config = {}) {
    super(config);

    this.codingPath = config.codingPath ||
      process.env.CODING_TOOLS_PATH ||
      process.env.CODING_REPO ||
      path.join(os.homedir(), 'Agentic', 'coding');

    this.projectPath = config.projectPath ||
      process.env.TRANSCRIPT_SOURCE_PROJECT ||
      process.cwd();

    this.claudeSettingsPath = config.claudeSettingsPath ||
      path.join(os.homedir(), '.claude', 'settings.json');
  }

  getName() {
    return 'claude';
  }

  getDisplayName() {
    return 'Claude Code';
  }

  getCapabilities() {
    return {
      mcp: true,
      hooks: true,
      statusline: true,
      transcripts: true,
      memory: true,
      browser: true
    };
  }

  async initialize(config) {
    if (config) {
      this.config = { ...this.config, ...config };
    }

    this.log('Initializing Claude Code adapter...', 'info');

    // Validate Claude Code is available
    try {
      const { commandExists } = await import('../../utils/system.js');
      const hasClaude = await commandExists('claude');

      if (!hasClaude) {
        throw new Error('Claude Code CLI not found. Please install it first.');
      }
    } catch (error) {
      throw new Error(`Failed to detect Claude Code: ${error.message}`);
    }

    this.initialized = true;
    this.log('Claude Code adapter initialized', 'info');
  }

  async launch(args = []) {
    if (!this.initialized) {
      await this.initialize();
    }

    const mcpLauncher = path.join(this.codingPath, 'bin', 'claude-mcp');

    return new Promise((resolve, reject) => {
      const proc = spawn(mcpLauncher, args, {
        stdio: 'inherit',
        cwd: this.projectPath,
        env: {
          ...process.env,
          CODING_AGENT: 'claude',
          CODING_TOOLS_PATH: this.codingPath,
          TRANSCRIPT_SOURCE_PROJECT: this.projectPath
        }
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Claude Code exited with code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }

  async shutdown() {
    this.log('Shutting down Claude Code adapter', 'info');
    this.initialized = false;
  }

  getStatuslineProvider() {
    if (!this._statuslineProvider) {
      this._statuslineProvider = new ClaudeStatuslineProvider({
        codingPath: this.codingPath,
        projectPath: this.projectPath
      });
    }
    return this._statuslineProvider;
  }

  getHooksManager() {
    if (!this._hooksManager) {
      this._hooksManager = new ClaudeHooksManager({
        settingsPath: this.claudeSettingsPath,
        codingPath: this.codingPath
      });
    }
    return this._hooksManager;
  }

  getTranscriptAdapter() {
    if (!this._transcriptAdapter) {
      this._transcriptAdapter = new ClaudeTranscriptAdapter({
        projectPath: this.projectPath,
        codingPath: this.codingPath
      });
    }
    return this._transcriptAdapter;
  }
}

// ============================================
// Claude Statusline Provider
// ============================================

/**
 * Claude Code status line provider
 * Wraps the existing combined-status-line.js functionality
 */
class ClaudeStatuslineProvider extends StatuslineProvider {
  constructor(config = {}) {
    super(config);
    this.codingPath = config.codingPath;
    this.projectPath = config.projectPath;
  }

  async getStatus() {
    try {
      // Import and use the existing combined status line logic
      // For now, we provide a simplified implementation
      const servicesPath = path.join(this.codingPath, '.services-running.json');
      let services = {};

      try {
        const content = await fs.readFile(servicesPath, 'utf8');
        services = JSON.parse(content);
      } catch {
        // Services file not available
      }

      const indicators = {};

      // Check constraint monitor
      if (services.constraint_monitor?.health === 'healthy') {
        indicators.constraints = {
          icon: '🛡️',
          status: 'healthy',
          label: 'Constraints'
        };
      } else {
        indicators.constraints = {
          icon: '🛡️',
          status: services.constraint_monitor ? 'warning' : 'offline',
          label: 'Constraints'
        };
      }

      // Check semantic analysis
      if (services.semantic_analysis?.health === 'healthy') {
        indicators.semantic = {
          icon: '🧠',
          status: 'healthy',
          label: 'Semantic'
        };
      } else {
        indicators.semantic = {
          icon: '🧠',
          status: 'offline',
          label: 'Semantic'
        };
      }

      // Check VKB server
      if (services.vkb_server?.health === 'healthy') {
        indicators.knowledge = {
          icon: '📚',
          status: 'healthy',
          label: 'Knowledge'
        };
      } else {
        indicators.knowledge = {
          icon: '📚',
          status: 'offline',
          label: 'Knowledge'
        };
      }

      // Determine overall color
      const statuses = Object.values(indicators).map(i => i.status);
      const color = statuses.includes('error') || statuses.every(s => s === 'offline') ? 'red' :
                    statuses.includes('warning') || statuses.includes('offline') ? 'yellow' :
                    'green';

      // Build text representation
      const text = Object.values(indicators)
        .map(i => `[${i.icon}${i.status === 'healthy' ? '✅' : i.status === 'warning' ? '⚠️' : '❌'}]`)
        .join(' ');

      return {
        text,
        color,
        indicators,
        health: { status: color === 'green' ? 'healthy' : color === 'yellow' ? 'degraded' : 'unhealthy' },
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('Failed to get status', { error: error.message });
      return this.getErrorStatus(error);
    }
  }

  async formatForTmux(statusData) {
    const data = statusData || await this.getCachedStatus();
    return data.text;
  }

  async formatForCLI(statusData) {
    const data = statusData || await this.getCachedStatus();

    const lines = ['Claude Code Status'];
    lines.push('─'.repeat(40));

    for (const [name, indicator] of Object.entries(data.indicators)) {
      const statusIcon = indicator.status === 'healthy' ? '✅' :
                         indicator.status === 'warning' ? '⚠️' : '❌';
      lines.push(`${indicator.icon} ${indicator.label}: ${statusIcon} ${indicator.status}`);
    }

    return lines.join('\n');
  }
}

// ============================================
// Claude Hooks Manager
// ============================================

/**
 * Claude Code hooks manager
 * Manages hooks via ~/.claude/settings.json
 */
class ClaudeHooksManager extends HooksManager {
  constructor(config = {}) {
    super(config);
    this.settingsPath = config.settingsPath ||
      path.join(os.homedir(), '.claude', 'settings.json');
    this.codingPath = config.codingPath;
  }

  getAgentType() {
    return 'claude';
  }

  async loadNativeHooks() {
    try {
      const content = await fs.readFile(this.settingsPath, 'utf8');
      const settings = JSON.parse(content);

      if (!settings.hooks) {
        return;
      }

      // Map Claude native hooks to unified events
      for (const [event, handlers] of Object.entries(settings.hooks)) {
        const unifiedEvent = this.mapNativeEventToUnified(event);

        if (!unifiedEvent) {
          continue;
        }

        // Register handlers from native config
        for (const handler of (Array.isArray(handlers) ? handlers : [handlers])) {
          if (handler.command || handler.script) {
            this.registerHook(unifiedEvent, this.createNativeHandler(handler), {
              source: 'native-settings',
              id: `native-${event}-${Date.now()}`
            });
          }
        }
      }

      logger.info(`Loaded native hooks from ${this.settingsPath}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.error('Failed to load native hooks', { error: error.message });
      }
    }
  }

  async saveNativeHooks() {
    try {
      let settings = {};

      try {
        const content = await fs.readFile(this.settingsPath, 'utf8');
        settings = JSON.parse(content);
      } catch {
        // Start with empty settings if file doesn't exist
      }

      // Save registered hooks to settings
      settings.hooks = settings.hooks || {};

      // Note: We only save hooks that were registered through the API
      // Native hooks are preserved as-is

      await fs.writeFile(this.settingsPath, JSON.stringify(settings, null, 2));
      logger.info('Saved hooks to native settings');
    } catch (error) {
      logger.error('Failed to save native hooks', { error: error.message });
    }
  }

  /**
   * Map native Claude event to unified event
   */
  mapNativeEventToUnified(nativeEvent) {
    const mapping = {
      'PreToolUse': HookEvent.PRE_TOOL,
      'PostToolUse': HookEvent.POST_TOOL,
      'Startup': HookEvent.STARTUP,
      'Shutdown': HookEvent.SHUTDOWN
    };
    return mapping[nativeEvent] || null;
  }

  /**
   * Create a handler that executes a native hook command
   */
  createNativeHandler(handlerConfig) {
    return async (context) => {
      const { spawn } = await import('child_process');

      const command = handlerConfig.command || handlerConfig.script;
      const args = handlerConfig.args || [];

      return new Promise((resolve) => {
        const proc = spawn(command, args, {
          cwd: this.codingPath,
          env: {
            ...process.env,
            HOOK_EVENT: context.event,
            HOOK_TOOL_NAME: context.tool?.name || '',
            HOOK_SESSION_ID: context.sessionId
          },
          stdio: ['pipe', 'pipe', 'pipe']
        });

        // Send context as JSON to stdin
        proc.stdin.write(JSON.stringify(context));
        proc.stdin.end();

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => { stdout += data.toString(); });
        proc.stderr.on('data', (data) => { stderr += data.toString(); });

        proc.on('close', (code) => {
          try {
            // Try to parse JSON response
            const result = stdout.trim() ? JSON.parse(stdout) : {};
            resolve({
              allow: result.allow !== false,
              message: result.message || stderr || undefined
            });
          } catch {
            // Non-JSON response
            resolve({
              allow: code === 0,
              message: stderr || undefined
            });
          }
        });

        proc.on('error', (error) => {
          resolve({
            allow: true, // Don't block on hook errors
            message: `Hook error: ${error.message}`
          });
        });
      });
    };
  }
}

// ============================================
// Claude Transcript Adapter
// ============================================

/**
 * Claude Code transcript adapter
 * Reads and parses transcripts from ~/.claude/projects/
 */
class ClaudeTranscriptAdapter extends TranscriptAdapter {
  constructor(config = {}) {
    super(config);
    this.projectPath = config.projectPath || process.cwd();
    this.codingPath = config.codingPath;
  }

  getAgentType() {
    return 'claude';
  }

  getTranscriptDirectory(projectPath) {
    const baseDir = path.join(os.homedir(), '.claude', 'projects');
    const projectDir = projectPath || this.projectPath;

    // Convert project path to Claude's directory name format
    const dirName = `-${projectDir.replace(/[^a-zA-Z0-9]/g, '-')}`;
    return path.join(baseDir, dirName);
  }

  async readTranscripts(options = {}) {
    const transcriptDir = this.getTranscriptDirectory(options.projectPath);

    if (!fsSync.existsSync(transcriptDir)) {
      logger.debug(`Transcript directory not found: ${transcriptDir}`);
      return [];
    }

    const files = fsSync.readdirSync(transcriptDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const filePath = path.join(transcriptDir, f);
        const stats = fsSync.statSync(filePath);
        return { path: filePath, mtime: stats.mtime, name: f };
      })
      .sort((a, b) => b.mtime - a.mtime);

    if (options.limit) {
      files.splice(options.limit);
    }

    const sessions = [];

    for (const file of files) {
      try {
        const session = await this.parseTranscriptFile(file.path);
        if (session) {
          sessions.push(session);
        }
      } catch (error) {
        logger.error(`Failed to parse transcript: ${file.path}`, { error: error.message });
      }
    }

    return sessions;
  }

  async getCurrentSession() {
    const transcriptDir = this.getTranscriptDirectory();

    if (!fsSync.existsSync(transcriptDir)) {
      return null;
    }

    const files = fsSync.readdirSync(transcriptDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const filePath = path.join(transcriptDir, f);
        const stats = fsSync.statSync(filePath);
        return { path: filePath, mtime: stats.mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) {
      return null;
    }

    const mostRecent = files[0];
    const age = Date.now() - mostRecent.mtime.getTime();

    // Only return if session is recent (within 2 hours)
    if (age > 7200000) {
      return null;
    }

    return this.parseTranscriptFile(mostRecent.path);
  }

  async parseTranscriptFile(filePath) {
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(l => l.trim());

    const sessionId = path.basename(filePath, '.jsonl');
    const entries = [];
    let startTime = null;
    let endTime = null;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const lslEntry = this.convertToLSL(entry);

        if (lslEntry) {
          entries.push(lslEntry);

          if (!startTime) {
            startTime = lslEntry.timestamp;
          }
          endTime = lslEntry.timestamp;
        }
      } catch {
        // Skip malformed lines
      }
    }

    return {
      metadata: {
        agent: 'claude',
        sessionId,
        projectPath: this.projectPath,
        startTime: startTime || new Date().toISOString(),
        endTime,
        userHash: process.env.USER || 'unknown'
      },
      entries
    };
  }

  convertToLSL(nativeEntry) {
    if (!nativeEntry || !nativeEntry.type) {
      return null;
    }

    const timestamp = nativeEntry.timestamp || new Date().toISOString();

    switch (nativeEntry.type) {
      case 'user':
        return {
          type: LSLEntryType.USER,
          timestamp,
          content: this.extractContent(nativeEntry.message?.content)
        };

      case 'assistant':
        // Handle assistant messages which may contain tool calls
        const assistantContent = this.extractContent(nativeEntry.message?.content);
        const toolCalls = this.extractToolCalls(nativeEntry.message?.content);

        const entries = [];

        if (assistantContent) {
          entries.push({
            type: LSLEntryType.ASSISTANT,
            timestamp,
            content: assistantContent
          });
        }

        // Add tool use entries
        for (const tool of toolCalls) {
          entries.push({
            type: LSLEntryType.TOOL_USE,
            timestamp,
            content: `Tool: ${tool.name}`,
            tool: {
              name: tool.name,
              input: tool.input
            }
          });
        }

        return entries.length === 1 ? entries[0] : entries;

      case 'tool_result':
        return {
          type: LSLEntryType.TOOL_RESULT,
          timestamp,
          content: 'Tool result',
          tool: {
            name: nativeEntry.tool_use_id || 'unknown',
            output: this.extractContent(nativeEntry.content)
          }
        };

      default:
        return null;
    }
  }

  extractContent(content) {
    if (!content) {
      return '';
    }

    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n');
    }

    return '';
  }

  extractToolCalls(content) {
    if (!content || !Array.isArray(content)) {
      return [];
    }

    return content
      .filter(item => item.type === 'tool_use')
      .map(item => ({
        name: item.name,
        input: item.input,
        id: item.id
      }));
  }
}

// Export all classes
export default ClaudeAdapter;
export {
  ClaudeAdapter,
  ClaudeStatuslineProvider,
  ClaudeHooksManager,
  ClaudeTranscriptAdapter
};
