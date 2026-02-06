/**
 * Copilot Adapter - Implementation for GitHub Copilot CLI
 *
 * Provides GitHub Copilot CLI-specific implementations of:
 * - BaseAdapter: Core adapter functionality
 * - StatuslineProvider: Status line generation
 * - HooksManager: Hook management via .github/hooks/hooks.json
 * - TranscriptAdapter: Transcript parsing from copi session logs
 *
 * Integrates with the copi project for tmux wrapping and session logging.
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
import { CopilotParser } from '../transcripts/copilot-parser.js';
import { createLogger } from '../../logging/Logger.js';

const logger = createLogger('copilot-adapter');

// ============================================
// Copilot Adapter - Core Implementation
// ============================================

/**
 * GitHub Copilot CLI adapter implementing the BaseAdapter interface
 */
class CopilotAdapter extends BaseAdapter {
  constructor(config = {}) {
    super(config);

    this.codingPath = config.codingPath ||
      process.env.CODING_TOOLS_PATH ||
      process.env.CODING_REPO ||
      path.join(os.homedir(), 'Agentic', 'coding');

    this.projectPath = config.projectPath ||
      process.env.TRANSCRIPT_SOURCE_PROJECT ||
      process.cwd();

    // Copi integration path
    this.copiPath = config.copiPath ||
      path.join(this.codingPath, 'integrations', 'copi');

    // Copilot native hooks path
    this.hooksPath = config.hooksPath ||
      path.join(this.projectPath, '.github', 'hooks', 'hooks.json');
  }

  getName() {
    return 'copilot';
  }

  getDisplayName() {
    return 'GitHub Copilot CLI';
  }

  getCapabilities() {
    return {
      mcp: false, // Copilot doesn't support MCP natively
      hooks: true, // Native hooks via .github/hooks/
      statusline: true,
      transcripts: true, // Via copi session logging
      memory: true, // Via fallback services
      browser: true // Via Playwright fallback
    };
  }

  async initialize(config) {
    if (config) {
      this.config = { ...this.config, ...config };
    }

    this.log('Initializing Copilot CLI adapter...', 'info');

    // Validate Copilot CLI is available
    try {
      const { commandExists, executeCommand } = await import('../../utils/system.js');

      const hasGH = await commandExists('gh');
      if (!hasGH) {
        throw new Error('GitHub CLI (gh) not found. Please install it first.');
      }

      // Check for copilot extension
      const extensionList = await executeCommand('gh extension list').catch(() => '');
      const hasCopilot = extensionList.includes('copilot');

      if (!hasCopilot) {
        throw new Error('GitHub Copilot extension not found. Run: gh extension install github/gh-copilot');
      }
    } catch (error) {
      throw new Error(`Failed to detect Copilot CLI: ${error.message}`);
    }

    this.initialized = true;
    this.log('Copilot CLI adapter initialized', 'info');
  }

