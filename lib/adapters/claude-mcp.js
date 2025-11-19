const AgentAdapter = require('../agent-adapter');
const { executeCommand, fileExists } = require('../utils/system');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class ClaudeMCPAdapter extends AgentAdapter {
  constructor(config = {}) {
    super(config);
    this.capabilities = ['mcp', 'browser', 'logging'];
    this.mcpConfigPath = null;
    this.mcpConfig = null;
  }

  async initialize() {
    try {
      // Find and load MCP configuration
      this.mcpConfigPath = await this.findMCPConfig();
      if (!this.mcpConfigPath) {
        throw new Error('MCP configuration not found');
      }

      // Load the processed MCP config from the project
      const processedConfigPath = path.join(process.cwd(), 'claude-code-mcp-processed.json');
      if (await fileExists(processedConfigPath)) {
        const configContent = await fs.readFile(processedConfigPath, 'utf8');
        this.mcpConfig = JSON.parse(configContent);
      } else {
        throw new Error('Processed MCP configuration not found. Run install.sh first.');
      }

      // Check if sync is required
      await this.checkAndSyncMemory();

      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize Claude MCP adapter: ${error.message}`);
    }
  }

  async findMCPConfig() {
    const configPaths = [
      path.join(os.homedir(), '.config', 'claude', 'claude_desktop_config.json'),
      path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    ];

    for (const configPath of configPaths) {
      if (await fileExists(configPath)) {
        return configPath;
      }
    }

    return null;
  }

  async checkAndSyncMemory() {
    const syncPath = path.join(process.cwd(), '.mcp-sync', 'sync-required.json');
    if (await fileExists(syncPath)) {
      console.log('🔄 MCP memory sync required, will be handled by Claude on startup');
    }
  }

  async executeCommand(command = '', args = []) {
    const configArg = this.mcpConfigPath ? `--config "${this.mcpConfigPath}"` : '';
    const fullCommand = `claude ${configArg} ${command} ${args.join(' ')}`.trim();
    return await executeCommand(fullCommand);
  }

  // Browser operations - These will be handled by Claude's MCP tools
  async browserNavigate(url) {
    console.log('Browser operations require Claude Code to be running with MCP');
    return { 
      success: true, 
      message: 'Use mcp__browser-access__stagehand_navigate tool in Claude'
    };
  }

  async browserAct(action, variables = {}) {
    console.log('Browser operations require Claude Code to be running with MCP');
    return { 
      success: true, 
      message: 'Use mcp__browser-access__stagehand_act tool in Claude'
    };
  }

  async browserExtract() {
    console.log('Browser operations require Claude Code to be running with MCP');
    return { 
      success: true, 
      message: 'Use mcp__browser-access__stagehand_extract tool in Claude'
    };
  }

  // Logging operations
  async logConversation(data) {
    // Claude's logging is handled by the MCP logger server
    const logDir = path.join(process.cwd(), '.specstory', 'history');
    await fs.mkdir(logDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(logDir, `claude-${timestamp}.json`);
    
    await fs.writeFile(logFile, JSON.stringify({
      agent: 'claude',
      timestamp: new Date().toISOString(),
      ...data
    }, null, 2));
    
    return { success: true, logFile };
  }

  async readConversationHistory(options = {}) {
    const logDir = path.join(process.cwd(), '.specstory', 'history');
    
    try {
      const files = await fs.readdir(logDir);
      const claudeLogs = files.filter(f => f.startsWith('claude-') && f.endsWith('.json'));
      
      const logs = [];
      for (const file of claudeLogs) {
        const content = await fs.readFile(path.join(logDir, file), 'utf8');
        logs.push(JSON.parse(content));
      }
      
      return logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
      return [];
    }
  }
}

module.exports = ClaudeMCPAdapter;