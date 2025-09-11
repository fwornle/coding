#!/usr/bin/env node

/**
 * Semantic Analyzer for Live Logging
 * AI analysis of tool interactions using configurable LLM providers (XAI/Grok, etc.)
 */

// Semantic analysis with multiple provider support - direct HTTP approach

export class SemanticAnalyzer {
  constructor(apiKey, model = null) {
    if (!apiKey) {
      throw new Error('Semantic API key is required');
    }
    
    // Detect API type based on key prefix
    if (apiKey.startsWith('xai-')) {
      this.apiType = 'xai';
      this.baseURL = 'https://api.x.ai/v1';
      // Use the correct XAI model name - try common ones
      this.model = model || 'grok-2-1212';
    } else {
      this.apiType = 'openai';
      this.baseURL = 'https://api.openai.com/v1';
      this.model = model || 'gpt-4o-mini';
    }
    
    this.apiKey = apiKey;
    this.timeout = 10000; // 10 second timeout
  }

  /**
   * Analyze a tool interaction for insights
   */
  async analyzeToolInteraction(interaction, context = {}) {
    try {
      const prompt = this.buildAnalysisPrompt(interaction, context);
      
      const requestBody = {
        messages: [
          {
            role: 'system',
            content: 'You are an AI assistant that analyzes Claude Code tool interactions to provide brief, insightful observations. Keep responses concise and actionable.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        model: this.model,
        temperature: 0.7,
        max_tokens: 200
      };

      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.timeout)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(`${response.status} ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content?.trim();
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
   * Merge previous trajectory with new session to create updated trajectory summary
   */
  async mergeTrajectoryWithSession(previousTrajectory, sessionContent, sessionWindow) {
    if (!sessionContent || sessionContent.trim().length === 0) {
      return previousTrajectory;
    }

    try {
      const prompt = `Analyze the project evolution and create a concise trajectory update.

**Previous Context (excerpt):**
${previousTrajectory.substring(0, 1000)}

**New Session (${sessionWindow}):**
${sessionContent.substring(0, 1000)}

Create a 2-3 paragraph project trajectory summary that:
- Integrates new session developments with previous context
- Focuses on strategic project evolution and progress
- Maintains project focus rather than technical process details
- Stays under 250 words total

Return ONLY these three lines with no additional text or formatting:
TRAJECTORY_SUMMARY: [Your concise 2-3 paragraph summary here]
PROJECT_STATUS: [Active|Maintenance|Planning|Blocked]
KEY_FOCUS: [Primary focus in 5-8 words]`;

      const requestBody = {
        messages: [
          {
            role: 'system',
            content: 'You create concise project trajectory summaries. Return exactly the requested format with no extra text, headers, or markdown formatting.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        model: this.model,
        max_tokens: 400,
        temperature: 0.2
      };

      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.timeout)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(`${response.status} ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) {
        return {
          summary: previousTrajectory,
          status: 'Active',
          focus: 'Project development',
          timestamp: new Date().toISOString()
        };
      }

      return this.parseTrajectoryResponse(content, previousTrajectory);
      
    } catch (error) {
      console.error('Error merging trajectory:', error.message);
      return {
        summary: previousTrajectory,
        status: 'Active', 
        focus: 'Project development',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Parse trajectory merge response
   */
  parseTrajectoryResponse(content, fallback) {
    const lines = content.split('\n');
    let summary = '';
    let status = 'Active';
    let focus = '';

    for (const line of lines) {
      if (line.startsWith('TRAJECTORY_SUMMARY:')) {
        summary = line.replace('TRAJECTORY_SUMMARY:', '').trim();
      } else if (line.startsWith('PROJECT_STATUS:')) {
        status = line.replace('PROJECT_STATUS:', '').trim();
      } else if (line.startsWith('KEY_FOCUS:')) {
        focus = line.replace('KEY_FOCUS:', '').trim();
      }
    }

    // Fallback parsing if structured format not found
    if (!summary) {
      summary = content.trim();
    }

    return {
      summary: summary || fallback,
      status: status || 'Active',
      focus: focus || 'Project development',
      timestamp: new Date().toISOString()
    };
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

**User Message:** ${userMessage.slice(0, 500)}
**Assistant Response:** ${claudeResponse.slice(0, 500)}  
**Tools Used:** ${toolCalls}

**Classification Task:**
Determine if this conversation is primarily about CODING INFRASTRUCTURE or NOT.

**CODING_INFRASTRUCTURE indicators:**
- Development tools, environments, build systems
- LSL systems, transcript monitoring, trajectory generation  
- Semantic analysis tools, logging systems
- Script debugging, tool development, infrastructure maintenance
- Development workflows, CI/CD, deployment systems
- Code analysis, refactoring tools, testing frameworks
- Repository management, version control systems

**NOT CODING_INFRASTRUCTURE:**
- Any other topic (business logic, domain-specific content, user features, documentation, tutorials, etc.)
- Domain-specific discussions unrelated to development tooling
- Content creation, design, planning discussions
- General software usage (not tool development)

Focus on the PRIMARY semantic content, not incidental tool usage.

Format: CLASSIFICATION: [CODING_INFRASTRUCTURE|NOT_CODING_INFRASTRUCTURE] | CONFIDENCE: [high|medium|low] | REASON: [brief explanation]`;

      const requestBody = {
        messages: [
          {
            role: 'system',
            content: 'You are a content classifier that determines whether conversations are about coding/development infrastructure or any other topic. Focus on semantic meaning, not just keywords. Be domain-agnostic - only detect coding infrastructure vs everything else.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        model: this.model,
        temperature: 0.1,  // Low temperature for consistent classification
        max_tokens: 200
      };

      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.timeout)
      });

      if (!response.ok) {
        console.error(`Classification API error: ${response.status}`);
        return this.fallbackClassification(exchange);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      
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

      const response = await this.client.chat.completions.create({
        messages: [
          {
            role: 'system',
            content: 'You are an AI assistant that analyzes coding session productivity. Be encouraging and constructive.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        model: this.model,
        temperature: 0.6,
        max_tokens: 150,
        timeout: this.timeout
      });

      const content = response.choices[0]?.message?.content?.trim() || '';
      return this.parseSessionSummary(content, interactions);

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