  async launch(args = []) {
    if (!this.initialized) {
      await this.initialize();
    }

    // Check if copi wrapper is available
    const copiLauncher = path.join(this.copiPath, 'bin', 'copi');
    const useCopi = fsSync.existsSync(copiLauncher);

    return new Promise((resolve, reject) => {
      let proc;

      if (useCopi) {
        // Use copi for tmux integration and session logging
        this.log('Launching via copi tmux wrapper...', 'info');
        proc = spawn(copiLauncher, args, {
          stdio: 'inherit',
          cwd: this.projectPath,
          env: {
            ...process.env,
            CODING_AGENT: 'copilot',
            CODING_TOOLS_PATH: this.codingPath,
            TRANSCRIPT_SOURCE_PROJECT: this.projectPath
          }
        });
      } else {
        // Direct launch
        this.log('Launching gh copilot directly...', 'info');
        proc = spawn('gh', ['copilot', ...args], {
          stdio: 'inherit',
          cwd: this.projectPath,
          env: {
            ...process.env,
            CODING_AGENT: 'copilot',
            CODING_TOOLS_PATH: this.codingPath,
            TRANSCRIPT_SOURCE_PROJECT: this.projectPath
          }
        });
      }

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Copilot CLI exited with code ${code}`));
        }
      });

      proc.on('error', reject);
    });
  }

  async shutdown() {
    this.log('Shutting down Copilot CLI adapter', 'info');
    this.initialized = false;
  }

  getStatuslineProvider() {
    if (!this._statuslineProvider) {
      this._statuslineProvider = new CopilotStatuslineProvider({
        codingPath: this.codingPath,
        projectPath: this.projectPath,
        copiPath: this.copiPath
      });
    }
    return this._statuslineProvider;
  }

  getHooksManager() {
    if (!this._hooksManager) {
      this._hooksManager = new CopilotHooksManager({
        hooksPath: this.hooksPath,
        codingPath: this.codingPath,
        projectPath: this.projectPath
      });
    }
    return this._hooksManager;
  }

  getTranscriptAdapter() {
    if (!this._transcriptAdapter) {
      this._transcriptAdapter = new CopilotTranscriptAdapter({
        projectPath: this.projectPath,
        codingPath: this.codingPath,
        copiPath: this.copiPath
      });
    }
    return this._transcriptAdapter;
  }
}

// ============================================
// Copilot Statusline Provider
// ============================================

/**
 * Copilot CLI status line provider
 */
class CopilotStatuslineProvider extends StatuslineProvider {
  constructor(config = {}) {
    super(config);
    this.codingPath = config.codingPath;
    this.projectPath = config.projectPath;
    this.copiPath = config.copiPath;
  }

  async getStatus() {
    try {
      const indicators = {};

      // Check if Copilot CLI is available
      try {
        const { executeCommand } = await import('../../utils/system.js');
        const result = await executeCommand('gh copilot --version').catch(() => null);

        indicators.copilot = {
          icon: '🤖',
          status: result ? 'healthy' : 'offline',
          label: 'Copilot'
        };
      } catch {
        indicators.copilot = {
          icon: '🤖',
          status: 'offline',
          label: 'Copilot'
        };
      }

      // Check copi session status
      const copiLogDir = path.join(this.copiPath, 'logs');
      if (fsSync.existsSync(copiLogDir)) {
        const logs = fsSync.readdirSync(copiLogDir)
          .filter(f => f.endsWith('.jsonl'))
          .map(f => {
            const filePath = path.join(copiLogDir, f);
            const stats = fsSync.statSync(filePath);
            return { path: filePath, mtime: stats.mtime };
          })
          .sort((a, b) => b.mtime - a.mtime);

        if (logs.length > 0) {
          const age = Date.now() - logs[0].mtime.getTime();
          indicators.session = {
            icon: '📝',
            status: age < 3600000 ? 'healthy' : 'warning',
            label: 'Session'
          };
        } else {
          indicators.session = {
            icon: '📝',
            status: 'offline',
            label: 'Session'
          };
        }
      }

      // Check fallback services (from coding infrastructure)
      const servicesPath = path.join(this.codingPath, '.services-running.json');
      if (fsSync.existsSync(servicesPath)) {
        try {
          const services = JSON.parse(fsSync.readFileSync(servicesPath, 'utf8'));

          indicators.memory = {
            icon: '🧠',
            status: services.vkb_server?.health === 'healthy' ? 'healthy' : 'offline',
            label: 'Memory'
          };

          indicators.browser = {
            icon: '🌐',
            status: services.browser_service?.health === 'healthy' ? 'healthy' : 'offline',
            label: 'Browser'
          };
        } catch {
          // Ignore service status errors
        }
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

    const lines = ['GitHub Copilot CLI Status'];
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
// Copilot Hooks Manager
// ============================================

/**
 * Copilot CLI hooks manager
 * Manages hooks via .github/hooks/hooks.json (native Copilot format)
 */
class CopilotHooksManager extends HooksManager {
  constructor(config = {}) {
    super(config);
    this.hooksPath = config.hooksPath ||
      path.join(config.projectPath || process.cwd(), '.github', 'hooks', 'hooks.json');
    this.codingPath = config.codingPath;
    this.projectPath = config.projectPath;
  }

  getAgentType() {
    return 'copilot';
  }

  async loadNativeHooks() {
    try {
      if (!fsSync.existsSync(this.hooksPath)) {
        return;
      }

      const content = await fs.readFile(this.hooksPath, 'utf8');
      const hooksConfig = JSON.parse(content);

      // Map Copilot native hooks to unified events
      for (const [nativeEvent, handler] of Object.entries(hooksConfig)) {
        // Skip metadata fields
        if (nativeEvent.startsWith('_')) {
          continue;
        }

        const unifiedEvent = this.mapNativeEventToUnified(nativeEvent);

        if (!unifiedEvent) {
          continue;
        }

        if (handler.command) {
          this.registerHook(unifiedEvent, this.createNativeHandler(handler), {
            source: 'native-copilot',
            id: `copilot-native-${nativeEvent}-${Date.now()}`
          });
        }
      }

      logger.info(`Loaded native hooks from ${this.hooksPath}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.error('Failed to load native hooks', { error: error.message });
      }
    }
  }

