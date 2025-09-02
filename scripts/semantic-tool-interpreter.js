#!/usr/bin/env node

/**
 * Semantic Tool Interpreter
 * Transforms tool calls into meaningful, human-readable summaries
 * Replaces uninformative "[Tool: X]" with descriptive exchange summaries
 */

class SemanticToolInterpreter {
  constructor() {
    this.resultCache = new Map();
    this.cacheTimeout = 60000; // 1 minute cache
  }

  /**
   * Create meaningful summary of tool interaction
   */
  async summarize(toolCall, result, conversationContext = {}) {
    const { name: tool, params = {} } = toolCall;
    
    try {
      // Route to appropriate interpreter
      const interpreter = this.getInterpreter(tool);
      return await interpreter.call(this, tool, params, result, conversationContext);
    } catch (error) {
      console.warn(`Tool interpretation error for ${tool}:`, error.message);
      return this.genericSummary(tool, params, result);
    }
  }

  getInterpreter(tool) {
    const interpreters = {
      'Glob': this.interpretGlob,
      'Read': this.interpretRead,
      'Edit': this.interpretEdit,
      'MultiEdit': this.interpretMultiEdit,
      'Write': this.interpretWrite,
      'Bash': this.interpretBash,
      'TodoWrite': this.interpretTodo,
      'WebFetch': this.interpretWebFetch,
      'WebSearch': this.interpretWebSearch,
      'Grep': this.interpretGrep,
      'NotebookEdit': this.interpretNotebook,
      'Task': this.interpretTask
    };

    // Handle MCP tools
    if (tool.startsWith('mcp__')) {
      return this.interpretMCP;
    }

    return interpreters[tool] || this.genericSummary;
  }

  // File System Operations
  interpretGlob(tool, params, result) {
    const files = result.split('\n').filter(f => f.trim()).length;
    const pattern = params.pattern;
    const location = params.path || 'current directory';
    
    return {
      type: 'search',
      icon: '🔍',
      summary: files > 0 ? 
        `Found ${files} files matching \`${pattern}\` in ${location}` :
        `No files found matching \`${pattern}\` in ${location}`,
      details: files > 0 ? result.split('\n').filter(f => f.trim()).slice(0, 3).join('\n') + 
        (files > 3 ? `\n... and ${files - 3} more` : '') : null
    };
  }

  interpretRead(tool, params, result) {
    const filename = params.file_path.split('/').pop();
    const lines = result.split('\n').length;
    const hasOffset = params.offset || params.limit;
    
    return {
      type: 'read',
      icon: '📖',
      summary: `Read \`${filename}\` (${lines} lines)${
        hasOffset ? ` - lines ${params.offset || 1}-${(params.offset || 1) + (params.limit || lines)}` : ''
      }`,
      details: result.includes('error>') ? 'File not found or permission denied' : null
    };
  }

  interpretEdit(tool, params, result) {
    const filename = params.file_path.split('/').pop();
    const oldLen = params.old_string.length;
    const newLen = params.new_string.length;
    const changeType = newLen > oldLen ? 'expanded' : newLen < oldLen ? 'reduced' : 'modified';
    
    return {
      type: 'edit',
      icon: '✏️',
      summary: `Modified \`${filename}\` - ${changeType} content${
        params.replace_all ? ' (all occurrences)' : ''
      }`,
      details: `"${params.old_string.slice(0, 40)}${oldLen > 40 ? '...' : ''}" → "${params.new_string.slice(0, 40)}${newLen > 40 ? '...' : ''}"`
    };
  }

  interpretMultiEdit(tool, params, result) {
    const filename = params.file_path.split('/').pop();
    const editCount = params.edits.length;
    
    return {
      type: 'edit',
      icon: '✏️',
      summary: `Applied ${editCount} edits to \`${filename}\``,
      details: params.edits.map((edit, i) => 
        `${i + 1}. "${edit.old_string.slice(0, 30)}${edit.old_string.length > 30 ? '...' : ''}" → "${edit.new_string.slice(0, 30)}${edit.new_string.length > 30 ? '...' : ''}"`
      ).slice(0, 3).join('\n') + (editCount > 3 ? `\n... and ${editCount - 3} more edits` : '')
    };
  }

  interpretWrite(tool, params, result) {
    const filename = params.file_path.split('/').pop();
    const contentLength = params.content.length;
    const lines = params.content.split('\n').length;
    
    return {
      type: 'write',
      icon: '📝',
      summary: `Created/overwrote \`${filename}\` (${lines} lines, ${contentLength} chars)`,
      details: null
    };
  }

  // Command Operations
  interpretBash(tool, params, result) {
    const command = params.command;
    const cmd = command.split(' ')[0];
    const success = !result.includes('error') && !result.includes('Error') && !result.includes('command not found');
    const description = params.description || 'executed command';
    
    return {
      type: 'command',
      icon: success ? '⚡' : '❌',
      summary: `${success ? 'Executed' : 'Failed'}: \`${cmd}\` - ${description}`,
      details: success ? result.slice(0, 200) + (result.length > 200 ? '...' : '') : result
    };
  }

  // Search Operations
  interpretGrep(tool, params, result) {
    const pattern = params.pattern;
    const fileCount = params.output_mode === 'files_with_matches' ? 
      result.split('\n').filter(f => f.trim()).length :
      result.split('\n').length;
    
    return {
      type: 'search',
      icon: '🔍',
      summary: `Searched for \`${pattern}\` - found ${fileCount} ${params.output_mode === 'files_with_matches' ? 'files' : 'matches'}`,
      details: fileCount > 0 ? result.split('\n').slice(0, 3).join('\n') + 
        (fileCount > 3 ? `\n... ${fileCount - 3} more` : '') : 'No matches found'
    };
  }

