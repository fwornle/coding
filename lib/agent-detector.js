import {
  commandExists,
  executeCommand,
  glob,
  getVSCodeExtensionsPath
} from './utils/system.js';
import { runIfMain } from './utils/esm-cli.js';
import { createLogger } from './logging/Logger.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const logger = createLogger('agent-detector');

// Resolve config/agents/ directory relative to this file
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_CONFIG_DIR = path.join(__dirname, '..', 'config', 'agents');

/**
 * Parse an agent config shell file to extract key variables.
 * Reads AGENT_NAME, AGENT_COMMAND, and AGENT_REQUIRES_COMMANDS.
 */
function parseAgentConfig(configPath) {
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const get = (key) => {
      const match = content.match(new RegExp(`^${key}="?([^"\\n]+)"?`, 'm'));
      return match ? match[1].trim() : null;
    };
    return {
      name: get('AGENT_NAME'),
      command: get('AGENT_COMMAND'),
      // AGENT_REQUIRES_COMMANDS is a space-separated list of required binaries
      requiresCommands: (get('AGENT_REQUIRES_COMMANDS') || get('AGENT_COMMAND') || '').split(/\s+/).filter(Boolean)
    };
  } catch {
    return null;
  }
}

/**
 * Discover all configured agents from config/agents/*.sh
 */
function discoverAgentConfigs() {
  try {
    const files = fs.readdirSync(AGENTS_CONFIG_DIR).filter(f => f.endsWith('.sh'));
    return files.map(f => {
      const config = parseAgentConfig(path.join(AGENTS_CONFIG_DIR, f));
      return config ? { file: f, ...config } : null;
    }).filter(Boolean);
  } catch {
    return [];
  }
}

class AgentDetector {
  constructor() {
    // Build detection methods from config/agents/*.sh files
    this.agentConfigs = discoverAgentConfigs();
    this.detectionMethods = {};

    for (const config of this.agentConfigs) {
      if (config.name) {
        this.detectionMethods[config.name] = () => this.detectByCommand(config);
      }
    }

    // Fallback: ensure claude and copilot are always in detection even without configs
    if (!this.detectionMethods.claude) {
      this.detectionMethods.claude = () => this.detectByBinary('claude');
    }
    if (!this.detectionMethods.copilot) {
      this.detectionMethods.copilot = () => this.detectByBinary('copilot');
    }

    this.capabilities = {
      claude: ['mcp', 'browser', 'logging'],
      copilot: ['code-completion', 'chat']
    };
  }

  /**
   * Detect an agent by checking if its required command(s) exist
   */
  async detectByCommand(config) {
    try {
      // For commands that are paths (start with $ or /), just check the binary name
      for (const cmd of config.requiresCommands) {
        const binaryName = cmd.replace(/.*\//, '').replace(/^\$.*\//, '');
        // Skip path-based commands (e.g. $CODING_REPO/bin/claude-mcp) — check the base binary
        const checkCmd = binaryName.includes('/') ? path.basename(binaryName) : binaryName;
        if (checkCmd && !(await commandExists(checkCmd))) {
          return false;
        }
      }
      return true;
    } catch (error) {
      logger.error(`Error detecting ${config.name}`, { error: error.message });
      return false;
    }
  }

  /**
   * Detect an agent by checking a single binary name
   */
  async detectByBinary(binary) {
    try {
      return await commandExists(binary);
    } catch (error) {
      logger.error(`Error detecting ${binary}`, { error: error.message });
      return false;
    }
  }

  /**
   * Detect VSCode Specstory extension
   */
  async detectSpecstoryExtension() {
    try {
      const vscodeExtPath = getVSCodeExtensionsPath();
      const specstoryPaths = await glob(`${vscodeExtPath}/*specstory*`);
      return specstoryPaths.length > 0;
    } catch (error) {
      logger.error('Error detecting Specstory', { error: error.message });
      return false;
    }
  }

  /**
   * Detect all available agents
   */
  async detectAll() {
    const results = {};

    for (const [agent, detector] of Object.entries(this.detectionMethods)) {
      results[agent] = await detector();
    }

    // Also check for additional capabilities
    results.specstory = await this.detectSpecstoryExtension();

    return results;
  }

  /**
   * Get the best available agent (prefer Claude, then others in config order)
   */
  async getBest() {
    const detected = await this.detectAll();

    // Prefer Claude if available
    if (detected.claude) return 'claude';
    if (detected.copilot) return 'copilot';

    // Check remaining agents in discovery order
    for (const config of this.agentConfigs) {
      if (config.name && config.name !== 'claude' && config.name !== 'copilot' && detected[config.name]) {
        return config.name;
      }
    }

    return null;
  }

  /**
   * Get capabilities for a specific agent
   */
  getCapabilities(agent) {
    return this.capabilities[agent] || [];
  }

  /**
   * Check if running in CLI mode for output formatting
   */
  async runCLI(args) {
    const command = args[0];
    
    switch (command) {
      case '--best':
        const best = await this.getBest();
        console.log(best || 'none');
        break;
        
      case '--list-all':
        const all = await this.detectAll();
        const available = Object.entries(all)
          .filter(([_, detected]) => detected)
          .map(([agent]) => agent);
        console.log(available.join(' '));
        break;
        
      case '--output=name':
        const bestAgent = await this.getBest();
        console.log(bestAgent || 'none');
        break;
        
      case '--output=capabilities':
        const agent = await this.getBest();
        const caps = agent ? this.getCapabilities(agent) : [];
        console.log(caps.join(','));
        break;
        
      default:
        process.stderr.write(`Unknown command: ${command}\n`);
        process.exit(1);
    }
  }
}

// Run CLI if called directly (cross-platform compatible)
runIfMain(import.meta.url, () => {
  const detector = new AgentDetector();
  detector.runCLI(process.argv.slice(2));
});

export default AgentDetector;