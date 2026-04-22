#!/usr/bin/env node

/**
 * Semantic Analyzer for Live Logging
 * AI analysis of tool interactions using configurable LLM providers (XAI/Grok, etc.)
 */

// Semantic analysis routed through LLM proxy bridge server (VPN-safe)
import http from 'node:http';

export class SemanticAnalyzer {
  constructor(apiKey, model = null) {
    if (!apiKey) {
      // apiKey kept for backward compat but not used — bridge handles auth
    }
    
    // Detect API type for logging only
    if (apiKey && apiKey.startsWith('xai-')) {
      this.apiType = 'xai';
      this.model = model || 'grok-2-1212';
    } else {
      this.apiType = 'openai';
      this.model = model || 'gpt-4o-mini';
    }
    
    this.apiKey = apiKey;
    this.proxyPort = parseInt(process.env.LLM_CLI_PROXY_PORT || '12435', 10);
    this.timeout = 15000; // 15 second timeout
  }
  
  /**
   * Call the LLM proxy bridge server instead of direct API
   */
  _callBridge(body) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const timer = setTimeout(() => reject(new Error('Bridge timeout')), this.timeout);
      const req = http.request({
        hostname: '127.0.0.1', port: this.proxyPort,
        path: '/api/complete', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          clearTimeout(timer);
          try { resolve(JSON.parse(data)); } catch { reject(new Error(`Bridge parse error: ${data.slice(0, 200)}`)); }
        });
      });
      req.on('error', e => { clearTimeout(timer); reject(e); });
      req.write(payload);
      req.end();
    });
  }

  /**
   * Shared LLM completion via bridge server
   */
  async _complete(messages, maxTokens = 200) {
    const data = await this._callBridge({ messages, model: this.model, max_tokens: maxTokens });
    return data.choices?.[0]?.message?.content?.trim() || data.text?.trim() || '';
  }

  /**
   * Analyze a tool interaction for insights
   */
  async analyzeToolInteraction(interaction, context = {}) {
    try {
      const prompt = this.buildAnalysisPrompt(interaction, context);
      const content = await this._complete([
        { role: 'system', content: 'You are an AI assistant that analyzes Claude Code tool interactions to provide brief, insightful observations. Keep responses concise and actionable.' },
        { role: 'user', content: prompt }
      ]);
      if (!content) {
        return { insight: 'Analysis completed', category: 'info' };
      }

      return this.parseAnalysisResponse(content, interaction);

    } catch (error) {
      console.error(`Grok analysis error: ${error.message}`);
      return { 
        insight: 'Analysis unavailable', 
        category: 'error',
        error: error.message 
      };
    }
  }

  /**
   * Build analysis prompt for tool interaction
   */
  buildAnalysisPrompt(interaction, context) {
    const { toolName, toolInput, toolResult, success } = interaction;
    const { userRequest, previousActions } = context;

    return `Analyze this Claude Code tool interaction:

**User Request:** ${userRequest || 'Not specified'}

**Tool Used:** ${toolName}
**Input:** ${JSON.stringify(toolInput, null, 2)}
**Result:** ${success ? 'Success' : 'Error'}
${toolResult ? `**Output:** ${typeof toolResult === 'string' ? toolResult.slice(0, 200) : JSON.stringify(toolResult).slice(0, 200)}` : ''}

**Previous Actions:** ${previousActions?.join(', ') || 'None'}

Provide a brief insight about:
1. What this tool interaction accomplished
2. Any patterns or potential improvements
3. Overall progress assessment

Format as: INSIGHT: [your observation] | CATEGORY: [info|success|warning|error]`;
  }

  /**
   * Parse the AI response into structured data
   */
  parseAnalysisResponse(content, interaction) {
    const lines = content.split('\n');
    let insight = '';
    let category = 'info';

    for (const line of lines) {
      if (line.startsWith('INSIGHT:')) {
        insight = line.replace('INSIGHT:', '').trim();
      } else if (line.startsWith('CATEGORY:')) {
        category = line.replace('CATEGORY:', '').trim().toLowerCase();
      }
    }

    // Fallback if parsing fails
    if (!insight) {
      insight = content.split('|')[0]?.trim() || content.trim();
    }

    // Validate category
    if (!['info', 'success', 'warning', 'error'].includes(category)) {
      category = 'info';
    }

    // Add tool-specific insights
    const toolInsight = this.getToolSpecificInsight(interaction);
    if (toolInsight) {
      insight = `${toolInsight} ${insight}`;
    }

    return {
      insight: insight.slice(0, 200), // Limit length
      category,
      timestamp: Date.now()
    };
  }

  /**
   * Get tool-specific insights
   */
  getToolSpecificInsight(interaction) {
    const { toolName, toolInput, success } = interaction;

    switch (toolName.toLowerCase()) {
      case 'edit':
      case 'multiedit':
        return success ? '📝 Code modified' : '❌ Edit failed';
      
      case 'write':
        return success ? '📄 File created' : '❌ Write failed';
      
      case 'read':
        const filePath = toolInput?.file_path || '';
        if (filePath.includes('.md')) return '📖 Documentation read';
        if (filePath.includes('.js') || filePath.includes('.ts')) return '💻 Code analyzed';
        return '📋 File examined';
      
      case 'bash':
        const command = toolInput?.command || '';
        if (command.includes('npm') || command.includes('yarn')) return '📦 Package management';
        if (command.includes('git')) return '🔄 Git operation';
        if (command.includes('test')) return '🧪 Tests executed';
        return success ? '✅ Command executed' : '❌ Command failed';
      
      case 'grep':
        return '🔍 Code search performed';
      
      case 'glob':
        return '📁 Files located';
      
      default:
        return success ? '⚙️ Tool executed' : '❌ Tool failed';
    }
  }

  /**
   * Classify conversation content for project routing
   * Determines if content is about coding infrastructure vs educational content
   */
  async classifyConversationContent(exchange, context = {}) {
    try {
      const userMessage = exchange.userMessage || '';
      const claudeResponse = exchange.claudeResponse || '';
      const toolCalls = exchange.toolCalls?.map(t => `${t.name}: ${JSON.stringify(t.input)}`).join('\n') || 'No tools used';
      
      const prompt = `Analyze this conversation exchange to determine if it's about coding infrastructure:

**User Message:** ${typeof userMessage === 'string' ? userMessage.slice(0, 500) : JSON.stringify(userMessage).slice(0, 500)}
**Assistant Response:** ${typeof claudeResponse === 'string' ? claudeResponse.slice(0, 500) : JSON.stringify(claudeResponse).slice(0, 500)}  
**Tools Used:** ${toolCalls}

**Classification Task:**
Determine if this conversation is primarily about CODING INFRASTRUCTURE or NOT.

**STRONG CODING_INFRASTRUCTURE indicators (high confidence):**
- LSL systems, live session logging, transcript monitoring, trajectory generation
- Batch mode, foreign mode, from-nano-degree files, redirected files
- Enhanced-transcript-monitor, generate-lsl scripts, session logs
- MCP servers, semantic analysis tools, reliable coding classifier
- Half-hour nomenclature, time windows, session files
- Development tools, build systems, script debugging
- Repository management, CI/CD, deployment systems

**MODERATE CODING_INFRASTRUCTURE indicators (medium confidence):**
- Code analysis, refactoring tools, testing frameworks
- Development workflows, tool development, infrastructure maintenance
- Knowledge management systems for coding projects

**NOT CODING_INFRASTRUCTURE (low confidence for coding):**
- Business logic, domain-specific content unrelated to development tooling
- User features, product documentation, tutorials, content creation
- General software usage discussions (not tool development)

**IMPORTANT:** Pay special attention to LSL-related keywords like "session logs", "batch mode", "foreign files", "redirected", "from-nano-degree" - these are ALWAYS coding infrastructure discussions.

Format: CLASSIFICATION: [CODING_INFRASTRUCTURE|NOT_CODING_INFRASTRUCTURE] | CONFIDENCE: [high|medium|low] | REASON: [brief explanation]`;

      const content = await this._complete([
        { role: 'system', content: 'You are a content classifier that determines whether conversations are about coding/development infrastructure or any other topic. Consider both semantic meaning AND specific technical keywords. LSL systems, session logs, batch mode, foreign files, and redirected files are ALWAYS coding infrastructure topics. Be precise - only classify as CODING_INFRASTRUCTURE if the conversation is actually about development tools, systems, or infrastructure.' },
        { role: 'user', content: prompt }
      ]);
      
      if (!content) {
        return this.fallbackClassification(exchange);
      }

      return this.parseClassificationResponse(content);

    } catch (error) {
      console.error(`Classification error: ${error.message}`);
      return this.fallbackClassification(exchange);
    }
  }

  /**
   * Parse classification response
   */
  parseClassificationResponse(content) {
    const lines = content.split('\n');
    let classification = 'NOT_CODING_INFRASTRUCTURE'; // Default to non-coding
    let confidence = 'medium';
    let reason = 'Default classification';

    for (const line of lines) {
      if (line.startsWith('CLASSIFICATION:')) {
        const cls = line.replace('CLASSIFICATION:', '').trim();
        if (['CODING_INFRASTRUCTURE', 'NOT_CODING_INFRASTRUCTURE'].includes(cls)) {
          classification = cls;
        }
      } else if (line.startsWith('CONFIDENCE:')) {
        const conf = line.replace('CONFIDENCE:', '').trim().toLowerCase();
        if (['high', 'medium', 'low'].includes(conf)) {
          confidence = conf;
        }
      } else if (line.startsWith('REASON:')) {
        reason = line.replace('REASON:', '').trim();
      }
    }

    return {
      classification,
      confidence,
      reason,
      timestamp: Date.now()
    };
  }

  /**
   * Fallback classification when API fails
   */
  fallbackClassification(exchange) {
    const combinedContent = (exchange.userMessage + ' ' + exchange.claudeResponse).toLowerCase();
    
    // Strong coding infrastructure indicators
    const codingKeywords = [
      'enhanced-transcript-monitor', 'transcript-monitor', 'lsl system', 'live session logging',
      'lsl', 'trajectory file', 'statusline', 'trajectory', 'semantic analysis', 'coding tools', 
      'generate-proper-lsl', 'redaction', 'tool development', 
      'ci/cd', 'repository management', 'mcp__semantic_analysis',
      'mcp__semantic-analysis', 'mcp integration', 'semantic analyzer'
    ];
    
    const codingScore = codingKeywords.filter(keyword => combinedContent.includes(keyword)).length;
    
    if (codingScore >= 2) {
      return {
        classification: 'CODING_INFRASTRUCTURE',
        confidence: 'medium',
        reason: `Fallback: Found ${codingScore} coding infrastructure keywords`,
        timestamp: Date.now()
      };
    } else {
      return {
        classification: 'NOT_CODING_INFRASTRUCTURE',
        confidence: 'low',
        reason: `Fallback: Default to non-coding (${codingScore} coding keywords found)`,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Analyze session summary
   */
  async analyzeSessionSummary(interactions, sessionDuration) {
    if (interactions.length === 0) {
      return { summary: 'No activities recorded', productivity: 'unknown' };
    }

    try {
      const toolCounts = this.countToolUsage(interactions);
      const successRate = interactions.filter(i => i.success).length / interactions.length;
      
      const prompt = `Analyze this Claude Code session:

**Duration:** ${Math.round(sessionDuration / 60000)} minutes
**Tool Interactions:** ${interactions.length}
**Success Rate:** ${Math.round(successRate * 100)}%
**Tool Usage:** ${Object.entries(toolCounts).map(([tool, count]) => `${tool}:${count}`).join(', ')}

Recent activities:
${interactions.slice(-5).map(i => `- ${i.toolName}: ${i.success ? 'success' : 'failed'}`).join('\n')}

Provide a brief session summary and productivity assessment.
Format as: SUMMARY: [your summary] | PRODUCTIVITY: [high|medium|low]`;

      const content = await this._complete([
        { role: 'system', content: 'You are an AI assistant that analyzes coding session productivity. Be encouraging and constructive.' },
        { role: 'user', content: prompt }
      ], 150);
      return this.parseSessionSummary(content || '', interactions);

    } catch (error) {
      console.error(`Session analysis error: ${error.message}`);
      return { 
        summary: 'Session analysis unavailable', 
        productivity: 'unknown' 
      };
    }
  }

  /**
   * Count tool usage
   */
  countToolUsage(interactions) {
    const counts = {};
    for (const interaction of interactions) {
      counts[interaction.toolName] = (counts[interaction.toolName] || 0) + 1;
    }
    return counts;
  }

  /**
   * Parse session summary response
   */
  parseSessionSummary(content, interactions) {
    const lines = content.split('\n');
    let summary = '';
    let productivity = 'medium';

    for (const line of lines) {
      if (line.startsWith('SUMMARY:')) {
        summary = line.replace('SUMMARY:', '').trim();
      } else if (line.startsWith('PRODUCTIVITY:')) {
        productivity = line.replace('PRODUCTIVITY:', '').trim().toLowerCase();
      }
    }

    // Fallback
    if (!summary) {
      summary = content.split('|')[0]?.trim() || 'Session completed';
    }

    // Validate productivity
    if (!['high', 'medium', 'low'].includes(productivity)) {
      productivity = interactions.length > 20 ? 'high' : 
                   interactions.length > 10 ? 'medium' : 'low';
    }

    return {
      summary: summary.slice(0, 150),
      productivity,
      toolCount: interactions.length,
      successRate: Math.round((interactions.filter(i => i.success).length / interactions.length) * 100)
    };
  }
}