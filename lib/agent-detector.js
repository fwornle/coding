import {
  commandExists,
  fileExists,
  executeCommand,
  glob,
  getVSCodeExtensionsPath
} from './utils/system.js';
import { runIfMain } from './utils/esm-cli.js';

class AgentDetector {
  constructor() {
    this.detectionMethods = {
      claude: this.detectClaude.bind(this),
      copilot: this.detectCoPilot.bind(this)
    };
    this.capabilities = {
      claude: ['mcp', 'browser', 'logging'],
      copilot: ['code-completion', 'chat']
    };
  }

  /**
   * Detect Claude Code with MCP support
   */
  async detectClaude() {
    try {
      // Check for claude command
      const hasClaudeCLI = await commandExists('claude');
      if (!hasClaudeCLI) return false;

      // Check for MCP config in multiple locations
      const mcpConfigPaths = [
        '~/.config/claude/claude_desktop_config.json',
        '~/Library/Application Support/Claude/claude_desktop_config.json'
      ];
      
      for (const configPath of mcpConfigPaths) {
        if (await fileExists(configPath)) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error('Error detecting Claude:', error);
      return false;
    }
  }

  /**
   * Detect GitHub CoPilot
   */
  async detectCoPilot() {
    try {
      // Check for GitHub CLI
      const hasGHCLI = await commandExists('gh');
      if (!hasGHCLI) return false;

      // Check for CoPilot extension
      const extensionList = await executeCommand('gh extension list').catch(() => '');
      const hasCoPilotExt = extensionList.includes('copilot');
      
      return hasCoPilotExt;
    } catch (error) {
      console.error('Error detecting CoPilot:', error);
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
      console.error('Error detecting Specstory:', error);
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
   * Get the best available agent (prefer Claude)
   */
  async getBest() {
    const detected = await this.detectAll();
    
    // Prefer Claude if available
    if (detected.claude) return 'claude';
    if (detected.copilot) return 'copilot';
    
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
        console.error('Unknown command:', command);
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