  async saveNativeHooks() {
    try {
      let hooksConfig = {};

      try {
        if (fsSync.existsSync(this.hooksPath)) {
          const content = await fs.readFile(this.hooksPath, 'utf8');
          hooksConfig = JSON.parse(content);
        }
      } catch {
        // Start with empty config
      }

      // Ensure directory exists
      const dir = path.dirname(this.hooksPath);
      if (!fsSync.existsSync(dir)) {
        await fs.mkdir(dir, { recursive: true });
      }

      await fs.writeFile(this.hooksPath, JSON.stringify(hooksConfig, null, 2));
      logger.info('Saved hooks to native config');
    } catch (error) {
      logger.error('Failed to save native hooks', { error: error.message });
    }
  }

  /**
   * Map native Copilot event to unified event
   */
  mapNativeEventToUnified(nativeEvent) {
    const mapping = {
      'sessionStart': HookEvent.STARTUP,
      'sessionEnd': HookEvent.SHUTDOWN,
      'preToolUse': HookEvent.PRE_TOOL,
      'postToolUse': HookEvent.POST_TOOL,
      'userPromptSubmitted': HookEvent.PRE_PROMPT,
      'errorOccurred': HookEvent.ERROR
    };
    return mapping[nativeEvent] || null;
  }

  /**
   * Create a handler that executes a native hook command
   */
  createNativeHandler(handlerConfig) {
    return async (context) => {
      const { spawn } = await import('child_process');

      const command = handlerConfig.command;
      const args = handlerConfig.args || [];

      return new Promise((resolve) => {
        const proc = spawn(command, args, {
          cwd: this.projectPath || process.cwd(),
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
            // Copilot expects: { continue: true/false, message?: string }
            const result = stdout.trim() ? JSON.parse(stdout) : {};
            resolve({
              allow: result.continue !== false,
              message: result.message || stderr || undefined
            });
          } catch {
            resolve({
              allow: code === 0,
              message: stderr || undefined
            });
          }
        });

        proc.on('error', (error) => {
          resolve({
            allow: true,
            message: `Hook error: ${error.message}`
          });
        });
      });
    };
  }

  /**
   * Install the unified bridge as a Copilot native hook
   * This creates .github/hooks/hooks.json with bridge configuration
   */
  async installBridge() {
    const bridgePath = path.join(this.codingPath, 'lib', 'agent-api', 'hooks', 'copilot-bridge.sh');

    const hooksConfig = {
      "_comment": "Copilot CLI hooks configuration - bridges to unified hook system",
      "sessionStart": {
        "command": bridgePath,
        "args": ["sessionStart"]
      },
      "sessionEnd": {
        "command": bridgePath,
        "args": ["sessionEnd"]
      },
      "preToolUse": {
        "command": bridgePath,
        "args": ["preToolUse"]
      },
      "postToolUse": {
        "command": bridgePath,
        "args": ["postToolUse"]
      },
      "userPromptSubmitted": {
        "command": bridgePath,
        "args": ["userPromptSubmitted"]
      },
      "errorOccurred": {
        "command": bridgePath,
        "args": ["errorOccurred"]
      }
    };

    // Ensure directory exists
    const dir = path.dirname(this.hooksPath);
    if (!fsSync.existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }

    await fs.writeFile(this.hooksPath, JSON.stringify(hooksConfig, null, 2));
    logger.info(`Installed unified bridge at ${this.hooksPath}`);
  }
}

// ============================================
// Copilot Transcript Adapter
// ============================================

/**
 * Copilot CLI transcript adapter
 * Reads and parses session logs from copi
 */
class CopilotTranscriptAdapter extends TranscriptAdapter {
  constructor(config = {}) {
    super(config);
    this.projectPath = config.projectPath || process.cwd();
    this.codingPath = config.codingPath;
    this.copiPath = config.copiPath ||
      path.join(this.codingPath, 'integrations', 'copi');

    this.parser = new CopilotParser({
      projectPath: this.projectPath,
      codingPath: this.codingPath,
      logDir: path.join(this.copiPath, 'logs')
    });
  }

  getAgentType() {
    return 'copilot';
  }

  getTranscriptDirectory(projectPath) {
    return this.parser.getLogDirectory();
  }

  async readTranscripts(options = {}) {
    return this.parser.parseMultiple(options);
  }

  async getCurrentSession() {
    const currentLogPath = await this.parser.findCurrentLog();

    if (!currentLogPath) {
      return null;
    }

    return this.parser.parseFile(currentLogPath);
  }

  convertToLSL(nativeEntry) {
    return this.parser.converter.fromCopiEntry(nativeEntry);
  }
}

// Export all classes
export default CopilotAdapter;
export {
  CopilotAdapter,
  CopilotStatuslineProvider,
  CopilotHooksManager,
  CopilotTranscriptAdapter
};