  // Web Operations
  interpretWebFetch(tool, params, result) {
    const url = params.url;
    const domain = url.replace(/https?:\/\//, '').split('/')[0];
    
    return {
      type: 'web',
      icon: '🌐',
      summary: `Fetched content from ${domain}`,
      details: `Prompt: "${params.prompt.slice(0, 60)}${params.prompt.length > 60 ? '...' : ''}"`
    };
  }

  interpretWebSearch(tool, params, result) {
    const query = params.query;
    
    return {
      type: 'web',
      icon: '🔍',
      summary: `Web search: "${query}"`,
      details: result.includes('search result') ? 'Found search results' : 'No results returned'
    };
  }

  // Task Management
  interpretTodo(tool, params, result) {
    const todos = params.todos || [];
    const completed = todos.filter(t => t.status === 'completed').length;
    const inProgress = todos.filter(t => t.status === 'in_progress').length;
    const pending = todos.filter(t => t.status === 'pending').length;
    
    return {
      type: 'task',
      icon: '📋',
      summary: `Updated todos: ${completed} completed, ${inProgress} in progress, ${pending} pending`,
      details: todos.length > 0 ? todos.map(t => `${t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⏳'} ${t.content}`).slice(0, 3).join('\n') : null
    };
  }

  interpretTask(tool, params, result) {
    const description = params.description || 'task execution';
    const agent = params.subagent_type || 'general-purpose';
    
    return {
      type: 'agent',
      icon: '🤖',
      summary: `Launched ${agent} agent: ${description}`,
      details: `Agent task: "${params.prompt.slice(0, 100)}${params.prompt.length > 100 ? '...' : ''}"`
    };
  }

  interpretNotebook(tool, params, result) {
    const filename = params.notebook_path.split('/').pop();
    const mode = params.edit_mode || 'replace';
    const cellType = params.cell_type || 'code';
    
    return {
      type: 'notebook',
      icon: '📓',
      summary: `${mode} ${cellType} cell in \`${filename}\``,
      details: params.new_source ? `Content: "${params.new_source.slice(0, 60)}${params.new_source.length > 60 ? '...' : ''}"` : null
    };
  }

  // MCP Tools
  interpretMCP(tool, params, result, conversationContext) {
    const mcpServer = tool.split('__')[1] || 'unknown';
    const mcpTool = tool.split('__')[2] || tool;
    
    const serverNames = {
      'memory': 'Knowledge Graph',
      'semantic-analysis': 'Semantic Analysis',
      'constraint-monitor': 'Constraint Monitor',
      'browser-access': 'Browser Automation',
      'ide': 'IDE Integration'
    };
    
    const serverIcon = {
      'memory': '🧠',
      'semantic-analysis': '🔬',
      'constraint-monitor': '🛡️',
      'browser-access': '🌐',
      'ide': '💻'
    }[mcpServer] || '🔧';
    
    const serverName = serverNames[mcpServer] || mcpServer;
    
    return {
      type: 'mcp',
      icon: serverIcon,
      summary: `${serverName}: ${this.humanizeMCPTool(mcpTool)}`,
      details: this.summarizeMCPResult(result)
    };
  }

  humanizeMCPTool(tool) {
    const toolMap = {
      'search_nodes': 'searched knowledge graph',
      'create_entities': 'created knowledge entities',
      'read_graph': 'read knowledge graph',
      'analyze_code': 'analyzed code patterns',
      'determine_insights': 'extracted insights',
      'get_constraint_status': 'checked compliance status',
      'stagehand_navigate': 'navigated browser',
      'getDiagnostics': 'retrieved IDE diagnostics'
    };
    
    return toolMap[tool] || tool.replace(/_/g, ' ');
  }

  summarizeMCPResult(result) {
    if (typeof result === 'object') {
      if (result.entities) {
        return `Found ${result.entities.length} entities`;
      }
      if (result.status) {
        return `Status: ${result.status}`;
      }
      if (result.compliance_score) {
        return `Compliance: ${result.compliance_score}/10`;
      }
      return Object.keys(result).slice(0, 3).join(', ');
    }
    
    return typeof result === 'string' && result.length > 100 ? 
      result.slice(0, 100) + '...' : result;
  }

  // Generic fallback
  genericSummary(tool, params, result) {
    // Better parameter summary
    const paramSummary = Object.keys(params).length > 0 ? 
      Object.keys(params).slice(0, 3).join(', ') : 'executed';
    
    // Better result display
    let resultDisplay;
    if (typeof result === 'string') {
      resultDisplay = result.length > 100 ? result.slice(0, 100) + '...' : result;
    } else if (typeof result === 'object' && result !== null) {
      try {
        const resultStr = JSON.stringify(result, null, 2);
        resultDisplay = resultStr.length > 200 ? 
          resultStr.slice(0, 200) + '...' : resultStr;
      } catch (error) {
        resultDisplay = `[Object with ${Object.keys(result).length} properties]`;
      }
    } else {
      resultDisplay = String(result);
    }
    
    return {
      type: 'unknown',
      icon: '🔧',
      summary: `${tool}: ${paramSummary}`,
      details: resultDisplay
    };
  }
}

export default SemanticToolInterpreter;